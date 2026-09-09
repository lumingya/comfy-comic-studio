"""Byte-level launcher regressions and native Windows execution checks."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import venv
from unittest.mock import patch
from tools import build_release
ROOT = Path(__file__).resolve().parents[1]

class LauncherFormatTests(unittest.TestCase):
    def test_utf8_without_bom_and_canonical_crlf(self):
        for name in ('start.bat', 'build_release.bat'):
            data = (ROOT / name).read_bytes()
            self.assertTrue(data.startswith(b'@echo off\r\n'))
            data.decode('utf-8')
            self.assertNotIn(b'\n', data.replace(b'\r\n', b''))
            self.assertNotIn(b'\r', data.replace(b'\r\n', b''))
            self.assertFalse(data.startswith(b'\xef\xbb\xbf'))

    def test_all_jump_targets_exist(self):
        for name in ('start.bat', 'build_release.bat'):
            source = (ROOT / name).read_text(encoding='utf-8')
            labels = set(re.findall(r'^:([\w-]+)', source, re.M))
            for target in re.findall(r'\bgoto ([\w-]+)', source, re.I):
                self.assertIn(target, labels)

    def test_requested_runtime_order_and_pause(self):
        source = (ROOT / 'start.bat').read_text(encoding='utf-8')
        self.assertIn('chcp 65001 >nul', source)
        self.assertIn('title Mio v1.0.0', source)
        self.assertIn('cd /d "%~dp0"', source)
        ordered = ['goto use_venv1', 'goto use_venv2', 'where python >nul', 'where py >nul']
        self.assertEqual(sorted(source.index(x) for x in ordered), [source.index(x) for x in ordered])
        for cmd in ['".venv\\Scripts\\python.exe" server.py', '"venv\\Scripts\\python.exe" server.py', 'python server.py', 'py server.py']:
            self.assertIn(cmd, source)
        self.assertTrue(source.rstrip().endswith(':end\npause'))
        for omitted in ['py -3', 'MIO_NO_PAUSE', 'sys.version_info', 'mio.exe']:
            self.assertNotIn(omitted, source)

    def test_release_launcher_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / 'start.bat'
            build_release.create_start_bat(target)
            self.assertEqual(target.read_bytes(), (ROOT / 'start.bat').read_bytes())

    def test_release_rejects_accidental_lf_only_source(self):
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / 'start.bat').write_bytes(b'@echo off\necho broken\n')
            with patch.object(build_release, 'ROOT_DIR', temp), self.assertRaisesRegex(ValueError, 'CRLF'):
                build_release.create_start_bat(Path(temp) / 'result.bat')

    def test_release_rejects_bom(self):
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / 'start.bat').write_bytes(b'\xef\xbb\xbf@echo off\r\n')
            with patch.object(build_release, 'ROOT_DIR', temp), self.assertRaisesRegex(ValueError, 'BOM'):
                build_release.create_start_bat(Path(temp) / 'result.bat')

    def test_git_preserves_crlf(self):
        self.assertIn('*.bat text eol=crlf', (ROOT / '.gitattributes').read_text())

@unittest.skipUnless(os.name == 'nt', 'Requires real Windows cmd.exe')
class WindowsLauncherExecutionTests(unittest.TestCase):
    def run_fixture(self, name='start.bat', environments=()):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'Mio 空格 & (test)!'
            folder.mkdir()
            (folder / name).write_bytes((ROOT / name).read_bytes())
            for environment in environments:
                venv.EnvBuilder(with_pip=False).create(folder / environment)
            script = folder / ('server.py' if name == 'start.bat' else 'tools/build_release.py')
            script.parent.mkdir(exist_ok=True)
            script.write_text('from pathlib import Path\nimport sys\nPath("launcher-ok.txt").write_text(sys.prefix, encoding="utf-8")\n', encoding='utf-8')
            result = subprocess.run([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/v:off', '/c', name], cwd=folder,
                                    env={**os.environ, 'MIO_NO_PAUSE': '1'}, input=b'\r\n',
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
            marker = folder / 'launcher-ok.txt'
            self.assertTrue(marker.exists(), result.stdout)
            if environments:
                self.assertEqual(Path(marker.read_text(encoding='utf-8')), folder / environments[0])

    def test_start_in_unicode_space_and_metacharacter_path(self):
        self.run_fixture()

    def test_dot_venv_has_priority_over_venv(self):
        self.run_fixture(environments=('.venv', 'venv'))

    def test_venv_used_when_dot_venv_absent(self):
        self.run_fixture(environments=('venv',))

    def test_build_launcher(self):
        self.run_fixture('build_release.bat')
