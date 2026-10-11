---
name: tekscope-file-commands
description: Implement, review, or troubleshoot binary-safe SCPI file transfer for Tektronix scopes with FILESystem:CWD, FILESystem:READFile, and FILESystem:WRITEFile, including the MSO2-specific fatal 8,092 kB write ceiling. Use for bridge adapters and their tests; do not use as a general waveform-acquisition command reference.
---

# TekScope file commands

Use these rules when an ArbDraw bridge adapter must move a file to or from a
Tektronix 2 Series MSO. Keep vendor-specific file handling in the adapter, not
in the generic bridge or browser UI.

## Authoritative source

Use the Tektronix [2 Series MSO Programmer Manual landing page](https://www.tek.com/en/manual/oscilloscope/2-series-mso-programmer-manual-2-series-mso-portable-oscilloscope)
and [manual revision 077-1776-08](https://download.tek.com/manual/2-Series-MSO-Programmer-077177608.pdf),
released September 15, 2026 for MSO22, MSO24, MSO22-EDU, and MSO24-EDU.

Relevant printed pages in that manual:

- Command argument and IEEE 488.2 block format: 2-7 through 2-9.
- File-system conventions and command table: 2-32 through 2-33.
- `FILESystem:CWD`: 2-345.
- `FILESystem:READFile`: 2-350 through 2-351.
- `FILESystem:WRITEFile`: 2-354.

Recheck the current manual when supporting another Tektronix family or a
materially different firmware revision. Do not assume every Tek scope implements
the same file-system behavior.

## Undocumented MSO2 write limit

Treat the following as a project hardware erratum, not as a claim from the
programming manual:

- On MSO2 scopes, `FILESystem:WRITEFile` has a fatal data-transfer boundary at
  8,092 kB. Never send a payload at that boundary or above it.
- Set the adapter's maximum safe MSO2 write size below 8,092 kB and reject an
  oversized request before opening the VISA resource or changing scope state.
- Keep the measured unit explicit as `kB`; do not silently relabel it `KiB` or
  convert it using an unverified convention. The adapter must use a conservative
  byte ceiling until the exact decimal-versus-binary byte boundary is recorded.
- Do not try to bypass the limit by splitting one file across multiple
  `WRITEFile` calls. Append or continuation semantics are not documented.
- This limit is specific to MSO2 `WRITEFile`. Do not apply it globally to other
  TekScope families, which do not have this observed limit. Select write limits
  from the matched model's capabilities.
- `FILESystem:READFile` does not have this transfer limit, including on MSO2.
  Do not reject a read because its file size exceeds the write ceiling. Receive
  large reads with bounded-memory streaming or chunk accumulation appropriate
  to the VISA backend and enforce only ordinary host resource and timeout limits.

Return a stable error such as `instrument_limit_exceeded` for an MSO2 write that
is too large. Include the attempted size and configured safe maximum in the
message, but do not probe the fatal boundary on live hardware.

## Command contract

| Operation | SCPI form | Result |
| --- | --- | --- |
| Get working directory | `FILESystem:CWD?` | Returns the current directory as a quoted string, with an optional response header. |
| Set working directory | `FILESystem:CWD "E:/waveforms/"` | Changes the directory used by relative `FILESystem` commands. |
| Read a file | `FILESystem:READFile "E:/path/file.ext"` | Sends the named file's contents to the current interface. This is explicitly a no-query-form command. |
| Write a file | `FILESystem:WRITEFile "E:/path/file.ext",<Block>` | Writes the supplied block bytes to the named file. This is explicitly a no-query-form command. |

`READFile` must not acquire a trailing `?`. Send the command, then perform a
binary-safe raw read from the same session. Do not use a text query helper that
decodes, strips, or normalizes returned bytes.

## Paths and current-directory state

- Quote every file or directory argument.
- Tektronix documents MS-DOS-style paths: `[DRIVE:][\PATH\]filename`.
- Both slash directions are accepted. Prefer `/` in generated commands so host
  language escape sequences such as `\n` and `\t` cannot corrupt a path.
- Treat paths as 7-bit ASCII quoted strings. Reject NUL, CR, LF, and unsupported
  characters before opening the instrument. Escape a literal quote by doubling
  it only when the adapter deliberately supports quotes in file names.
- Prefer absolute paths. `CWD` affects later relative file commands and is shared
  mutable instrument state.
- When relative paths are required, query and save `CWD`, change it, perform the
  complete operation under the instrument lock, and restore it in `finally`.

The response to `CWD?` depends on the instrument's response-header setting. The
manual shows `:FILESYSTEM:CWD "E:/"`; an MSO22 with headers disabled returned
only `"C:"`. Parse the final quoted string instead of requiring either prefix.
Do not change the user's header setting merely to simplify parsing.

## Block encoding for `WRITEFile`

Use a definite-length block unless a tested transport requires otherwise. The
manual defines a block as either definite length
`#<N><decimal-byte-count><payload>` or indefinite length
`#0<payload><terminator>`. Definite length is safer for arbitrary binary data.

Build the command as bytes and send it as one raw VISA program message:

```python
def definite_block(payload: bytes) -> bytes:
    count = str(len(payload)).encode("ascii")
    if len(count) > 9:
        raise ValueError("payload is too large for an IEEE 488.2 definite block")
    return b"#" + str(len(count)).encode("ascii") + count + payload


def write_scope_file(instrument, path: str, payload: bytes) -> None:
    safe_path = validate_scope_path(path)
    prefix = f'FILESystem:WRITEFile "{safe_path}",'.encode("ascii")
    instrument.write_raw(prefix + definite_block(payload))
```

The byte count covers only `payload`, not the SCPI prefix, block header, or any
transport terminator. Do not pass arbitrary SCPI, a prebuilt block header, or a
caller-controlled command prefix through adapter options.

## Binary-safe `READFile`

Use a separate write and raw read because the command has no query form:

```python
def read_scope_file(instrument, path: str) -> bytes:
    safe_path = validate_scope_path(path)
    instrument.write(f'FILESystem:READFile "{safe_path}"')
    return instrument.read_raw()
```

The command page says the file contents are sent to the interface but does not
promise an IEEE block wrapper for the response. Preserve the received bytes.
Only remove a wrapper if behavior for the exact model, firmware, and transport
has been established by a focused hardware test. Never decode a binary file to
text as part of the transport layer.

### Verified MSO22 VXI-11 readback framing

An MSO22 running firmware `2.26.13-release.58`, read over the VXI-11
`TCPIP::...::INSTR` resource, returned the exact stored file bytes followed by
one transport LF byte. A 2,037-byte CSV ending in CRLF therefore produced a
2,038-byte `read_raw()` result ending in `CR LF LF`.

For byte-for-byte verification on this model/transport, accept either the exact
payload or exactly `payload + b"\n"`. Do not call `rstrip()`, normalize line
endings, or remove more than that one established transport byte; those actions
can hide real corruption in a binary file.

Drain the raw file response before sending any status query. A live test that
sent `*ESR?` immediately after `FILESystem:READFile` but before a separate raw
read interrupted the pending file response and produced ESR bit 4 / event 410
(`Query INTERRUPTED`). The safe order is command write, raw read to completion,
then status/error queries.

## MSO2 built-in AFG CSV requirements

`AFG:ARBitrary:SOUrce` accepts `.csv`, but a plain one-value-per-line file is
not sufficient on the tested MSO22. The file transferred and read back exactly,
then the AFG parser reported event 104 (`Data type error`) for that path. The
same values loaded successfully after they were wrapped in the Tek waveform CSV
shape produced by `SAVe:WAVEform CH1,"...csv"`:

```csv
Model,MSO22
Label,
Waveform Type,ANALOG
Horizontal Units,s
Sample Interval,1.00000000e-05
Record Length,100
Zero Index,49.00000000
Vertical Units,V

Labels,
TIME,CH1
-4.90000000e-04,1.25000000e-01
```

Use CRLF line endings and include one `TIME,<value>` row per point. For an
N-point waveform requested at frequency `f`, the tested encoder uses sample
interval `1 / (f * N)`, zero index `floor(N / 2) - 1`, and
`time[i] = (i - zero_index) * sample_interval`. Frequency is still programmed
explicitly with `AFG:FREQuency`; the file's time column does not replace that
setting.

On MSO22 firmware `2.26.13-release.58`, a generated 100-point file in this
shape loaded successfully, queried back as the selected arbitrary source, and
produced an on-scope CH1 frequency measurement of 1000.0000000019 Hz when the
AFG was set to 1 kHz. The configured 1 Vpp output measured 1.014 Vpp on CH1.

Source parsing can finish after the `AFG:ARBitrary:SOUrce` write returns. Poll
`*OPC?` to `1`, then check ESR/event status before applying later AFG settings;
otherwise an invalid-file error can surface on an unrelated subsequent command.

## Adapter workflow and safety

1. Validate the resource, path, payload size, overwrite policy, and all options
   before contacting the instrument. Apply the MSO2-only safe write ceiling
   after model selection and before sending any file data.
2. Open one VISA session, apply explicit timeout and termination settings, and
   verify `*IDN?` conservatively against the supported Tektronix models.
3. Hold the per-resource lock across any `CWD`, write/read, verification, and
   restoration sequence. The bridge serializes its own instrument operations,
   but the adapter may also be imported elsewhere.
4. Use an absolute destination and a collision-resistant temporary name when
   atomic replacement or readback verification is needed.
5. Send binary data with raw I/O. Check the instrument error facility after a
   write and report a stable, JSON-safe adapter error without embedding payload
   bytes or credentials.
6. Verify a write with a directory listing, size metadata, or byte-for-byte
   readback when the operation warrants it. Do not report success from a VISA
   write call alone.
7. Restore `CWD` and close the VISA resource in `finally`.

Writing, overwriting, renaming, or deleting a file changes instrument state.
Never perform a live write test unless the user authorized it and the exact
destination is known. Default tests to a fake VISA resource. Keep destructive
cleanup separately authorized when it is not already part of the requested
file-transfer operation.

## Tests

Cover these behaviors without hardware:

- Accepted and rejected `*IDN?` identities.
- Path quoting, forward-slash normalization, and rejection of control bytes.
- Definite-block headers at byte-count digit boundaries such as 9/10 and 99/100.
- Empty and binary payloads, including NUL, CR, LF, comma, quote, and `#` bytes.
- Exact raw command bytes for `WRITEFile`.
- MSO2 writes below the configured safe ceiling are accepted, while writes at
  the 8,092 kB fatal boundary and above are rejected without instrument I/O.
- Other TekScope identities do not inherit the MSO2 write ceiling.
- MSO2 `READFile` accepts responses larger than the write ceiling.
- `READFile` using command-write plus raw-read, with no trailing `?` and no text
  decoding.
- Header-on and header-off `CWD?` responses.
- Locking, timeout propagation, error mapping, session closure, and `CWD`
  restoration on every simulated failure stage.
- JSON serialization of the adapter's final result.

Keep live tests opt-in. Record model, serial, firmware, VISA backend, resource,
destination, byte count, overwrite behavior, and readback result when one is
authorized.
