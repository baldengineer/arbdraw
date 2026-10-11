"""Authorized live-test CLI for the TekScope ArbDraw adapter."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .adapter import (
    BACKENDS_BY_ID,
    TekScopeAdapterError,
    encode_tekscope_csv,
    upload_file_and_configure,
)


def _numeric_rows(path: Path) -> list[float]:
    values = []
    for line_number, row in enumerate(path.read_text(encoding="ascii").splitlines(), 1):
        if not row.strip():
            continue
        if "," in row:
            raise TekScopeAdapterError(
                "invalid_waveform",
                f"{path} line {line_number} contains multiple columns; --values-only expects one value.",
            )
        try:
            values.append(float(row))
        except ValueError as error:
            raise TekScopeAdapterError(
                "invalid_waveform", f"{path} line {line_number} is not numeric."
            ) from error
    return values


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    upload = subparsers.add_parser("upload-file", help="Upload and select an existing arb CSV.")
    upload.add_argument(
        "--backend",
        choices=tuple(BACKENDS_BY_ID),
        default="tekscope-mso2",
        help="Select the expected TekScope model family.",
    )
    upload.add_argument("--resource", required=True)
    upload.add_argument("--local-path", required=True, type=Path)
    upload.add_argument("--remote-path", required=True)
    upload.add_argument("--frequency-hz", required=True, type=float)
    upload.add_argument("--amplitude-vpp", required=True, type=float)
    upload.add_argument("--offset-voltage", required=True, type=float)
    upload.add_argument("--load-impedance", choices=("HIGHZ", "FIFTY"), default="HIGHZ")
    upload.add_argument("--timeout-ms", type=int, default=60_000)
    upload.add_argument("--visa-library", default=None)
    upload.add_argument("--enable-output", action="store_true")
    upload.add_argument("--no-readback", action="store_true")
    upload.add_argument(
        "--values-only",
        action="store_true",
        help="Wrap a one-value-per-line CSV in the Tek waveform CSV format accepted by the scope AFG.",
    )
    arguments = parser.parse_args()

    backend = BACKENDS_BY_ID[arguments.backend]
    values = _numeric_rows(arguments.local_path) if arguments.values_only else None
    payload = None if values is not None else arguments.local_path.read_bytes()
    result = upload_file_and_configure(
        arguments.resource,
        payload,
        arguments.remote_path,
        frequency_hz=arguments.frequency_hz,
        amplitude_vpp=arguments.amplitude_vpp,
        offset_voltage=arguments.offset_voltage,
        load_impedance=arguments.load_impedance,
        enable_output=arguments.enable_output,
        timeout_ms=arguments.timeout_ms,
        verify_readback=not arguments.no_readback,
        visa_library=arguments.visa_library,
        backend=backend,
        payload_factory=(
            (
                lambda model: encode_tekscope_csv(
                    values,
                    arguments.frequency_hz,
                    model=model,
                    max_points=backend.max_arb_points,
                )
            )
            if values is not None
            else None
        ),
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

