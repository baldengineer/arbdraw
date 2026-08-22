# ArbDraw instrument adapter guide

This guide explains how to connect an existing waveform loader to the ArbDraw Python bridge. It is written for both human developers and AI coding agents.

An adapter translates ArbDraw's instrument-independent waveform document into the commands and binary data required by one instrument family. ArbDraw remains the only user interface. The browser sends a waveform to the local Python bridge, and the adapter owns all vendor-specific validation, encoding, VISA communication, and cleanup.

## Current implementation and intended direction

The bridge currently loads one adapter callable from the command line:

```powershell
python -m python_bridge --serve-app . --waveform-handler my_adapter:send_waveform
```

ArbDraw sends the complete project document to `POST /api/v1/waveforms/send`. The bridge validates the top-level request and calls the configured function. This is the supported integration point today.

The intended next step is a registry of instrument adapters selected from the resource and `*IDN?` response. Adapter code should therefore keep instrument matching, capabilities, transfer options, and waveform transmission separate, even when the first version exports only the current `send_waveform(request)` function. That structure will make the adapter straightforward to register later without changing its transfer implementation.

Do not add vendor-specific rules to ArbDraw's JavaScript or to the generic bridge service. Put them in the adapter.

## Data flow

```text
ArbDraw UI
    |
    | POST /api/v1/waveforms/send
    | resource + waveform document + options
    v
Python bridge
    |
    | configured adapter callable
    v
Instrument adapter
    |
    | validation + encoding + VISA/SCPI transfer
    v
AWG or oscilloscope
```

The bridge and adapter run in the same Python process. A native Python API is preferred over launching a command-line utility because it provides structured inputs, results, and errors without temporary files or console-output parsing.

For a utility that cannot yet be imported, a subprocess wrapper is an acceptable compatibility step. It may write the received waveform document to a temporary `.arbdraw.json` file, invoke the utility with a fixed allowlisted set of arguments, check its exit status, and remove the temporary file. Treat that wrapper as transitional and never construct arbitrary commands from browser input.

## Current adapter contract

The configured callable receives one dictionary with this shape:

```json
{
  "resource": "USB0::0x5345::0x1235::2025332::INSTR",
  "waveform": {
    "schema": "arbdraw.waveform",
    "version": 1,
    "name": "Waveform 01",
    "waveform": {
      "type": "custom",
      "highVoltage": 1.0,
      "lowVoltage": -1.0,
      "sampleRateMSa": 1.0,
      "frequencyHz": 1000.0,
      "sampleCount": 4,
      "values": [0.0, 1.0, 0.0, -1.0]
    }
  },
  "options": {
    "channel": 1,
    "persist": false,
    "enable_output": false
  }
}
```

### `resource`

`resource` is a nonempty VISA resource string selected in ArbDraw. The bridge converts a bare IPv4 address to the standard `TCPIP0::<address>::INSTR` form before sending the request.

An adapter must not assume that every transport supported for ASCII SCPI also supports binary waveform transfer. For example, an instrument may answer `*IDN?` over LAN while accepting bulk binary data only through USBTMC. Reject an unsupported transport before changing instrument state.

### `waveform`

`waveform` is the complete ArbDraw project document, not only the sample array. Adapters must require:

- `schema` equal to `arbdraw.waveform`.
- `version` equal to a version the adapter supports. Version 1 is the only current version.
- A `waveform` object.
- At least two finite numeric values.
- `waveform.sampleCount` equal to the length of `waveform.values`.
- Positive finite timing values required by the target instrument.
- Samples and voltage metadata within the target instrument's limits.

The authoritative sample array is `waveform.values`, expressed in volts. Canonical metadata units are volts, hertz, milliseconds, and millions of samples per second (`sampleRateMSa`). Do not depend on ArbDraw's displayed unit selections.

Adapters may use metadata such as `highVoltage`, `lowVoltage`, `frequencyHz`, and `sampleRateMSa` to configure the channel. They should derive amplitude and offset consistently:

```python
amplitude_vpp = high_voltage - low_voltage
offset_voltage = (high_voltage + low_voltage) / 2
```

An adapter should reject malformed documents rather than silently regenerate or alter samples. The editor is responsible for generating the final waveform sent to the bridge.

### `options`

`options` is an adapter-specific JSON object. Every option must be explicitly recognized, type checked, range checked, and given a safe default. Reject unknown options when accepting them could hide a spelling error or unsafe assumption.

