ArbDraw Python bridge with instrument adapters

Requires Python 3.11 or newer and an internet connection for Python dependencies.
Extract this ZIP, open a terminal in the extracted directory, then run:

    python install.py

This installs the bridge and both supported instrument adapters into that
Python interpreter. To install only one adapter, use either:

    python install.py --adapter owon-xdg3000
    python install.py --adapter rigol-dg1022

Start the bridge with the same interpreter:

    python -m python_bridge

On Windows, pip also creates arbdraw-bridge.exe in that interpreter's Scripts
directory. If you use a virtual environment, run its python executable for both
installation and startup. Open ArbDraw's File > Instruments dialog to connect.

The adapter code is distributed as separate wheels in this ZIP. It can also be
installed alongside an existing bridge wheel by running python -m pip install
with the selected adapter wheel path, using the same Python interpreter that
installed the bridge.

VISA communication requires a VISA implementation (such as NI-VISA). The Rigol
adapter also installs PyVISA-py. For general setup and safety information, see
https://github.com/baldengineer/arbdraw/blob/main/python_bridge/README.md
