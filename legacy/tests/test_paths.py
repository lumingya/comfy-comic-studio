"""Shipped data/ resolution for the flat package layout and the repository legacy/ layout."""
import tempfile
import unittest
from pathlib import Path

from backend import mio_update
from backend.mio_paths import inside_repository_subfolder, shipped_data_dir


def _manifest(folder):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'distribution.json').write_text('{"files": {}}', encoding='utf-8')


class ShippedDataDirTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_package_layout_uses_data_next_to_program(self):
        _manifest(self.root / 'data')
        self.assertEqual(shipped_data_dir(self.root), self.root / 'data')

    def test_repository_layout_uses_data_beside_legacy(self):
        program = self.root / 'legacy'
        program.mkdir()
        _manifest(self.root / 'data')
        self.assertEqual(shipped_data_dir(program), self.root / 'data')

    def test_folder_without_manifest_never_shadows_the_repository_data(self):
        program = self.root / 'legacy'
        (program / 'data' / 'catalog').mkdir(parents=True)
        _manifest(self.root / 'data')
        self.assertEqual(shipped_data_dir(program), self.root / 'data')

    def test_defaults_to_program_data_when_nothing_is_shipped(self):
        self.assertEqual(shipped_data_dir(self.root), self.root / 'data')

    def test_updater_refuses_a_legacy_folder_inside_a_checkout(self):
        program = self.root / 'legacy'
        program.mkdir()
        (program / 'server.py').write_text('', encoding='utf-8')
        (self.root / '.git').mkdir()
        self.assertTrue(inside_repository_subfolder(program))
        facts = mio_update.install_facts(program, self.root / 'data')
        self.assertFalse(facts['canApply'])
        self.assertTrue(any('legacy/' in text for text in facts['blockers']))

    def test_checkout_root_itself_is_not_a_subfolder(self):
        (self.root / '.git').mkdir()
        self.assertFalse(inside_repository_subfolder(self.root))


if __name__ == '__main__':
    unittest.main()
