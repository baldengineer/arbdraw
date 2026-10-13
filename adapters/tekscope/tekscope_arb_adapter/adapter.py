"""Binary-safe TekScope file transfer and model-specific AFG configuration."""

from __future__ import annotations

import math
import re
import threading
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Callable, Iterable


# MSO22 firmware 2.26.13 rejects larger FILESystem:WRITEFile program messages
# over VXI-11 with event 161, "Invalid block data; Block too large". Stay below
# the project's observed 8,092-byte boundary. This is a transport/file-command
# limit, not the AFG's waveform-memory depth.
MSO2_SAFE_WRITE_BYTES = 8_000
MSO2_MODELS = frozenset({"MSO22", "MSO24", "MSO22-EDU", "MSO24-EDU"})
MSO2_MAX_ARB_POINTS = 128_000
MSO6_MODELS = frozenset({"MSO64", "MSO66", "MSO68", "MSO64B", "MSO66B", "MSO68B"})
MSO6_MAX_ARB_POINTS = 128 * 1024
MSO6_MIN_FREQUENCY_HZ = 0.1
MSO6_MAX_FREQUENCY_HZ = 25_000_000.0
MSO6_MAX_SAMPLE_RATE_SA = 250_000_000.0
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
class TekScopeLoadLimits:
    amplitude_vpp: tuple[float, float]
    offset_voltage: tuple[float, float]


@dataclass(frozen=True)
class TekScopeBackend:
    id: str
    family_name: str
    models: frozenset[str]
    max_arb_points: int
    safe_write_bytes: int | None = None
    frequency_hz: tuple[float, float] | None = None
    max_sample_rate_sa: float | None = None
    highz_limits: TekScopeLoadLimits | None = None
    fifty_ohm_limits: TekScopeLoadLimits | None = None


