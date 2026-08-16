# ArbDraw JSON Format

ArbDraw project files contain a single waveform and use JSON encoded as UTF-8 text. Saved files normally use the extension `.arbdraw.json`.

The current format identifier is:

```json
{
  "schema": "arbdraw.waveform",
  "version": 1
}
```

## Complete example

```json
{
  "schema": "arbdraw.waveform",
  "version": 1,
  "name": "One Cycle Example",
  "waveform": {
    "type": "sine",
    "highVoltage": 1,
    "lowVoltage": -1,
    "durationMs": 8,
    "sampleRateMSa": 0.001,
    "frequencyHz": 125,
    "cycles": 1,
    "phaseDegrees": 0,
    "dutyCyclePercent": 50,
    "sampleCount": 8,
    "values": [
      0,
      0.7818314825,
      0.9749279122,
      0.4338837391,
      -0.4338837391,
      -0.9749279122,
      -0.7818314825,
      0
    ]
  }
}
```

## Top-level fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schema` | string | Yes | Must be exactly `arbdraw.waveform`. |
| `version` | number | Yes | Must be exactly `1`. |
| `name` | string | No | Project name. ArbDraw truncates imported names to 120 characters. |
| `waveform` | object | Yes | Waveform metadata and sample values. |

Unknown top-level fields are ignored.

## Waveform fields

| Field | Type | Unit | Description |
| --- | --- | --- | --- |
| `type` | string | — | Waveform classification. See **Waveform types** below. |
| `highVoltage` | number | V | Nominal high level. |
| `lowVoltage` | number | V | Nominal low level. |
| `durationMs` | number | ms | Derived record duration. ArbDraw recalculates this during import. |
| `sampleRateMSa` | number | MSa/s | Sample rate in millions of samples per second. `1` means 1,000,000 samples/second. |
| `frequencyHz` | number | Hz | Nominal waveform frequency. |
| `cycles` | integer | cycles | Number of waveform cycles represented by the sample array. Minimum value is 1. |
| `phaseDegrees` | number | degrees | Nominal phase offset. |
| `dutyCyclePercent` | number | % | High-state percentage for square and pulse waveforms. |
| `serial` | object | — | Serial framing metadata. See **Serial settings** below. |
| `sampleCount` | integer | samples | Number of entries expected in `values`. Minimum value is 2. |
| `values` | array of numbers | V | Ordered sample voltages. Every entry must be a finite JSON number. |

All waveform numbers use canonical units. UI display prefixes such as mV, kHz, and µs are not stored in the project JSON.

## Authoritative and derived values

Treat these fields as authoritative:

- `sampleCount`
- `sampleRateMSa`
- `frequencyHz`
- `cycles`
- `values`

ArbDraw derives the record duration as:

```text
durationMs = sampleCount / (sampleRateMSa × 1000)
```

An imported `durationMs` value is ignored and replaced with the calculated value. Frequency is configuration metadata and does not determine the sample values or cycle count.

## Sample ordering and time

`values[0]` is the first voltage point and `values[sampleCount - 1]` is the last.

ArbDraw displays sample timestamps across one period calculated from `frequencyHz`. The `cycles`
setting changes the voltage pattern within that span but is intentionally excluded from the time
calculation:

```text
displayTimeSeconds(i) = i / (sampleCount - 1) × (1 / frequencyHz)
```

For hardware-oriented processing, the sample rate itself is usually the more useful timing authority:

```text
sampleIntervalSeconds = 1 / (sampleRateMSa × 1,000,000)
hardwareTimeSeconds(i) = i × sampleIntervalSeconds
```

The current ArbDraw UI therefore uses frequency metadata for its displayed x-axis while retaining
`sampleRateMSa` and `durationMs` as separate instrument metadata. External scripts should choose the
timing interpretation required by the destination instrument.

## Waveform types

Version 1 recognizes:

- `custom`
- `sine`
- `square`
- `triangle`
- `ramp`
- `pulse`
- `dc`
- `noise`

The legacy value `free` is imported as `custom`. Unknown values are also imported as `custom`.

## Serial settings

When `type` is `serial`, the `serial` object stores the selected protocol and framing metadata:

| Field | Type | Allowed values | Default |
| --- | --- | --- | --- |
| `protocol` | string | `UART`, `I2C` | `UART` |
| `baud` | integer | Any positive integer | `57600` |
| `wordSize` | integer | `7`, `8` | `8` |
| `bitOrder` | string | `LSB`, `MSB` | `LSB` |
| `invertData` | boolean | `true`, `false` | `false` |
| `parity` | string | `odd`, `even`, `none` | `none` |
| `startBit` | boolean | `true`, `false` | `true` |
| `preIdleBits` | integer | Zero or greater | `1` |
| `postIdleBits` | integer | Zero or greater | `10` |
| `stopBits` | integer | `1`, `2` | `1` |
| `payload` | string | Any string | `0xAA` |
| `binaryPattern` | string | A string containing only `0` and `1`, or empty | Empty |

