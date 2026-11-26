The bridge bundles the independently maintained [Tektronix AFG31252 adapter](https://github.com/baldengineer/tek-afg31252-arbdraw-adapter). Both AFG31252 profiles use the same backend. Advanced mode supports packed sample files and editor uploads at 16 or 128 Mpoints, depending on installed instrument memory.

Download **`arbdraw-bridge-with-adapters-0.1.7.zip`**, extract it, and run
`python install.py` with Python 3.11 or newer. This installs the bridge plus the
OWON XDG3000 / Multicomp MP750290, Rigol DG1022, TekScope MSO2/MSO6, and Tektronix AFG31252
adapters in the same Python environment. On Windows, run
`arbdraw-bridge-tray.exe`; on macOS, run `arbdraw-bridge-menubar`; on other
platforms, run `python -m python_bridge`. Then open **File → Send to AWG** in
ArbDraw.

Use `python install.py --adapter owon-xdg3000`, `--adapter rigol-dg1022`, `--adapter tekscope`, or `--adapter tek-afg31252` if you need only one adapter package. The TekScope package registers both model-specific backends. Individual wheels and source distributions are also attached for manual installation and development. To add an adapter to an existing bridge installation, install its wheel with the same Python interpreter that installed `arbdraw-bridge.exe`.

An instrument connection also requires a suitable VISA implementation. See the [setup guide](https://github.com/baldengineer/arbdraw/blob/main/python_bridge/README.md) for details.
