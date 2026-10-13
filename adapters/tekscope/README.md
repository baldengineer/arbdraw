# TekScope ArbDraw adapter

The TekScope package connects ArbDraw's local Python bridge to the built-in AFG
on supported Tektronix MSO2 and MSO6 scopes. It registers two bridge backends:

| ArbDraw profile | Bridge backend | Accepted `*IDN?` models | Profile limit |
| --- | --- | --- | --- |
| TekScope MSO2 (files) | `tekscope-mso2` | MSO22, MSO24, MSO22-EDU, MSO24-EDU | 128,000 points |
| TekScope MSO6 (files) | `tekscope-mso6` | MSO64, MSO66, MSO68, MSO64B, MSO66B, MSO68B | 131,072 points |

Both backends are installed from one `tekscope-arbdraw-adapter` Python package.
The selected backend checks the instrument identity before it writes a file, so
an MSO2 cannot accidentally be driven through the MSO6 policy or vice versa.

## What a send operation does

For each ArbDraw waveform, the adapter:

1. Validates the ArbDraw document, selected backend, file path, and settings.
2. Opens the VISA resource and checks `*IDN?` against the selected model family.
3. Encodes the sample values as a Tek waveform CSV using the identified model.
4. Checks the destination with `FILESystem:CWD` and `FILESystem:DIR?`, restoring
   the previous working directory. If the file exists and overwrite is off,
   stops with an error before changing AFG output.
5. Disables AFG output, deletes the existing destination only when overwrite
   is selected, and writes the CSV with binary-safe `FILESystem:WRITEFile` block data.
6. Reads the file back with `FILESystem:READFile` and verifies the bytes.
7. Selects the file with `AFG:ARBitrary:SOUrce`, waits for parsing to finish,
   and applies frequency, amplitude, offset, and load.
8. Enables output only when the request selected **Enable output**.
9. Queries the configured AFG state and returns it to ArbDraw.

The default destination directory is `C:/baldee`. Create that folder on the
scope before the first transfer. The filename is derived from the ArbDraw
project name unless an API caller supplies `file_name` or a CLI caller supplies
`--remote-path`. **Path** initially shows `C:/baldee/`; **Overwrite waveform file**
is off by default. Both preferences are saved in local browser settings and
shared by the MSO2 and MSO6 backends.

Tektronix's [file-command reference](https://tm-devices.readthedocs.io/stable/reference/tm_devices/commands/gen_gny502_msotekscopepc/filesystem/)
documents `WRITEFile` without an overwrite flag or a guarantee that existing
files are replaced. ArbDraw therefore implements explicit replacement with
`FILESystem:DELEte` followed by `WRITEFile`. With overwrite off, a collision
returns `waveform_file_exists` and asks you to change the project name or select
**Overwrite waveform file**. Replacement is not atomic: if writing fails after
deletion, the previous file is no longer available. No unrelated files are deleted.

## Requirements

- Python 3.11 or newer for the release bundle.
- A supported TekScope with its built-in AFG capability available.
- A LAN connection between the scope and the computer running the bridge.
- PyVISA plus a VISA implementation. NI-VISA normally works without an extra
  bridge option. For a pure-Python VISA stack, install `pyvisa-py` into the same
  Python environment and start the bridge with `--visa-library @py`.
- The supported TekScope AFG is a single-channel output. Selecting either
  TekScope backend sets Channel to 1 and disables the selector.

## Install from a release bundle

Download and extract `arbdraw-bridge-with-adapters.zip` from the latest ArbDraw
release. In the extracted directory, install the TekScope package and bridge
with the same Python interpreter:

```powershell
python .\install.py --adapter tekscope
```

Omit `--adapter tekscope` to install every bundled adapter. One TekScope wheel
provides both `tekscope-mso2` and `tekscope-mso6`.

Verify VISA communication before starting the server:

```powershell
python -m python_bridge --list-resources
python -m python_bridge --idn 192.168.128.233
```

A bare IPv4 address becomes `TCPIP0::<address>::INSTR`. Replace the example
address with the scope's address. Start the bridge and leave it running while
ArbDraw is open:

```powershell
python -m python_bridge
```

## Install from an ArbDraw source checkout

Install both the generic bridge and the TekScope package into the same virtual
environment. Reinstall the adapter after changing its `pyproject.toml` entry
points or dependencies.

```powershell
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m pip install -e .\adapters\tekscope
.\.venv\Scripts\python.exe -m pytest -q .\adapters\tekscope\tests
.\.venv\Scripts\python.exe -m python_bridge --serve-app .
```

Confirm both backends are registered without contacting hardware:

```powershell
.\.venv\Scripts\python.exe -c "from python_bridge.server import discover_adapters; print(sorted(discover_adapters()))"
```

The list should contain `tekscope-mso2` and `tekscope-mso6`.

## Use from ArbDraw

