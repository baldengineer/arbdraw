import json
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from python_bridge.server import BridgeService, create_server


class FakeVisa:
    def __init__(self):
        self.queries = []

    def list_resources(self):
        return ["USB0::0x1234::0x5678::SN1::INSTR"]

    def query(self, resource, command, timeout_ms):
        self.queries.append((resource, command, timeout_ms))
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
        self.assertEqual(self.visa.queries[-1], (resource, "*IDN?", 2500))

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


if __name__ == "__main__":
    unittest.main()
