"""Extension code and private data have independent uninstall lifetimes."""

import json
import stat
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.backups import Backups
from mio_server.backups.extension_data import extension_data_dir
from mio_server.backups.models import BackupOptions
from mio_server.extensions.sdk import ExtensionAPI

from .api_harness import ApiCase
from .test_extensions import write_ext


class ExtensionDataTests(ApiCase):
    def prepare(self):
        folder = write_ext(self.ctx.extensions.root)
        sdk = ExtensionAPI("demo", folder, self.ctx)
        sdk.save_settings({"title": "retained"})
        (sdk.data_dir / "private").mkdir()
        private = sdk.data_dir / "private" / "notes.txt"
        private.write_text("private notes", encoding="utf-8")
        return folder, sdk, private

    def test_sdk_data_is_isolated_and_default_uninstall_keeps_all_data(self):
        folder, sdk, private = self.prepare()
        self.assertEqual(sdk.data_dir, self.ctx.data_dir / "extensions_data" / "demo")
        self.assertEqual(
            json.loads((sdk.data_dir / "settings.json").read_bytes()), sdk.load_settings()
        )
        item = next(item for item in self.ctx.extensions.list() if item.id == "demo")
        self.assertTrue(item.to_json()["has_data"])
        self.assertEqual(self.client.delete("/api/extensions/demo").status_code, 204)
        self.assertFalse(folder.exists())
        self.assertEqual(sdk.load_settings(), {"title": "retained"})
        self.assertEqual(private.read_text(encoding="utf-8"), "private notes")
        backup = Backups(self.ctx).export(BackupOptions())
        paths = {entry.path for entry in backup.inspection.manifest.entries}
        self.assertIn("extensions_data/demo/settings.json", paths)
        self.assertNotIn("extensions_data/demo/private/notes.txt", paths)

    def test_explicit_data_removal_does_not_remove_other_extensions(self):
        folder, sdk, _ = self.prepare()
        other = extension_data_dir(self.ctx.data_dir, "other")
        other.mkdir()
        (other / "settings.json").write_text("{}", encoding="utf-8")
        self.assertEqual(
            self.client.delete("/api/extensions/demo?delete_data=true").status_code, 204
        )
        self.assertFalse(folder.exists())
        self.assertFalse(sdk.data_dir.exists())
        self.assertTrue((other / "settings.json").is_file())

    def test_busy_service_rejects_uninstall_without_deleting_anything(self):
        folder, sdk, private = self.prepare()
        self.ctx.extension_services["demo"] = SimpleNamespace(busy=True)
        self.addCleanup(lambda: self.ctx.extension_services.pop("demo", None))
        response = self.client.delete("/api/extensions/demo?delete_data=true")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertTrue(folder.is_dir())
        self.assertTrue(private.is_file())
        self.assertEqual(sdk.load_settings(), {"title": "retained"})

    def test_reparse_code_root_and_nested_data_are_rejected_before_removal(self):
        folder, sdk, private = self.prepare()
        original = Path.lstat
        for forbidden in (self.ctx.extensions.root, private.parent, private):
            with self.subTest(path=forbidden):

                def reparse(path, *args, **kwargs):
                    if path == forbidden:
                        return SimpleNamespace(
                            st_mode=stat.S_IFREG if path == private else stat.S_IFDIR,
                            st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT,
                        )
                    return original(path, *args, **kwargs)

                with patch.object(Path, "lstat", new=reparse):
                    response = self.client.delete("/api/extensions/demo?delete_data=true")
                self.assertEqual(response.status_code, 400, response.text)
                self.assertTrue(folder.is_dir())
                self.assertTrue(private.is_file())
                self.assertTrue((sdk.data_dir / "settings.json").is_file())

    def test_invalid_identifiers_cannot_select_another_data_directory(self):
        for identifier in ("../other", "demo/../../other", "DEMO", "con", "demo\\other"):
            with self.subTest(identifier=identifier):
                with self.assertRaises(ValueError):
                    extension_data_dir(self.ctx.data_dir, identifier)
                with self.assertRaises(ValueError):
                    self.ctx.extensions.remove(identifier, delete_data=True)

    def test_paths_changed_during_disable_are_rechecked_before_any_delete(self):
        folder, sdk, private = self.prepare()
        data = sdk.data_dir
        original = Path.lstat
        disable = self.ctx.extensions.disable
        for forbidden in (self.ctx.extensions.root, folder, data.parent, data, private.parent):
            for delete_data in (False, True):
                if forbidden == private.parent and not delete_data:
                    continue
                with self.subTest(path=forbidden, delete_data=delete_data):
                    changed = False

                    def deactivate(identifier):
                        nonlocal changed
                        result = disable(identifier)
                        changed = True
                        return result

                    def reparse(path, *args, **kwargs):
                        if changed and path == forbidden:
                            return SimpleNamespace(
                                st_mode=stat.S_IFDIR,
                                st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT,
                            )
                        return original(path, *args, **kwargs)

                    with (
                        patch.object(self.ctx.extensions, "disable", side_effect=deactivate),
                        patch.object(Path, "lstat", new=reparse),
                        patch("mio_server.extensions.manager.shutil.rmtree") as remove,
                    ):
                        response = self.client.delete(
                            f"/api/extensions/demo?delete_data={str(delete_data).lower()}"
                        )
                    self.assertEqual(response.status_code, 400, response.text)
                    remove.assert_not_called()
                    self.assertTrue(folder.is_dir())
                    self.assertTrue(private.is_file())
