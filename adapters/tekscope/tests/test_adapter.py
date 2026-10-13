from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from tekscope_arb_adapter import (  # noqa: E402
    MSO2_SAFE_WRITE_BYTES,
    MSO6_BACKEND,
    MSO6_MAX_ARB_POINTS,
    MSO6_MAX_FREQUENCY_HZ,
    MSO6_MAX_SAMPLE_RATE_SA,
    MSO6_MIN_FREQUENCY_HZ,
    AdapterOptions,
    TekScopeAdapterError,
    definite_block,
    encode_csv,
    encode_tekscope_csv,
    parse_cwd_response,
    send_waveform_mso2,
    send_waveform_mso6,
    upload_file_and_configure,
    validate_scope_path,
)


class FakeInstrument:
    def __init__(self, *, identity="TEKTRONIX,MSO22,SN1,2.26.13", read_suffix=b""):
        self.identity = identity
        self.read_suffix = read_suffix
        self.timeout = None
        self.write_termination = None
        self.read_termination = None
        self.query_delay = None
        self.send_end = None
        self.closed = False
        self.commands = []
        self.raw_writes = []
        self.files = {}
        self.cwd = "C:/original/"
        self.directory_header = ""
        self.directory_response = None
        self.pending_read = b""
        self.state = {
            "AFG:ARBITRARY:SOURCE": '""',
            "AFG:FUNCTION": "SINE",
            "AFG:FREQUENCY": "1000",
            "AFG:AMPLITUDE": "1",
            "AFG:OFFSET": "0",
            "AFG:OUTPUT:LOAD:IMPEDANCE": "HIGHZ",
            "AFG:OUTPUT:STATE": "0",
        }

    def close(self):
        self.closed = True

    def write_raw(self, message):
        self.raw_writes.append(message)
        prefix = b'FILESystem:WRITEFile "'
        assert message.startswith(prefix)
        path_end = message.index(b'",', len(prefix))
        path = message[len(prefix):path_end].decode("ascii")
        block = message[path_end + 2 :]
        digits = int(chr(block[1]))
        size = int(block[2 : 2 + digits])
        payload = block[2 + digits :]
        assert len(payload) == size
        if path in self.files:
            raise RuntimeError("Destination already exists")
        self.files[path] = payload

    def write(self, command):
        self.commands.append(command)
        if command.startswith("FILESystem:CWD "):
            self.cwd = command.split('"', 2)[1]
            return
        if command.startswith("FILESystem:DELEte "):
            path = command.split('"', 2)[1]
            key = next(key for key in self.files if key.casefold() == path.casefold())
            del self.files[key]
            return
        if command.startswith("FILESystem:READFile "):
            path = command.split('"', 2)[1]
            self.pending_read = self.files[path]
            return
        header, _, value = command.partition(" ")
        self.state[header.upper()] = value.strip()

    def read_raw(self):
        return self.pending_read + self.read_suffix

    def query(self, command):
        self.commands.append(command)
        if command == "*IDN?":
            return self.identity
        if command == "*ESR?":
            return "0"
        if command == "*OPC?":
            return "1"
        if command == "ALLEV?":
            return ""
        if command == "FILESystem:CWD?":
            return f'{self.directory_header.replace("DIR", "CWD")}"{self.cwd}"'
        if command == "FILESystem:DIR?":
            if self.directory_response is not None:
                return self.directory_response
            directory = self.cwd.rstrip("/").casefold()
            names = [path.rpartition("/")[2] for path in self.files
                     if path.rpartition("/")[0].casefold() == directory]
            return self.directory_header + ",".join(f'"{name}"' for name in names)
        header = command[:-1].upper()
        return self.state[header]


class FakeManager:
    def __init__(self, instrument):
        self.instrument = instrument
        self.closed = False

    def open_resource(self, _resource):
        return self.instrument

    def close(self):
        self.closed = True


