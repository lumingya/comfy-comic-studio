"""Uninstall owns package files; private state survives unless deletion is explicit."""

import shutil
import stat
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.extensions.sdk import ExtensionAPI
from mio_server.storage import NotFound

from .api_harness import ApiCase
from .test_extensions import write_ext
from .test_theme_packages import THEME, archive


class PrivateDataLifecycleTests(ApiCase):
    def prepare_extension(self):
        folder = write_ext(self.ctx.extensions.root, main="def activate(mio):\n    pass\n")
        sdk = ExtensionAPI("demo", folder, self.ctx)
        sdk.save_settings({"setting": "retained"})
        self.ok(self.client.put("/api/ext/demo/preferences", json={"window": "canonical"}))
        canonical = self.ctx.data_dir / "extensions_data" / "demo"
        self.assertTrue((canonical / "preferences.json").is_file())
        (canonical / "business").mkdir()
        (canonical / "business" / "notes.txt").write_text("retained notes", encoding="utf-8")
        legacy = self.ctx.data_dir / "extension_data" / "demo"
        legacy.mkdir(parents=True)
        (legacy / "preferences.json").write_text('{"window":"legacy"}', encoding="utf-8")
        return folder, canonical, legacy

    def prepare_theme_state(self, theme_id):
        canonical = self.ctx.data_dir / "theme_data" / theme_id
        canonical.mkdir(parents=True, exist_ok=True)
        (canonical / "preferences.json").write_text('{"wallpaper":"saved"}', encoding="utf-8")
        (canonical / "wallpapers").mkdir()
        (canonical / "wallpapers" / "saved.png").write_bytes(b"private canonical media")
        legacy = self.ctx.data_dir / "themes" / theme_id / "user_wallpapers"
        legacy.mkdir(parents=True, exist_ok=True)
        (legacy / "saved.png").write_bytes(b"private legacy media")
        return canonical, legacy

    def saved_files(self, *folders):
        return {
            path: path.read_bytes()
            for folder in folders
            for path in folder.rglob("*")
            if path.is_file()
        }

    def assert_files_unchanged(self, files):
        for path, value in files.items():
            self.assertEqual(path.read_bytes(), value, str(path))

    def test_default_extension_uninstall_keeps_both_sources_and_all_business_data(self):
        folder, canonical, legacy = self.prepare_extension()
        saved = self.saved_files(canonical, legacy)
        self.ok(self.client.delete("/api/extensions/demo"), 204)
        self.assertFalse(folder.exists())
        self.assert_files_unchanged(saved)
        self.assertEqual(
            self.ok(self.client.get("/api/ext/demo/preferences")), {"window": "canonical"}
        )

    def test_extension_has_data_recognizes_retained_legacy_preferences(self):
        folder = write_ext(self.ctx.extensions.root, main="def activate(mio):\n    pass\n")
        legacy = self.ctx.data_dir / "extension_data" / "demo"
        legacy.mkdir(parents=True)
        (legacy / "preferences.json").write_text("{}", encoding="utf-8")
        self.assertTrue(self.ctx.extensions.info("demo").has_data)
        (folder / "mio-extension.json").write_text('{"invalid":true}', encoding="utf-8")
        info = self.ctx.extensions.info("demo")
        self.assertEqual(info.status, "invalid")
        self.assertTrue(info.has_data)

    def test_explicit_extension_delete_removes_each_owned_source_exactly_once(self):
        folder, canonical, legacy = self.prepare_extension()
        other = self.ctx.data_dir / "extensions_data" / "other"
        other.mkdir()
        (other / "preferences.json").write_text("{}", encoding="utf-8")
        theme_data = self.prepare_theme_state("forest")
        kept = self.saved_files(other, *theme_data)
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        original_remove = shutil.rmtree
        with patch("mio_server.extensions.manager.shutil.rmtree", wraps=original_remove) as remove:
            self.ok(self.client.delete("/api/extensions/demo?delete_data=true"), 204)
        removed = [call.args[0] for call in remove.call_args_list]
        for path in (folder, canonical, legacy):
            self.assertEqual(removed.count(path), 1, removed)
            self.assertFalse(path.exists())
        self.assert_files_unchanged(kept)
        self.assertNotIn("forest", {item.id for item in self.ctx.registry.all("theme")})

    def test_legacy_extension_links_are_rejected_before_any_target_is_deleted(self):
        folder, canonical, legacy = self.prepare_extension()
        (legacy / "nested").mkdir()
        private = legacy / "nested" / "notes.txt"
        private.write_text("retained", encoding="utf-8")
        saved = self.saved_files(folder, canonical, legacy)
        original = Path.lstat
        for forbidden in (legacy.parent, legacy, private.parent, private):
            for attributes, mode in (
                (
                    stat.FILE_ATTRIBUTE_REPARSE_POINT,
                    stat.S_IFREG if forbidden == private else stat.S_IFDIR,
                ),
                (0, stat.S_IFLNK),
            ):
                with self.subTest(path=forbidden, mode=mode):

                    def linked(path, *args, **kwargs):
                        if path == forbidden:
                            return SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
                        return original(path, *args, **kwargs)

                    with (
                        patch.object(Path, "lstat", new=linked),
                        patch("mio_server.extensions.manager.shutil.rmtree") as remove,
                    ):
                        response = self.client.delete("/api/extensions/demo?delete_data=true")
                    self.assertEqual(response.status_code, 400, response.text)
                    remove.assert_not_called()
                    self.assert_files_unchanged(saved)

    def test_extension_rechecks_legacy_targets_after_deactivation(self):
        folder, canonical, legacy = self.prepare_extension()
        (legacy / "nested").mkdir()
        (legacy / "nested" / "notes.txt").write_text("retained", encoding="utf-8")
        saved = self.saved_files(folder, canonical, legacy)
        original = Path.lstat
        disable = self.ctx.extensions.disable
        for forbidden in (legacy.parent, legacy, legacy / "nested"):
            for delete_data in (False, True):
                if forbidden == legacy / "nested" and not delete_data:
                    continue
                with self.subTest(path=forbidden, delete_data=delete_data):
                    changed = False

                    def deactivate(identifier):
                        nonlocal changed
                        result = disable(identifier)
                        changed = True
                        return result

                    def linked(path, *args, **kwargs):
                        if changed and path == forbidden:
                            return SimpleNamespace(
                                st_mode=stat.S_IFDIR,
                                st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT,
                            )
                        return original(path, *args, **kwargs)

                    with (
                        patch.object(self.ctx.extensions, "disable", side_effect=deactivate),
                        patch.object(Path, "lstat", new=linked),
                        patch("mio_server.extensions.manager.shutil.rmtree") as remove,
                    ):
                        response = self.client.delete(
                            f"/api/extensions/demo?delete_data={str(delete_data).lower()}"
                        )
                    self.assertEqual(response.status_code, 400, response.text)
                    remove.assert_not_called()
                    self.assert_files_unchanged(saved)

    def test_default_package_removal_keeps_new_and_legacy_theme_private_state(self):
        self.ctx.theme_packages.install_package(archive())
        canonical, legacy = self.prepare_theme_state(THEME["id"])
        saved = self.saved_files(canonical, legacy)
        folder = legacy.parent
        self.ok(self.client.delete(f"/api/themes/{THEME['id']}"), 204)
        self.assertEqual([path.name for path in folder.iterdir()], ["user_wallpapers"])
        self.assert_files_unchanged(saved)
        self.assertNotIn(THEME["id"], {item.id for item in self.ctx.registry.all("theme")})

    def test_explicit_package_removal_deletes_all_owned_private_state(self):
        self.ctx.theme_packages.install_package(archive())
        canonical, legacy = self.prepare_theme_state(THEME["id"])
        other = self.prepare_theme_state("other-theme")
        saved = self.saved_files(*other)
        self.ok(self.client.delete(f"/api/themes/{THEME['id']}?delete_data=true"), 204)
        self.assertFalse(canonical.exists())
        self.assertFalse(legacy.parent.exists())
        self.assert_files_unchanged(saved)

    def test_reinstall_uses_retained_legacy_container_without_changing_private_files(self):
        self.ctx.theme_packages.install_package(archive())
        canonical, legacy = self.prepare_theme_state(THEME["id"])
        saved = self.saved_files(canonical, legacy)
        self.ok(self.client.delete(f"/api/themes/{THEME['id']}"), 204)
        self.ctx.theme_packages.install_package(archive())
        self.assert_files_unchanged(saved)
        self.assertTrue((legacy.parent / "mio-theme.json").is_file())
        self.assertIn(THEME["id"], {item.id for item in self.ctx.registry.all("theme")})

    def test_failed_reinstall_registration_preserves_retained_private_files(self):
        self.ctx.theme_packages.install_package(archive())
        canonical, legacy = self.prepare_theme_state(THEME["id"])
        saved = self.saved_files(canonical, legacy)
        self.ok(self.client.delete(f"/api/themes/{THEME['id']}"), 204)
        with patch.object(self.ctx.registry, "register", side_effect=ValueError("publish failed")):
            with self.assertRaisesRegex(ValueError, "publish failed"):
                self.ctx.theme_packages.install_package(archive())
        self.assert_files_unchanged(saved)
        self.assertEqual([path.name for path in legacy.parent.iterdir()], ["user_wallpapers"])

    def test_json_theme_removal_has_the_same_private_state_policy(self):
        for delete_data in (False, True):
            with self.subTest(delete_data=delete_data):
                theme_id = f"json-theme-{str(delete_data).lower()}"
                document = {**THEME, "id": theme_id}
                self.ok(self.client.post("/api/themes", json=document), 201)
                canonical, legacy = self.prepare_theme_state(theme_id)
                saved = self.saved_files(canonical, legacy)
                self.ok(
                    self.client.delete(
                        f"/api/themes/{theme_id}?delete_data={str(delete_data).lower()}"
                    ),
                    204,
                )
                with self.assertRaises(NotFound):
                    self.ctx.store.get_doc("theme", theme_id)
                if delete_data:
                    self.assertFalse(canonical.exists())
                    self.assertFalse(legacy.exists())
                else:
                    self.assert_files_unchanged(saved)

    def test_theme_private_tree_is_validated_before_any_package_or_document_mutation(self):
        self.ctx.theme_packages.install_package(archive())
        self.ok(self.client.post("/api/themes", json={**THEME, "id": "json-theme"}), 201)
        states = {
            theme_id: self.prepare_theme_state(theme_id) for theme_id in (THEME["id"], "json-theme")
        }
        original = Path.lstat
        for theme_id, (canonical, legacy) in states.items():
            saved = self.saved_files(canonical, legacy)
            for forbidden in (canonical.parent, canonical, legacy, legacy / "saved.png"):
                with self.subTest(theme_id=theme_id, path=forbidden):

                    def linked(path, *args, **kwargs):
                        if path == forbidden:
                            return SimpleNamespace(
                                st_mode=stat.S_IFREG if path.suffix else stat.S_IFDIR,
                                st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT,
                            )
                        return original(path, *args, **kwargs)

                    with patch.object(Path, "lstat", new=linked):
                        response = self.client.delete(f"/api/themes/{theme_id}?delete_data=true")
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertIn(theme_id, {item.id for item in self.ctx.registry.all("theme")})
                    if theme_id == THEME["id"]:
                        self.assertTrue((legacy.parent / "mio-theme.json").is_file())
                    else:
                        self.assertIsNotNone(self.ctx.store.get_doc("theme", theme_id))
                    self.assert_files_unchanged(saved)

    def test_builtin_and_extension_theme_cannot_be_removed_through_theme_api(self):
        self.prepare_extension()
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        for theme_id in ("theme-linen", "forest"):
            canonical, legacy = self.prepare_theme_state(theme_id)
            saved = self.saved_files(canonical, legacy)
            response = self.client.delete(f"/api/themes/{theme_id}?delete_data=true")
            self.assertEqual(response.status_code, 400, response.text)
            self.assert_files_unchanged(saved)
            self.assertIn(theme_id, {item.id for item in self.ctx.registry.all("theme")})
