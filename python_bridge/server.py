"""Dependency-light ArbDraw REST server.

PyVISA is imported only when a VISA operation is requested. This lets the
health endpoint and adapter tests run before a VISA implementation is installed.
"""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import importlib.metadata
import json
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Protocol
from urllib.parse import urlsplit

API_VERSION = "1"
MAX_REQUEST_BYTES = 64 * 1024 * 1024


class BridgeError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class VisaBackend(Protocol):
    def list_resources(self) -> list[str]: ...

    def query(self, resource: str, command: str, timeout_ms: int) -> str: ...


class PyVisaBackend:
    """Small PyVISA adapter; all VISA ownership stays in this process."""

    def __init__(self, visa_library: str | None = None):
        self.visa_library = visa_library
        self._resource_manager = None
        self._lock = threading.Lock()

    def _manager(self):
        if self._resource_manager is None:
            try:
                import pyvisa
            except ImportError as error:
                raise BridgeError(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    "pyvisa_unavailable",
                    "PyVISA is not installed in the Python bridge environment.",
                ) from error
            try:
                self._resource_manager = (
                    pyvisa.ResourceManager()
                    if self.visa_library is None
                    else pyvisa.ResourceManager(self.visa_library)
                )
            except Exception as error:
                raise BridgeError(
                    HTTPStatus.BAD_GATEWAY,
                    "visa_initialization_failed",
                    f"Could not initialize VISA: {error}",
                ) from error
        return self._resource_manager

    def list_resources(self) -> list[str]:
        with self._lock:
            try:
                return list(self._manager().list_resources())
            except BridgeError:
                raise
            except Exception as error:
                raise BridgeError(
                    HTTPStatus.BAD_GATEWAY,
                    "visa_list_failed",
                    f"VISA resource discovery failed: {error}",
                ) from error

    def query(self, resource: str, command: str, timeout_ms: int) -> str:
        with self._lock:
            try:
                with self._manager().open_resource(resource) as instrument:
                    instrument.timeout = timeout_ms
                    # SCPI instruments commonly require LF to terminate a
                    # command and use LF to terminate the response. Do this
                    # explicitly instead of relying on backend defaults.
                    instrument.write_termination = "\n"
                    instrument.read_termination = "\n"
                    return str(instrument.query(command)).strip()
            except BridgeError:
                raise
            except Exception as error:
                raise BridgeError(
                    HTTPStatus.BAD_GATEWAY,
                    "visa_query_failed",
                    f"VISA query failed for {resource}: {error}",
                ) from error


WaveformHandler = Callable[[dict[str, Any]], dict[str, Any] | None]


class BridgeService:
    def __init__(
        self,
        visa_backend: VisaBackend | None = None,
        waveform_handler: WaveformHandler | None = None,
        adapters: dict[str, WaveformHandler] | None = None,
    ):
        self.visa = visa_backend or PyVisaBackend()
        self.waveform_handler = waveform_handler
        self.adapters = dict(adapters or {})
        if waveform_handler is not None and "default" not in self.adapters:
            self.adapters["default"] = waveform_handler

    def dispatch(
        self, method: str, path: str, payload: dict[str, Any] | None
    ) -> tuple[int, dict[str, Any]]:
        if method == "GET" and path == "/api/v1/health":
            return HTTPStatus.OK, {
                "status": "ok",
                "api_version": API_VERSION,
                "capabilities": {
                    "visa": importlib.util.find_spec("pyvisa") is not None,
                    "waveform_send": bool(self.adapters),
                    "adapters": bool(self.adapters),
                },
            }
        if method == "GET" and path == "/api/v1/adapters":
            return HTTPStatus.OK, {"adapters": [{"id": key, "name": key} for key in self.adapters]}
        if method == "GET" and path == "/api/v1/visa/resources":
            return HTTPStatus.OK, {"resources": self.visa.list_resources()}
        if method == "POST" and path == "/api/v1/visa/idn":
            request = self._object(payload)
            resource = self._text(request, "resource")
            timeout_ms = self._timeout(request)
            return HTTPStatus.OK, {
                "resource": resource,
                "identity": self.visa.query(resource, "*IDN?", timeout_ms),
            }
        if method == "POST" and path == "/api/v1/visa/query":
            request = self._object(payload)
            resource = self._text(request, "resource")
            command = self._text(request, "command")
            timeout_ms = self._timeout(request)
            return HTTPStatus.OK, {
                "resource": resource,
                "command": command,
                "response": self.visa.query(resource, command, timeout_ms),
            }
        if method == "POST" and path == "/api/v1/waveforms/send":
            request = self._object(payload)
            self._text(request, "resource")
            waveform = request.get("waveform")
            if not isinstance(waveform, dict) or waveform.get("schema") != "arbdraw.waveform":
                raise BridgeError(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_waveform",
                    "waveform must be an ArbDraw waveform document.",
                )
            adapter_id = request.get("adapter", "default")
            if not isinstance(adapter_id, str) or not adapter_id.strip():
                raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_adapter", "adapter must be a non-empty string.")
            handler = self.adapters.get(adapter_id)
            if handler is None:
                raise BridgeError(
                    HTTPStatus.BAD_REQUEST if self.adapters else HTTPStatus.NOT_IMPLEMENTED,
                    "adapter_not_found" if self.adapters else "waveform_handler_unconfigured",
                    f"Unknown waveform adapter: {adapter_id}." if self.adapters else "No waveform adapter is installed in the Python bridge.",
                )
            result = handler(request)
            return HTTPStatus.OK, result or {"status": "sent", "message": "Waveform sent."}
        raise BridgeError(HTTPStatus.NOT_FOUND, "route_not_found", "REST endpoint not found.")

    @staticmethod
    def _object(payload: dict[str, Any] | None) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_json", "A JSON object is required.")
        return payload

    @staticmethod
    def _text(payload: dict[str, Any], field: str) -> str:
        value = payload.get(field)
        if not isinstance(value, str) or not value.strip():
            raise BridgeError(
                HTTPStatus.BAD_REQUEST, "invalid_request", f"{field} must be a non-empty string."
            )
        return value.strip()

    @staticmethod
    def _timeout(payload: dict[str, Any]) -> int:
        value = payload.get("timeout_ms", 5000)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_request", "timeout_ms must be numeric.")
        return max(1, min(120_000, int(value)))


