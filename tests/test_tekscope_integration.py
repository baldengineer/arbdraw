"""Integration with an installed TekScope adapter; no instrument I/O."""
import os
import unittest

from python_bridge.server import discover_adapters

try:
    from tekscope_arb_adapter import send_waveform_mso2, send_waveform_mso6
except ModuleNotFoundError as error:
    if error.name != "tekscope_arb_adapter" or os.environ.get("ARBDRAW_REQUIRE_TEKSCOPE") == "1":
        raise
    ADAPTER_AVAILABLE = False
else:
    ADAPTER_AVAILABLE = True


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


@unittest.skipUnless(ADAPTER_AVAILABLE, "Install the TekScope adapter to run integration tests")
class TekScopeBridgeTests(unittest.TestCase):
    def test_installed_entry_points_are_discovered(self):
        adapters = discover_adapters()
        self.assertIs(adapters["tekscope-mso2"], send_waveform_mso2)
        self.assertIs(adapters["tekscope-mso6"], send_waveform_mso6)

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
