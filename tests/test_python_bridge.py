import json
import sys
import threading
import time
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from python_bridge.server import (
    BridgeError,
    BridgeService,
    PyVisaBackend,
    create_server,
    main,
    normalize_visa_resource,
    startup_messages,
)


class FakeVisa:
    def __init__(self):
        self.queries = []

    def list_resources(self):
        return ["USB0::0x1234::0x5678::SN1::INSTR"]

    def query(self, resource, command, timeout_ms, pyvisa_options=None):
        self.queries.append((resource, command, timeout_ms, pyvisa_options or {}))
        return "ArbDraw,FakeScope,SN1,1.0"


class PythonBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.visa = FakeVisa()
        cls.sent = []

        def waveform_handler(request):
            cls.sent.append(request)
            return {"status": "sent", "message": "Adapter accepted waveform."}

        service = BridgeService(cls.visa, waveform_handler)
        cls.server = create_server(
            "127.0.0.1", 0, service, str(Path(__file__).resolve().parents[1])
        )
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, path, payload=None, method=None, origin="null"):
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(
            self.base_url + path,
            data=data,
            method=method or ("POST" if data else "GET"),
            headers={"Content-Type": "application/json", "Origin": origin},
        )
        try:
            with urlopen(request, timeout=2) as response:
                return response.status, dict(response.headers), json.loads(response.read())
        except HTTPError as error:
            return error.code, dict(error.headers), json.loads(error.read())

    def test_health_and_cors(self):
        status, headers, body = self.request("/api/v1/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "null")
        self.assertEqual(body["api_version"], "1")

        _, headers, _ = self.request("/api/v1/health", origin="https://untrusted.example")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_can_serve_the_app(self):
        with urlopen(self.base_url + "/", timeout=2) as response:
            body = response.read().decode()
        self.assertIn("<title>ArbDraw - Waveform Editor</title>", body)

    def test_list_and_identify(self):
        status, _, body = self.request("/api/v1/visa/resources")
        self.assertEqual(status, 200)
        resource = body["resources"][0]
        status, _, body = self.request(
            "/api/v1/visa/idn", {"resource": resource, "timeout_ms": 2500}
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["identity"], "ArbDraw,FakeScope,SN1,1.0")
        self.assertEqual(self.visa.queries[-1], (resource, "*IDN?", 2500, {}))

    def test_send_waveform_uses_adapter(self):
        payload = {
            "resource": "USB0::INSTR",
            "waveform": {"schema": "arbdraw.waveform", "version": 1, "waveform": {"values": [0, 1]}},
            "options": {"channel": 1},
        }
        status, _, body = self.request("/api/v1/waveforms/send", payload)
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "sent")
        self.assertEqual(self.sent[-1], payload)

    def test_invalid_request_has_stable_error_shape(self):
        status, _, body = self.request("/api/v1/visa/idn", {})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_request")

    def test_instrument_operations_are_serialized_across_clients(self):
        active = 0
        maximum_active = 0
        state_lock = threading.Lock()

        def handler(request):
            nonlocal active, maximum_active
            with state_lock:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.05)
            with state_lock:
                active -= 1
            return {"status": "sent"}

        service = BridgeService(FakeVisa(), adapters={"test": handler})
        payload = {
            "resource": "USB0::INSTR",
            "adapter": "test",
            "waveform": {"schema": "arbdraw.waveform", "version": 1},
        }
        errors = []

        def send():
            try:
                self.assertEqual(service.dispatch("POST", "/api/v1/waveforms/send", payload)[0], 200)
            except Exception as error:  # pragma: no cover - only reports thread failures
                errors.append(error)

        first = threading.Thread(target=send)
        second = threading.Thread(target=send)
        first.start()
        second.start()
        first.join()
        second.join()
        self.assertFalse(errors)
        self.assertEqual(maximum_active, 1)

    def test_pyvisa_backend_does_not_reuse_manager_after_adapter_cleanup(self):
        managers = []
        instruments = []

        class Instrument:
            def __init__(self):
                self.query_delay = None
                self.read_termination = None
                self.send_end = None
                self.write_termination = None
                instruments.append(self)

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def query(self, command):
                return f"response:{command}"

        class Manager:
            def __init__(self):
                self.closed = False
                managers.append(self)

            def list_resources(self):
                return ("USB0::INSTR",)

            def open_resource(self, _resource):
                return Instrument()

            def close(self):
                self.closed = True

        fake_pyvisa = SimpleNamespace(ResourceManager=Manager)
        original = sys.modules.get("pyvisa")
        sys.modules["pyvisa"] = fake_pyvisa
        try:
            backend = PyVisaBackend()
            self.assertEqual(backend.list_resources(), ["USB0::INSTR"])
            self.assertEqual(
                backend.query(
                    "USB0::INSTR",
                    "*IDN?",
                    1000,
                    {
                        "read_termination": "\r",
                        "write_termination": "\r\n",
                        "query_delay": 5,
                        "send_end": False,
                    },
                ),
                "response:*IDN?",
            )
        finally:
            if original is None:
                sys.modules.pop("pyvisa", None)
            else:
                sys.modules["pyvisa"] = original

        self.assertEqual(len(managers), 2)
        self.assertTrue(all(manager.closed for manager in managers))
        instrument = instruments[-1]
        self.assertEqual(instrument.read_termination, "\r")
        self.assertEqual(instrument.write_termination, "\r\n")
        self.assertEqual(instrument.query_delay, 5)
        self.assertFalse(instrument.send_end)

    def test_startup_lists_adapters_before_the_listening_message(self):
        adapters = {
            "rigol-dg1022": lambda request: None,
            "owon-xdg3000": lambda request: None,
        }

        messages = startup_messages(adapters, "127.0.0.1", 8876)

        self.assertEqual(
            messages,
            [
                "Available waveform adapters (2):",
                "  - owon-xdg3000",
                "  - rigol-dg1022",
                "ArbDraw Python bridge listening on http://127.0.0.1:8876",
            ],
        )

    def test_startup_reports_when_no_adapters_are_installed(self):
        messages = startup_messages({}, "127.0.0.1", 8876)

        self.assertEqual(
            messages,
            [
                "Available waveform adapters: none",
                "ArbDraw Python bridge listening on http://127.0.0.1:8876",
            ],
        )

    def test_cli_normalizes_ip_resources(self):
        self.assertEqual(
            normalize_visa_resource("192.168.1.50"),
            "TCPIP0::192.168.1.50::INSTR",
        )
        self.assertEqual(
            normalize_visa_resource("192.168.1.50:5025"),
            "TCPIP0::192.168.1.50::5025::SOCKET",
        )
        self.assertEqual(
            normalize_visa_resource("192.168.1.50/5025"),
            "TCPIP0::192.168.1.50::5025::SOCKET",
        )
        self.assertEqual(
            normalize_visa_resource("USB0::0x1234::0x5678::SN1::INSTR"),
            "USB0::0x1234::0x5678::SN1::INSTR",
        )

    def test_cli_actions_can_list_and_identify_without_starting_server(self):
        visa = FakeVisa()
        arguments = [
            "arbdraw-bridge",
            "--list-resources",
            "--idn",
            "192.168.1.50:5025",
        ]

        with (
            patch.object(sys, "argv", arguments),
            patch("python_bridge.server.PyVisaBackend", return_value=visa),
            patch("python_bridge.server.create_server") as create_server_mock,
            patch("python_bridge.server.discover_adapters") as discover_adapters_mock,
            patch("builtins.print") as print_mock,
        ):
            main()

        create_server_mock.assert_not_called()
        discover_adapters_mock.assert_not_called()
        self.assertEqual(
            visa.queries,
            [("TCPIP0::192.168.1.50::5025::SOCKET", "*IDN?", 5000, {})],
        )
        self.assertEqual(
            [call.args[0] for call in print_mock.call_args_list],
            [
                "Available VISA resources (1):",
                "  - USB0::0x1234::0x5678::SN1::INSTR",
                "TCPIP0::192.168.1.50::5025::SOCKET: ArbDraw,FakeScope,SN1,1.0",
            ],
        )

    def test_idn_applies_and_validates_pyvisa_options(self):
        payload = {
            "resource": "USB0::INSTR",
            "pyvisa_options": {
                "read_termination": "\r",
                "write_termination": "\r\n",
                "query_delay": 5,
                "send_end": False,
            },
        }

        status, body = BridgeService(self.visa).dispatch(
            "POST", "/api/v1/visa/idn", payload
        )

        self.assertEqual(status, 200)
        self.assertEqual(body["identity"], "ArbDraw,FakeScope,SN1,1.0")
        self.assertEqual(self.visa.queries[-1][3], payload["pyvisa_options"])
        with self.assertRaisesRegex(BridgeError, "query_delay"):
            BridgeService(self.visa).dispatch(
                "POST",
                "/api/v1/visa/idn",
                {"resource": "USB0::INSTR", "pyvisa_options": {"query_delay": -1}},
            )

    def test_waveform_request_forwards_validated_pyvisa_options_to_adapter(self):
        requests = []
        service = BridgeService(
            self.visa,
            adapters={"test": lambda request: requests.append(request) or {"status": "sent"}},
        )
        payload = {
            "resource": "USB0::INSTR",
            "adapter": "test",
            "waveform": {"schema": "arbdraw.waveform", "version": 1},
            "pyvisa_options": {"query_delay": 5, "send_end": True},
        }

        status, _ = service.dispatch("POST", "/api/v1/waveforms/send", payload)

        self.assertEqual(status, 200)
        self.assertEqual(requests[0]["pyvisa_options"], payload["pyvisa_options"])


if __name__ == "__main__":
    unittest.main()
