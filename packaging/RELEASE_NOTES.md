The Windows tray and macOS menu bar apps now automatically try to start the
bridge when their status icon loads. They use an already-running compatible
bridge without starting a duplicate. Startup failures appear in the status UI,
where you can retry with **Start Bridge**.

This release also adds `arbdraw-bridge-menubar`, a native macOS menu bar utility for
starting, stopping, and restarting the ArbDraw Python bridge without a Dock
window. It complements the existing `arbdraw-bridge-tray.exe` Windows
notification-area app. Both menus show the installed bridge version and the
available instrument adapters.

The status icon is grey while the bridge is inactive and changes to blue after
the health check confirms that the bridge is running. The Windows favicon
resources are included in the bridge wheel; macOS uses a native system symbol.

Download **`arbdraw-bridge-with-adapters-0.1.6.zip`**, extract it, and run
`python install.py` with Python 3.11 or newer. This installs the bridge plus the
OWON XDG3000 / Multicomp MP750290, Rigol DG1022, and TekScope MSO2/MSO6
adapters in the same Python environment. On Windows, run
`arbdraw-bridge-tray.exe`; on macOS, run `arbdraw-bridge-menubar`; on other
platforms, run `python -m python_bridge`. Then open **File → Send to AWG** in
ArbDraw.

Use `python install.py --adapter owon-xdg3000`, `--adapter rigol-dg1022`, or `--adapter tekscope` if you need only one adapter package. The TekScope package registers both model-specific backends. Individual wheels and source distributions are also attached for manual installation and development. To add an adapter to an existing bridge installation, install its wheel with the same Python interpreter that installed `arbdraw-bridge.exe`.

An instrument connection also requires a suitable VISA implementation. See the [setup guide](https://github.com/baldengineer/arbdraw/blob/main/python_bridge/README.md) for details.
