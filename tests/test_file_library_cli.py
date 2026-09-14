import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'tools/file_library.py'
STORY = ROOT / 'examples/storyboards/晴天借阅室_分镜导入.json'


class FileLibraryCliTests(unittest.TestCase):
    def invoke(self, root, *args, success=True):
        result = subprocess.run([sys.executable, str(CLI), '--data', str(root), *map(str, args)], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=15)
        self.assertEqual(result.returncode, 0 if success else 2, result.stdout + result.stderr)
        return json.loads(result.stdout if success else result.stderr)

    def test_actual_twelve_scene_file_copy_import_and_share(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'first'; other = Path(temp) / 'second'
            original = STORY.read_bytes(); document = json.loads(original)
            self.invoke(root, 'init')
            imported = self.invoke(root, 'import', 'storyboards', STORY)
            restored = self.invoke(root, 'get', 'storyboards', imported['id'])['document']
            self.assertNotEqual(restored['id'], document['id'])
            self.assertEqual(restored['frames'], document['frames'])
            self.assertEqual(restored['outline'], document['outline'])
            self.assertTrue(all(frame['prompt'].count('{主角参考图}') == 1 for frame in restored['frames']))
            self.assertEqual(len(restored['frames']), 12)
            # Same JSON imports as a new identity, not an overwrite.
            again = self.invoke(root, 'import', 'storyboards', STORY)
            self.assertNotEqual(imported['id'], again['id'])
            # Direct copying is also supported, using the file's stable original ID.
            manual = root / 'storyboards/直接拷贝.json'; manual.write_bytes(original)
            self.invoke(root, 'scan')
            self.assertEqual(self.invoke(root, 'list', 'storyboards')['total'], 3)
            manual.rename(root / 'storyboards/更名后仍然是同一分镜.json'); self.invoke(root, 'scan')
            self.assertEqual(self.invoke(root, 'get', 'storyboards', document['id'])['document']['frames'], document['frames'])
            bundle = Path(temp) / '晴天分享.zip'
            self.invoke(root, 'export', 'storyboards', imported['id'], '--output', bundle)
            before = bundle.read_bytes()
            self.invoke(root, 'export', 'storyboards', imported['id'], '--output', bundle, success=False)
            self.assertEqual(bundle.read_bytes(), before)
            self.invoke(other, 'init')
            shared = self.invoke(other, 'import', 'storyboards', bundle)
            self.assertEqual(self.invoke(other, 'get', 'storyboards', shared['id'])['document']['frames'], document['frames'])
            self.assertEqual(STORY.read_bytes(), original)

    def test_cli_refuses_occupied_old_data_and_uninitialized_reads(self):
        with tempfile.TemporaryDirectory() as temp:
            old = Path(temp) / 'old'; old.mkdir(); file = old / 'content.json'; file.write_text('{"templates": []}')
            error = self.invoke(old, 'init', success=False)
            self.assertEqual(error['code'], 'conversion_required')
            self.assertEqual(file.read_text(), '{"templates": []}')
            self.assertFalse((old / 'workspace.json').exists())
            missing = Path(temp) / 'does-not-exist'
            self.invoke(missing, 'list', 'albums', success=False)
            self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
