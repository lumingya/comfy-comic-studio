"""UI state follows the complete workspace backup, conflict and restart contract."""

import hashlib
import io
import json
import stat
import tempfile
import threading
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.backups import Backups, snapshot, ui_data
from mio_server.backups.models import BackupOptions, RestoreApply
from mio_server.context import AppContext
from mio_server.extension_preferences import load_preferences
from mio_server.storage import Conflict
from mio_server.theme_packages import package_theme
from mio_server.themes import parse_theme

from .test_extensions import write_ext

PNG = b"\x89PNG\r\n\x1a\nwallpaper-fixture"


class BackupUIDataTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.data = self.root / "workspace"
        self.ctx = None
        self.client = None
        self.addCleanup(self.close)
        self.open()

    def open(self):
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        self.client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://127.0.0.1")
        self.service = Backups(self.ctx)

    def close(self):
        if self.client:
            self.client.close()
            self.client = None
        if self.ctx:
            self.ctx.close()
            self.ctx = None

    def upload(self, theme_id="theme-wallpaper"):
        response = self.client.post(
            f"/api/themes/{theme_id}/wallpapers", files={"file": ("wall.png", PNG, "image/png")}
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def save_theme(self, value, theme_id="theme-wallpaper"):
        response = self.client.put(f"/api/themes/{theme_id}/preferences", json=value)
        self.assertEqual(response.status_code, 200, response.text)

    def command(self, plan):
        return RestoreApply(
            expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
        )

    def rewrite(self, source, name, raw):
        with zipfile.ZipFile(source) as archive:
            members = {entry: archive.read(entry) for entry in archive.namelist()}
        members[name] = raw
        manifest = json.loads(members["manifest.json"])
        manifest["entries"] = [entry for entry in manifest["entries"] if entry["path"] != name]
        manifest["entries"].append(
            {"path": name, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        )
        members["manifest.json"] = json.dumps(manifest).encode()
        target = self.root / "modified.zip"
        with zipfile.ZipFile(target, "w") as archive:
            for path, value in members.items():
                archive.writestr(path, value)
        return target

    def test_all_theme_sources_preserve_private_state_through_real_restart_restore(self):
        response = self.client.post(
            "/api/themes", json={"id": "inline-theme", "name": "Inline", "mode": "light"}
        )
        self.assertEqual(response.status_code, 201, response.text)
        package_id, package = package_theme(
            parse_theme({"id": "packaged-theme", "name": "Packaged", "mode": "dark"})
        )
        self.ctx.theme_packages.install_package(package)
        attached = parse_theme({"id": "attached-theme", "name": "Attached", "mode": "dark"})
        # Exercise a real reviewed declaration rather than manually injecting a source tag.
        folder = write_ext(self.ctx.extensions.root, "demo", "def activate(mio):\n    pass\n")
        (folder / "theme.json").write_text(attached.model_dump_json(), encoding="utf-8")
        extension_package = io.BytesIO()
        with zipfile.ZipFile(extension_package, "w") as extension_archive:
            for path in folder.iterdir():
                extension_archive.writestr(path.name, path.read_bytes())
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        themes = ["theme-wallpaper", "inline-theme", package_id, attached.id]
        wallpapers = {}
        for theme_id in themes:
            with self.subTest(theme=theme_id):
                before = self.service.head().head
                item = self.upload(theme_id)
                after_upload = self.service.head().head
                self.assertNotEqual(before, after_upload)
                self.save_theme({"wallpaper_id": item["id"], "loop": False}, theme_id)
                self.assertNotEqual(after_upload, self.service.head().head)
                wallpapers[theme_id] = item
        backup = self.service.export(BackupOptions())
        names = {entry.path for entry in backup.inspection.manifest.entries}
        for theme_id, item in wallpapers.items():
            self.assertIn(f"theme_data/{theme_id}/preferences.json", names)
            self.assertIn(f"theme_data/{theme_id}/wallpapers/{item['id']}.json", names)
            self.assertIn(f"theme_data/{theme_id}/wallpapers/{item['id']}.png", names)
            self.assertFalse((self.data / "themes" / theme_id / "user_wallpapers").exists())
        portable = self.client.get(f"/api/themes/{package_id}/package")
        self.assertEqual(portable.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(portable.content)) as archive:
            self.assertFalse(
                any("wallpapers" in name or "preferences" in name for name in archive.namelist())
            )
        self.save_theme({"loop": True})
        plan = self.service.stage(self.service.download(backup.id))
        scheduled = self.service.apply(plan.id, self.command(plan)).plan
        with zipfile.ZipFile(self.service.download(scheduled.protection_backup_id)) as archive:
            current = json.loads(archive.read("theme_data/theme-wallpaper/preferences.json"))
            self.assertEqual(current, {"loop": True})
        self.close()
        self.open()
        # Restoring data never executes archive code. Explicitly reinstall/review to
        # make the contributed theme available, then read its already restored state.
        self.assertNotIn("demo", self.ctx.extensions.loaded)
        self.ctx.extensions.install(extension_package.getvalue())
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        for theme_id, item in wallpapers.items():
            with self.subTest(restored_theme=theme_id):
                response = self.client.get(f"/api/themes/{theme_id}/preferences")
                self.assertEqual(response.json(), {"wallpaper_id": item["id"], "loop": False})
                self.assertEqual(self.client.get(item["url"]).content, PNG)
        self.assertEqual(self.service.get_plan(plan.id).state, "installed")

    def test_extension_preferences_survive_restore_and_retained_data_needs_no_code(self):
        write_ext(self.ctx.extensions.root, "demo", "raise AssertionError('must not execute')")
        path = "/api/ext/demo/preferences"
        value = {"floating_surfaces": {"palette": {"x": 12, "y": 34}}}
        before = self.service.head().head
        response = self.client.put(path, json=value)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotEqual(before, self.service.head().head)
        self.ctx.extensions.remove("demo")
        backup = self.service.export(BackupOptions())
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            self.assertEqual(
                json.loads(archive.read("extensions_data/demo/preferences.json")), value
            )
            self.assertFalse(any(name.startswith("extensions/") for name in archive.namelist()))
        self.assertEqual(self.client.put(path, json={"current": True}).status_code, 200)
        plan = self.service.stage(self.service.download(backup.id))
        self.service.apply(plan.id, self.command(plan))
        self.close()
        self.open()
        self.assertEqual(load_preferences(self.data, "demo"), value)
        self.assertEqual(self.client.get(path).json(), value)
        self.assertEqual(self.ctx.extensions.loaded, {})

    def test_private_state_changes_invalidate_staged_restore(self):
        write_ext(self.ctx.extensions.root, "demo", "")
        for change in (
            lambda: self.save_theme({"value": 1}),
            lambda: self.client.put("/api/ext/demo/preferences", json={"x": 2}),
            self.upload,
        ):
            backup = self.service.export(BackupOptions())
            plan = self.service.stage(self.service.download(backup.id))
            change()
            with self.assertRaisesRegex(Conflict, "changed since staging"):
                self.service.apply(plan.id, self.command(plan))

    def test_edit_after_scheduling_rejects_restore_without_losing_private_state(self):
        self.save_theme({"value": "backup"})
        backup = self.service.export(BackupOptions())
        plan = self.service.stage(self.service.download(backup.id))
        self.service.apply(plan.id, self.command(plan))
        self.save_theme({"value": "new edit"})
        self.close()
        self.open()
        self.assertEqual(
            self.client.get("/api/themes/theme-wallpaper/preferences").json(), {"value": "new edit"}
        )
        self.assertEqual(self.service.get_plan(plan.id).state, "rejected")

    def test_archives_reject_bad_private_json_media_pairs_and_paths(self):
        item = self.upload()
        backup = self.service.export(BackupOptions())
        source = self.service.download(backup.id)
        media_root = f"theme_data/theme-wallpaper/wallpapers/{item['id']}"
        for name, raw in (
            ("theme_data/theme-wallpaper/preferences.json", b'{"a":1,"a":2}'),
            ("extension_data/demo/preferences.json", b"[]"),
            ("extension_data/con/preferences.json", b"{}"),
            ("theme_data/../outside/preferences.json", b"{}"),
            ("theme_data/theme-wallpaper/execute.py", b"pass"),
            (f"{media_root}.json", b'{"id": "wrong"}'),
            (f"{media_root}.png", b"not a PNG"),
            (f"{media_root}-other.png", PNG),
        ):
            with self.subTest(path=name):
                modified = self.rewrite(source, name, raw)
                with self.assertRaises(ValueError):
                    Backups.inspect(modified)

    def test_credentials_and_size_limits_remain_fail_closed(self):
        self.save_theme({"api_key": "PRIVATE-TEST-FIXTURE"})
        with self.assertRaisesRegex(ValueError, "embedded credentials"):
            self.service.export(BackupOptions())
        included = self.service.export(BackupOptions(include_credentials=True))
        self.assertIn(
            "theme_data/theme-wallpaper/preferences.json",
            {entry.path for entry in included.inspection.manifest.entries},
        )
        self.save_theme({})
        item = self.upload()
        media = self.data / f"theme_data/theme-wallpaper/wallpapers/{item['id']}.png"
        original = Path.read_bytes

        def bounded(path):
            if path == media:
                raise AssertionError("wallpapers must be streamed")
            return original(path)

        with patch.object(Path, "read_bytes", bounded):
            self.service.export(BackupOptions())
        with patch.object(ui_data, "MAX_WALLPAPER", 8):
            with self.assertRaisesRegex(ValueError, "size limit"):
                self.service.export(BackupOptions())

    def test_wallpaper_only_exception_does_not_accept_arbitrary_broken_packages(self):
        folder = self.data / "themes" / "broken-theme"
        folder.mkdir(parents=True)
        (folder / "execute.py").write_bytes(b"pass")
        with self.assertRaises(ValueError):
            self.service.export(BackupOptions())

    def test_reparse_points_are_rejected_before_private_data_is_read(self):
        self.save_theme({"x": 1})
        item = self.upload()
        metadata = self.data / f"theme_data/theme-wallpaper/wallpapers/{item['id']}.json"
        original = Path.lstat
        for target in (self.data / "theme_data", metadata):
            with self.subTest(target=target.name):

                def reparse(path, *args, **kwargs):
                    if path == target:
                        return SimpleNamespace(
                            st_mode=stat.S_IFDIR if path.name == "theme_data" else stat.S_IFREG,
                            st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT,
                        )
                    return original(path, *args, **kwargs)

                with patch.object(Path, "lstat", reparse):
                    with self.assertRaisesRegex(ValueError, "reparse"):
                        self.service.export(BackupOptions())

    def test_theme_save_waits_for_backup_snapshot(self):
        self.save_theme({"version": "before"})
        before = self.service.head().head
        entered, release, saving = threading.Event(), threading.Event(), threading.Event()
        original = snapshot.copy_data

        def copying(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise AssertionError("snapshot not released")
            return original(*args, **kwargs)

        def save():
            saving.set()
            self.save_theme({"version": "after"})

        with (
            ThreadPoolExecutor(max_workers=2) as pool,
            patch.object(snapshot, "copy_data", side_effect=copying),
        ):
            exporting = pool.submit(self.service.export, BackupOptions())
            try:
                self.assertTrue(entered.wait(3))
                writing = pool.submit(save)
                self.assertTrue(saving.wait(3))
                with self.assertRaises(TimeoutError):
                    writing.result(timeout=0.05)
            finally:
                release.set()
            backup = exporting.result(timeout=5)
            writing.result(timeout=5)
        self.assertEqual(backup.inspection.manifest.source_head, before)
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            self.assertEqual(
                json.loads(archive.read("theme_data/theme-wallpaper/preferences.json")),
                {"version": "before"},
            )

    def test_legacy_private_sources_and_shadowed_copies_survive_restart_restore(self):
        item = self.upload()
        canonical = self.data / "theme_data/theme-wallpaper/wallpapers"
        legacy = self.data / "themes/theme-wallpaper/user_wallpapers"
        legacy.mkdir(parents=True)
        for path in canonical.iterdir():
            (legacy / path.name).write_bytes(path.read_bytes())
        old_preferences = self.data / "extension_data/demo/preferences.json"
        old_preferences.parent.mkdir(parents=True)
        old_preferences.write_text('{"legacy":true}', encoding="utf-8")
        new_preferences = self.data / "extensions_data/demo/preferences.json"
        new_preferences.parent.mkdir(parents=True)
        new_preferences.write_text('{"canonical":true}', encoding="utf-8")
        self.assertEqual(self.client.get("/api/ext/demo/preferences").json(), {"canonical": True})
        before = self.service.head().head
        old_preferences.write_text('{"legacy":"changed"}', encoding="utf-8")
        self.assertNotEqual(before, self.service.head().head)
        backup = self.service.export(BackupOptions())
        names = {entry.path for entry in backup.inspection.manifest.entries}
        self.assertIn("extension_data/demo/preferences.json", names)
        self.assertIn("extensions_data/demo/preferences.json", names)
        self.assertIn(f"themes/theme-wallpaper/user_wallpapers/{item['id']}.png", names)
        plan = self.service.stage(self.service.download(backup.id))
        self.service.apply(plan.id, self.command(plan))
        self.close()
        self.open()
        self.assertEqual(old_preferences.read_text(encoding="utf-8"), '{"legacy":"changed"}')
        self.assertEqual(self.client.get(item["url"]).content, PNG)
        self.assertEqual(
            len(self.client.get("/api/themes/theme-wallpaper/wallpapers").json()["items"]), 1
        )