1. Select **TekScope MSO2 (files)** or **TekScope MSO6 (files)** in
   **AWG Profile** before creating or resizing the waveform.
2. Set the sample count, frequency, high voltage, and low voltage.
3. Choose **File → Send to AWG** and connect to
   `http://127.0.0.1:8876`.
4. Select a discovered VISA resource or enter a bare scope IP address.
5. Select **Identify (*IDN?)** and check that the model matches the profile.
6. Verify that ArbDraw selected `tekscope-mso2` or `tekscope-mso6` as the
   waveform backend.
7. Confirm **Path**, choose whether to **Overwrite waveform file**, and choose
   whether output should be enabled after a successful transfer. Channel is
   automatically set to 1 and disabled.
8. Select **Send waveform** and wait for the verified result.

The bridge API accepts adapter-specific `directory`, `overwrite`, `file_name`,
`frequency_hz`, `amplitude_vpp`, `offset_voltage`, `load_impedance`,
`enable_output`, `timeout_ms`, and `verify_readback` options. The current
ArbDraw dialog exposes channel, output state, destination directory, and overwrite;
the other values come from the project or adapter defaults. `overwrite` must be
a boolean and defaults to `false`.

## MSO2 firmware write limit

The 128,000-point profile limit describes the scope's waveform memory, but the
tested MSO2 firmware has a separate `FILESystem:WRITEFile` transport bug near
8,092 bytes. The adapter uses a conservative ceiling and rejects an encoded CSV
of 8,000 bytes or more after identity, but before it changes AFG state or sends
raw file data.

A 100-point encoded waveform is known to work. Larger records can exceed the
byte limit even when their point count is valid; increasing the VISA timeout
does not bypass the firmware's `Block too large` response. The adapter does not
split one file across multiple commands because append/continuation semantics
are not documented.

On the tested MSO22 firmware `2.26.13-release.58` over VXI-11, readback adds one
transport LF byte after the exact stored file. The adapter accepts only the
exact payload or that specific one-byte framing variant during verification.

## MSO6 hardware validation

The MSO6 backend does not inherit the MSO2 8,000-byte write ceiling. The
MSO4/5/6/7 command references support the file-system and AFG commands used by
the adapter. The MSO6/MSO6B arbitrary-waveform limits are 131,072 points,
250 MS/s, and 0.1 Hz to 25 MHz repetition rate, subject to
`points * repetition rate <= 250 MS/s`. Into High Z, arbitrary amplitude is
20 mVpp to 5 Vpp with -2.5 V to +2.5 V offset. Into 50 ohms, it is 10 mVpp to
2.5 Vpp with -1.25 V to +1.25 V offset. The backend validates these limits
before instrument I/O.

End-to-end ArbDraw transfers have been verified on MSO6 hardware through
100,000 points, including upload, readback verification, arbitrary-source
selection, and AFG configuration. The exact scope model, firmware revision,
VISA implementation, and any transport framing details should be recorded
during the next qualification run.

## Authorized CLI transfer test

The installed package provides `arbdraw-tekscope`. With `--values-only`, it
wraps a one-value-per-line file in the Tek waveform CSV format after identifying
the connected model:

```powershell
arbdraw-tekscope upload-file `
  --backend tekscope-mso2 `
  --resource "TCPIP0::192.168.128.233::INSTR" `
  --local-path ".\ignore\100 pts sine.csv" `
  --remote-path "C:/baldee/100 pts sine.csv" `
  --frequency-hz 1000 `
  --amplitude-vpp 1 `
  --offset-voltage 0 `
  --values-only
```

Add `--enable-output` only when the AFG should be on after verification. Add
`--overwrite` to replace the exact named destination; otherwise an existing file
causes an error. Replacement deletes that destination before writing it again.

## Troubleshooting

- **`tekscope-mso2` / `tekscope-mso6` is missing:** Install the TekScope wheel
  with the same interpreter that starts the bridge, then restart the bridge.
- **No VISA resources:** Verify the VISA implementation, LAN connection, and
  scope IP. A bare IP can still be entered directly in ArbDraw or passed to
  `python -m python_bridge --idn`.
- **Unsupported instrument:** The selected backend does not match the model
  returned by `*IDN?`. Select the matching ArbDraw profile and backend.
- **Invalid scope path or write failure:** Confirm `C:/baldee` exists on the
  scope and that the filename contains only supported ASCII characters.
- **`waveform_file_exists`:** Change the ArbDraw project name or select
  **Overwrite waveform file** and send again.
- **MSO2 `instrument_limit_exceeded`:** Reduce the sample count. A longer
  timeout will not help with the firmware block-size limit.
- **Readback or source-load failure:** Keep the complete error message, model,
  firmware, VISA resource, VISA implementation, destination path, and byte
  count when reporting the problem.

The command and file-transfer evidence used by this adapter is maintained in
[`skills/tekscope-file-commands/SKILL.md`](../../skills/tekscope-file-commands/SKILL.md).

