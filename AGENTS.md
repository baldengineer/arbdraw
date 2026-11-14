# Using ArbDraw as an AI agent

Use this guide when creating or inspecting waveforms with ArbDraw. For field details, read [ArbDraw_JSON_Format.md](ArbDraw_JSON_Format.md); for browser workflows, read [README.md](README.md). Instrument setup and the REST contract are in [python_bridge/README.md](python_bridge/README.md). This guide was checked against source revision `fcc414c`; documentation task: [issue #68](https://github.com/baldengineer/arbdraw/issues/68).

## Choose the right workflow

- Use the browser to generate standard sources, adjust properties, draw samples, inspect signals, and export files.
- Generate an `.arbdraw.json` file when the user gives an exact mathematical or sampled waveform. Open the file in ArbDraw to inspect and edit it. There is no general waveform-generation CLI; the Python bridge CLI is for instrument access and serving the app.
- Use the optional Python bridge only when instrument discovery or waveform transfer is part of the task. Creating a waveform file does not require hardware or Python dependencies.

Determine the required levels in volts, source frequency or record duration, cycle count, point count/resolution, destination profile, and desired output format. Use explicit units. Ask about missing requirements that materially change the signal; state reasonable assumptions for the rest. Distinguish source frequency, record repetition frequency, and sample rate.

## Open the application

The hosted app is <https://baldengineer.github.io/arbdraw/>. Opening the checkout's `index.html` directly also supports editing, JSON save/open, and file exports, without installation or a build step.

Direct `file://` pages cannot access the instrument bridge. For local instrument use, install the bridge and needed adapter, then run this from the ArbDraw checkout containing `index.html`:

```sh
python -m python_bridge --serve-app .
```

Open <http://127.0.0.1:8876>. For the hosted app, the normal `python -m python_bridge` launcher is sufficient. An already running bridge may occupy that port. Save JSON before changing browser origins; browser preferences are origin-specific and are not project backups.

## Create and edit a waveform

1. Select the signal and its AWG Profile before setting point count and source properties. Consult [js/awg-profiles.js](js/awg-profiles.js) for current limits. Profiles are waveform constraints, not a connection to an instrument.
2. Choose the Waveshape and set its properties: voltage levels, frequency, cycles, phase, and applicable duty, symmetry, edge-time, or source-specific controls. Amplitude is peak-to-peak: `high = offset + amplitude/2`, `low = offset - amplitude/2`.
3. Use Basic for source generation. Switch to Advanced for selection, freehand/erase editing, sample-table edits, and filters. The URL option `mode=arbitrary` refers to the advanced editing workflow; labels may differ between releases.
4. Inspect the result in Editor, Samples, and Viewer. Editor Absolute uses sample indices; Relative (Time) uses elapsed time. Viewer cursors measure displayed coordinates; they do not change or snap to samples.
5. Save the editable JSON project, then export the requested deliverable. Verify the selected signal and, for file exports, Full Record versus Segment.

Returning to Basic after point edits or filters regenerates the source and discards those changes after confirmation. Changing sources or sequence point allocations may also regenerate samples. Save a copy or duplicate the signal before replacing edits that need to survive. Undo/redo is associated with each signal.

Filters run noise, then smoothing, then voltage clamp. Clamp limits are volts; equal limits produce a constant voltage. Disabling a filter regenerates from the source and remaining filters, rather than reversing its effect on edited samples.

## Sources and examples

- **Periodic/DC:** sine, square, pulse, triangle, RC, and DC. Triangle symmetry 100% is a rising ramp; 0% is falling. RC `rcTau` is the number of time constants per cycle, not a duration in seconds. Rise/fall controls apply to square, pulse, and serial edges.
- **Math:** choose Math and apply an expression, or press Ctrl/Command+Enter. `sin(2*pi*x)` is a sine; `exp(-4*x)*sin(8*pi*x)` is a repeated damped oscillation. `x` runs from 0 up to, excluding, 1 each cycle. Results are clipped to [-1, 1], then mapped to `offset + amplitude/2 * result`; filters follow. Use explicit multiplication. `^` is exponentiation. Expressions are not JavaScript. Supported functions and limits are in the format guide. Increase point density when needed; there is no automatic antialiasing.
- **Noise:** choose white or pink noise, or add noise with a filter. Save actual samples when the exact realization matters; regeneration can produce different noise.
- **Serial/UART:** select Serial and configure baud, 7/8-bit words, bit order, parity, start/stop bits, idle intervals, and payload. Text is encoded as bytes; payloads beginning with `0x`, such as `0xAA 0x55`, are hexadecimal. `invertData` flips payload bits only, not the entire frame or electrical voltage standard. Ensure the complete frame fits the record; excess bits can be clipped. A nonempty `binaryPattern` overrides the structured framing until another serial control clears it.
- **I2C:** selecting I2C generates SDA and SCL records. Set their assignments to distinct signals, configure bus speed, address without the R/W bit, transaction, hexadecimal payload, ACK/NACK, levels, and resolution; select Generate packet to update both. Supported speeds are 100 kbit/s, 400 kbit/s, and 1 Mbit/s; resolution is 20/40/80 samples per bit. These are simulated bus levels, including target responses, not communication with a live target. I2C does not model open-drain circuitry, arbitration, or clock stretching and cannot be a sequence segment.

## Signals and sequences

**+ Signal** generates a new independent signal using inherited settings and record timing. **Duplicate signal** preserves exact samples and segments. Select the correct row/dropdown before editing, playing, exporting, or sending. Signal IDs are not physical channel numbers.

**Add Segments** starts a sequence. Select a segment card to edit it; Full Record is a read-only combined overview. Adding segments redistributes the total point count and regenerates sources; reordering preserves samples. Segments share one sample rate and concatenate in order. Viewer, playback, and Send to AWG use the complete sequence; file exports can use a chosen segment.

Saving JSON retains all signals. CSV, SVG, WAV, playback, and hardware transfer operate on one selected signal at a time. Separate uploads do not synchronize hardware outputs, even for an I2C pair.

## Write project JSON

Use UTF-8 `.arbdraw.json` with `schema: "arbdraw.waveform"` and `version: 2`. Supply a nonempty `signals` array, unique nonempty signal IDs, project/signal names, and `activeSignalId`. Every signal needs an `AWG` object and `waveform` object. Use supported profile IDs, integer point counts of at least 2 within the profile/application limit, and exactly that many finite numeric voltage values. Do not use numeric strings, NaN, or infinities for samples.

Version 2 rejects missing/invalid sample buffers; metadata alone is insufficient. Valid samples are authoritative and preserved on import. Set `samplesEdited: true` for custom point data that must not be silently treated as a freshly generated source. Do not use `custom` or `free` as waveform types; they are obsolete. Use a supported source type and preserve the explicit values.

Canonical JSON units are V, Hz, seconds for edge times, milliseconds for `durationMs`, degrees for phase, and **MSa/s** for sample rate: `0.048` means 48,000 samples/second. UI display prefixes and the display-unit defaults in `js/defaults.js` are not JSON units. Keep duplicated AWG/waveform count, rate, and level fields consistent. Preserve unrelated fields during read/edit/write.

This Python example creates a 1 kHz, 2 Vpp, zero-offset sine with one cycle and 48 samples at 48 kSa/s. It uses `i/N`, so the endpoint is not duplicated:

```python
import json
import math
from pathlib import Path

n, rate_hz, frequency_hz, cycles = 48, 48_000, 1_000, 1
values = [math.sin(2 * math.pi * cycles * i / n) for i in range(n)]
project = {
    "schema": "arbdraw.waveform", "version": 2,
    "name": "1 kHz sine", "activeSignalId": "signal-1",
    "signals": [{
        "id": "signal-1", "name": "Sine",
        "AWG": {
            "profileId": "audio", "sampleRateType": "Fixed",
            "sampleRateMSa": rate_hz / 1_000_000, "sampleCount": n,
            "frequencyHz": frequency_hz / cycles,
            "periodSeconds": cycles / frequency_hz,
            "highVoltage": 1, "lowVoltage": -1,
        },
        "waveform": {
            "type": "sine", "frequencyHz": frequency_hz, "cycles": cycles,
            "phaseDegrees": 0, "highVoltage": 1, "lowVoltage": -1,
            "sourceHighVoltage": 1, "sourceLowVoltage": -1,
            "sampleRateMSa": rate_hz / 1_000_000, "sampleCount": n,
            "durationMs": n / rate_hz * 1000,
            "filters": {"enabled": False}, "samplesEdited": False,
            "values": values,
        },
    }],
}
Path("sine-1khz.arbdraw.json").write_text(
    json.dumps(project, indent=2, allow_nan=False) + "\n", encoding="utf-8"
)
```

Version 1 uses top-level `AWG` and `waveform` and remains readable. Use it only for an older consumer that requires it. New application saves use version 2. The application's Send to AWG path already converts the selected signal to a version 1 document for adapter compatibility.

For sequences, include at least two non-nested `waveform.segments`, each with its own source fields, count, and finite values. Counts must sum to the full AWG count; the importer reconstructs the combined values from segments. For I2C, retain the recipe and role on both complete sampled outputs; use the application generator when possible.

## Timing: check the intended interpretation

For an ordinary record with `N` samples, `C` cycles, and source frequency `f`:

- AWG repetition frequency is `f/C`; the complete record period is `C/f`.
- Current Editor Relative (Time) uses `dt = C/(f*N)` and sample `i` at `i*dt`. The last sample precedes the end by one interval.
- Sample-rate metadata separately gives `R = sampleRateMSa * 1_000_000` and stored `durationMs = N/R * 1000`.

For sequences and generated I2C, sample-clock timing is authoritative: `dt = 1/R`, record duration `N/R`, and record repetition `R/N`. A sequence segment with `C` cycles and `Nsegment` points has source frequency `C*R/Nsegment`.

Do not assume frequency-derived timing equals sample-rate timing. If the requested destination needs them to agree, choose `R = N*f/C`. WAV duration uses `N/R`; browser playback uses the configured waveform timing. Check the actual export rather than relabeling its timestamps.

The format guide's older `displayTimeSeconds(i) = i/(N-1)/f` description does not describe the current Editor time axis. For current behavior consult `editorTiming()` in [js/waveform-editor.js](js/waveform-editor.js) and [tests/editor-time-axis.test.js](tests/editor-time-axis.test.js). Export and Viewer paths have their own timing implementations; do not assume every view uses the Editor formula.

## Save, export, and verify

- **Save JSON:** editable project with all signals, samples, source settings, and segments. Zoom, undo history, selected segment, and measurement cursors are transient.
- **CSV:** selected signal or segment, with optional metadata and timestamp column. Check column choices, units, and target instrument requirements.
- **SVG:** waveform drawing, optionally with axes/grid; not an editable ArbDraw project.
- **WAV:** mono 16-bit PCM, one sample-buffer copy, using the saved sample rate. Export accepts 8–384 kHz. Peak normalization changes absolute amplitude; WAV is not calibrated voltage output. The Audio profile defaults to 48 kHz and 1,000 points, with a 100,000-point maximum.

Before delivery, parse generated JSON and check every buffer's count and finite values, voltage extrema, timing, and profile limits. Open/save/reopen in the application when browser access is available, then inspect the desired signal/segment and export. Describe which checks actually ran; do not claim browser or hardware verification from file checks alone. Report artifact paths and key signal settings.

## Optional instrument transfer

Use [the bridge guide](python_bridge/README.md) for installation, VISA setup, adapter selection, REST payloads, and troubleshooting. Install bridge and adapters into the same Python environment. The generic bridge alone cannot send waveforms without a suitable adapter.

In **File → Send to AWG**, connect, Identify the intended resource, check the selected backend, choose the matching AWG Profile separately, and verify destination channel, load, voltage levels, repetition frequency, and requested output state. Identify does not change the waveform profile. Unknown/ambiguous instruments remain Identify-only until a suitable backend is selected. A successful upload is not a measurement of the physical signal.

Keep output disabled unless enabling it is part of the user's request. Do not guess a resource or channel, overwrite an instrument file unnecessarily, or assume that two channels are synchronized. Consult the adapter's limits as well as profile point limits; for example, TekScope MSO2 has a separate encoded-file-size limit.

For direct REST clients, use `/api/v1/health` to check the service, then follow the documented API. Origin-less command requests require `X-ArbDraw-Token` matching `ARBDRAW_BRIDGE_TOKEN` in the bridge environment. Do not bypass the origin boundary by forging a browser Origin. Keep the service on loopback and keep tokens out of files, URLs, and logs. Prefer the supported `--list-resources` and `--idn` CLI options for one-shot discovery and identification.

## If the task includes changing ArbDraw

Read the relevant source and tests before editing. Preserve direct-from-disk operation and classic-script loading order; the browser app has no required build step. Keep waveform calculations separate from UI behavior, and keep instrument-specific code in its adapter repository. Do not alter unrelated samples or saved settings to make an example work.

Run the relevant existing checks from the checkout:

```sh
node --test tests/*.test.js
python -m unittest discover -s tests -p test_python_bridge.py
```

Select additional tests for touched modules, such as tray/menu-bar, packaging, or adapter integration. Update the usage/format documentation when behavior changes. Hardware tests require an actual intended instrument and do not follow from passing host-independent tests.
