"""Install the wheels from an extracted ArbDraw bridge release bundle."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


WHEEL_PREFIXES = {
    "bridge": "arbdraw_python_bridge-",
    "owon-xdg3000": "owon_multicomp_awg_python_waveform_importer-",
    "rigol-dg1022": "rigol_dg1022_arbdraw_adapter-",
}


def find_wheel(directory: Path, prefix: str) -> Path:
    matches = sorted(directory.glob(f"{prefix}*.whl"))
    if len(matches) != 1:
        raise SystemExit(f"Expected one {prefix} wheel in {directory}; found {len(matches)}.")
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--adapter",
        choices=("all", "owon-xdg3000", "rigol-dg1022"),
        default="all",
        help="Install both supported adapters (default) or one instrument family.",
    )
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        parser.error("The bundled adapters require Python 3.11 or newer.")

    wheels = Path(__file__).resolve().parent / "wheels"
    selected = (
        ("owon-xdg3000", "rigol-dg1022")
        if args.adapter == "all"
        else (args.adapter,)
    )
    paths = [find_wheel(wheels, WHEEL_PREFIXES["bridge"])]
    paths.extend(find_wheel(wheels, WHEEL_PREFIXES[adapter]) for adapter in selected)
    subprocess.run([sys.executable, "-m", "pip", "install", *map(str, paths)], check=True)
    subprocess.run(
        [
            sys.executable,
            "-c",
            "from python_bridge.server import discover_adapters; "
            f"expected = {selected!r}; "
            "found = discover_adapters(); "
            "assert all(name in found for name in expected), f'Missing adapters: {found}'; "
            "print('Installed adapters:', ', '.join(sorted(found)))",
        ],
        check=True,
    )
    print(f"Start the bridge with: {sys.executable} -m python_bridge")


if __name__ == "__main__":
    main()
