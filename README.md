# ArbDraw

Vibe coded, but actually useful, arbitrary waveform editor.

[![ArbDraw waveform editor](arbdraw_screenshot.PNG)](https://baldengineer.github.io/arbdraw/)

## Try it online

Access the GitHub-hosted version at [baldengineer.github.io/arbdraw](https://baldengineer.github.io/arbdraw/).

## Run

No build step or third-party dependencies are required.


## Features

- Sine, square, triangle, custom, and serial (UART) waveform types
- Fixed, evenly spaced voltage points (with frequency and period stored as instrument metadata)
- Undo and redo for waveform changes
- Freehand, line, and erase editing
- Waveform Viewer (to simulate what you'd see on an oscilloscope)
- Serial pulse-train generation from protocol, baud, word size, parity, framing, and payload controls

## ArbDraw Files

The editor keeps a versioned `arbdraw.waveform` document in memory as its source of truth.

- Use **Save** to download an `.arbdraw.json` project containing waveform parameters and sample values.
- Use **Open** to restore a project from a JSON file or pasted JSON text.

See [ArbDraw_JSON_Format.md](ArbDraw_JSON_Format.md) for the complete field reference, units, import rules, timing formulas, and a Python reader example.

(Transient UI state such as the selected drawing tool, zoom, and undo history is intentionally not stored in the project document.)

## Editing defaults

Edit [`js/defaults.js`](js/defaults.js) to change the fallback waveform values used for new projects and incomplete imported projects. 

The defaults use a JavaScript object rather than fetched JSON so that the app also works when `index.html` is opened directly from disk.

## License

ArbDraw is available under the [MIT License](LICENSE).


