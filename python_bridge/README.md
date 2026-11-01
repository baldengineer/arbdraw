# ArbDraw Python bridge

The bridge is the only process that talks to VISA or vendor utilities. ArbDraw talks to it over a versioned REST API at `http://127.0.0.1:8876` by default.

## Download and install

Open the [Python bridge releases](https://github.com/baldengineer/arbdraw/releases)
and download `arbdraw-bridge-with-adapters-<version>.zip` from the newest bridge release.
Extract it and use Python 3.11 or newer to install the bridge and all supported
adapters into one Python environment:

```powershell
python .\install.py
python -m python_bridge
```

On Windows, pip also creates `arbdraw-bridge.exe` in that Python environment's
`Scripts` directory. It is a launcher for the same bridge, not a standalone
installer. If you use a virtual environment, use its `python` executable for
both installation and startup.

### Windows notification-area app

The same installation also creates `arbdraw-bridge-tray.exe`. Run it to place
an ArbDraw Bridge icon in the Windows notification area. Click the icon to see
the ArbDraw favicon, current state, bridge version, and available adapters, then
choose **Start bridge**, **Stop bridge**, **Restart bridge**, or **Exit**. The
app finds `arbdraw-bridge.exe` in the same Python environment and starts it
without opening a console window.

When the icon loads, the app automatically tries to start the bridge. If a
compatible bridge is already running, it uses that process. If startup fails,
the icon reports an error and you can retry with **Start bridge**.

The favicon is grey while the bridge is stopped, starting, stopping, or in an
error state. It changes to the ArbDraw blue when the bridge health check
confirms that it is running.

The status check uses the configured bridge URL, `http://127.0.0.1:8876` by
default. It can also stop or restart a compatible bridge that was already
running when the tray app opened. Exiting the tray app stops a bridge that the
app started, but leaves a bridge started elsewhere running. Bridge output is
written to `%LOCALAPPDATA%\ArbDraw\bridge.log`.

For a non-default executable, URL, or bridge arguments, start the tray app from
a shortcut or terminal, for example:

```powershell
arbdraw-bridge-tray.exe --url http://127.0.0.1:9000 -- --port 9000 --visa-library @py
```

### macOS menu bar app

On macOS, the installation also creates `arbdraw-bridge-menubar` and installs
its native AppKit dependency. Run it from Terminal to add ArbDraw Bridge to the
menu bar without opening a Dock window:

```bash
arbdraw-bridge-menubar
```

When the status item loads, the app automatically tries to start the bridge.
If a compatible bridge is already running, it uses that process. If startup
fails, the menu reports an error and you can retry with **Start Bridge**.

Click the waveform status item to see the current state, bridge version,
available adapters, and bridge log. The menu provides **Start Bridge**, **Stop
Bridge**, **Restart Bridge**, **Open Bridge Log**, and **Quit ArbDraw Bridge**.
The status item is blue only after the health check confirms a running bridge;
otherwise it is grey.

The menu bar app finds `arbdraw-bridge` beside its own launcher. If the launcher
is not on `PATH`, use the full path shown by the installer, or run it from the
same environment as `python -m python_bridge.macos_menu_bar`. Only one menu bar
instance can run for a macOS user at a time.

As on Windows, the app can control a compatible bridge that was already
running. Quitting stops only a bridge process started by the menu bar app and
leaves an externally started bridge alone. Bridge output is written to
`~/Library/Logs/ArbDraw/bridge.log`.

Non-default URLs and bridge arguments use the same `--` separator as the
Windows utility:

```bash
arbdraw-bridge-menubar --url http://127.0.0.1:9000 -- --port 9000 --visa-library @py
```

To launch it when you sign in, add the full `arbdraw-bridge-menubar` executable
path from your Python environment in **System Settings → General → Login
Items**. Keep that environment installed at the same path.

To install only one instrument family, use `python .\install.py --adapter
owon-xdg3000`, `--adapter rigol-dg1022`, or `--adapter tekscope`. The TekScope
package registers separate `tekscope-mso2` and `tekscope-mso6` backends. The release also
contains individual `.whl` assets. For an existing bridge installation, install
the desired adapter wheel with **the same interpreter** that installed the
bridge, for example:

```powershell
python -m pip install .\owon_multicomp_awg_python_waveform_importer-0.1.0-py3-none-any.whl
python -m python_bridge
```

Use the actual downloaded wheel filename. If `arbdraw-bridge.exe` is on your
PATH but its Python environment is unclear, locate it with `Get-Command
arbdraw-bridge` and use the `python.exe` beside or above its `Scripts` directory.
The bridge alone still supports health checks, VISA discovery, and `*IDN?`, but
waveform sending needs an installed adapter. The `.tar.gz` assets are source
distributions intended mainly for developers and packaging tools.

## Install from source

From an ArbDraw source checkout, install and start the generic bridge with:

```powershell
python -m pip install -e .
python -m python_bridge
```

On macOS, that editable install also installs the Cocoa dependency and menu bar
launcher. Start it with `arbdraw-bridge-menubar` instead of the second command
when you want the menu bar controller.

For instrument access from a local source checkout, start with `python -m python_bridge --serve-app .` and open `http://127.0.0.1:8876`. Run this from the ArbDraw folder containing `index.html`; direct `file://` pages cannot call the bridge. See [Connect ArbDraw](#connect-arbdraw) below.

Instrument waveform sending also requires the corresponding adapter package.
For TekScope development, clone and install the separate package into the same Python
environment before starting the bridge:

```powershell
git clone git@github.com:baldengineer/tekscope-arbdraw-adapter.git .\local_adapters\tekscope-arbdraw-adapter
python -m pip install -e .\local_adapters\tekscope-arbdraw-adapter
python -m python_bridge --serve-app .
```

## One-shot VISA commands

The bridge CLI can list resources or query instrument identity without starting
the HTTP server:

```powershell
python -m python_bridge --list-resources
python -m python_bridge --idn "USB0::0x1234::0x5678::SN1::INSTR"
python -m python_bridge --idn 192.168.1.50
python -m python_bridge --idn 192.168.1.50:5025
```

`--list-resources` and `--idn` can be used together. `--idn` is repeatable when
you want to query more than one instrument. A bare IPv4 address becomes
`TCPIP0::<address>::INSTR`; an IPv4 address with a port becomes
`TCPIP0::<address>::<port>::SOCKET`. When either one-shot option is present, the
command performs the requested VISA operations and exits without starting the
bridge server.

## Connect ArbDraw

For the [hosted ArbDraw app](https://baldengineer.github.io/arbdraw/), start the bridge normally with `python -m python_bridge` or the tray/menu-bar launcher, then choose **File → Send to AWG**. The bridge listens only on `http://127.0.0.1:8876` by default; the hosted app does not need `--serve-app`.

For a local copy, open a terminal in the ArbDraw source folder containing `index.html` and run:

```powershell
python -m python_bridge --serve-app .
```

Open [http://127.0.0.1:8876](http://127.0.0.1:8876) in your browser and use that same URL in **Send to AWG**. Keep the terminal running. Stop an existing bridge on port 8876 before starting this command. The `.` selects the current source folder, not the extracted bridge installer folder.

Opening `index.html` directly still supports editing, saving, and exporting, but instrument discovery, Identify, and waveform transfer are blocked. Browsers assign `file://` pages an opaque origin shared with other untrusted documents; the bridge rejects these requests before dispatching instrument commands. Save your waveform as JSON before moving from a file page to the served app, then reopen it there. Browser preferences are stored separately for different origins.

If you use the pure-Python backend, install `pyvisa-py` too and start with `--visa-library @py`. A vendor VISA installation such as NI-VISA normally does not need that selector.

Keep the default loopback host unless you deliberately want to expose instrument control to another machine. Browser access is limited to the ArbDraw GitHub Pages origin and the exact loopback URLs served by `--serve-app`. Local `file://` pages (opaque `null` origins) are rejected; run `python -m python_bridge --serve-app .` from the checkout and open `http://127.0.0.1:8876` instead. Use repeatable `--allow-origin https://example.test` arguments for another trusted deployment.

## TekScope quick start

The TekScope package registers two bridge backends from one wheel:

- `tekscope-mso2` for MSO22, MSO24, MSO22-EDU, and MSO24-EDU.
- `tekscope-mso6` for MSO64, MSO66, MSO68, and their B variants.

Verify VISA access and identity before starting the long-running bridge:

```powershell
python -m python_bridge --list-resources
python -m python_bridge --idn 192.168.128.233
python -m python_bridge
```

A bare IPv4 address is normalized to a VXI-11
`TCPIP0::<address>::INSTR` resource. In ArbDraw, select the matching TekScope AWG
profile before opening **File → Send to AWG**. Connect, identify the scope,
confirm the matching backend, select channel 1, choose the desired output state,
and send the waveform.

The adapter currently stores files in `C:/baldee`; that folder must exist on
the scope. It disables output during transfer, verifies file readback, selects
the arbitrary source, applies frequency and voltage settings, and enables
output only when requested. Sending the same project name overwrites that file;
the adapter does not delete scope files.

MSO2 firmware has an observed `FILESystem:WRITEFile` failure near 8,092 bytes,
so the adapter rejects encoded payloads of 8,000 bytes or more. This is separate
from the profile's point-memory limit. The MSO6 backend does not inherit this
cap and has been verified end-to-end through 100,000 points. See the
[complete TekScope adapter guide](https://github.com/baldengineer/tekscope-arbdraw-adapter#readme).

## Install and manage adapters

See [ADAPTERS.md](ADAPTERS.md) for the complete adapter-authoring guide, including validation, safety, packaging, testing, registry direction, and an OWON XDG3000 / Multicomp MP750290 example.

The release ZIP contains separate adapter wheels for OWON XDG3000 / Multicomp
MP750290, Rigol DG1022, and TekScope instruments. The TekScope wheel provides
model-specific MSO2 and MSO6 bridge backends. The ZIP installer installs
them alongside the bridge wheel and verifies that all appear in the adapter registry. ArbDraw's
HTML/JavaScript editor works without them. Installing an adapter affects only
the Python environment used to run the bridge.

### Keep local adapter source for development

The following steps are for developing an adapter from source; release users can
use the ZIP flow above. The repository ignores the root-level `local_adapters`
directory so development clones do not become part of ArbDraw's Git history.
For example, clone the OWON adapter from the ArbDraw repository root:

```powershell
git clone --branch arbdraw_integration `
    https://github.com/baldengineer/owon-multicomp-awg-python-waveform-importer.git `
    .\local_adapters\owon-multicomp-awg-python-waveform-importer
```

Each adapter remains its own Git repository. Pull, branch, and commit inside its directory rather than from the ArbDraw repository.

### Install an adapter for development

Install the adapter into ArbDraw's virtual environment in editable mode:

```powershell
.\.venv\Scripts\python.exe -m pip install -e `
    .\local_adapters\owon-multicomp-awg-python-waveform-importer
```

Editable mode registers the source directory with the virtual environment instead of copying its Python files. Changes and pulls in the adapter repository are therefore used the next time the bridge starts. Reinstall after changing adapter packaging metadata or dependencies.

This installation does not make the adapter a dependency of the web app or generic bridge. Another ArbDraw checkout or virtual environment will not have the adapter unless it is installed there too.

### Verify an installation

Ask `pip` which version and source location are installed:

```powershell
.\.venv\Scripts\python.exe -m pip show `
    owon-multicomp-awg-python-waveform-importer
```

Then verify the bridge entry point can be imported from the ArbDraw root:

```powershell
.\.venv\Scripts\python.exe -c `
    "from arbdraw_bridge_adapter import send_waveform; print('OWON adapter available:', callable(send_waveform))"
```

This check imports the adapter but does not open a VISA resource or communicate with hardware.

### Test an adapter

Install the adapter's development dependencies when its documentation provides a `dev` extra:

```powershell
.\.venv\Scripts\python.exe -m pip install -e `
    ".\local_adapters\owon-multicomp-awg-python-waveform-importer[dev]"
```

Run the OWON hardware-free tests from the ArbDraw root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q `
    .\local_adapters\owon-multicomp-awg-python-waveform-importer\test_arbdraw_adapter.py
```

These tests validate document parsing, encoding, options, packaged defaults, and imports. They do not intentionally upload a waveform. Follow an adapter's own documentation for any separately authorized hardware tests.

### Start the bridge

```powershell
.\.venv\Scripts\python.exe -m python_bridge --serve-app . `
    --port 8876
```

The bridge discovers installed adapters registered in the `arbdraw.instrument_adapters` entry-point group. Open **File → Send to AWG** in ArbDraw to see the available waveform backends and select one before sending. The generic bridge remains usable for health checks, VISA discovery, identity queries, and SCPI queries when no adapter is installed.

The bridge is safe for multiple ArbDraw browser clients. Instrument-facing operations are serialized inside the bridge, including VISA discovery, queries, and adapter waveform transfers. This prevents concurrent clients or adapters from using the VISA stack at the same time. Non-instrument HTTP requests remain independently serviceable.

The legacy `--waveform-handler module:function` option remains available as a temporary compatibility override, but normal users should select the backend in the GUI.

### Update an editable adapter

Pull updates inside the adapter repository:

```powershell
git -C .\local_adapters\owon-multicomp-awg-python-waveform-importer pull --ff-only
```

Restart the bridge to load updated Python code. Run the editable install command again if `pyproject.toml` or dependencies changed.

### Develop the TekScope adapters

The shared TekScope package lives in its
[own repository](https://github.com/baldengineer/tekscope-arbdraw-adapter), like
the OWON and Rigol adapters. Clone it once into the ignored local adapter
directory, then register it in the bridge environment:

```powershell
git clone git@github.com:baldengineer/tekscope-arbdraw-adapter.git .\local_adapters\tekscope-arbdraw-adapter
.\.venv\Scripts\python.exe -m pip install -e .\local_adapters\tekscope-arbdraw-adapter
.\.venv\Scripts\python.exe -m unittest discover -s .\local_adapters\tekscope-arbdraw-adapter\tests -p "test_*.py"
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_tekscope_integration.py"
```

The adapter registers both `tekscope-mso2` and `tekscope-mso6`. It uploads a Tek
waveform CSV into the scope filesystem, reads it back for verification, selects
it as the built-in AFG arbitrary source, and applies the waveform settings.
Output remains off unless **Enable output after send** is selected.

To update, run:

```powershell
git -C .\local_adapters\tekscope-arbdraw-adapter pull --ff-only
```

Restart the bridge after pulling changes. Reinstall the editable package when
its packaging metadata or dependencies change. The integration tests skip
explicitly if no adapter is installed; set `ARBDRAW_REQUIRE_TEKSCOPE=1` to make
a missing adapter an error, as the release workflow does.

See [the adapter README](https://github.com/baldengineer/tekscope-arbdraw-adapter#readme)
for supported models, setup, CLI usage, and limitations. The authoritative
[TekScope file-command skill](https://github.com/baldengineer/tekscope-arbdraw-adapter/blob/main/skills/tekscope-file-commands/SKILL.md)
is maintained with that source.

### Build a release bundle from source

Check out each adapter at the full commit SHA recorded in
`.github/workflows/python-bridge-release.yml`, then build into a fresh output
directory. Release CI fetches each independent repository at those pins:

```powershell
.\.venv\Scripts\python.exe -m pip install build twine
.\.venv\Scripts\python.exe packaging/build_release.py --owon-source .\local_adapters\owon-multicomp-awg-python-waveform-importer --rigol-source .\local_adapters\rigol-awg-python-importer --tekscope-source .\local_adapters\tekscope-arbdraw-adapter
.\.venv\Scripts\python.exe packaging/check_release.py dist
```

The bridge has no mandatory adapter dependency. The release bundle contains
four separately built wheels: bridge, OWON, Rigol, and TekScope.

### Remove an adapter

Uninstall the package from ArbDraw's virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip uninstall `
    owon-multicomp-awg-python-waveform-importer
```

Uninstalling removes the virtual environment's registration but does not delete the source clone under `local_adapters`. Delete or archive that separate clone only when it is no longer needed.

### Adapter callable contract

Pass an adapter callable using `module:function` syntax:

```powershell
python -m python_bridge --waveform-handler my_arb_adapter:send_waveform
```

The callable receives one dictionary:

```python
def send_waveform(request):
    resource = request["resource"]
    project = request["waveform"]  # Complete arbdraw.waveform document
    options = request.get("options", {})

    # Call the existing instrument/vendor utility here.
    return {"status": "sent", "message": f"Sent to {resource}"}
```

Returning `None` uses a generic success message. Raise an exception to return an error to ArbDraw. Until an adapter is configured, **Send waveform** returns HTTP 501 with a clear message.

## REST API v1

- `GET /api/v1/health`
- `GET /api/v1/visa/resources`
- `POST /api/v1/visa/idn` with `resource` and optional `timeout_ms`
- `POST /api/v1/visa/query` with `resource`, `command`, and optional `timeout_ms`
- `POST /api/v1/waveforms/send` with `resource`, complete `waveform` document, and optional `options`

Errors use `{ "error": { "code": "...", "message": "..." }`. Origin checks run before API dispatch, and command POSTs require `application/json`. Other local web servers need an explicit `--allow-origin` including the port. Origin-less REST clients must send `X-ArbDraw-Token` matching a strong secret set in the bridge process environment as `ARBDRAW_BRIDGE_TOKEN`; without that configuration they are denied. The read-only health endpoint and direct `--idn`/`--list-resources` CLI commands need no token. Keep the token private; do not put it in URLs. This is a browser-origin boundary, not authentication against clients that can forge an approved Origin: keep the bridge on loopback.
