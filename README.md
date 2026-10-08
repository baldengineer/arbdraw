# ArbDraw

Vibe coded, but actually useful, arbitrary waveform editor.

[![ArbDraw waveform editor](arbdraw_screenshot.PNG)](https://baldengineer.github.io/arbdraw/)

## Try it online

Access the GitHub-hosted version at [baldengineer.github.io/arbdraw](https://baldengineer.github.io/arbdraw/).

## Run

No build step or dependency installation is required.

ArbDraw loads the pinned MIT-licensed Driver.js 1.8.0 browser distribution from jsDelivr for its first-run product tour. If the CDN is unavailable, it automatically falls back to the vendored copy, so the tour also works when `index.html` is opened directly from disk. The upstream license is retained in [`vendor/driver.js/1.8.0/LICENSE`](vendor/driver.js/1.8.0/LICENSE).

## Python instrument bridge

The **Instruments** button connects ArbDraw to a local Python REST service. From the app, users can discover VISA resources, issue `*IDN?`, and send the current waveform to a configured instrument adapter.

Download `arbdraw-bridge-with-adapters.zip` from the [Python bridge releases](https://github.com/baldengineer/arbdraw/releases), extract it, and run `python install.py` with Python 3.11 or newer. This installs the bridge and both supported instrument adapters into the same Python environment. Start it with `python -m python_bridge` (or `arbdraw-bridge.exe` on Windows). See [python_bridge/README.md](python_bridge/README.md) for single-adapter installation, VISA setup, source installation, and API details.


## Features

- Sine, square, pulse, triangle with adjustable symmetry (including rising/falling ramps), RC charging curves, white/pink noise, and serial (UART) waveform types
- Fixed, evenly spaced voltage points (with frequency and period stored as instrument metadata)
- Generator profiles, including Audio at 48 kHz with 1,000 default points and a 100,000-point maximum
- CSV export with optional waveform metadata headers
- SVG export with black lines on a transparent background and optional time/voltage axes and grid
- WAV export as mono 16-bit PCM at the current sample rate, with peak normalization (use the Audio profile for 48 kHz)
- Browser audio playback with a Play/Stop control and automatic output-rate conversion
- Optional noise and smoothing filters with checkbox and value controls in Advanced mode Properties
- Undo and redo for waveform changes
- Freehand, line, and erase editing
- Waveform Viewer (to simulate what you'd see on an oscilloscope)
- Serial pulse-train generation from protocol, baud, word size, parity, framing, and payload controls
- Adjustable rise and fall times for square, pulse, and serial waveforms, with linear ramps limited by the next opposite edge

## Editing modes

New projects open in **Basic**, where you choose a waveshape and adjust its properties. Switch to **Advanced** above the editor canvas to select or draw points and use filters. Returning to Basic after advanced edits or filters asks for confirmation, then regenerates the waveform from its properties and discards those advanced changes. Projects with point edits or active filters open in Advanced. Sample values can be changed in the Samples view only while Advanced is active. Theme and waveform rendering are available from the View menu.

## ArbDraw Files

The editor keeps a versioned `arbdraw.waveform` document in memory as its source of truth.

## URL parameters

The initial waveform can be selected and configured from the URL. URL parameters override saved browser settings. For example:

`?waveshape=triangle&frequencyHz=1000&nCycles=2&symmetryPercent=25`

For an RC charging curve, `rcTau` sets the number of time constants shown in each cycle (default 5); `tau` is accepted as a URL alias. Since `τ = R × C`, five time constants charge the capacitor from the low level to about 99.3% of the high level.

Parameters use the same names as the editable defaults in `js/defaults.js`. `wave`, `waveshape`, `waveform`, and `type` are aliases for `waveformType`; `frequency` and `period` are aliases for `frequencyHz` and `periodSeconds`. If both frequency and period are supplied, frequency takes precedence so the linked controls remain synchronized.

Use `?onboard=1` to force the getting-started tour to open or `?onboard=0` to suppress its automatic first-run launch. The tour can always be started again from **Help → Getting started**.

Driver.js uses the CDN by default. Add `?driver=local` to use the vendored JavaScript and CSS without attempting a network request.

- Use **Save** to download an `.arbdraw.json` project containing waveform parameters and sample values.
- Use **Open** to restore a project from a JSON file or pasted JSON text.

See [ArbDraw_JSON_Format.md](ArbDraw_JSON_Format.md) for the complete field reference, units, import rules, timing formulas, and a Python reader example.

(Transient UI state such as the selected drawing tool, zoom, and undo history is intentionally not stored in the project document.)

## Exporting waveforms

Choose **Export Waveform**, select **CSV**, **SVG**, or **WAV**, and enter a filename.

- **CSV** exports voltage samples with an optional metadata header and a timestamp column that is included by default but can be omitted. The timestamp choice is remembered until you create a new project or reset all settings.
- **SVG** exports black waveform lines on a transparent background, with optional axes and grid.
- **WAV** exports the current samples as mono, 16-bit PCM audio. Sample values are normalized so the largest absolute value reaches full scale; silence remains silent.

### Audio and WAV export

1. Select **Audio** in **AWG Profile** before creating your waveform. This sets the sample rate to **48 kHz** and the sample count to **1,000**, with a maximum of **100,000** points.
2. Adjust the sample count and create or edit your waveform.
3. Use **Play** in the AWG controls to hear the waveform through the browser. Playback follows the configured frequency and repeats until you select **Stop**.
4. Choose **Export Waveform → WAV**, enter a filename, and select **Export WAV**.

The WAV sample rate comes from the current waveform settings and is shown in the export dialog. The exporter accepts rates from **8 to 384 kHz**. Hardware generator profiles can use much higher rates, so select the Audio profile when preparing audio files for applications such as Adobe Audition.

The file contains one copy of the sample buffer. At 48 kHz, 1,000 points lasts about **20.8 ms**, and 100,000 points lasts about **2.08 seconds**. Selecting a profile resets the sample count to its default and regenerates the waveform, so choose the profile before editing.

## Editing defaults

Edit [`js/defaults.js`](js/defaults.js) to change the fallback waveform values used for new projects and incomplete imported projects. 

The defaults use a JavaScript object rather than fetched JSON so that the app also works when `index.html` is opened directly from disk.

## License

ArbDraw is available under the [MIT License](LICENSE).


