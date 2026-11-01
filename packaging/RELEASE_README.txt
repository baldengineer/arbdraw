ArbDraw Python bridge with instrument adapters

Requires Python 3.11 or newer and an internet connection for Python dependencies.
Extract this ZIP, open a terminal in the extracted directory, then run:

    python install.py

This installs the bridge and all supported instrument adapters into that
Python interpreter. To install only one adapter, use either:

    python install.py --adapter owon-xdg3000
    python install.py --adapter rigol-dg1022
    python install.py --adapter tekscope

The TekScope package installs separate tekscope-mso2 and tekscope-mso6 bridge
backends.

Start the bridge with the same interpreter:

    python -m python_bridge

On Windows, pip also creates arbdraw-bridge.exe and
arbdraw-bridge-tray.exe in that interpreter's Scripts directory. Run the tray
app for notification-area Start, Stop, and Restart controls, or run
arbdraw-bridge.exe directly. The tray menu shows the bridge version and
available adapters. Its ArbDraw favicon is grey while the bridge is inactive
and changes to blue when its health check confirms the bridge is running. If
you use a virtual environment, run its Python executable for installation and
use the launchers from that environment. Open ArbDraw's File > Send to AWG
dialog to connect.

On macOS, pip creates arbdraw-bridge and arbdraw-bridge-menubar in that
interpreter's bin directory. Run arbdraw-bridge-menubar for equivalent menu bar
Start, Stop, Restart, version, adapter, and log controls. The status item is
blue only while the bridge health check confirms it is running. Bridge logs are
stored in ~/Library/Logs/ArbDraw/bridge.log. The installer prints the full
launcher path, which you can also add to System Settings > General > Login
Items if you want it to start when you sign in.

The adapter code is distributed as separate wheels in this ZIP. It can also be
installed alongside an existing bridge wheel by running python -m pip install
with the selected adapter wheel path, using the same Python interpreter that
installed the bridge.

VISA communication requires a VISA implementation (such as NI-VISA). The Rigol
adapter also installs PyVISA-py. For general setup and safety information, see
https://github.com/baldengineer/arbdraw/blob/main/python_bridge/README.md
