"""Development package checks use the exact release view without weakening static validation."""

import importlib.util
import json
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.extensions.ctk import check_package

from .release_fixture import write_release_seed

TOOLS = Path(__file__).resolve().parents[2] / "tools"


def load_tool(filename, name):
    previous_path = sys.path[:]
    previous_release = sys.modules.get("build_release")
    try:
        sys.path.insert(0, str(TOOLS))
        spec = importlib.util.spec_from_file_location(name, TOOLS / filename)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path[:] = previous_path
        if previous_release is None:
            sys.modules.pop("build_release", None)
        else:
            sys.modules["build_release"] = previous_release


class ExtensionExampleToolsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.checker = load_tool("check_extension_examples.py", "mio_example_checker_test")

    def extension(self, parent):
        folder = parent / "demo-extension"
        folder.mkdir(parents=True)
        (folder / "main.py").write_text(
            "raise AssertionError('must not execute')", encoding="utf-8"
        )
        (folder / "mio-extension.json").write_text(
            json.dumps({"id": folder.name, "name": "Example", "main": "main.py"}),
            encoding="utf-8",
        )
        return folder

    def test_staged_extension_and_theme_files_match_actual_release_selection_and_are_cleaned(self):
        release = load_tool("build_release.py", "mio_example_release_test")
        write_release_seed(self.root)
        extension = self.extension(self.root / "extensions")
        theme = self.root / "themes/demo-theme"
        theme.mkdir(parents=True)
        (theme / "mio-theme.json").write_text(
            json.dumps(
                {
                    "id": theme.name,
                    "name": "Example",
                    "version": "1.0.0",
                    "author": "",
                    "description": "",
                    "theme_file": "theme.json",
                }
            ),
            encoding="utf-8",
        )
        (theme / "theme.json").write_text(
            json.dumps({"id": theme.name, "name": "Example", "mode": "light"}), encoding="utf-8"
        )
        for folder in (extension, theme):
            for name in (
                "runtime.js",
                "page/dist/app.js",
                "runtime.test.js",
                "runtime.spec.js",
                ".env",
                ".env.local",
                ".env.directory/kept.js",
                "folder.pyc/kept.js",
                "compiled.pyc",
                "compiled.pyo",
                "node_modules/dependency.js",
                ".git/config",
                "__pycache__/cached.pyc",
                "tests/offline.js",
                ".pytest_cache/state",
                ".ruff_cache/state",
                ".venv/state",
            ):
                path = folder / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture")
        with patch.object(release, "ROOT", self.root):
            published = set(release.files())

        for source, kind in ((extension, "extension"), (theme, "theme")):
            with self.subTest(kind=kind):
                before = {
                    p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()
                }
                staging = []

                def validate(staged, selected_kind):
                    staging.append(staged)
                    self.assertFalse(staged.is_relative_to(self.root))
                    self.assertEqual(
                        {
                            p.relative_to(staged): p.read_bytes()
                            for p in staged.rglob("*")
                            if p.is_file()
                        },
                        {
                            p.relative_to(source): p.read_bytes()
                            for p in published
                            if p.is_relative_to(source)
                        },
                    )
                    return check_package(staged, selected_kind)

                with patch.object(self.checker, "check_package", side_effect=validate):
                    report = self.checker.check_published_package(source, kind)
                # The release view retains unsupported theme files such as runtime.js;
                # CTK must still reject those rather than silently filter them away.
                self.assertEqual(report.valid, kind == "extension", report)
                self.assertTrue(staging)
                self.assertTrue(all(not folder.exists() for folder in staging))
                self.assertEqual(
                    {
                        p.relative_to(source): p.read_bytes()
                        for p in source.rglob("*")
                        if p.is_file()
                    },
                    before,
                )

    def test_development_dependencies_do_not_consume_the_published_package_limit(self):
        folder = self.extension(self.root / "extensions")
        dependency = folder / "node_modules/dependency.js"
        dependency.parent.mkdir()
        dependency.write_bytes(b"development only")
        with patch("mio_server.extensions.manager.MAX_ENTRIES", 2):
            self.assertFalse(check_package(folder, "extension").valid)
            self.assertTrue(self.checker.check_published_package(folder, "extension").valid)
        self.assertEqual(dependency.read_bytes(), b"development only")

    def test_manifest_reference_to_an_unpublished_file_still_fails_ctk(self):
        folder = self.extension(self.root / "extensions")
        entry = folder / "tests/entry.py"
        entry.parent.mkdir()
        entry.write_bytes(b"raise AssertionError('must not execute')")
        manifest = folder / "mio-extension.json"
        document = json.loads(manifest.read_text(encoding="utf-8"))
        document["main"] = "tests/entry.py"
        manifest.write_text(json.dumps(document), encoding="utf-8")
        self.assertTrue(check_package(folder, "extension").valid)
        report = self.checker.check_published_package(folder, "extension")
        self.assertFalse(report.valid)
        self.assertEqual([finding.code for finding in report.findings], ["package.invalid"])

    def test_published_links_and_reparse_points_are_rejected_before_copying(self):
        folder = self.extension(self.root / "extensions")
        entry = folder / "main.py"
        original_lstat = Path.lstat
        for mode, attributes in ((stat.S_IFLNK | 0o777, 0), (stat.S_IFREG | 0o644, 0x400)):
            with self.subTest(mode=mode, attributes=attributes):

                def redirected(path, *args, **kwargs):
                    if path == entry:
                        return SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
                    return original_lstat(path, *args, **kwargs)

                with (
                    patch.object(Path, "lstat", redirected),
                    patch.object(self.checker.shutil, "copyfile") as copy_file,
                    self.assertRaisesRegex(ValueError, "links or reparse points"),
                ):
                    self.checker.check_published_package(folder, "extension")
                copy_file.assert_not_called()