Typical AWG options include:

```json
{
  "channel": 1,
  "persist": false,
  "user_slot": 1,
  "enable_output": false,
  "timeout_ms": 60000,
  "frequency_hz": null,
  "amplitude_vpp": null,
  "offset_voltage": null
}
```

Use `null` for an omitted override; do not confuse an omitted value with zero. Physical output should default to off. Persistent storage should be an explicit option because it can be slower and has different lifetime and wear implications than volatile memory.

Do not accept arbitrary SCPI commands, Python import names, executable paths, or command-line fragments through `options`.

## Return value

Return a JSON-serializable dictionary. At minimum, return `status` and a user-facing `message`:

```python
return {
    "status": "sent",
    "message": "Loaded 4096 points into EMEMory on channel 1; output is off.",
    "adapter": "owon-xdg3000",
    "identity": identity,
    "points": waveform.sample_count,
    "channel": 1,
    "output_enabled": False,
    "persistent_memory": None,
}
```

All returned values must be JSON serializable. Do not return VISA resource objects, exceptions, byte arrays, dataclasses, or `Path` instances without converting them.

Returning `None` is allowed, but the bridge can then display only a generic success message. A structured result is strongly preferred.

In the current bridge, an unhandled adapter exception becomes an HTTP 500 response with error code `internal_error`. Raise clear exceptions without secrets or binary payload contents in their messages. A future adapter registry should introduce a dedicated adapter exception carrying a stable error code, safe message, and appropriate HTTP status.

Recommended future error codes include:

- `adapter_not_found`
- `unsupported_instrument`
- `unsupported_transport`
- `invalid_waveform`
- `invalid_adapter_options`
- `instrument_limit_exceeded`
- `waveform_encode_failed`
- `waveform_upload_failed`
- `instrument_verification_failed`

## Minimal adapter that works today

```python
from __future__ import annotations

from typing import Any


def send_waveform(request: dict[str, Any]) -> dict[str, Any]:
    resource = request["resource"]
    project = request["waveform"]
    options = request.get("options", {})

    if project.get("schema") != "arbdraw.waveform" or project.get("version") != 1:
        raise ValueError("This adapter requires arbdraw.waveform version 1")
    if not isinstance(options, dict):
        raise ValueError("options must be an object")

    waveform = waveform_from_document(project)
    adapter_options = AdapterOptions.from_mapping(options)
    result = upload_waveform(resource, waveform, adapter_options)

    return {
        "status": "sent",
        "message": (
            f"Loaded {waveform.sample_count} points on channel "
            f"{adapter_options.channel}."
        ),
        **result,
    }
```

Keep this exported function thin. Parsing, validation, encoding, and transport belong in independently testable functions or classes.

## Recommended internal design

A maintainable adapter normally has four layers:

1. **Configuration** converts the `options` mapping into an immutable, validated configuration object.
2. **Waveform conversion** converts the in-memory ArbDraw project into an adapter-owned waveform model.
3. **Encoding** converts voltage samples into the device's binary or textual transfer format without opening an instrument.
4. **Transport** opens the VISA resource, verifies the instrument, transfers the encoded waveform, configures the channel, verifies success, and performs cleanup.

One possible interface is:

```python
class InstrumentAdapter:
    id = "vendor-model-family"
    name = "Vendor Model Family"

    def matches(self, resource: str, identity: str) -> bool:
        """Return true only for identities this adapter understands."""

    def capabilities(self) -> dict[str, Any]:
        """Describe limits, transports, channels, storage, and options."""

    def send_waveform(
        self,
        resource: str,
        project: dict[str, Any],
        options: dict[str, Any],
    ) -> dict[str, Any]:
        """Validate, encode, transfer, verify, and return a result."""
```

The current `send_waveform(request)` entry point can instantiate this class and delegate to it. Do not require the registry implementation before building the first adapter.

## Instrument selection and capabilities

The current bridge runs one explicitly configured adapter, so it does not automatically choose among instrument families. When a registry is added, selection should follow this order:

1. Discover the selected VISA resource.
2. Query and cache its `*IDN?` response for a short period.
3. Ask each registered adapter whether the resource and identity match.
4. Use the single match, or report a clear ambiguity or unsupported-instrument error.
5. Allow an explicit adapter selection only as a controlled override.

An adapter match should be conservative. Match parsed manufacturer and model fields or well-defined patterns, not a loose substring that could select the wrong command set.

