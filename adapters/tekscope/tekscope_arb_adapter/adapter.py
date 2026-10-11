"""Binary-safe TekScope file transfer and MSO2 AFG configuration."""

from __future__ import annotations

import math
import re
import threading
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Callable, Iterable


# The observed fatal MSO2 boundary is 8,092 kB, with the precise decimal versus
# binary interpretation still unknown. Stay conservatively below both readings.
MSO2_SAFE_WRITE_BYTES = 8_000_000
MSO2_MODELS = frozenset({"MSO22", "MSO24", "MSO22-EDU", "MSO24-EDU"})
MSO2_MAX_ARB_POINTS = 128_000
DEFAULT_DIRECTORY = "C:/baldee"
SCPI_ERROR_MASK = 32 | 16 | 8 | 4
_RESOURCE_LOCKS: dict[str, threading.RLock] = {}
_RESOURCE_LOCKS_GUARD = threading.Lock()


class TekScopeAdapterError(RuntimeError):
    """Safe adapter error with a stable machine-readable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class AdapterOptions:
    channel: int = 1
    directory: str = DEFAULT_DIRECTORY
    file_name: str | None = None
    frequency_hz: float | None = None
    amplitude_vpp: float | None = None
    offset_voltage: float | None = None
    load_impedance: str = "HIGHZ"
    enable_output: bool = False
    timeout_ms: int = 60_000
    verify_readback: bool = True

    @classmethod
    def from_mapping(cls, value: Any) -> "AdapterOptions":
        if value is None:
            value = {}
        if not isinstance(value, dict):
            raise TekScopeAdapterError("invalid_adapter_options", "options must be an object.")
        allowed = {
            "channel",
            "directory",
            "file_name",
            "frequency_hz",
            "amplitude_vpp",
            "offset_voltage",
            "load_impedance",
            "enable_output",
            "timeout_ms",
            "verify_readback",
        }
        unknown = sorted(set(value) - allowed)
        if unknown:
            raise TekScopeAdapterError(
                "invalid_adapter_options", f"Unknown TekScope option: {unknown[0]}."
            )

        channel = value.get("channel", 1)
        if isinstance(channel, bool) or channel != 1:
            raise TekScopeAdapterError(
                "invalid_adapter_options", "The MSO2 built-in AFG uses channel 1."
            )
        directory = value.get("directory", DEFAULT_DIRECTORY)
        if not isinstance(directory, str):
            raise TekScopeAdapterError(
                "invalid_adapter_options", "directory must be a string."
            )
        directory = validate_scope_path(directory, require_file=False).rstrip("/")

        file_name = value.get("file_name")
        if file_name is not None:
            if not isinstance(file_name, str) or not file_name.strip():
                raise TekScopeAdapterError(
                    "invalid_adapter_options", "file_name must be a non-empty string or null."
                )
            if "/" in file_name or "\\" in file_name:
                raise TekScopeAdapterError(
                    "invalid_adapter_options", "file_name must not contain a directory."
                )
            file_name = _safe_file_name(file_name)

        frequency_hz = _optional_positive(value.get("frequency_hz"), "frequency_hz")
        amplitude_vpp = _optional_positive(value.get("amplitude_vpp"), "amplitude_vpp")
        offset_voltage = _optional_finite(value.get("offset_voltage"), "offset_voltage")

        load_impedance = value.get("load_impedance", "HIGHZ")
        if not isinstance(load_impedance, str) or load_impedance.upper() not in {"HIGHZ", "FIFTY"}:
            raise TekScopeAdapterError(
                "invalid_adapter_options", "load_impedance must be HIGHZ or FIFTY."
            )

        enable_output = value.get("enable_output", False)
        verify_readback = value.get("verify_readback", True)
        if not isinstance(enable_output, bool) or not isinstance(verify_readback, bool):
            raise TekScopeAdapterError(
                "invalid_adapter_options", "enable_output and verify_readback must be boolean."
            )
        timeout_ms = value.get("timeout_ms", 60_000)
        if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, (int, float)):
            raise TekScopeAdapterError(
                "invalid_adapter_options", "timeout_ms must be numeric."
            )
        timeout_ms = int(timeout_ms)
        if not 1 <= timeout_ms <= 120_000:
            raise TekScopeAdapterError(
                "invalid_adapter_options", "timeout_ms must be between 1 and 120000."
            )

        return cls(
            channel=1,
            directory=directory,
            file_name=file_name,
            frequency_hz=frequency_hz,
            amplitude_vpp=amplitude_vpp,
            offset_voltage=offset_voltage,
            load_impedance=load_impedance.upper(),
            enable_output=enable_output,
            timeout_ms=timeout_ms,
            verify_readback=verify_readback,
        )


def _optional_positive(value: Any, name: str) -> float | None:
    result = _optional_finite(value, name)
    if result is not None and result <= 0:
        raise TekScopeAdapterError("invalid_adapter_options", f"{name} must be positive.")
    return result


def _optional_finite(value: Any, name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TekScopeAdapterError("invalid_adapter_options", f"{name} must be numeric or null.")
    result = float(value)
    if not math.isfinite(result):
        raise TekScopeAdapterError("invalid_adapter_options", f"{name} must be finite.")
    return result


def validate_scope_path(path: str, *, require_file: bool = True) -> str:
    """Validate an absolute 7-bit-ASCII TekScope path and normalize separators."""
    if not isinstance(path, str) or not path.strip():
        raise TekScopeAdapterError("invalid_scope_path", "Scope path must be non-empty.")
    normalized = path.strip().replace("\\", "/")
    if not re.fullmatch(r"[A-Za-z]:/[^\x00-\x1f\x7f\"]*", normalized):
        raise TekScopeAdapterError(
            "invalid_scope_path",
            "Scope path must be an absolute ASCII drive path without control characters or quotes.",
        )
    try:
        normalized.encode("ascii")
    except UnicodeEncodeError as error:
        raise TekScopeAdapterError(
            "invalid_scope_path", "Scope path must contain only 7-bit ASCII characters."
        ) from error
    if require_file and normalized.endswith("/"):
        raise TekScopeAdapterError("invalid_scope_path", "Scope file path must include a file name.")
    return normalized


def parse_cwd_response(response: str) -> str:
    """Accept both header-on and header-off FILESystem:CWD? responses."""
    if not isinstance(response, str):
        raise TekScopeAdapterError("instrument_verification_failed", "CWD response was not text.")
    matches = re.findall(r'"((?:[^"]|"")*)"', response)
    if not matches:
        raise TekScopeAdapterError(
            "instrument_verification_failed", f"Could not parse FILESystem:CWD? response: {response!r}"
        )
    return matches[-1].replace('""', '"').replace("\\", "/")


def definite_block(payload: bytes) -> bytes:
    count = str(len(payload)).encode("ascii")
    if len(count) > 9:
        raise TekScopeAdapterError(
            "instrument_limit_exceeded", "Payload is too large for an IEEE 488.2 definite block."
        )
    return b"#" + str(len(count)).encode("ascii") + count + payload


def encode_csv(values: Iterable[float]) -> bytes:
    """Encode plain numeric rows for interchange or diagnostics."""
    return ("\n".join(format(value, ".17g") for value in _validated_values(values)) + "\n").encode(
        "ascii"
    )


def _validated_values(values: Iterable[float]) -> list[float]:
    numbers: list[float] = []
    for index, value in enumerate(values):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TekScopeAdapterError(
                "invalid_waveform", f"waveform.values[{index}] must be numeric."
            )
        number = float(value)
        if not math.isfinite(number):
            raise TekScopeAdapterError(
                "invalid_waveform", f"waveform.values[{index}] must be finite."
            )
        numbers.append(number)
    if len(numbers) < 2:
        raise TekScopeAdapterError("invalid_waveform", "At least two waveform samples are required.")
    if len(numbers) > MSO2_MAX_ARB_POINTS:
        raise TekScopeAdapterError(
            "instrument_limit_exceeded",
            f"MSO2 arbitrary waveforms support at most {MSO2_MAX_ARB_POINTS} points.",
        )
    return numbers


def encode_tekscope_csv(
    values: Iterable[float],
    frequency_hz: float,
    *,
    model: str = "MSO22",
    label: str = "",
) -> bytes:
    """Encode the Tek waveform CSV shape accepted by the MSO2 built-in AFG."""
    numbers = _validated_values(values)
    frequency = _optional_positive(frequency_hz, "frequency_hz")
    assert frequency is not None
    if not isinstance(model, str) or model.upper() not in MSO2_MODELS:
        raise TekScopeAdapterError("invalid_waveform", "CSV model must be an MSO22 or MSO24 variant.")
    if not isinstance(label, str) or any(character in label for character in "\r\n,"):
        raise TekScopeAdapterError(
            "invalid_waveform", "CSV label must be text without commas or line breaks."
        )
    try:
        label.encode("ascii")
    except UnicodeEncodeError as error:
        raise TekScopeAdapterError("invalid_waveform", "CSV label must contain only ASCII.") from error

    sample_interval = 1.0 / (frequency * len(numbers))
    zero_index = float(len(numbers) // 2 - 1)
    lines = [
        f"Model,{model.upper()}",
        f"Label,{label}",
        "Waveform Type,ANALOG",
        "Horizontal Units,s",
        f"Sample Interval,{sample_interval:.8e}",
        f"Record Length,{len(numbers)}",
        f"Zero Index,{zero_index:.8f}",
        "Vertical Units,V",
        "",
        "Labels,",
        "TIME,CH1",
    ]
    lines.extend(
        f"{((index - zero_index) * sample_interval):.8e},{number:.8e}"
        for index, number in enumerate(numbers)
    )
    return ("\r\n".join(lines) + "\r\n").encode("ascii")


def _safe_file_name(value: str) -> str:
    name = value.strip()
    try:
        name.encode("ascii")
    except UnicodeEncodeError as error:
        raise TekScopeAdapterError(
            "invalid_scope_path", "TekScope file names must contain only 7-bit ASCII characters."
        ) from error
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._-]*", name):
        raise TekScopeAdapterError(
            "invalid_scope_path",
            "TekScope file names may contain letters, numbers, spaces, dot, underscore, and dash.",
        )
    return name if name.lower().endswith(".csv") else f"{name}.csv"


def _project_waveform(project: Any) -> tuple[dict[str, Any], list[float]]:
    if not isinstance(project, dict) or project.get("schema") != "arbdraw.waveform":
        raise TekScopeAdapterError(
            "invalid_waveform", "This adapter requires an arbdraw.waveform document."
        )
    if project.get("version") != 1:
        raise TekScopeAdapterError("invalid_waveform", "This adapter supports document version 1.")
    waveform = project.get("waveform")
    if not isinstance(waveform, dict) or not isinstance(waveform.get("values"), list):
        raise TekScopeAdapterError("invalid_waveform", "waveform.values must be an array.")
    values = waveform["values"]
    sample_count = waveform.get("sampleCount")
    if isinstance(sample_count, bool) or not isinstance(sample_count, int) or sample_count != len(values):
        raise TekScopeAdapterError(
            "invalid_waveform", "waveform.sampleCount must equal the number of waveform values."
        )
    return waveform, values


def _resource_lock(resource: str) -> threading.RLock:
    with _RESOURCE_LOCKS_GUARD:
        return _RESOURCE_LOCKS.setdefault(resource, threading.RLock())


def _parse_identity(identity: str) -> tuple[str, str]:
    fields = [field.strip() for field in identity.split(",")]
    if len(fields) < 2:
        raise TekScopeAdapterError(
            "unsupported_instrument", f"Unrecognized *IDN? response: {identity!r}"
        )
    manufacturer, model = fields[:2]
    if manufacturer.upper() != "TEKTRONIX" or model.upper() not in MSO2_MODELS:
        raise TekScopeAdapterError(
            "unsupported_instrument", f"Expected a Tektronix 2 Series MSO, received {identity!r}."
        )
    return manufacturer, model.upper()


def _consume_status(instrument: Any) -> tuple[int, str]:
    try:
        esr = int(str(instrument.query("*ESR?")).strip())
    except (TypeError, ValueError) as error:
        raise TekScopeAdapterError(
            "instrument_verification_failed", "The scope returned an invalid *ESR? value."
        ) from error
    events = str(instrument.query("ALLEV?")).strip()
    return esr, events


def _check_status(instrument: Any, operation: str) -> None:
    esr, events = _consume_status(instrument)
    if esr & SCPI_ERROR_MASK:
        raise TekScopeAdapterError(
            "waveform_upload_failed",
            f"The scope reported an error after {operation}: ESR={esr}; ALLEV={events or '<empty>'}.",
        )


def _write_checked(instrument: Any, command: str, operation: str) -> None:
    instrument.write(command)
    _check_status(instrument, operation)


def _query_text(instrument: Any, command: str) -> str:
    return str(instrument.query(command)).strip()


def _configure_session(instrument: Any, timeout_ms: int, pyvisa_options: dict[str, Any]) -> None:
    instrument.timeout = timeout_ms
    instrument.write_termination = pyvisa_options.get("write_termination", "\n")
    instrument.read_termination = pyvisa_options.get("read_termination", "\n")
    if "query_delay" in pyvisa_options:
        instrument.query_delay = pyvisa_options["query_delay"]
    if "send_end" in pyvisa_options:
        instrument.send_end = pyvisa_options["send_end"]


def _read_scope_file(instrument: Any, path: str) -> bytes:
    previous = instrument.read_termination
    instrument.read_termination = None
    try:
        instrument.write(f'FILESystem:READFile "{path}"')
        return bytes(instrument.read_raw())
    finally:
        instrument.read_termination = previous


def _write_scope_file(instrument: Any, path: str, payload: bytes) -> None:
    prefix = f'FILESystem:WRITEFile "{path}",'.encode("ascii")
    instrument.write_raw(prefix + definite_block(payload))
    _check_status(instrument, f"writing {path}")


def _open_manager(visa_library: str | None = None) -> Any:
    try:
        import pyvisa
    except ImportError as error:
        raise TekScopeAdapterError(
            "pyvisa_unavailable", "PyVISA is not installed in the adapter environment."
        ) from error
    try:
        return pyvisa.ResourceManager() if visa_library is None else pyvisa.ResourceManager(visa_library)
    except Exception as error:
        raise TekScopeAdapterError(
            "visa_initialization_failed", f"Could not initialize VISA: {error}"
        ) from error


def upload_file_and_configure(
    resource: str,
    local_payload: bytes,
    remote_path: str,
    *,
    frequency_hz: float,
    amplitude_vpp: float,
    offset_voltage: float,
    load_impedance: str = "HIGHZ",
    enable_output: bool = False,
    timeout_ms: int = 60_000,
    verify_readback: bool = True,
    pyvisa_options: dict[str, Any] | None = None,
    visa_library: str | None = None,
    manager_factory: Callable[[], Any] | None = None,
) -> dict[str, Any]:
    """Upload one CSV, select it as the MSO2 AFG source, and query settings back."""
    if not isinstance(resource, str) or not resource.strip():
        raise TekScopeAdapterError("invalid_request", "resource must be a non-empty string.")
    path = validate_scope_path(remote_path)
    if not isinstance(local_payload, bytes):
        raise TekScopeAdapterError("invalid_request", "local_payload must be bytes.")
    if len(local_payload) >= MSO2_SAFE_WRITE_BYTES:
        raise TekScopeAdapterError(
            "instrument_limit_exceeded",
            f"MSO2 write is {len(local_payload)} bytes; the configured safe maximum is "
            f"{MSO2_SAFE_WRITE_BYTES - 1} bytes.",
        )
    frequency = _optional_positive(frequency_hz, "frequency_hz")
    amplitude = _optional_positive(amplitude_vpp, "amplitude_vpp")
    offset = _optional_finite(offset_voltage, "offset_voltage")
    load = load_impedance.upper() if isinstance(load_impedance, str) else ""
    if load not in {"HIGHZ", "FIFTY"}:
        raise TekScopeAdapterError("invalid_adapter_options", "load_impedance must be HIGHZ or FIFTY.")
    if not isinstance(enable_output, bool) or not isinstance(verify_readback, bool):
        raise TekScopeAdapterError(
            "invalid_adapter_options", "enable_output and verify_readback must be boolean."
        )
    session_options = dict(pyvisa_options or {})
    manager = None
    instrument = None
    identity = ""
    with _resource_lock(resource.strip()):
        try:
            manager = manager_factory() if manager_factory is not None else _open_manager(visa_library)
            instrument = manager.open_resource(resource.strip())
            _configure_session(instrument, timeout_ms, session_options)
            identity = _query_text(instrument, "*IDN?")
            _, model = _parse_identity(identity)

            # Drain pre-existing status only after identity succeeds. Do not begin a
            # session with *CLS; power-on events are not attributable to this upload.
            _consume_status(instrument)
            _write_checked(instrument, "AFG:OUTPut:STATE OFF", "disabling AFG output")
            _write_scope_file(instrument, path, local_payload)

            if verify_readback:
                received = _read_scope_file(instrument, path)
                # MSO22 firmware 2.26.13 on VXI-11 terminates READFile with one
                # LF byte outside the stored file. Accept only that exact framing
                # variant; never broadly strip bytes from binary readback.
                readback_matches = received == local_payload or received == local_payload + b"\n"
                if not readback_matches:
                    raise TekScopeAdapterError(
                        "instrument_verification_failed",
                        f"Readback for {path} differed from the {len(local_payload)} uploaded bytes "
                        f"({len(received)} bytes received).",
                    )

            _write_checked(
                instrument,
                f"AFG:OUTPut:LOAd:IMPEDance {load}",
                "setting AFG load impedance",
            )
            _write_checked(
                instrument,
                f'AFG:ARBitrary:SOUrce "{path}"',
                "selecting the arbitrary waveform source",
            )
            if _query_text(instrument, "*OPC?") != "1":
                raise TekScopeAdapterError(
                    "instrument_verification_failed",
                    "The scope did not finish loading the arbitrary waveform source.",
                )
            _check_status(instrument, "loading the arbitrary waveform source")
            _write_checked(instrument, "AFG:FUNCtion ARBitrary", "selecting arbitrary mode")
            _write_checked(instrument, f"AFG:FREQuency {frequency:.17g}", "setting AFG frequency")
            _write_checked(instrument, f"AFG:AMPLitude {amplitude:.17g}", "setting AFG amplitude")
            _write_checked(instrument, f"AFG:OFFSet {offset:.17g}", "setting AFG offset")
            if enable_output:
                _write_checked(instrument, "AFG:OUTPut:STATE ON", "enabling AFG output")

            actual = {
                "source": _query_text(instrument, "AFG:ARBitrary:SOUrce?").strip('"'),
                "function": _query_text(instrument, "AFG:FUNCtion?"),
                "frequency_hz": float(_query_text(instrument, "AFG:FREQuency?")),
                "amplitude_vpp": float(_query_text(instrument, "AFG:AMPLitude?")),
                "offset_voltage": float(_query_text(instrument, "AFG:OFFSet?")),
                "load_impedance": _query_text(instrument, "AFG:OUTPut:LOAd:IMPEDance?"),
                "output_enabled": _query_text(instrument, "AFG:OUTPut:STATE?") in {"1", "ON"},
            }
            _check_status(instrument, "querying configured AFG state")
            if actual["source"].replace("\\", "/") != path:
                raise TekScopeAdapterError(
                    "instrument_verification_failed",
                    f"Scope selected {actual['source']!r} instead of {path!r}.",
                )
            if actual["function"].upper() not in {"ARB", "ARBITRARY"}:
                raise TekScopeAdapterError(
                    "instrument_verification_failed",
                    f"Scope reported AFG function {actual['function']!r} instead of ARBITRARY.",
                )
            if actual["output_enabled"] != enable_output:
                raise TekScopeAdapterError(
                    "instrument_verification_failed", "AFG output state did not match the request."
                )
            return {
                "status": "sent",
                "message": (
                    f"Uploaded {len(local_payload)} bytes to {path}; selected the arbitrary "
                    f"waveform at {actual['frequency_hz']:g} Hz and {actual['amplitude_vpp']:g} Vpp; "
                    f"output is {'on' if actual['output_enabled'] else 'off'}."
                ),
                "adapter": "tekscope-mso2",
                "identity": identity,
                "model": model,
                "remote_path": path,
                "bytes": len(local_payload),
                "readback_verified": verify_readback,
                "readback_transport_lf": verify_readback and received == local_payload + b"\n",
                **actual,
            }
        except TekScopeAdapterError:
            raise
        except Exception as error:
            raise TekScopeAdapterError(
                "waveform_upload_failed", f"TekScope upload failed: {error}"
            ) from error
        finally:
            if instrument is not None:
                try:
                    instrument.close()
                except Exception:
                    pass
            if manager is not None:
                try:
                    manager.close()
                except Exception:
                    pass


def send_waveform(request: dict[str, Any]) -> dict[str, Any]:
    """ArbDraw bridge entry point."""
    if not isinstance(request, dict):
        raise TekScopeAdapterError("invalid_request", "Adapter request must be an object.")
    resource = request.get("resource")
    if not isinstance(resource, str) or not resource.strip():
        raise TekScopeAdapterError("invalid_request", "resource must be a non-empty string.")
    waveform, values = _project_waveform(request.get("waveform"))
    options = AdapterOptions.from_mapping(request.get("options"))
    name = options.file_name or _safe_file_name(str(request["waveform"].get("name") or "arbdraw-waveform"))
    remote_path = str(PurePosixPath(options.directory) / name)
    frequency_hz = options.frequency_hz
    if frequency_hz is None:
        frequency_hz = _optional_positive(waveform.get("frequencyHz"), "waveform.frequencyHz")
    assert frequency_hz is not None
    payload = encode_tekscope_csv(values, frequency_hz)
    high = _optional_finite(waveform.get("highVoltage"), "waveform.highVoltage")
    low = _optional_finite(waveform.get("lowVoltage"), "waveform.lowVoltage")
    if high is None or low is None or high <= low:
        raise TekScopeAdapterError(
            "invalid_waveform", "waveform.highVoltage must be greater than waveform.lowVoltage."
        )
    amplitude_vpp = options.amplitude_vpp if options.amplitude_vpp is not None else high - low
    offset_voltage = (
        options.offset_voltage if options.offset_voltage is not None else (high + low) / 2
    )
    return upload_file_and_configure(
        resource,
        payload,
        remote_path,
        frequency_hz=frequency_hz,
        amplitude_vpp=amplitude_vpp,
        offset_voltage=offset_voltage,
        load_impedance=options.load_impedance,
        enable_output=options.enable_output,
        timeout_ms=options.timeout_ms,
        verify_readback=options.verify_readback,
        pyvisa_options=request.get("pyvisa_options"),
    )

