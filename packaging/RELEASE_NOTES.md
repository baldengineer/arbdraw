This release adds profile-configured PyVISA session options for instrument
identity queries and waveform transfers. The bundled Rigol DG1022 adapter now
accepts `read_termination`, `write_termination`, `query_delay`, and `send_end`
from ArbDraw instead of hard-coding instrument-specific values. The hosted
Rigol profile currently supplies a five-second query delay for affected DG1022
USB sessions.

The bridge also now prints its discovered waveform adapters at startup and
provides one-shot `--list-resources` and repeatable `--idn RESOURCE` commands.
These commands may be combined and exit without starting the HTTP server.

Download **`arbdraw-bridge-with-adapters.zip`**, extract it, and run `python install.py` with Python 3.11 or newer. This installs the bridge plus the OWON XDG3000 / Multicomp MP750290 and Rigol DG1022 adapters in the same Python environment. Run `python -m python_bridge` to start the bridge, then open **File → Instruments** in ArbDraw.

Use `python install.py --adapter owon-xdg3000` or `--adapter rigol-dg1022` if you need only one adapter. Individual wheels and source distributions are also attached for manual installation and development. To add an adapter to an existing bridge installation, install its wheel with the same Python interpreter that installed `arbdraw-bridge.exe`.

An instrument connection also requires a suitable VISA implementation. See the [setup guide](https://github.com/baldengineer/arbdraw/blob/main/python_bridge/README.md) for details.