Capabilities should eventually tell ArbDraw which controls are meaningful for the selected instrument. Useful fields include:

- Supported VISA transports, especially whether bulk upload works over USBTMC, TCPIP INSTR, or SOCKET.
- Minimum and maximum sample counts.
- DAC resolution or accepted sample representation.
- Available channels.
- Volatile and persistent memory support.
- Valid persistent slot range.
- Frequency, amplitude, and offset limits.
- Output-control support.
- Estimated or configured upload timeout.

Possible future endpoints are `GET /api/v1/adapters` and `GET /api/v1/instruments`. They do not exist yet and an adapter must not depend on them until the bridge implements them.

## VISA ownership, concurrency, and cleanup

All VISA access belongs in the Python process. ArbDraw must never communicate directly with an instrument.

Only one operation may modify a given VISA resource at a time. The bridge's generic query backend currently has its own lock, but a separately imported adapter may open its own resource manager. Until the bridge provides shared per-resource locks, the adapter must protect its multi-command upload from concurrent calls. A future registry should centralize per-resource locking for queries and adapters.

Use context managers or `try`/`finally` so instruments and resource managers always close. If the adapter locks the front panel, disables output, changes edit memory, or enters another temporary state, its failure path must restore the safest practical state.

Recommended upload order for an AWG is:

1. Validate the complete request without contacting the instrument.
2. Encode the waveform before contacting the instrument when practical.
3. Open the selected resource and set explicit read/write termination and timeout values.
4. Query and verify identity.
5. Read or clear the SCPI error queue as required by the instrument.
6. Disable the selected output.
7. Lock the front panel if supported.
8. Allocate memory and transfer the waveform.
9. Verify the point count and error queue.
10. Persist the waveform only when requested.
11. Select and configure the waveform on the requested channel.
12. Enable output only when explicitly requested and every prior step succeeded.
13. Unlock the front panel and close the resource.

Do not automatically retry a multi-step upload unless the operation is known to be idempotent. A retry after a partial transfer can produce surprising instrument state.

## Adapting an existing loader

Prefer refactoring the existing project into an importable package while preserving its command-line tool. Both interfaces should call the same library functions.

Before integration, look for these common obstacles. A file-based ArbDraw JSON API already supports the correct format; it is only an integration-boundary consideration because the REST bridge receives that JSON as an in-memory dictionary:

- File-only APIs such as `load_arbdraw_json(path)`, which can be used through a temporary file or supplemented with an in-memory entry point.
- Module globals initialized by argument parsing.
- Configuration loaded only from a working-directory file.
- Direct `print()` calls instead of returned results or progress callbacks.
- Calls to `sys.exit()` below the CLI layer.
- Broad exception handling that discards the original failure stage.
- Instrument I/O mixed into sample conversion, making dry-run tests impossible.
- An output-on default or cleanup path that can leave output enabled after failure.

The adapter-facing library should instead expose functions resembling:

```python
config = Config.from_mapping(options)
waveform = waveform_from_document(project, limits=config.limits)
payload = encode_waveform(waveform, config)
result = upload_waveform(resource, waveform, payload, config)
```

The command-line program may still load JSON or CSV files, combine TOML defaults with command-line overrides, call these functions, and print the result.

### OWON XDG3000 / Multicomp MP750290 example

The existing OWON/Multicomp utility already loads ArbDraw `.arbdraw.json` files directly. No waveform-format conversion or new JSON parser is required. It also separates much of the required work: it has a validated `Waveform` model, ArbDraw JSON parsing, DAB encoding, IEEE 488.2 block construction, and a VISA upload function. A bridge adapter should reuse those pieces rather than duplicate the instrument protocol.

There are two reasonable integration paths:

1. **Immediate compatibility adapter:** serialize the received `request["waveform"]` dictionary unchanged to a securely created temporary `.arbdraw.json` file, invoke the existing utility with fixed allowlisted command-line arguments, check its exit status, capture a safe result message, and delete the file in a `finally` block. This uses the utility's existing ArbDraw JSON support without modifying it.
2. **Preferred native adapter:** import the loader as a Python library and pass the already parsed document directly. This avoids temporary-file and subprocess management and makes structured errors, tests, locking, and future progress reporting easier.

The native path requires a reusable in-memory boundary, not new format support. Recommended refactoring steps are:

