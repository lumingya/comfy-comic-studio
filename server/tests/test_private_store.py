"""The SDK and both preference owners share one validated private storage boundary."""

import json
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.api.theme_preferences import _validate_preferences as validate_theme_preferences
from mio_server.backups import extension_data
from mio_server.extension_preferences import save_preferences, validate_preferences
from mio_server.private_store import MAX_JSON_DEPTH, PrivateStore, validate_json


class SharedPrivateStoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.workspace = self.root / "container" / "workspace"
        self.workspace.mkdir(parents=True)

    def test_sdk_and_preferences_reject_the_same_strict_json_corpus(self):
        validators = (
            validate_json,
            extension_data.validate_settings,
            validate_preferences,
            validate_theme_preferences,
        )
        too_deep = b'{"child":' * (MAX_JSON_DEPTH + 1) + b"{}" + b"}" * (MAX_JSON_DEPTH + 1)
        for raw in (
            b"[]",
            b'{"value":1,"value":2}',
            b'{"value":NaN}',
            b'{"value":Infinity}',
            b'{"value":1e309}',
            b'{"value":"\\ud800"}',
            b'{"\\ud800":0}',
            too_deep,
        ):
            for validate in validators:
                with self.subTest(validator=validate.__module__, raw=raw[:48]):
                    with self.assertRaises(ValueError):
                        validate(raw)
        maximum_depth = b'{"child":' * MAX_JSON_DEPTH + b"{}" + b"}" * MAX_JSON_DEPTH
        for validate in validators:
            self.assertEqual(validate(maximum_depth), json.loads(maximum_depth))

    def test_all_private_writers_freeze_and_preserve_the_previous_valid_file(self):
        settings = self.workspace / "extensions_data/demo/settings.json"
        preferences = self.workspace / "extensions_data/demo/preferences.json"
        theme = PrivateStore(self.workspace, "theme", "paper")
        writers = (
            (lambda value: extension_data.save_settings(self.workspace, "demo", value), settings),
            (lambda value: save_preferences(self.workspace, "demo", value), preferences),
            (theme.write_json, theme.file("preferences.json")),
        )
        invalid = {"leaf": True}
        for _ in range(MAX_JSON_DEPTH):
            invalid = {"child": invalid}
        for save, path in writers:
            save({"value": "retained"})
            before = path.read_bytes()
            for value in (invalid, {"value": float("inf")}, {"value": "\ud800"}):
                with self.subTest(path=path.name):
                    with self.assertRaises(ValueError):
                        save(value)
                    self.assertEqual(path.read_bytes(), before)
            self.assertFalse(any(item.name.startswith(".write-") for item in path.parent.iterdir()))

    def test_sdk_rejects_redirected_ancestors_before_read_write_or_enumeration(self):
        extension_data.save_settings(self.workspace, "demo", {"value": "retained"})
        settings = self.workspace / "extensions_data/demo/settings.json"
        before = settings.read_bytes()
        original = Path.lstat
        for target in (
            self.workspace.parent,
            self.workspace,
            settings.parent.parent,
            settings.parent,
            settings,
        ):
            for mode, attributes in (
                (
                    stat.S_IFREG if target == settings else stat.S_IFDIR,
                    stat.FILE_ATTRIBUTE_REPARSE_POINT,
                ),
                (stat.S_IFLNK, 0),
            ):
                with self.subTest(target=target.name, mode=mode):

                    def redirected(path, *args, **kwargs):
                        if path == target:
                            return SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
                        return original(path, *args, **kwargs)

                    with patch.object(Path, "lstat", new=redirected):
                        with self.assertRaisesRegex(ValueError, "links or reparse"):
                            extension_data.load_settings(self.workspace, "demo")
                        with self.assertRaisesRegex(ValueError, "links or reparse"):
                            extension_data.save_settings(self.workspace, "demo", {"value": "new"})
                        with self.assertRaisesRegex(ValueError, "links or reparse"):
                            list(extension_data.settings_files(self.workspace))
                    self.assertEqual(settings.read_bytes(), before)

    def test_sdk_helpers_are_adapters_to_the_shared_validation_boundary(self):
        from mio_server import private_store

        self.assertIs(extension_data.regular_path, private_store.regular_path)
        self.assertIs(extension_data.validate_tree, private_store.validate_tree)
        self.assertIs(extension_data.validate_identifier, private_store.validate_identifier)
        self.assertIs(extension_data.atomic_json, private_store.atomic_json)
        for identifier in ("../other", "UPPER", "con", "demo\\other"):
            with self.subTest(identifier=identifier):
                self.assertFalse(
                    extension_data.allowed_extension_path(
                        f"extensions_data/{identifier}/settings.json"
                    )
                )
                with self.assertRaises(ValueError):
                    extension_data.extension_data_dir(self.workspace, identifier)
