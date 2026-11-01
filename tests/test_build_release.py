"""Release assembly must consume explicit external adapter sources."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile


spec = importlib.util.spec_from_file_location(
    'arbdraw_build_release', Path(__file__).resolve().parents[1] / 'packaging/build_release.py'
)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class BuildReleaseTests(unittest.TestCase):
    def test_tekscope_source_is_required(self):
        with patch('sys.argv', ['build_release.py', '--owon-source', '.', '--rigol-source', '.']):
            with contextlib.redirect_stderr(io.StringIO()) as errors, self.assertRaises(SystemExit):
                release.main()
        self.assertIn('--tekscope-source', errors.getvalue())

    def test_invalid_tekscope_source_fails_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'pyproject.toml').write_text('[project]\nname = "fixture"\n')
            args = ['build_release.py', '--owon-source', str(root), '--rigol-source', str(root),
                    '--tekscope-source', str(root / 'missing'), '--output', str(root / 'out')]
            with patch('sys.argv', args), contextlib.redirect_stderr(io.StringIO()) as errors:
                with self.assertRaises(SystemExit):
                    release.main()
            self.assertIn('--tekscope-source must contain pyproject.toml', errors.getvalue())
            self.assertFalse((root / 'out').exists())

    def test_external_tekscope_source_is_staged_and_bundled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bridge = root / 'bridge-source'
            (bridge / 'packaging').mkdir(parents=True)
            for name in ('install_release.py', 'RELEASE_README.txt'):
                (bridge / 'packaging' / name).write_text('fixture')
            # Neither local clones nor workflow checkouts belong in the bridge source staging.
            for name in ('local_adapters', 'adapter-sources'):
                (bridge / name).mkdir()
                (bridge / name / 'unwanted').write_text('fixture')
            adapters = {}
            for name in ('owon', 'rigol', 'tekscope'):
                adapters[name] = root / f'external-{name}'
                adapters[name].mkdir()
                (adapters[name] / 'pyproject.toml').write_text(
                    release.ENTRY_POINT if name == 'owon' else '[project]\nname = "fixture"\n'
                )
                (adapters[name] / 'origin.txt').write_text(name)
            calls = []

            def fake_build(source, output, no_isolation):
                calls.append(source.name)
                if source.name == 'bridge':
                    self.assertFalse((source / 'adapter-sources').exists())
                    self.assertFalse((source / 'local_adapters').exists())
                else:
                    self.assertEqual((source / 'origin.txt').read_text(), source.name)
                (output / f'{source.name}-0.1-py3-none-any.whl').write_bytes(b'wheel fixture')

            args = ['build_release.py', '--output', str(root / 'out')]
            for name, path in adapters.items():
                args.extend([f'--{name}-source', str(path)])
            with patch.object(release, 'ROOT', bridge), patch.object(release, 'build', fake_build), patch('sys.argv', args):
                release.main()
            self.assertEqual(calls, ['bridge', 'owon', 'rigol', 'tekscope'])
            with ZipFile(next((root / 'out').glob('*.zip'))) as archive:
                wheels = [name for name in archive.namelist() if name.startswith('wheels/')]
                self.assertEqual(len(wheels), 4)
                self.assertIn('wheels/tekscope-0.1-py3-none-any.whl', wheels)
