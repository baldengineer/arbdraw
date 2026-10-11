"""Smoke-test the exact release ZIP in a fresh Python environment."""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from python_bridge import __version__


VERIFY = """
import json
import threading
from importlib.resources import files
from urllib.request import urlopen
from python_bridge.server import BridgeService, create_server, discover_adapters

adapters = discover_adapters()
expected = {'owon-xdg3000', 'rigol-dg1022', 'tekscope-mso2', 'tekscope-mso6'}
assert expected <= adapters.keys(), f'Missing adapters: {expected - adapters.keys()}'
assert all(callable(adapters[name]) for name in expected)
for package, resource in (
    ('python_bridge', 'ArbDraw.ico'),
    ('python_bridge', 'ArbDraw-gray.ico'),
    ('owon_xdg3000', 'defaults.toml'),
    ('rigol_dg1022', 'defaults.toml'),
    ('rigol_dg1022', 'specs.toml'),
):
    assert files(package).joinpath(resource).is_file(), f'Missing {package}/{resource}'
server = create_server('127.0.0.1', 0, BridgeService(adapters=adapters))
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with urlopen(f'http://127.0.0.1:{server.server_port}/api/v1/adapters', timeout=5) as response:
        listed = {adapter['id'] for adapter in json.load(response)['adapters']}
    assert expected <= listed, f'Adapter endpoint omitted: {expected - listed}'
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
print('Release adapter smoke test passed:', ', '.join(sorted(adapters)))
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    bundle = args.directory / f"arbdraw-bridge-with-adapters-{__version__}.zip"
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        with ZipFile(bundle) as archive:
            archive.extractall(root / "bundle")
        environment = root / "venv"
        subprocess.run([sys.executable, "-m", "venv", str(environment)], check=True)
        python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        subprocess.run([str(python), str(root / "bundle" / "install.py")], check=True)
        tray = environment / (
            "Scripts/arbdraw-bridge-tray.exe"
            if sys.platform == "win32"
            else "bin/arbdraw-bridge-tray"
        )
        if not tray.is_file():
            raise SystemExit(f"Missing tray launcher: {tray}")
        subprocess.run([str(python), "-c", VERIFY], check=True)
        subprocess.run([str(python), "-m", "python_bridge", "--help"], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
