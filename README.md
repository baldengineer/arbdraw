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
