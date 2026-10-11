"""ArbDraw adapter for TekScope-based instruments."""

from .adapter import (
    BACKENDS_BY_ID,
    MSO2_BACKEND,
    MSO2_SAFE_WRITE_BYTES,
    MSO6_BACKEND,
    AdapterOptions,
    TekScopeAdapterError,
    definite_block,
    encode_csv,
    encode_tekscope_csv,
    parse_cwd_response,
    send_waveform,
    send_waveform_mso2,
    send_waveform_mso6,
    upload_file_and_configure,
    validate_scope_path,
)

__all__ = [
    "BACKENDS_BY_ID",
    "MSO2_BACKEND",
    "MSO2_SAFE_WRITE_BYTES",
    "MSO6_BACKEND",
    "AdapterOptions",
    "TekScopeAdapterError",
    "definite_block",
    "encode_csv",
    "encode_tekscope_csv",
    "parse_cwd_response",
    "send_waveform",
    "send_waveform_mso2",
    "send_waveform_mso6",
    "upload_file_and_configure",
    "validate_scope_path",
]

