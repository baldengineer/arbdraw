from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from tekscope_arb_adapter import (  # noqa: E402
    MSO2_SAFE_WRITE_BYTES,
    AdapterOptions,
    TekScopeAdapterError,
    definite_block,
    encode_csv,
    encode_tekscope_csv,
    parse_cwd_response,
    send_waveform,
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
        self.files[path] = payload

    def write(self, command):
        self.commands.append(command)
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

    def test_adapter_options_reject_unknown_and_wrong_channel(self):
        with self.assertRaisesRegex(TekScopeAdapterError, "Unknown TekScope option"):
            AdapterOptions.from_mapping({"mystery": True})
        with self.assertRaisesRegex(TekScopeAdapterError, "channel 1"):
            AdapterOptions.from_mapping({"channel": 2})

    def test_oversized_mso2_write_is_rejected_before_instrument_io(self):
        called = False

        def factory():
            nonlocal called
            called = True
            return FakeManager(FakeInstrument())

        with self.assertRaisesRegex(TekScopeAdapterError, "safe maximum") as context:
            upload_file_and_configure(
                "TCPIP0::scope::INSTR",
                b"x" * MSO2_SAFE_WRITE_BYTES,
                "C:/baldee/large.csv",
                frequency_hz=1000,
                amplitude_vpp=1,
                offset_voltage=0,
                manager_factory=factory,
            )
        self.assertEqual(context.exception.code, "instrument_limit_exceeded")
        self.assertFalse(called)

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
        self.assertEqual(writes[0], "AFG:OUTPut:STATE OFF")
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
            "options": {"enable_output": False},
        }

        import tekscope_arb_adapter.adapter as adapter

        original = adapter._open_manager
        adapter._open_manager = lambda _library=None: manager
        try:
            result = send_waveform(request)
        finally:
            adapter._open_manager = original

        self.assertEqual(result["remote_path"], "C:/baldee/Practice sine.csv")
        uploaded = instrument.files[result["remote_path"]]
        self.assertIn(b"Record Length,3\r\n", uploaded)
        self.assertIn(b"TIME,CH1\r\n", uploaded)
        self.assertEqual(result["frequency_hz"], 2000)
        self.assertEqual(result["amplitude_vpp"], 2)
        self.assertEqual(result["offset_voltage"], 0.25)

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
                adapters={"tekscope-mso2": send_waveform}
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


if __name__ == "__main__":
    unittest.main()

