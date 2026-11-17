"""Collect shipped extension tests without adding extension-specific imports to the host."""

from __future__ import annotations

import hashlib
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2] / "extensions"


def _package(name: str, folder: Path) -> None:
    if name not in sys.modules:
        package = types.ModuleType(name)
        package.__path__ = [str(folder)]
        package.__package__ = name
        sys.modules[name] = package


def collect_extension_tests(root: Path, loader: unittest.TestLoader) -> unittest.TestSuite:
    """Each extension owns its tests package, including relative helper imports."""
    suite = unittest.TestSuite()
    for directory in sorted(root.glob("*/tests")):
        identity = hashlib.sha256(str(directory.resolve()).encode()).hexdigest()[:16]
        package = f"_mio_extension_tests_{identity}"
        _package(package, directory.parent)
        _package(f"{package}.tests", directory)
        for file in sorted(directory.rglob("test_*.py")):
            rel = file.relative_to(directory)
            parent = f"{package}.tests"
            current = directory
            for part in rel.parts[:-1]:
                parent += "." + part
                current /= part
                _package(parent, current)
            name = f"{parent}.{file.stem}"
            spec = importlib.util.spec_from_file_location(name, file)
            if spec is None or spec.loader is None:
                raise ImportError(f"Cannot load extension tests: {file}")
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            spec.loader.exec_module(module)
            suite.addTests(loader.loadTestsFromModule(module))
    return suite


class ExtensionTestDiscoveryTests(unittest.TestCase):
    def test_collects_distinct_extensions_with_same_test_name_and_relative_helpers(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            for extension in ("one-extension", "another"):
                tests = root / extension / "tests"
                tests.mkdir(parents=True)
                (tests / "helper.py").write_text(f"VALUE = {extension!r}\n", encoding="utf-8")
                (tests.parent / "core").mkdir()
                (tests.parent / "core" / "values.py").write_text(
                    f"VALUE = {extension!r}\n", encoding="utf-8"
                )
                (tests / "test_sample.py").write_text(
                    "import unittest\nfrom .helper import VALUE\n"
                    "from ..core.values import VALUE as CORE_VALUE\n"
                    "class Sample(unittest.TestCase):\n"
                    "    def test_identity(self):\n"
                    f"        self.assertEqual(VALUE, {extension!r})\n"
                    "        self.assertEqual(CORE_VALUE, VALUE)\n",
                    encoding="utf-8",
                )
            suite = collect_extension_tests(root, unittest.TestLoader())
            self.assertEqual(suite.countTestCases(), 2)
            result = unittest.TestResult()
            suite.run(result)
            self.assertTrue(result.wasSuccessful(), result.errors + result.failures)

    def test_absent_extensions_directory_is_valid(self):
        with TemporaryDirectory() as temporary:
            suite = collect_extension_tests(Path(temporary) / "missing", unittest.TestLoader())
            self.assertEqual(suite.countTestCases(), 0)

    def test_release_contains_extension_code_and_docs_but_not_local_or_test_files(self):
        spec = importlib.util.spec_from_file_location(
            "_mio_extension_release_test", ROOT.parent / "tools/build_release.py"
        )
        module = importlib.util.module_from_spec(spec)
        original_path = sys.path[:]
        try:
            spec.loader.exec_module(module)
        finally:
            sys.path[:] = original_path
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            include = {
                "extensions/sample/manifest.json",
                "extensions/sample/core/__init__.py",
                "extensions/sample/page/index.tsx",
                "extensions/sample/readme.md",
            }
            exclude = {
                "extensions/sample/tests/test_core.py",
                "extensions/sample/page/component.test.tsx",
                "extensions/sample/page/component.spec.ts",
                "extensions/sample/.env",
                "extensions/sample/.env.local",
                "extensions/sample/data/conversation.json",
                "extensions/sample/node_modules/package/index.js",
                "extensions/sample/core/__pycache__/cache.pyc",
            }
            for name in include | exclude:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture", encoding="utf-8")
            with (
                patch.object(module, "ROOT", root),
                patch.object(module, "shipped_manifest", return_value={"files": {}}),
            ):
                found = {p.relative_to(root).as_posix() for p in module.files()}
            self.assertTrue(include <= found)
            self.assertFalse(exclude & found)


def load_tests(loader, tests, pattern):
    tests.addTests(collect_extension_tests(ROOT, loader))
    return tests