class BridgeRequestHandler(SimpleHTTPRequestHandler):
    service: BridgeService
    static_directory: str | None = None
    allowed_origins: tuple[str, ...] = ("https://baldengineer.github.io",)
    server_version = "ArbDrawBridge/1"

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=self.static_directory, **kwargs)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if self.static_directory is not None and not path.startswith("/api/"):
            super().do_GET()
            return
        self._handle_request()

    def do_POST(self) -> None:
        self._handle_request()

    def _handle_request(self) -> None:
        try:
            payload = self._read_json() if self.command == "POST" else None
            status, response = self.service.dispatch(
                self.command, urlsplit(self.path).path.rstrip("/") or "/", payload
            )
            self._send_json(status, response)
        except BridgeError as error:
            self._send_json(error.status, {"error": {"code": error.code, "message": error.message}})
        except Exception as error:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": {"code": "internal_error", "message": f"Bridge error: {error}"}},
            )

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_request", "Invalid Content-Length.") from error
        if length <= 0:
            raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_json", "A JSON request body is required.")
        if length > MAX_REQUEST_BYTES:
            raise BridgeError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request_too_large", "Request body is too large.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_json", "Request body is not valid JSON.") from error
        if not isinstance(payload, dict):
            raise BridgeError(HTTPStatus.BAD_REQUEST, "invalid_json", "A JSON object is required.")
        return payload

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        parsed_origin = urlsplit(origin) if origin and origin != "null" else None
        loopback_origin = parsed_origin is not None and parsed_origin.hostname in {
            "127.0.0.1",
            "localhost",
            "::1",
        }
        if origin == "null" or loopback_origin or origin in self.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format_string: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format_string % args}")


def create_server(
    host: str,
    port: int,
    service: BridgeService | None = None,
    static_directory: str | None = None,
    allowed_origins: tuple[str, ...] = ("https://baldengineer.github.io",),
) -> ThreadingHTTPServer:
    handler = type("ConfiguredBridgeRequestHandler", (BridgeRequestHandler,), {})
    handler.service = service or BridgeService()
    handler.static_directory = static_directory
    handler.allowed_origins = allowed_origins
    return ThreadingHTTPServer((host, port), handler)


def load_waveform_handler(specification: str | None) -> WaveformHandler | None:
    if not specification:
        return None
    module_name, separator, attribute_name = specification.partition(":")
    if not separator or not module_name or not attribute_name:
        raise ValueError("Waveform handler must use module:function syntax.")
    handler = getattr(importlib.import_module(module_name), attribute_name)
    if not callable(handler):
        raise TypeError(f"{specification} is not callable.")
    return handler


def discover_adapters() -> dict[str, WaveformHandler]:
    """Load installed adapters registered under the ArbDraw entry-point group."""
    adapters: dict[str, WaveformHandler] = {}
    for entry_point in importlib.metadata.entry_points(group="arbdraw.instrument_adapters"):
        handler = entry_point.load()
        if not callable(handler):
            raise TypeError(f"Adapter {entry_point.name} is not callable.")
        adapters[entry_point.name] = handler
    return adapters


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local ArbDraw Python bridge.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8876)
    parser.add_argument("--visa-library", default=None, help="Optional PyVISA backend/library selector.")
    parser.add_argument(
        "--serve-app",
        metavar="DIRECTORY",
        default=None,
        help="Also serve ArbDraw static files from this directory.",
    )
    parser.add_argument(
        "--waveform-handler",
        default=None,
        help="Waveform adapter callable in module:function form.",
    )
    parser.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        help="Additional browser origin allowed to call the bridge (repeatable).",
    )
    arguments = parser.parse_args()
    adapters = discover_adapters()
    configured_handler = load_waveform_handler(arguments.waveform_handler)
    if configured_handler is not None:
        adapters["default"] = configured_handler
    service = BridgeService(
        visa_backend=PyVisaBackend(arguments.visa_library),
        adapters=adapters,
    )
    allowed_origins = ("https://baldengineer.github.io", *arguments.allow_origin)
    server = create_server(
        arguments.host,
        arguments.port,
        service,
        arguments.serve_app,
        allowed_origins,
    )
    print(f"ArbDraw Python bridge listening on http://{arguments.host}:{arguments.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping ArbDraw Python bridge.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
