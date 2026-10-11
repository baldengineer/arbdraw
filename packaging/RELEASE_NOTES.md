This release updates the bundled TekScope MSO6 adapter to match the AFG's
documented limits: 131,072 arbitrary-waveform points, 250 MS/s, and repetition
rates from 0.1 Hz to 25 MHz. It validates the sample-count/rate relationship
and the load-dependent amplitude and offset ranges before opening a VISA
session. The ArbDraw MSO6 profile exposes the same limits.

The downloadable Python bridge bundle includes the TekScope MSO2 and MSO6
adapters introduced in version 0.1.3.

It also adds profile-configured PyVISA session options for instrument
identity queries and waveform transfers. The bundled Rigol DG1022 adapter now
accepts `read_termination`, `write_termination`, `query_delay`, and `send_end`
from ArbDraw instead of hard-coding instrument-specific values. The hosted
Rigol profile currently supplies a five-second query delay for affected DG1022
USB sessions.

It also adds model-specific `tekscope-mso2` and `tekscope-mso6` backends for
the built-in AFG on Tektronix scopes. The shared TekScope package writes a Tek
waveform CSV to the scope, verifies the bytes by reading the file back, selects
the file as the arbitrary source, and configures frequency, amplitude, offset,
load, and output state. The MSO2 backend retains its observed VXI-11 write-size
workaround; the MSO6 backend does not inherit that firmware-specific limit.
The MSO6 path has been verified end-to-end with waveforms up to 100,000 points.

The bridge also now prints its discovered waveform adapters at startup and
provides one-shot `--list-resources` and repeatable `--idn RESOURCE` commands.
These commands may be combined and exit without starting the HTTP server.

Download **`arbdraw-bridge-with-adapters.zip`**, extract it, and run `python install.py` with Python 3.11 or newer. This installs the bridge plus the OWON XDG3000 / Multicomp MP750290, Rigol DG1022, and TekScope MSO2/MSO6 adapters in the same Python environment. Run `python -m python_bridge` to start the bridge, then open **File → Instruments** in ArbDraw.

Use `python install.py --adapter owon-xdg3000`, `--adapter rigol-dg1022`, or `--adapter tekscope` if you need only one adapter package. The TekScope package registers both model-specific backends. Individual wheels and source distributions are also attached for manual installation and development. To add an adapter to an existing bridge installation, install its wheel with the same Python interpreter that installed `arbdraw-bridge.exe`.

An instrument connection also requires a suitable VISA implementation. See the [setup guide](https://github.com/baldengineer/arbdraw/blob/main/python_bridge/README.md) for details.
