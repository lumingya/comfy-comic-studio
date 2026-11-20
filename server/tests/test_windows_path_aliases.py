"""Normal Windows path aliases remain valid while link ancestors stay rejected."""

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.theme_media import validate_theme_resources
from mio_server.theme_packages import ThemePackageError, _regular_path


class ThemePathAliasTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="mio-ordinary-long-path-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "ordinary directory with a long name"
        self.root.mkdir()
        (self.root / "theme.css").write_text("body{color:red}", encoding="utf-8")
        self.theme = SimpleNamespace(background=None, style_file="theme.css", script_file=None)

    def short_alias(self):
        import ctypes

        output = ctypes.create_unicode_buffer(32768)
        size = ctypes.windll.kernel32.GetShortPathNameW(str(self.root), output, len(output))
        if not size or size >= len(output):
            self.skipTest("Windows did not return an 8.3 alias")
        alias = Path(output.value)
        if alias == self.root.resolve():
            self.skipTest("8.3 aliases are disabled on this filesystem")
        self.assertTrue(alias.samefile(self.root))
        self.assertFalse(alias.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT)
        return alias

    @unittest.skipUnless(os.name == "nt", "8.3 aliases are a Windows filesystem feature")
    def test_ordinary_short_path_is_accepted_by_package_and_resource_checks(self):
        alias = self.short_alias()
        self.assertTrue(_regular_path(alias, directory=True))
        self.assertTrue(_regular_path(alias / "theme.css", directory=False))
        validate_theme_resources(alias, self.theme)

    @unittest.skipUnless(os.name == "nt", "8.3 aliases are a Windows filesystem feature")
    def test_missing_child_below_ordinary_short_path_is_allowed(self):
        alias = self.short_alias()
        self.assertFalse(_regular_path(alias / "new-theme", directory=True, missing=True))

    def test_symlink_ancestor_is_rejected_for_existing_and_missing_children(self):
        link = self.root.parent / "linked"
        try:
            link.symlink_to(self.root, target_is_directory=True)
        except OSError:
            self.skipTest("creating symbolic links is not permitted")
        for target in (link, link / "theme.css", link / "new-theme"):
            with self.subTest(target=target.name), self.assertRaises(ThemePackageError):
                _regular_path(target, directory=target.suffix != ".css", missing=True)
        with self.assertRaises(ValueError):
            validate_theme_resources(link, self.theme)
        self.assertEqual((self.root / "theme.css").read_text("utf-8"), "body{color:red}")

    def test_windows_reparse_ancestor_is_rejected_before_resource_read(self):
        original_lstat = Path.lstat

        def reparse(path, *args, **kwargs):
            if path == self.root:
                return SimpleNamespace(
                    st_mode=stat.S_IFDIR,
                    st_file_attributes=getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400),
                )
            return original_lstat(path, *args, **kwargs)

        with patch.object(Path, "lstat", new=reparse):
            with self.assertRaises(ThemePackageError):
                _regular_path(self.root / "new-theme", directory=True, missing=True)
            with self.assertRaises(ValueError):
                validate_theme_resources(self.root, self.theme)

    @unittest.skipUnless(os.name == "nt", "junctions are a Windows filesystem feature")
    def test_real_junction_ancestor_is_rejected(self):
        link = self.root.parent / "junction"
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(self.root)], capture_output=True
        )
        if result.returncode:
            self.skipTest("creating junctions is not permitted")
        self.addCleanup(link.rmdir)
        self.assertTrue(link.samefile(self.root))
        for target in (link, link / "theme.css", link / "new-theme"):
            with self.subTest(target=target.name), self.assertRaises(ThemePackageError):
                _regular_path(target, directory=target.suffix != ".css", missing=True)
        with self.assertRaises(ValueError):
            validate_theme_resources(link, self.theme)
        self.assertEqual((self.root / "theme.css").read_text("utf-8"), "body{color:red}")