class TekScopeAdapterTests(unittest.TestCase):
    def test_definite_block_digit_boundaries(self):
        self.assertEqual(definite_block(b"1" * 9)[:3], b"#19")
        self.assertEqual(definite_block(b"1" * 10)[:4], b"#210")
        self.assertEqual(definite_block(b"1" * 99)[:4], b"#299")
        self.assertEqual(definite_block(b"1" * 100)[:5], b"#3100")

    def test_path_validation_and_cwd_parsing(self):
        self.assertEqual(validate_scope_path(r"C:\baldee\wave.csv"), "C:/baldee/wave.csv")
        self.assertEqual(parse_cwd_response('"C:"'), "C:")
        self.assertEqual(parse_cwd_response(':FILESYSTEM:CWD "E:/waveforms/"'), "E:/waveforms/")
        for invalid in ("relative.csv", 'C:/bad"name.csv', "C:/bad\nname.csv", "C:/é.csv"):
            with self.subTest(invalid=invalid), self.assertRaises(TekScopeAdapterError):
                validate_scope_path(invalid)

    def test_encode_csv_preserves_binary_sensitive_characters_as_ascii_rows(self):
        payload = encode_csv([0.0, 1.25, -2.5])
        self.assertEqual(payload, b"0\n1.25\n-2.5\n")

    def test_encode_tekscope_csv_matches_scope_waveform_shape(self):
        payload = encode_tekscope_csv([0.0, 1.0, 0.0, -1.0], 1000)
        text = payload.decode("ascii")
        self.assertTrue(text.startswith("Model,MSO22\r\nLabel,\r\nWaveform Type,ANALOG\r\n"))
        self.assertIn("Sample Interval,2.50000000e-04\r\n", text)
        self.assertIn("Record Length,4\r\nZero Index,1.00000000\r\n", text)
        self.assertIn("\r\nLabels,\r\nTIME,CH1\r\n", text)
        self.assertTrue(text.endswith("5.00000000e-04,-1.00000000e+00\r\n"))

    def test_encode_tekscope_csv_uses_the_selected_mso6_model(self):
        payload = encode_tekscope_csv(
            [0.0, 1.0, 0.0, -1.0],
            1000,
            model="MSO64B",
            max_points=MSO6_BACKEND.max_arb_points,
        )
        self.assertTrue(payload.startswith(b"Model,MSO64B\r\n"))

    def test_csv_depths_track_the_vxi11_write_ceiling(self):
        short_payload = encode_tekscope_csv([-1.0] * 240, 1000)
        long_payload = encode_tekscope_csv([-1.0] * 245, 1000)
        thousand_point_payload = encode_tekscope_csv([0.0] * 1000, 1000)

        self.assertLess(len(short_payload), MSO2_SAFE_WRITE_BYTES)
        self.assertGreaterEqual(len(long_payload), MSO2_SAFE_WRITE_BYTES)
        self.assertGreaterEqual(len(thousand_point_payload), MSO2_SAFE_WRITE_BYTES)

    def test_adapter_options_reject_unknown_and_wrong_channel(self):
        with self.assertRaisesRegex(TekScopeAdapterError, "Unknown TekScope option"):
            AdapterOptions.from_mapping({"mystery": True})
        with self.assertRaisesRegex(TekScopeAdapterError, "channel 1"):
            AdapterOptions.from_mapping({"channel": 2})

    def test_overwrite_option_is_opt_in_and_boolean(self):
        self.assertFalse(AdapterOptions.from_mapping({}).overwrite)
        self.assertTrue(AdapterOptions.from_mapping({"overwrite": True}).overwrite)
        for invalid in (1, "true", None):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(TekScopeAdapterError, "overwrite must be boolean"):
                AdapterOptions.from_mapping({"overwrite": invalid})

    def test_existing_file_requires_overwrite_without_changing_afg(self):
        for identity, backend_id in (("MSO22", "tekscope-mso2"), ("MSO64B", "tekscope-mso6")):
            with self.subTest(backend=backend_id):
                from tekscope_arb_adapter.adapter import BACKENDS_BY_ID
                instrument = FakeInstrument(identity=f"TEKTRONIX,{identity},SN1,1.0")
                instrument.files["C:/baldee/TEST.csv"] = b"original"
                instrument.state["AFG:OUTPUT:STATE"] = "1"
                manager = FakeManager(instrument)
                with self.assertRaisesRegex(TekScopeAdapterError, "Change the project name.*Overwrite waveform file") as context:
                    upload_file_and_configure(
                        "TCPIP0::scope::INSTR", b"0\n1\n", "C:/baldee/test.csv",
                        frequency_hz=1000, amplitude_vpp=1, offset_voltage=0,
                        backend=BACKENDS_BY_ID[backend_id], manager_factory=lambda: manager,
                    )
                self.assertEqual(context.exception.code, "waveform_file_exists")
                self.assertEqual(instrument.files["C:/baldee/TEST.csv"], b"original")
                self.assertEqual(instrument.state["AFG:OUTPUT:STATE"], "1")
                self.assertFalse(instrument.raw_writes)
                self.assertFalse(any(command.startswith("FILESystem:DELEte") for command in instrument.commands))
                self.assertEqual(instrument.cwd, "C:/original/")
                self.assertTrue(manager.closed)
                self.assertTrue(instrument.closed)

    def test_overwrite_replaces_existing_file_for_both_backends(self):
        from tekscope_arb_adapter.adapter import BACKENDS_BY_ID
        for model, backend_id in (("MSO22", "tekscope-mso2"), ("MSO64B", "tekscope-mso6")):
            with self.subTest(backend=backend_id):
                instrument = FakeInstrument(identity=f"TEKTRONIX,{model},SN1,1.0")
                instrument.files["C:/baldee/test.csv"] = b"original"
                instrument.files["C:/baldee/other.csv"] = b"keep"
                instrument.directory_header = ":FILESYSTEM:DIR "
                result = upload_file_and_configure(
                    "TCPIP0::scope::INSTR", b"0\n1\n", "C:/baldee/test.csv",
                    frequency_hz=1000, amplitude_vpp=1, offset_voltage=0, overwrite=True,
                    backend=BACKENDS_BY_ID[backend_id], manager_factory=lambda: FakeManager(instrument),
                )
                self.assertTrue(result["overwritten"])
                self.assertTrue(result["readback_verified"])
                self.assertEqual(instrument.files["C:/baldee/test.csv"], b"0\n1\n")
                self.assertEqual(instrument.files["C:/baldee/other.csv"], b"keep")
                self.assertEqual(instrument.cwd, "C:/original/")
                self.assertLess(instrument.commands.index("AFG:OUTPut:STATE OFF"),
                                instrument.commands.index('FILESystem:DELEte "C:/baldee/test.csv"'))

    def test_directory_failure_restores_cwd_and_aborts_before_upload(self):
        instrument = FakeInstrument()
        instrument.directory_response = "unrecognized response"
        with self.assertRaisesRegex(TekScopeAdapterError, "Could not parse FILESystem:DIR"):
            upload_file_and_configure(
                "TCPIP0::scope::INSTR", b"0\n1\n", "C:/baldee/test.csv",
                frequency_hz=1000, amplitude_vpp=1, offset_voltage=0, overwrite=True,
                manager_factory=lambda: FakeManager(instrument),
            )
        self.assertEqual(instrument.cwd, "C:/original/")
        self.assertFalse(instrument.raw_writes)
        self.assertNotIn("AFG:OUTPut:STATE OFF", instrument.commands)

    def test_delete_failure_aborts_without_writing(self):
        instrument = FakeInstrument()
        instrument.files["C:/baldee/test.csv"] = b"original"
        original_write = instrument.write
        def fail_delete(command):
            if command.startswith("FILESystem:DELEte"):
                raise RuntimeError("read-only file")
            original_write(command)
        instrument.write = fail_delete
        with self.assertRaisesRegex(TekScopeAdapterError, "read-only file"):
            upload_file_and_configure(
                "TCPIP0::scope::INSTR", b"0\n1\n", "C:/baldee/test.csv",
                frequency_hz=1000, amplitude_vpp=1, offset_voltage=0, overwrite=True,
                manager_factory=lambda: FakeManager(instrument),
            )
        self.assertFalse(instrument.raw_writes)
        self.assertEqual(instrument.files["C:/baldee/test.csv"], b"original")

    def test_oversized_mso2_write_is_rejected_after_identity_before_state_change(self):
        instrument = FakeInstrument()
        manager = FakeManager(instrument)

        with self.assertRaisesRegex(TekScopeAdapterError, "safe maximum") as context:
            upload_file_and_configure(
                "TCPIP0::scope::INSTR",
                b"x" * MSO2_SAFE_WRITE_BYTES,
                "C:/baldee/large.csv",
                frequency_hz=1000,
                amplitude_vpp=1,
                offset_voltage=0,
                manager_factory=lambda: manager,
            )
        self.assertEqual(context.exception.code, "instrument_limit_exceeded")
        self.assertIn("*IDN?", instrument.commands)
        self.assertNotIn("AFG:OUTPut:STATE OFF", instrument.commands)
        self.assertFalse(instrument.raw_writes)
        self.assertTrue(instrument.closed)
        self.assertTrue(manager.closed)

    def test_mso6_backend_accepts_a_write_larger_than_the_mso2_workaround(self):
        payload = b"x" * (MSO2_SAFE_WRITE_BYTES + 1)
        instrument = FakeInstrument(identity="TEKTRONIX,MSO64,SN6,1.0")
        result = upload_file_and_configure(
            "TCPIP0::scope6::INSTR",
            payload,
            "C:/baldee/large.csv",
            frequency_hz=1000,
            amplitude_vpp=1,
            offset_voltage=0,
            manager_factory=lambda: FakeManager(instrument),
            backend=MSO6_BACKEND,
        )
        self.assertEqual(result["adapter"], "tekscope-mso6")
        self.assertEqual(result["model"], "MSO64")
        self.assertEqual(instrument.files["C:/baldee/large.csv"], payload)

    def test_mso6_backend_limits_match_the_documented_specification(self):
        self.assertEqual(MSO6_MAX_ARB_POINTS, 131_072)
        self.assertEqual(MSO6_BACKEND.max_arb_points, 131_072)
        self.assertEqual(
            MSO6_BACKEND.frequency_hz,
            (MSO6_MIN_FREQUENCY_HZ, MSO6_MAX_FREQUENCY_HZ),
        )
        self.assertEqual(MSO6_BACKEND.max_sample_rate_sa, MSO6_MAX_SAMPLE_RATE_SA)
        self.assertEqual(MSO6_BACKEND.highz_limits.amplitude_vpp, (0.02, 5.0))
        self.assertEqual(MSO6_BACKEND.highz_limits.offset_voltage, (-2.5, 2.5))
        self.assertEqual(MSO6_BACKEND.fifty_ohm_limits.amplitude_vpp, (0.01, 2.5))
        self.assertEqual(MSO6_BACKEND.fifty_ohm_limits.offset_voltage, (-1.25, 1.25))

    def test_mso6_limits_are_rejected_before_instrument_io(self):
        cases = (
            {"frequency_hz": 0.099, "amplitude_vpp": 1, "offset_voltage": 0},
            {"frequency_hz": 25_000_001, "amplitude_vpp": 1, "offset_voltage": 0},
            {"frequency_hz": 1000, "amplitude_vpp": 0.019, "offset_voltage": 0},
            {"frequency_hz": 1000, "amplitude_vpp": 5.001, "offset_voltage": 0},
            {"frequency_hz": 1000, "amplitude_vpp": 1, "offset_voltage": 2.501},
            {
                "frequency_hz": 1000,
                "amplitude_vpp": 0.009,
                "offset_voltage": 0,
                "load_impedance": "FIFTY",
            },
            {
                "frequency_hz": 1000,
                "amplitude_vpp": 2.501,
                "offset_voltage": 0,
                "load_impedance": "FIFTY",
            },
            {
                "frequency_hz": 1000,
                "amplitude_vpp": 1,
                "offset_voltage": 1.251,
                "load_impedance": "FIFTY",
            },
            {
                "frequency_hz": 25_000_000,
                "amplitude_vpp": 1,
                "offset_voltage": 0,
                "sample_count": 11,
            },
        )
        for settings in cases:
            called = False

            def fail_if_called():
                nonlocal called
                called = True
                return FakeManager(FakeInstrument(identity="TEKTRONIX,MSO64,SN6,1.0"))

            with self.subTest(settings=settings), self.assertRaises(
                TekScopeAdapterError
            ) as context:
                upload_file_and_configure(
                    "TCPIP0::scope6::INSTR",
                    b"0\n1\n",
                    "C:/baldee/limits.csv",
                    manager_factory=fail_if_called,
                    backend=MSO6_BACKEND,
                    **settings,
                )
            self.assertEqual(context.exception.code, "instrument_limit_exceeded")
            self.assertFalse(called)

    def test_mso6_accepts_documented_frequency_voltage_and_sample_rate_boundaries(self):
        instrument = FakeInstrument(identity="TEKTRONIX,MSO64B,SN6,1.0")
        result = upload_file_and_configure(
            "TCPIP0::scope6::INSTR",
            b"0\n1\n",
            "C:/baldee/boundaries.csv",
            frequency_hz=25_000_000,
            amplitude_vpp=2.5,
            offset_voltage=1.25,
            load_impedance="FIFTY",
            sample_count=10,
            manager_factory=lambda: FakeManager(instrument),
            backend=MSO6_BACKEND,
        )
        self.assertEqual(result["frequency_hz"], 25_000_000)
        self.assertEqual(result["amplitude_vpp"], 2.5)
        self.assertEqual(result["offset_voltage"], 1.25)
        self.assertEqual(result["load_impedance"], "FIFTY")

    def test_live_sequence_writes_reads_back_configures_and_keeps_output_off(self):
        instrument = FakeInstrument(read_suffix=b"\n")
        manager = FakeManager(instrument)
        result = upload_file_and_configure(
            "TCPIP0::scope::INSTR",
            b"0\n1\n0\n-1\n",
            "C:/baldee/test.csv",
            frequency_hz=1234,
            amplitude_vpp=2.5,
            offset_voltage=0.25,
            manager_factory=lambda: manager,
        )
        self.assertEqual(instrument.files["C:/baldee/test.csv"], b"0\n1\n0\n-1\n")
        writes = [command for command in instrument.commands if not command.endswith("?")]
        self.assertEqual(writes[0], 'FILESystem:CWD "C:/baldee/"')
        self.assertLess(writes.index('FILESystem:CWD "C:/original/"'), writes.index("AFG:OUTPut:STATE OFF"))
        self.assertFalse(result["overwritten"])
        self.assertLess(
            writes.index("AFG:OUTPut:LOAd:IMPEDance HIGHZ"),
            writes.index("AFG:AMPLitude 2.5"),
        )
        source_index = instrument.commands.index('AFG:ARBitrary:SOUrce "C:/baldee/test.csv"')
        opc_index = instrument.commands.index("*OPC?", source_index)
        function_index = instrument.commands.index("AFG:FUNCtion ARBitrary")
        self.assertLess(source_index, opc_index)
        self.assertLess(opc_index, function_index)
        self.assertNotIn("AFG:OUTPut:STATE ON", writes)
        self.assertEqual(result["source"], "C:/baldee/test.csv")
        self.assertFalse(result["output_enabled"])
        self.assertTrue(result["readback_verified"])
        self.assertTrue(result["readback_transport_lf"])
        self.assertTrue(instrument.closed)
        self.assertTrue(manager.closed)
        json.dumps(result)

    def test_readback_rejects_more_than_one_transport_terminator(self):
        instrument = FakeInstrument(read_suffix=b"\n\n")
        with self.assertRaisesRegex(TekScopeAdapterError, "differed"):
            upload_file_and_configure(
                "TCPIP0::scope::INSTR",
                b"0\n1\n",
                "C:/baldee/test.csv",
                frequency_hz=1000,
                amplitude_vpp=1,
                offset_voltage=0,
                manager_factory=lambda: FakeManager(instrument),
            )

    def test_send_waveform_derives_file_frequency_amplitude_and_offset(self):
        instrument = FakeInstrument()
        instrument.files["C:/custom/Practice sine.csv"] = b"previous waveform"
        manager = FakeManager(instrument)
        request = {
            "resource": "TCPIP0::scope::INSTR",
            "waveform": {
                "schema": "arbdraw.waveform",
                "version": 1,
                "name": "Practice sine",
                "waveform": {
                    "sampleCount": 3,
                    "values": [0, 1, -1],
                    "frequencyHz": 2000,
                    "highVoltage": 1.25,
                    "lowVoltage": -0.75,
                },
            },
            "options": {"enable_output": False, "directory": "C:/custom/", "overwrite": True},
        }

        import tekscope_arb_adapter.adapter as adapter

        original = adapter._open_manager
        adapter._open_manager = lambda _library=None: manager
        try:
            result = send_waveform_mso2(request)
        finally:
            adapter._open_manager = original

        self.assertEqual(result["remote_path"], "C:/custom/Practice sine.csv")
        self.assertTrue(result["overwritten"])
        uploaded = instrument.files[result["remote_path"]]
        self.assertIn(b"Record Length,3\r\n", uploaded)
        self.assertIn(b"TIME,CH1\r\n", uploaded)
        self.assertEqual(result["frequency_hz"], 2000)
        self.assertEqual(result["amplitude_vpp"], 2)
        self.assertEqual(result["offset_voltage"], 0.25)

    def test_mso6_send_waveform_uses_the_identified_model_in_the_csv(self):
        instrument = FakeInstrument(identity="TEKTRONIX,MSO68B,SN6,1.0")
        manager = FakeManager(instrument)
        request = {
            "resource": "TCPIP0::scope6::INSTR",
            "waveform": {
                "schema": "arbdraw.waveform",
                "version": 1,
                "name": "MSO6 sine",
                "waveform": {
                    "sampleCount": 4,
                    "values": [0, 1, 0, -1],
                    "frequencyHz": 1000,
                    "highVoltage": 1,
                    "lowVoltage": -1,
                },
            },
            "options": {"enable_output": False},
        }

        import tekscope_arb_adapter.adapter as adapter

        original = adapter._open_manager
        adapter._open_manager = lambda _library=None: manager
        try:
            result = send_waveform_mso6(request)
        finally:
            adapter._open_manager = original

        self.assertEqual(result["adapter"], "tekscope-mso6")
        self.assertEqual(result["model"], "MSO68B")
        self.assertTrue(instrument.files[result["remote_path"]].startswith(b"Model,MSO68B\r\n"))

    def test_mso6_uses_the_awg_repeat_rate_for_sample_rate_validation(self):
        instrument = FakeInstrument(identity="TEKTRONIX,MSO68B,SN6,1.0")
        manager = FakeManager(instrument)
        request = {
            "resource": "TCPIP0::scope6::INSTR",
            "waveform": {
                "schema": "arbdraw.waveform",
                "version": 1,
                "name": "Ten-cycle sine",
                "AWG": {"frequencyHz": 1000},
                "waveform": {
                    "sampleCount": 1000,
                    "values": [0.0] * 1000,
                    "frequencyHz": 1_000_000,
                    "highVoltage": 1,
                    "lowVoltage": -1,
                },
            },
        }

        import tekscope_arb_adapter.adapter as adapter

        original = adapter._open_manager
        adapter._open_manager = lambda _library=None: manager
        try:
            result = send_waveform_mso6(request)
        finally:
            adapter._open_manager = original

        self.assertEqual(result["frequency_hz"], 1000)
        self.assertIn(b"Sample Interval,1.00000000e-06\r\n", instrument.files[result["remote_path"]])

    def test_bridge_dispatches_the_registered_tekscope_adapter(self):
        from python_bridge.server import BridgeService

        instrument = FakeInstrument(read_suffix=b"\n")
        manager = FakeManager(instrument)
        request = {
            "adapter": "tekscope-mso2",
            "resource": "TCPIP0::scope::INSTR",
            "waveform": {
                "schema": "arbdraw.waveform",
                "version": 1,
                "name": "Bridge sine",
                "waveform": {
                    "sampleCount": 4,
                    "values": [0, 0.5, 0, -0.5],
                    "frequencyHz": 2000,
                    "highVoltage": 0.5,
                    "lowVoltage": -0.5,
                },
            },
            "options": {"enable_output": True},
        }

        import tekscope_arb_adapter.adapter as adapter

        original = adapter._open_manager
        adapter._open_manager = lambda _library=None: manager
        try:
            status, result = BridgeService(
                adapters={"tekscope-mso2": send_waveform_mso2}
            ).dispatch("POST", "/api/v1/waveforms/send", request)
        finally:
            adapter._open_manager = original

        self.assertEqual(status, 200)
        self.assertEqual(result["adapter"], "tekscope-mso2")
        self.assertEqual(result["remote_path"], "C:/baldee/Bridge sine.csv")
        self.assertEqual(result["frequency_hz"], 2000)
        self.assertEqual(result["amplitude_vpp"], 1)
        self.assertTrue(result["output_enabled"])
        self.assertIn("C:/baldee/Bridge sine.csv", instrument.files)

    def test_bridge_dispatches_the_registered_mso6_adapter(self):
        from python_bridge.server import BridgeService

        instrument = FakeInstrument(identity="TEKTRONIX,MSO66,SN6,1.0")
        manager = FakeManager(instrument)
        request = {
            "adapter": "tekscope-mso6",
            "resource": "TCPIP0::scope6::INSTR",
            "waveform": {
                "schema": "arbdraw.waveform",
                "version": 1,
                "name": "Bridge MSO6 sine",
                "waveform": {
                    "sampleCount": 4,
                    "values": [0, 0.5, 0, -0.5],
                    "frequencyHz": 2000,
                    "highVoltage": 0.5,
                    "lowVoltage": -0.5,
                },
            },
            "options": {"enable_output": True},
        }

        import tekscope_arb_adapter.adapter as adapter

        original = adapter._open_manager
        adapter._open_manager = lambda _library=None: manager
        try:
            status, result = BridgeService(
                adapters={"tekscope-mso6": send_waveform_mso6}
            ).dispatch("POST", "/api/v1/waveforms/send", request)
        finally:
            adapter._open_manager = original

        self.assertEqual(status, 200)
        self.assertEqual(result["adapter"], "tekscope-mso6")
        self.assertEqual(result["model"], "MSO66")
        self.assertTrue(result["output_enabled"])

    def test_rejects_non_mso2_identity_before_raw_write(self):
        instrument = FakeInstrument(identity="TEKTRONIX,MSO64,SN1,1.0")
        with self.assertRaisesRegex(TekScopeAdapterError, "2 Series"):
            upload_file_and_configure(
                "TCPIP0::scope::INSTR",
                b"0\n1\n",
                "C:/baldee/test.csv",
                frequency_hz=1000,
                amplitude_vpp=1,
                offset_voltage=0,
                manager_factory=lambda: FakeManager(instrument),
            )
        self.assertFalse(instrument.raw_writes)

    def test_mso6_backend_rejects_an_mso2_identity_before_raw_write(self):
        instrument = FakeInstrument()
        with self.assertRaisesRegex(TekScopeAdapterError, "6 Series"):
            upload_file_and_configure(
                "TCPIP0::scope::INSTR",
                b"0\n1\n",
                "C:/baldee/test.csv",
                frequency_hz=1000,
                amplitude_vpp=1,
                offset_voltage=0,
                manager_factory=lambda: FakeManager(instrument),
                backend=MSO6_BACKEND,
            )
        self.assertFalse(instrument.raw_writes)

    def test_mso6_point_limit_is_checked_before_instrument_io(self):
        called = False
        request = {
            "resource": "TCPIP0::scope6::INSTR",
            "waveform": {
                "schema": "arbdraw.waveform",
                "version": 1,
                "name": "Too long",
                "waveform": {
                    "sampleCount": MSO6_BACKEND.max_arb_points + 1,
                    "values": [0.0] * (MSO6_BACKEND.max_arb_points + 1),
                    "frequencyHz": 1000,
                    "highVoltage": 1,
                    "lowVoltage": -1,
                },
            },
        }

        import tekscope_arb_adapter.adapter as adapter

        original = adapter._open_manager

        def fail_if_called(_library=None):
            nonlocal called
            called = True
            return FakeManager(FakeInstrument(identity="TEKTRONIX,MSO64,SN6,1.0"))

        adapter._open_manager = fail_if_called
        try:
            with self.assertRaisesRegex(TekScopeAdapterError, "131072 points"):
                send_waveform_mso6(request)
        finally:
            adapter._open_manager = original
        self.assertFalse(called)


if __name__ == "__main__":
    unittest.main()

