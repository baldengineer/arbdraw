# TekScope ArbDraw adapter

This package uploads ArbDraw waveforms to the filesystem of Tektronix MSO2 and
MSO6 scopes, selects the uploaded CSV as the built-in AFG arbitrary source, and
applies the waveform frequency and voltage settings.

The adapter is intentionally separate from ArbDraw's generic bridge. It
registers the `tekscope-mso2` and `tekscope-mso6` entry points when installed
into the same Python environment as the bridge:

```powershell
python -m pip install -e .\adapters\tekscope
python -m python_bridge --serve-app .
```

Output is disabled before transfer and stays disabled unless ArbDraw sends
`enable_output: true`. The current development destination is `C:/baldee`; API
clients can override it with the adapter-specific `directory` and `file_name`
options.

The two backends intentionally carry separate capability policy:

- `tekscope-mso2` accepts MSO22/MSO24 variants and applies the observed
  8,000-byte-safe `FILESystem:WRITEFile` workaround. Its ArbDraw profile exposes
  the instrument's 128,000-point depth; transfers that exceed the firmware
  workaround fail before the adapter changes AFG state.
- `tekscope-mso6` accepts MSO64/MSO66/MSO68 and B variants, exposes 100,000
  points, and does not inherit the MSO2 firmware-specific write cap. Its SCPI
  command set is documentation-grounded, but the CSV/readback behavior still
  needs validation on live MSO6 hardware.

For an authorized live file-transfer check without ArbDraw:

```powershell
arbdraw-tekscope upload-file `
  --backend tekscope-mso2 `
  --resource "TCPIP0::192.168.128.233::INSTR" `
  --local-path ".\ignore\100 pts sine.csv" `
  --remote-path "C:/baldee/100 pts sine.csv" `
  --frequency-hz 1000 `
  --amplitude-vpp 1 `
  --offset-voltage 0 `
  --values-only
```

`--values-only` converts a one-value-per-line source into the Tek waveform CSV
shape accepted by the selected backend's built-in AFG. The command does not enable the AFG
output unless `--enable-output` is supplied.
Live writes overwrite the named destination; deletion is not implemented.

