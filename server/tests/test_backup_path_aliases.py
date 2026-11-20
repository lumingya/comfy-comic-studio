"""Backup paths tolerate Windows spelling aliases while rejecting redirected ancestors."""

import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.backups import service, themes, ui_data


class BackupPathAliasTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.alias = self.base / "RUNNER~1"
        self.expanded = self.base / "Runner Expanded"
        self.workspace = self.alias / "workspace"
        self.workspace.mkdir(parents=True)

    def expanded_resolve(self):
        original = Path.resolve

        def resolve(path, *args, **kwargs):
            resolved = original(path, *args, **kwargs)
            if resolved.is_relative_to(self.alias):
                return self.expanded / resolved.relative_to(self.alias)
            return resolved

        return patch.object(Path, "resolve", resolve)

    def test_regular_recovery_directory_accepts_an_expanded_spelling(self):
        recovery = self.alias / ".workspace.mio-recovery"
        with (
            patch.object(service, "recovery_root", return_value=recovery),
            self.expanded_resolve(),
        ):
            backups = service.Backups(SimpleNamespace(data_dir=self.workspace))
            self.assertEqual(backups.root, recovery)
            folder = backups._folder("exports", "backup_012345abcdef")
            self.assertEqual(folder, recovery / "exports" / "backup_012345abcdef")
        self.assertTrue(recovery.is_dir())

    def test_theme_enumeration_accepts_an_expanded_spelling(self):
        root = self.workspace / "themes"
        root.mkdir()
        with self.expanded_resolve():
            self.assertEqual(list(themes.theme_files(self.workspace)), [])

    def test_ui_preferences_keep_original_paths_when_resolve_expands_them(self):
        preferences = self.workspace / "theme_data" / "paper" / "preferences.json"
        preferences.parent.mkdir(parents=True)
        preferences.write_text('{"scale":1}', encoding="utf-8")
        with self.expanded_resolve():
            self.assertTrue(ui_data._directory(preferences.parent))
            files = list(ui_data.data_files(self.workspace))
        self.assertEqual(files, [("theme_data/paper/preferences.json", preferences)])

    def test_backups_reject_reparse_points_on_ancestors_before_creation_or_read(self):
        recovery = self.alias / ".workspace.mio-recovery"
        original = Path.lstat

        def reparse(path, *args, **kwargs):
            if path == self.alias:
                return SimpleNamespace(
                    st_mode=stat.S_IFDIR,
                    st_file_attributes=getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400),
                )
            return original(path, *args, **kwargs)

        with patch.object(Path, "lstat", reparse):
            with patch.object(service, "recovery_root", return_value=recovery):
                with self.assertRaisesRegex(ValueError, "reparse"):
                    service.Backups(SimpleNamespace(data_dir=self.workspace))
            with self.assertRaisesRegex(ValueError, "reparse"):
                service._regular_path(recovery / "exports" / "backup_012345abcdef")
            with self.assertRaisesRegex(ValueError, "reparse"):
                list(themes.theme_files(self.workspace))
            with self.assertRaisesRegex(ValueError, "reparse"):
                list(ui_data.data_files(self.workspace))
        self.assertFalse(recovery.exists())

    def test_ui_and_theme_enumeration_reject_ancestor_symbolic_links(self):
        target = self.base / "target"
        target.mkdir()
        redirect = self.base / "redirect"
        try:
            redirect.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest("symbolic link creation is unavailable; reparse checks run separately")
        redirected_workspace = redirect / "workspace"
        redirected_workspace.mkdir()
        with self.assertRaisesRegex(ValueError, "links"):
            list(themes.theme_files(redirected_workspace))
        with self.assertRaisesRegex(ValueError, "links"):
            list(ui_data.data_files(redirected_workspace))
