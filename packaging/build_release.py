"""Build the bridge and pinned adapter distributions and one install bundle."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from python_bridge import __version__


ENTRY_POINT = (
    '[project.entry-points."arbdraw.instrument_adapters"]\n'
    'owon-xdg3000 = "arbdraw_bridge_adapter:send_waveform"\n'
)


def copy_source(source: Path, destination: Path) -> None:
    shutil.copytree(
        source,
        destination,
        ignore=shutil.ignore_patterns(
            ".git",
            ".venv",
            ".agents",
            ".aws",
            ".codex*",
            "__pycache__",
            "*.egg-info",
            "arbdraw_python_bridge-*",
            "dist",
            "build",
            "ignore",
            "local_adapters",
            "adapter-sources",
            "TEKSCOPE_ADAPTER_EXTRACTION_PLAN.md",
            "node_modules",
            ".pytest_cache",
        ),
    )


def build(source: Path, destination: Path, no_isolation: bool) -> None:
    command = [sys.executable, "-m", "build", "--outdir", str(destination)]
    if no_isolation:
        command.append("--no-isolation")
    command.append(str(source))
    subprocess.run(
        command,
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owon-source", required=True, type=Path)
    parser.add_argument("--rigol-source", required=True, type=Path)
    parser.add_argument("--tekscope-source", required=True, type=Path)
    parser.add_argument("--output", default=ROOT / "dist", type=Path)
    parser.add_argument("--no-isolation", action="store_true", help="Use installed build dependencies.")
    args = parser.parse_args()
    for name in ("owon", "rigol", "tekscope"):
        source = getattr(args, f"{name}_source").resolve()
        if not (source / "pyproject.toml").is_file():
            parser.error(f"--{name}-source must contain pyproject.toml: {source}")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as temporary:
        staging = Path(temporary)
        bridge = staging / "bridge"
        owon = staging / "owon"
        rigol = staging / "rigol"
        tekscope = staging / "tekscope"
        copy_source(ROOT, bridge)
        copy_source(args.owon_source.resolve(), owon)
        copy_source(args.rigol_source.resolve(), rigol)
        copy_source(args.tekscope_source.resolve(), tekscope)

        metadata = owon / "pyproject.toml"
        contents = metadata.read_text(encoding="utf-8")
        if "[project.entry-points." not in contents:
            contents = contents.replace("[tool.setuptools]", ENTRY_POINT + "\n[tool.setuptools]", 1)
            metadata.write_text(contents, encoding="utf-8")
        if ENTRY_POINT.strip() not in contents:
            raise SystemExit("OWON source has an unexpected adapter entry point.")

        build(bridge, output, args.no_isolation)
        build(owon, output, args.no_isolation)
        build(rigol, output, args.no_isolation)
        build(tekscope, output, args.no_isolation)

    wheels = sorted(output.glob("*.whl"))
    if len(wheels) != 4:
        raise SystemExit(f"Expected four wheels; found {[wheel.name for wheel in wheels]}")
    bundle = output / f"arbdraw-bridge-with-adapters-{__version__}.zip"
    with ZipFile(bundle, "w", compression=ZIP_DEFLATED) as archive:
        archive.write(ROOT / "packaging" / "install_release.py", "install.py")
        archive.write(ROOT / "packaging" / "RELEASE_README.txt", "README.txt")
        for wheel in wheels:
            archive.write(wheel, f"wheels/{wheel.name}")
    print(f"Built {bundle}")


if __name__ == "__main__":
    main()