MSO2_BACKEND = TekScopeBackend(
    id="tekscope-mso2",
    family_name="Tektronix 2 Series MSO",
    models=MSO2_MODELS,
    max_arb_points=MSO2_MAX_ARB_POINTS,
    safe_write_bytes=MSO2_SAFE_WRITE_BYTES,
)
MSO6_BACKEND = TekScopeBackend(
    id="tekscope-mso6",
    family_name="Tektronix 6 Series MSO",
    models=MSO6_MODELS,
    max_arb_points=MSO6_MAX_ARB_POINTS,
    frequency_hz=(MSO6_MIN_FREQUENCY_HZ, MSO6_MAX_FREQUENCY_HZ),
    max_sample_rate_sa=MSO6_MAX_SAMPLE_RATE_SA,
    highz_limits=TekScopeLoadLimits(
        amplitude_vpp=(0.02, 5.0),
        offset_voltage=(-2.5, 2.5),
    ),
    fifty_ohm_limits=TekScopeLoadLimits(
        amplitude_vpp=(0.01, 2.5),
        offset_voltage=(-1.25, 1.25),
    ),
)
BACKENDS_BY_ID = {backend.id: backend for backend in (MSO2_BACKEND, MSO6_BACKEND)}


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
    overwrite: bool = False

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
            "overwrite",
        }
        unknown = sorted(set(value) - allowed)
        if unknown:
            raise TekScopeAdapterError(
                "invalid_adapter_options", f"Unknown TekScope option: {unknown[0]}."
            )

        channel = value.get("channel", 1)
        if isinstance(channel, bool) or channel != 1:
            raise TekScopeAdapterError(
                "invalid_adapter_options", "The TekScope built-in AFG uses channel 1."
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
        overwrite = value.get("overwrite", False)
        if not isinstance(overwrite, bool):
            raise TekScopeAdapterError("invalid_adapter_options", "overwrite must be boolean.")
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
            overwrite=overwrite,
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


def _validate_afg_limits(
    backend: TekScopeBackend,
    *,
    frequency_hz: float,
    amplitude_vpp: float,
    offset_voltage: float,
    load_impedance: str,
    sample_count: int | None = None,
) -> None:
    if backend.frequency_hz is not None:
        minimum, maximum = backend.frequency_hz
        if not minimum <= frequency_hz <= maximum:
            raise TekScopeAdapterError(
                "instrument_limit_exceeded",
                f"{backend.family_name} arbitrary repetition rate must be between "
                f"{minimum:g} Hz and {maximum:g} Hz.",
            )

    load_limits = (
        backend.highz_limits if load_impedance == "HIGHZ" else backend.fifty_ohm_limits
    )
    if load_limits is not None:
        amplitude_minimum, amplitude_maximum = load_limits.amplitude_vpp
        if not amplitude_minimum <= amplitude_vpp <= amplitude_maximum:
            raise TekScopeAdapterError(
                "instrument_limit_exceeded",
                f"{backend.family_name} amplitude into {load_impedance} must be between "
                f"{amplitude_minimum:g} Vpp and {amplitude_maximum:g} Vpp.",
            )
        offset_minimum, offset_maximum = load_limits.offset_voltage
        if not offset_minimum <= offset_voltage <= offset_maximum:
            raise TekScopeAdapterError(
                "instrument_limit_exceeded",
                f"{backend.family_name} offset into {load_impedance} must be between "
                f"{offset_minimum:g} V and {offset_maximum:g} V.",
            )

    if sample_count is not None and backend.max_sample_rate_sa is not None:
        if isinstance(sample_count, bool) or not isinstance(sample_count, int) or sample_count < 1:
            raise TekScopeAdapterError(
                "invalid_request", "sample_count must be a positive integer or null."
            )
        required_sample_rate = sample_count * frequency_hz
        if required_sample_rate > backend.max_sample_rate_sa:
            maximum_frequency = backend.max_sample_rate_sa / sample_count
            raise TekScopeAdapterError(
                "instrument_limit_exceeded",
                f"{backend.family_name} requires {required_sample_rate:g} Sa/s for "
                f"{sample_count} points at {frequency_hz:g} Hz; its maximum is "
                f"{backend.max_sample_rate_sa:g} Sa/s, so this record is limited to "
                f"{maximum_frequency:g} Hz.",
            )


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


def _validated_values(
    values: Iterable[float],
    *,
    max_points: int = MSO2_MAX_ARB_POINTS,
    family_name: str = "TekScope",
) -> list[float]:
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
    if len(numbers) > max_points:
        raise TekScopeAdapterError(
            "instrument_limit_exceeded",
            f"{family_name} arbitrary waveforms support at most {max_points} points.",
        )
    return numbers


def encode_tekscope_csv(
    values: Iterable[float],
    frequency_hz: float,
    *,
    model: str = "MSO22",
    label: str = "",
    max_points: int = MSO2_MAX_ARB_POINTS,
) -> bytes:
    """Encode the Tek waveform CSV shape accepted by supported TekScope AFGs."""
    numbers = _validated_values(values, max_points=max_points)
    frequency = _optional_positive(frequency_hz, "frequency_hz")
    assert frequency is not None
    if not isinstance(model, str) or model.upper() not in MSO2_MODELS | MSO6_MODELS:
        raise TekScopeAdapterError(
            "invalid_waveform", "CSV model must be a supported MSO2 or MSO6 model."
        )
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


def _parse_identity(identity: str, backend: TekScopeBackend) -> tuple[str, str]:
    fields = [field.strip() for field in identity.split(",")]
    if len(fields) < 2:
        raise TekScopeAdapterError(
            "unsupported_instrument", f"Unrecognized *IDN? response: {identity!r}"
        )
    manufacturer, model = fields[:2]
    if manufacturer.upper() != "TEKTRONIX" or model.upper() not in backend.models:
        raise TekScopeAdapterError(
            "unsupported_instrument", f"Expected a {backend.family_name}, received {identity!r}."
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


def _scope_file_exists(instrument: Any, path: str) -> bool:
    """List the destination directory, restoring shared CWD even on failure."""
    directory, _, name = path.rpartition("/")
    previous = parse_cwd_response(_query_text(instrument, "FILESystem:CWD?"))
    # CWD may return a drive alone (e.g. "C:"). Add its root separator so
    # validation and restoration retain absolute-path semantics.
    if re.fullmatch(r"[A-Za-z]:", previous):
        previous += "/"
    previous = validate_scope_path(previous, require_file=False)
    try:
        _write_checked(instrument, f'FILESystem:CWD "{directory}/"', "opening the waveform directory")
        response = _query_text(instrument, "FILESystem:DIR?")
        _check_status(instrument, "listing the waveform directory")
        listing = re.sub(r"^:?(?:FILESYSTEM|FILES):DIR\s*", "", response, flags=re.IGNORECASE)
        quoted = r'"(?:[^"]|"")*"'
        if listing and not re.fullmatch(rf"{quoted}(?:\s*,\s*{quoted})*", listing):
            raise TekScopeAdapterError(
                "instrument_verification_failed", "Could not parse FILESystem:DIR? response."
            )
        entries = re.findall(r'"((?:[^"]|"")*)"', listing)
        return any(entry.replace('""', '"').casefold() == name.casefold() for entry in entries)
    finally:
        _write_checked(instrument, f'FILESystem:CWD "{previous}"', "restoring the working directory")


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
    local_payload: bytes | None,
    remote_path: str,
    *,
    frequency_hz: float,
    amplitude_vpp: float,
    offset_voltage: float,
    load_impedance: str = "HIGHZ",
    enable_output: bool = False,
    timeout_ms: int = 60_000,
    verify_readback: bool = True,
    overwrite: bool = False,
    pyvisa_options: dict[str, Any] | None = None,
    visa_library: str | None = None,
    manager_factory: Callable[[], Any] | None = None,
    backend: TekScopeBackend = MSO2_BACKEND,
    payload_factory: Callable[[str], bytes] | None = None,
    sample_count: int | None = None,
) -> dict[str, Any]:
    """Upload one CSV, select it as the TekScope AFG source, and query settings back."""
    if not isinstance(resource, str) or not resource.strip():
        raise TekScopeAdapterError("invalid_request", "resource must be a non-empty string.")
    path = validate_scope_path(remote_path)
    if not isinstance(backend, TekScopeBackend):
        raise TekScopeAdapterError("invalid_request", "backend must be a TekScopeBackend.")
    if payload_factory is None and not isinstance(local_payload, bytes):
        raise TekScopeAdapterError("invalid_request", "local_payload must be bytes.")
    if payload_factory is not None and local_payload is not None:
        raise TekScopeAdapterError(
            "invalid_request", "Provide local_payload or payload_factory, not both."
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
    if not isinstance(overwrite, bool):
        raise TekScopeAdapterError("invalid_adapter_options", "overwrite must be boolean.")
    assert frequency is not None and amplitude is not None and offset is not None
    _validate_afg_limits(
        backend,
        frequency_hz=frequency,
        amplitude_vpp=amplitude,
        offset_voltage=offset,
        load_impedance=load,
        sample_count=sample_count,
    )
    session_options = dict(pyvisa_options or {})
    manager = None
    instrument = None
    identity = ""
    payload = b""
    received: bytes | None = None
    with _resource_lock(resource.strip()):
        try:
            manager = manager_factory() if manager_factory is not None else _open_manager(visa_library)
            instrument = manager.open_resource(resource.strip())
            _configure_session(instrument, timeout_ms, session_options)
            identity = _query_text(instrument, "*IDN?")
            _, model = _parse_identity(identity, backend)
            payload = payload_factory(model) if payload_factory is not None else local_payload
            if not isinstance(payload, bytes):
                raise TekScopeAdapterError("invalid_request", "Payload factory must return bytes.")
            if backend.safe_write_bytes is not None and len(payload) >= backend.safe_write_bytes:
                raise TekScopeAdapterError(
                    "instrument_limit_exceeded",
                    f"{backend.family_name} write is {len(payload)} bytes; the configured safe "
                    f"maximum is {backend.safe_write_bytes - 1} bytes.",
                )

            # Drain pre-existing status only after identity succeeds. Do not begin a
            # session with *CLS; power-on events are not attributable to this upload.
            _consume_status(instrument)
            exists = _scope_file_exists(instrument, path)
            if exists and not overwrite:
                raise TekScopeAdapterError(
                    "waveform_file_exists",
                    f"Waveform file {path} already exists. Change the project name or select "
                    "Overwrite waveform file and send again.",
                )
            _write_checked(instrument, "AFG:OUTPut:STATE OFF", "disabling AFG output")
            if exists:
                _write_checked(instrument, f'FILESystem:DELEte "{path}"', "deleting the existing waveform file")
            _write_scope_file(instrument, path, payload)

            if verify_readback:
                received = _read_scope_file(instrument, path)
                # MSO22 firmware 2.26.13 on VXI-11 terminates READFile with one
                # LF byte outside the stored file. Accept only that exact framing
                # variant; never broadly strip bytes from binary readback.
                readback_matches = received == payload or received == payload + b"\n"
                if not readback_matches:
                    raise TekScopeAdapterError(
                        "instrument_verification_failed",
                        f"Readback for {path} differed from the {len(payload)} uploaded bytes "
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
                    f"Uploaded {len(payload)} bytes to {path}; selected the arbitrary "
                    f"waveform at {actual['frequency_hz']:g} Hz and {actual['amplitude_vpp']:g} Vpp; "
                    f"output is {'on' if actual['output_enabled'] else 'off'}."
                ),
                "adapter": backend.id,
                "identity": identity,
                "model": model,
                "remote_path": path,
                "bytes": len(payload),
                "readback_verified": verify_readback,
                "overwritten": exists,
                "readback_transport_lf": verify_readback and received == payload + b"\n",
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


def _send_waveform(request: dict[str, Any], backend: TekScopeBackend) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise TekScopeAdapterError("invalid_request", "Adapter request must be an object.")
    resource = request.get("resource")
    if not isinstance(resource, str) or not resource.strip():
        raise TekScopeAdapterError("invalid_request", "resource must be a non-empty string.")
    project = request.get("waveform")
    waveform, raw_values = _project_waveform(project)
    values = _validated_values(
        raw_values,
        max_points=backend.max_arb_points,
        family_name=backend.family_name,
    )
    options = AdapterOptions.from_mapping(request.get("options"))
    name = options.file_name or _safe_file_name(str(request["waveform"].get("name") or "arbdraw-waveform"))
    remote_path = str(PurePosixPath(options.directory) / name)
    frequency_hz = options.frequency_hz
    if frequency_hz is None:
        awg = project.get("AWG") if isinstance(project, dict) else None
        if isinstance(awg, dict) and awg.get("frequencyHz") is not None:
            frequency_hz = _optional_positive(awg.get("frequencyHz"), "AWG.frequencyHz")
        else:
            frequency_hz = _optional_positive(waveform.get("frequencyHz"), "waveform.frequencyHz")
    assert frequency_hz is not None
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
        None,
        remote_path,
        frequency_hz=frequency_hz,
        amplitude_vpp=amplitude_vpp,
        offset_voltage=offset_voltage,
        load_impedance=options.load_impedance,
        enable_output=options.enable_output,
        timeout_ms=options.timeout_ms,
        verify_readback=options.verify_readback,
        overwrite=options.overwrite,
        pyvisa_options=request.get("pyvisa_options"),
        backend=backend,
        sample_count=len(values),
        payload_factory=lambda model: encode_tekscope_csv(
            values,
            frequency_hz,
            model=model,
            max_points=backend.max_arb_points,
        ),
    )


def send_waveform_mso2(request: dict[str, Any]) -> dict[str, Any]:
    """ArbDraw bridge entry point for Tektronix 2 Series MSO scopes."""
    return _send_waveform(request, MSO2_BACKEND)


def send_waveform_mso6(request: dict[str, Any]) -> dict[str, Any]:
    """ArbDraw bridge entry point for Tektronix 6 Series MSO scopes."""
    return _send_waveform(request, MSO6_BACKEND)


def send_waveform(request: dict[str, Any]) -> dict[str, Any]:
    """Backward-compatible alias for the original MSO2 bridge entry point."""
    return send_waveform_mso2(request)

