# ArbDraw

An early UI/UX prototype for a flexible arbitrary waveform editor.

## Run

No build step or third-party dependencies are required. From the project directory:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Prototype features

- Scalable black waveform canvas with time and voltage axes
- Sine, square, triangle, ramp, pulse, DC, noise, custom, and serial waveform types
- Freehand, line, and erase editing
- Voltage, timing, phase, duty-cycle, cycle-count, and sample controls
- Fixed, evenly spaced voltage points with frequency and period stored as instrument metadata
- Frequency-derived time display with automatic s, ms, µs, and ns axis scaling
- Automatic V/mV axis scaling and scroll-wheel adjustment of numeric properties
- Undo and redo for waveform changes
- Viewer, sample-table, and JSON representations of the current waveform
- Conditional Serial metadata controls for protocol, word size, parity, start bit, and stop bit

## Project files

The editor keeps a versioned `arbdraw.waveform` document in memory as its source of truth. Use **Save** to download an `.arbdraw.json` project containing waveform parameters and sample values. Use **Open** to restore a project from a JSON file or pasted JSON text.

See [ArbDraw_JSON_Format.md](ArbDraw_JSON_Format.md) for the complete field reference, units, import rules, timing formulas, and a Python reader example.

Transient UI state such as the selected drawing tool, zoom, and undo history is intentionally not stored in the project document.

## Editing defaults

Edit [`js/defaults.js`](js/defaults.js) to change the fallback waveform values used for new projects and incomplete imported projects. The configuration currently contains high level, low level, offset, amplitude, sample rate, sample count, N Cycles, frequency, phase, duty cycle, display colors, and the Viewer vertical division count. Frequency and period are reciprocal instrument metadata; they set the displayed time span but do not regenerate the voltage points. The defaults use a JavaScript object rather than fetched JSON so the app also works when `index.html` is opened directly from disk.
