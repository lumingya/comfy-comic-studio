import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tools import protect_local_data as protect

# The folder that contains data/ (the repository root once the program lives in legacy/).
ROOT = protect.ROOT


@unittest.skipUnless(shutil.which('git'), 'git is required')
class ProtectLocalDataTests(unittest.TestCase):
    def test_manifest_lists_shipped_paths_under_data(self):
        paths = protect.shipped_paths(ROOT)
        self.assertIn('data/settings/workspace.json', paths)
        self.assertTrue(all(p.startswith('data/') for p in paths))
        self.assertTrue(all((ROOT / p).is_file() for p in paths))

    def test_protect_hides_local_edits_and_undo_restores_them(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            git = lambda *a: subprocess.run(['git', *a], cwd=root, check=True, capture_output=True)
            git('init', '-q')
            git('config', 'user.email', 'test@example.invalid')
            git('config', 'user.name', 'test')
            (root / 'data' / 'settings').mkdir(parents=True)
            (root / 'data' / 'settings' / '工作区 设置.json').write_text('{"a": 1}\n', encoding='utf-8')
            (root / 'data' / 'distribution.json').write_text(json.dumps(
                {'schema': 'mio.distribution.v1', 'files': {'settings/工作区 设置.json': ''}}), encoding='utf-8')
            git('add', '-A')
            git('commit', '-qm', 'init')
            paths = protect.shipped_paths(root)
            (root / 'data' / 'settings' / '工作区 设置.json').write_text('{"a": 2}\n', encoding='utf-8')
            porcelain = lambda: subprocess.run(['git', 'status', '--porcelain'], cwd=root, capture_output=True, check=True).stdout
            self.assertTrue(porcelain())
            self.assertEqual(protect.set_protection(root, paths), paths)
            self.assertEqual(porcelain(), b'')
            protected, changed = protect.status(root, paths)
            self.assertEqual((protected, changed), (paths, paths))
            protect.set_protection(root, paths, protect=False)
            self.assertTrue(porcelain())


if __name__ == '__main__':
    unittest.main()
