This release adds `arbdraw-bridge-tray.exe`, a Windows notification-area app
for starting, stopping, and restarting the ArbDraw Python bridge without a
console window. Its context menu shows the installed bridge version and the
available instrument adapters.

The tray icon is grey while the bridge is inactive and changes to the blue
ArbDraw favicon after the health check confirms that the bridge is running.
Both icon resources are included in the bridge wheel.

Download **`arbdraw-bridge-with-adapters-0.1.5.zip`**, extract it, and run
`python install.py` with Python 3.11 or newer. This installs the bridge plus the
OWON XDG3000 / Multicomp MP750290, Rigol DG1022, and TekScope MSO2/MSO6
adapters in the same Python environment. On Windows, run
`arbdraw-bridge-tray.exe`; on other platforms, run `python -m python_bridge`.
Then open **File → Instruments** in ArbDraw.

Use `python install.py --adapter owon-xdg3000`, `--adapter rigol-dg1022`, or `--adapter tekscope` if you need only one adapter package. The TekScope package registers both model-specific backends. Individual wheels and source distributions are also attached for manual installation and development. To add an adapter to an existing bridge installation, install its wheel with the same Python interpreter that installed `arbdraw-bridge.exe`.

An instrument connection also requires a suitable VISA implementation. See the [setup guide](https://github.com/baldengineer/arbdraw/blob/main/python_bridge/README.md) for details.