The object remains part of the project document when another waveform type is active, allowing the
Serial settings to be restored if Serial is selected again.

For UART, ArbDraw emits each payload word in the selected bit order with the enabled start bit and selected number of stop bits,
and the selected parity bit. Pre Idle and Post Idle add the requested number of high-level bit times
around the complete sequence. For I2C, words use the selected bit order with an ACK-low slot after each
word. The enabled start state begins the payload and the selected number of high stop states ends the complete I2C payload. Logic zero
uses `lowVoltage`; logic one uses `highVoltage`.

When `invertData` is `true`, only payload data bits are emitted with inverted logic. Framing, parity,
and idle bits retain their documented logic levels. The Binary field shows the final physical bit
sequence whether or not inversion is enabled.

Payloads beginning with `0x` are interpreted as hexadecimal (`0xAA` or `0xAA 0x55`). Every other
payload is treated as an ASCII-compatible UTF-8 string and transmitted in full, one encoded byte at
a time, before the selected word-size mask is applied.

Each generated serial bit occupies `1 / baud` seconds on the frequency-derived waveform time axis.
If the complete serial frame ends before the waveform buffer, all remaining samples are set to the
high-level serial idle state. Frames longer than the available time span are clipped at the end of
the buffer.

When `binaryPattern` is nonempty, it is the authoritative bit sequence used for waveform generation.
Editing another structured Serial control clears this override and rebuilds the sequence from the
protocol, framing, and payload settings. Its Binary editor is hidden by default; set
`serial_debug: true` in `js/defaults.js` to show it.

`type` describes how ArbDraw should regenerate the waveform when valid sample data is unavailable. When `values` is valid, it remains the statement of record for the actual waveform points.

## Import validation and normalization

ArbDraw applies the following rules while opening a file:

- `schema`, `version`, and `waveform` must be present and valid or the file is rejected.
- Numeric metadata fields may be JSON numbers or numeric strings; they are converted with JavaScript's `Number(...)`.
- `sampleCount` is rounded to an integer and limited to a minimum of 2.
- `cycles` is rounded to an integer and limited to a minimum of 1.
- `sampleRateMSa` and `frequencyHz` are limited to a minimum of `0.000001`.
- `dutyCyclePercent` is limited to the range 5 through 95.
- `values` must contain exactly `sampleCount` entries.
- Every `values` entry must already be a finite JSON number. Numeric strings are not accepted in this array.
- If any sample-array validation fails, the entire `values` array is discarded and ArbDraw regenerates samples from the waveform metadata.
- Missing or invalid metadata fields fall back to the defaults in `js/defaults.js`.
- Unknown fields are ignored.

Standard JSON cannot represent `NaN`, positive infinity, or negative infinity. Do not write those values into `values`.

## Minimal Python reader

```python
import json
import math
from pathlib import Path


def load_arbdraw(path):
    project = json.loads(Path(path).read_text(encoding="utf-8"))

    if project.get("schema") != "arbdraw.waveform":
        raise ValueError("Unsupported ArbDraw schema")
    if project.get("version") != 1:
        raise ValueError("Unsupported ArbDraw version")

    waveform = project.get("waveform")
    if not isinstance(waveform, dict):
        raise ValueError("Missing waveform object")

    sample_count = int(waveform["sampleCount"])
    sample_rate_msa = float(waveform["sampleRateMSa"])
    values = waveform["values"]

    if len(values) != sample_count:
        raise ValueError("Sample count does not match values length")
    if not all(type(value) in (int, float) and math.isfinite(value) for value in values):
        raise ValueError("Waveform values must be finite numbers")

    sample_rate_sa = sample_rate_msa * 1_000_000
    sample_interval_s = 1 / sample_rate_sa

    return {
        "name": project.get("name", "Imported waveform"),
        "type": waveform.get("type", "custom"),
        "sample_rate_sa": sample_rate_sa,
        "sample_interval_s": sample_interval_s,
        "values_v": values,
    }
```

## Writing compatible files

For maximum compatibility:

1. Write UTF-8 JSON with `schema` set to `arbdraw.waveform` and `version` set to `1`.
2. Store all metadata in the canonical units shown above.
3. Set `sampleCount` to the exact length of `values`.
4. Use only finite JSON numbers in `values`.
5. Calculate `durationMs` with the formula in this document, even though ArbDraw recalculates it when opening the file.
6. Preserve fields you do not modify if your script performs a read-edit-write operation.