1. Add `waveform_from_document(project: dict) -> Waveform`; keep `load_arbdraw_json(path)` as a small file-reading wrapper around it.
2. Replace module globals such as identity prefix, maximum point count, and maximum DAC code with an immutable configuration object.
3. Make TOML defaults and `argparse` part of the CLI layer rather than requirements of the upload library.
4. Keep DAB encoding pure and test it without VISA hardware.
5. Let `upload_waveform` accept the selected resource and validated configuration directly.
6. Export a thin bridge entry point that maps ArbDraw options to the loader configuration and returns a JSON-safe result.

For that instrument family, the adapter must enforce the verified transport limitation: binary waveform transfer uses USBTMC even though LAN may work for ASCII SCPI. It should also preserve the loader's safe sequence of turning output off, locking the panel, checking the SCPI error queue, verifying allocated points, uploading the binary block, optionally copying to `USER` memory, selecting edit memory, configuring amplitude/offset/frequency, and enabling output only after complete success.

## Packaging and installation

The bridge should remain small and should not directly depend on every vendor package. Package native adapters separately when practical. A package may expose both its CLI and adapter entry point:

```text
owon_xdg3000/
    __init__.py
    model.py
    encoding.py
    transport.py
    bridge.py
    cli.py
```

During development, installing the adapter in the bridge's virtual environment is sufficient:

```powershell
python -m pip install -e C:\path\to\owon-loader
python -m python_bridge --serve-app . --waveform-handler owon_xdg3000.bridge:send_waveform
```

Longer term, Python entry points can provide adapter discovery without hard-coded imports:

```toml
[project.entry-points."arbdraw.instrument_adapters"]
owon-xdg3000 = "owon_xdg3000.bridge:OwonAdapter"
```

Entry-point discovery is a future bridge feature; the current bridge still requires `--waveform-handler`.

Pin or constrain dependencies when a vendor utility requires versions incompatible with the bridge environment. Do not dynamically install packages in response to a browser request.

## Testing requirements

Adapter development should not require hardware for routine tests. Use fake VISA resources or transport objects and keep encoding functions pure.

At minimum, test:

- Matching and rejecting representative `*IDN?` responses.
- Valid minimum, normal, and maximum point counts.
- Rejection of mismatched sample count and sample-array length.
- Rejection of booleans, nonnumeric values, NaN, infinity, and out-of-range values.
- Correct voltage-to-DAC conversion at low, center, and high levels.
- Correct byte order and IEEE 488.2 block length.
- Option defaults, type checks, ranges, and rejection of unknown options.
- Unsupported VISA transport rejection before instrument changes.
- SCPI command order for a successful upload.
- Output remaining off after every simulated failure stage.
- Front-panel unlock and resource closure after success and failure.
- JSON serialization of the returned result.
- One bridge integration test proving that `/api/v1/waveforms/send` invokes the adapter.

Hardware tests should be separate and opt-in. Record the tested instrument model, firmware, VISA backend, transport, point count, and whether persistent storage and output enabling were exercised.

## Definition of done

An adapter is ready when:

- It accepts the in-memory ArbDraw version 1 document through the current handler contract.
- Vendor-specific code is isolated from the generic bridge and browser UI.
- It validates the entire request before changing instrument state.
- It verifies instrument identity and supported transport.
- It enforces documented hardware limits.
- Output defaults to off and remains off after any failed transfer.
- Temporary instrument state is cleaned up in `finally` blocks.
- It returns a useful JSON-safe result.
- Unit tests cover validation, encoding, options, command order, and cleanup without hardware.
- At least one opt-in hardware test successfully uploads and selects a waveform.
- Its installation and `--waveform-handler` startup command are documented.

## Instructions for an AI coding agent

When implementing an adapter, first inspect both the current ArbDraw bridge contract and the existing loader's actual code. Do not infer an API from its README alone. Preserve proven instrument command sequences and safety behavior.

Make the smallest refactoring that creates a reusable library boundary while keeping the existing CLI operational. Do not copy a loader's protocol implementation into ArbDraw when it can be imported from the loader package. Avoid modifying the generic REST contract for one vendor.

Separate hardware-free tests from hardware tests. Never run a hardware test, enable an output, overwrite persistent instrument memory, or install a dependency unless the user has authorized that action and the exact target is known.

If the current bridge lacks a capability needed by more than one adapter, propose or implement that capability generically. Examples include per-resource locking, stable adapter error types, registry discovery, progress reporting, or cancellation. Clearly label future interfaces and do not write adapter code that assumes they already exist.
