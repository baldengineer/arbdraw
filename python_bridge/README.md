# ArbDraw Python bridge

The bridge is the only process that talks to VISA or vendor utilities. ArbDraw talks to it over a versioned REST API at `http://127.0.0.1:8876` by default.

## Start it

Install PyVISA in the Python environment that can see your VISA implementation:

```powershell
python -m pip install pyvisa
python -m python_bridge --serve-app .
```

Then open `http://127.0.0.1:8876` and use **Instruments** inside ArbDraw. If ArbDraw is already open from GitHub Pages or another web server, start the bridge without `--serve-app`.

If you use the pure-Python backend, install `pyvisa-py` too and start with `--visa-library @py`. A vendor VISA installation such as NI-VISA normally does not need that selector.

Keep the default loopback host unless you deliberately want to expose instrument control to another machine. Browser access is limited to local/file origins and the ArbDraw GitHub Pages origin. Use repeatable `--allow-origin https://example.test` arguments for another trusted deployment.

## Install and manage adapters

See [ADAPTERS.md](ADAPTERS.md) for the complete adapter-authoring guide, including validation, safety, packaging, testing, registry direction, and an OWON XDG3000 / Multicomp MP750290 example.

Adapters are optional Python packages. ArbDraw's HTML/JavaScript editor works without them, and installing an adapter affects only the local Python virtual environment used to run the bridge.

### Keep local adapter source

The repository ignores the root-level `local_adapters` directory so development clones do not become part of ArbDraw's Git history. For example, clone the OWON adapter from the ArbDraw repository root:

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

The bridge discovers installed adapters registered in the `arbdraw.instrument_adapters` entry-point group. Open **File → Instruments** in ArbDraw to see the available waveform backends and select one before sending. The generic bridge remains usable for health checks, VISA discovery, identity queries, and SCPI queries when no adapter is installed.

The legacy `--waveform-handler module:function` option remains available as a temporary compatibility override, but normal users should select the backend in the GUI.

### Update an editable adapter

Pull updates inside the adapter repository:

```powershell
git -C .\local_adapters\owon-multicomp-awg-python-waveform-importer pull --ff-only
```

Restart the bridge to load updated Python code. Run the editable install command again if `pyproject.toml` or dependencies changed.

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

Errors use `{ "error": { "code": "...", "message": "..." }`. CORS is enabled for the hosted ArbDraw app, loopback web servers, and a local `file://` copy.
