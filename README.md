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
- Sine, square, triangle, ramp, pulse, DC, noise, and blank presets
- Freehand, line, and erase editing
- Voltage, timing, phase, duty-cycle, and sample controls
- Undo and redo for waveform changes
- CSV export with time and voltage columns

## Project files

The editor keeps a versioned `arbdraw.waveform` document in memory as its source of truth. Use **Save** to download an `.arbdraw.json` project containing waveform parameters and sample values. Use **Open** to restore a project from a JSON file or pasted JSON text.

Transient UI state such as the selected drawing tool, zoom, and undo history is intentionally not stored in the project document.
