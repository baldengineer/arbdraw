# TekScope ArbDraw adapter

This package uploads ArbDraw waveforms to the filesystem of a Tektronix 2
Series MSO, selects the uploaded CSV as the built-in AFG arbitrary source, and
applies the waveform frequency and voltage settings.

The adapter is intentionally separate from ArbDraw's generic bridge. It
registers the `tekscope-mso2` entry point when installed into the same Python
environment as the bridge:

```powershell
python -m pip install -e .\adapters\tekscope
python -m python_bridge --serve-app .
```

Output is disabled before transfer and stays disabled unless ArbDraw sends
`enable_output: true`. The current development destination is `C:/baldee`; API
clients can override it with the adapter-specific `directory` and `file_name`
options.

The current MSO2 CSV-over-VXI-11 transfer path is capped below the observed
8,092-byte `FILESystem:WRITEFile` boundary. ArbDraw therefore defaults this
profile to 100 points and limits it to 240 points. Larger arbitrary records
need a different file format or transfer path; increasing the timeout does not
bypass the scope's `Block too large` response.

For an authorized live file-transfer check without ArbDraw:

```powershell
arbdraw-tekscope upload-file `
  --resource "TCPIP0::192.168.128.233::INSTR" `
  --local-path ".\ignore\100 pts sine.csv" `
  --remote-path "C:/baldee/100 pts sine.csv" `
  --frequency-hz 1000 `
  --amplitude-vpp 1 `
  --offset-voltage 0 `
  --values-only
```

`--values-only` converts a one-value-per-line source into the Tek waveform CSV
shape accepted by the MSO2 built-in AFG. The command does not enable the AFG
output unless `--enable-output` is supplied.
Live writes overwrite the named destination; deletion is not implemented.

