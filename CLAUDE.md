# Claude instructions for ArbDraw

Read and follow [AGENTS.md](AGENTS.md), the shared guide for using ArbDraw. It covers browser operation, waveform generation, Math/UART/I2C sources, signals and sequences, project JSON, timing, exports, verification, and optional instrument transfer.

Start by choosing the user's intended workflow: use the browser, produce an `.arbdraw.json` artifact, or transfer an explicitly requested waveform to an instrument. Use the current checkout's documentation and source when hosted releases differ.

For detailed references:

- [README.md](README.md): application setup and controls.
- [ArbDraw_JSON_Format.md](ArbDraw_JSON_Format.md): project fields and import rules; also read the timing caveat in AGENTS.md.
- [python_bridge/README.md](python_bridge/README.md): optional bridge, adapters, and REST API.

Save complete finite voltage samples with matching counts, keep source frequency distinct from record repetition and sample rate, and verify the selected signal/segment before export. Preserve existing sample edits. Do not claim browser or physical instrument validation unless those checks actually ran.

Maintain detailed instructions in AGENTS.md so the two entry points stay consistent. Documentation tracking: [issue #68](https://github.com/baldengineer/arbdraw/issues/68).
