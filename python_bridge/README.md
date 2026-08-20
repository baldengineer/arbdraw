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

## Attach a waveform utility

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
