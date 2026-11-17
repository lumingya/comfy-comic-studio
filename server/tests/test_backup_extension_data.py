"""Extension JSON follows the same atomic SDK/API, backup and restart contract."""

import hashlib
import json
import os
import shutil
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
from mio_server.auth import issue
from mio_server.backups import Backups, extension_data, snapshot
from mio_server.backups.models import BackupOptions, RestoreApply
from mio_server.context import AppContext
from mio_server.extensions.sdk import ExtensionAPI
from mio_server.storage import Conflict

from .test_extensions import write_ext


class BackupExtensionDataTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        # Windows TEMP may use an 8.3 alias; match the resolved paths inspected by production.
        self.root = Path(temporary.name).resolve()
        self.data = self.root / "workspace"
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        self.addCleanup(lambda: self.ctx.close() if self.ctx else None)
        self.service = Backups(self.ctx)
        self.sdk = ExtensionAPI("demo", self.data / "extensions" / "demo", self.ctx)
        self.settings = self.data / "extensions_data" / "demo" / "settings.json"

    def export(self, **options):
        return self.service.export(BackupOptions(**options))

    def command(self, plan):
        return RestoreApply(
            expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
        )

    def restart(self):
        self.ctx.close()
        self.ctx = None
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        self.service = Backups(self.ctx)
        self.sdk = ExtensionAPI("demo", self.data / "extensions" / "demo", self.ctx)

    def rewrite_archive(self, archive, name, raw, *, includes_credentials=None):
        with zipfile.ZipFile(archive) as source:
            members = {item: source.read(item) for item in source.namelist()}
        members[name] = raw
        manifest = json.loads(members["manifest.json"])
        manifest["entries"] = [item for item in manifest["entries"] if item["path"] != name]
        manifest["entries"].append(
            {"path": name, "size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        )
        if includes_credentials is not None:
            manifest["includes_credentials"] = includes_credentials
        members["manifest.json"] = json.dumps(manifest).encode()
        target = self.root / "modified.zip"
        with zipfile.ZipFile(target, "w") as result:
            for path, content in members.items():
                result.writestr(path, content)
        return target

    def test_real_restart_restores_json_and_protection_keeps_current_settings_without_code(self):
        write_ext(self.ctx.extensions.root, "demo", "raise AssertionError('must not execute')")
        original = {"label": "角色模板", "count": 2, "preferences": {"compact": True}}
        self.sdk.save_settings(original)
        backup = self.export()
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            self.assertEqual(
                json.loads(archive.read("extensions_data/demo/settings.json")), original
            )
            self.assertFalse(any(name.startswith("extensions/") for name in archive.namelist()))
        self.sdk.save_settings({"label": "Current settings"})
        plan = self.service.stage(self.service.download(backup.id))
        scheduled = self.service.apply(plan.id, self.command(plan)).plan
        with zipfile.ZipFile(self.service.download(scheduled.protection_backup_id)) as archive:
            self.assertEqual(
                json.loads(archive.read("extensions_data/demo/settings.json")),
                {"label": "Current settings"},
            )
        self.restart()
        self.assertEqual(self.sdk.load_settings(), original)
        self.assertEqual(self.ctx.extensions.loaded, {})
        self.assertFalse((self.data / "extensions" / "demo").exists())
        self.assertEqual(self.service.get_plan(plan.id).state, "installed")

    def test_credentials_require_explicit_export_and_cannot_be_hidden_by_an_archive_flag(self):
        for value in (
            {"nested": {"API_KEY": "PRIVATE-EXTENSION-SECRET"}},
            {"url": "HTTPS://name:PRIVATE-EXTENSION-SECRET@example.invalid"},
        ):
            with self.subTest(value_type=list(value)):
                self.sdk.save_settings(value)
                with self.assertRaisesRegex(ValueError, "embedded credentials") as error:
                    self.export()
                self.assertNotIn("PRIVATE-EXTENSION-SECRET", str(error.exception))
                included = self.export(include_credentials=True)
                path = self.service.download(included.id)
                with zipfile.ZipFile(path) as archive:
                    self.assertEqual(
                        json.loads(archive.read("extensions_data/demo/settings.json")), value
                    )
                bad = self.rewrite_archive(
                    path,
                    "extensions_data/demo/settings.json",
                    json.dumps(value).encode(),
                    includes_credentials=False,
                )
                with self.assertRaisesRegex(ValueError, "embedded credentials"):
                    Backups.inspect(bad)

    def test_head_tracks_json_names_and_exact_bytes_and_blocks_changed_staged_plan(self):
        self.sdk.save_settings({"value": 1})
        first = self.service.head().head
        self.settings.write_text('{ "value": 1 }', encoding="utf-8")
        second = self.service.head().head
        self.assertNotEqual(first, second)
        renamed = self.settings.with_name("other.json")
        self.settings.rename(renamed)
        self.assertNotEqual(second, self.service.head().head)
        renamed.rename(self.settings)
        backup = self.export()
        plan = self.service.stage(self.service.download(backup.id))
        self.sdk.save_settings({"value": 2})
        with self.assertRaisesRegex(Conflict, "changed since staging"):
            self.service.apply(plan.id, self.command(plan))
        self.assertFalse((self.service.root / "pending.json").exists())

    def test_settings_changed_after_scheduling_reject_startup_restore_without_losing_edits(self):
        self.sdk.save_settings({"value": "backup"})
        backup = self.export()
        plan = self.service.stage(self.service.download(backup.id))
        self.service.apply(plan.id, self.command(plan))
        self.sdk.save_settings({"value": "new edit"})
        self.restart()
        self.assertEqual(self.sdk.load_settings(), {"value": "new edit"})
        self.assertEqual(self.service.get_plan(plan.id).state, "rejected")

    def test_capture_serializes_sdk_save_and_freezes_consistent_head_and_json(self):
        self.sdk.save_settings({"version": "before"})
        before = self.service.head().head
        entered, release, saving = threading.Event(), threading.Event(), threading.Event()
        original = snapshot.copy_settings

        def copying(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise AssertionError("test capture was not released")
            return original(*args, **kwargs)

        def save():
            saving.set()
            self.sdk.save_settings({"version": "after"})

        with (
            ThreadPoolExecutor(max_workers=2) as pool,
            patch.object(snapshot, "copy_settings", side_effect=copying),
        ):
            backup_task = pool.submit(self.export)
            try:
                self.assertTrue(entered.wait(3))
                saving_task = pool.submit(save)
                self.assertTrue(saving.wait(3))
                with self.assertRaises(TimeoutError):
                    saving_task.result(timeout=0.05)
                self.assertEqual(json.loads(self.settings.read_bytes()), {"version": "before"})
            finally:
                release.set()
            backup = backup_task.result(timeout=5)
            saving_task.result(timeout=5)
        self.assertEqual(backup.inspection.manifest.source_head, before)
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            self.assertEqual(
                json.loads(archive.read("extensions_data/demo/settings.json")),
                {"version": "before"},
            )
        self.assertEqual(self.sdk.load_settings(), {"version": "after"})

    def test_atomic_save_failure_and_size_validation_keep_old_json_readable(self):
        self.sdk.save_settings({"value": "old"})
        with patch(
            "mio_server.backups.paths.os.replace",
            side_effect=OSError("simulated atomic rename failure"),
        ):
            with self.assertRaises(OSError):
                self.sdk.save_settings({"value": "new"})
        self.assertEqual(self.sdk.load_settings(), {"value": "old"})
        with self.assertRaisesRegex(ValueError, "1 MiB"):
            self.sdk.save_settings({"value": "x" * extension_data.MAX_EXTENSION_JSON})
        self.assertEqual(self.sdk.load_settings(), {"value": "old"})
        self.assertEqual([p.name for p in self.settings.parent.iterdir()], ["settings.json"])

    def test_invalid_json_and_oversized_settings_reject_export(self):
        self.settings.parent.mkdir(parents=True)
        invalid = [
            b"[]",
            b"null",
            b"{",
            b'{"a":NaN}',
            b'{"a":1e309}',
            b'{"a":1,"a":2}',
            b'{"a":"\xff"}',
            b" " * (extension_data.MAX_EXTENSION_JSON + 1),
        ]
        for raw in invalid:
            with self.subTest(raw_prefix=raw[:8]):
                self.settings.write_bytes(raw)
                with self.assertRaises(ValueError):
                    self.export()
        self.settings.write_bytes(b"{}")
        unexpected = self.settings.parent / "code.py"
        unexpected.write_bytes(b"print('not settings')")
        backup = self.export()
        self.assertNotIn(
            "extensions_data/demo/code.py",
            {entry.path for entry in backup.inspection.manifest.entries},
        )
        unexpected.unlink()
        directory = self.settings.parent / "nested.json"
        directory.mkdir()
        self.export()  # Private directories need a trusted participant before they are included.

    def test_save_commits_validated_snapshot_when_caller_changes_original_before_write(self):
        value = {"number": 1, "nested": {"text": "verified"}}
        original = extension_data.atomic_json

        def mutate_before_write(path, snapshot):
            value["number"] = float("inf")
            value["nested"]["text"] = "x" * (extension_data.MAX_EXTENSION_JSON + 1)
            original(path, snapshot)

        with patch.object(extension_data, "atomic_json", side_effect=mutate_before_write):
            self.sdk.save_settings(value)
        self.assertEqual(self.sdk.load_settings(), {"number": 1, "nested": {"text": "verified"}})
        self.assertLess(self.settings.stat().st_size, extension_data.MAX_EXTENSION_JSON)
        self.assertIsNotNone(self.service.head().head)

    def test_archive_rejects_invalid_json_size_code_and_paths_before_installation(self):
        backup = self.export()
        source = self.service.download(backup.id)
        for name, raw in (
            ("extensions_data/demo/settings.json", b"[]"),
            ("extensions_data/demo/settings.json", b'{"a":1e309}'),
            ("extensions_data/demo/settings.json", b" " * (extension_data.MAX_EXTENSION_JSON + 1)),
            ("extensions_data/demo/execute.py", b"{}"),
            ("extensions_data/../other/settings.json", b"{}"),
            ("extensions_data/UPPER/settings.json", b"{}"),
            ("extensions_data/con/settings.json", b"{}"),
        ):
            with self.subTest(name=name, size=len(raw)):
                bad = self.rewrite_archive(source, name, raw)
                with self.assertRaises(ValueError):
                    Backups.inspect(bad)
        self.assertEqual(self.ctx.engine.list(), [])

    def test_saved_utf8_bytes_match_the_exact_limit_and_overflow_keeps_the_previous_file(self):
        limit = extension_data.MAX_EXTENSION_JSON
        room = limit - len(b'{"value": ""}')
        value = "界" * (room // 3) + "x" * (room % 3)
        self.sdk.save_settings({"value": value})
        previous = self.settings.read_bytes()
        self.assertEqual(len(previous), limit)
        self.assertEqual(self.sdk.load_settings(), {"value": value})
        with self.assertRaisesRegex(ValueError, "1 MiB"):
            self.sdk.save_settings({"value": value + "x"})
        self.assertEqual(self.settings.read_bytes(), previous)
        with self.assertRaises(ValueError):
            self.sdk.save_settings({"value": float("inf")})
        self.assertEqual(self.settings.read_bytes(), previous)

    def test_private_data_and_atomic_leftovers_are_not_copied_and_links_are_rejected(self):
        self.sdk.save_settings({"value": "committed"})
        head = self.service.head().head
        descriptor, name = tempfile.mkstemp(prefix=".write-", dir=self.settings.parent)
        leftover = Path(name)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(b'{"uncommitted": "incomplete')
        self.assertEqual(self.service.head().head, head)
        backup = self.export()
        self.assertEqual(backup.inspection.manifest.source_head, head)
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            self.assertEqual(
                json.loads(archive.read("extensions_data/demo/settings.json")),
                {"value": "committed"},
            )
            self.assertFalse(any(".write-" in path for path in archive.namelist()))
        self.assertTrue(leftover.exists())
        original = Path.lstat

        def reparse(path, *args, **kwargs):
            if path == leftover:
                return SimpleNamespace(
                    st_mode=stat.S_IFREG, st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT
                )
            return original(path, *args, **kwargs)

        with patch.object(Path, "lstat", new=reparse):
            with self.assertRaisesRegex(ValueError, "reparse"):
                self.export()
        unknown = self.settings.parent / ".write-manual.json"
        unknown.write_bytes(b"{}")
        backup = self.export()
        with zipfile.ZipFile(self.service.download(backup.id)) as archive:
            self.assertNotIn("extensions_data/demo/.write-manual.json", archive.namelist())

    def test_links_and_windows_reparse_points_are_not_read_or_copied(self):
        self.sdk.save_settings({"value": "local"})
        original = Path.lstat
        for target in (self.settings.parent, self.settings):
            with self.subTest(target=target.name):

                def reparse(path, *args, **kwargs):
                    if path == target:
                        return SimpleNamespace(
                            st_mode=stat.S_IFDIR if path == self.settings.parent else stat.S_IFREG,
                            st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT,
                        )
                    return original(path, *args, **kwargs)

                with patch.object(Path, "lstat", new=reparse):
                    with self.assertRaisesRegex(ValueError, "reparse"):
                        self.export()
                    with self.assertRaisesRegex(ValueError, "reparse"):
                        self.sdk.save_settings({"value": "overwrite"})
        outside = self.root / "outside.json"
        outside.write_bytes(b'{"value":"outside"}')
        link = self.settings.parent / "linked.json"
        try:
            link.symlink_to(outside)
        except OSError:
            return  # Mocked reparse checks cover Windows without link privileges.
        try:
            with self.assertRaisesRegex(ValueError, "links"):
                self.export()
            self.assertEqual(outside.read_bytes(), b'{"value":"outside"}')
        finally:
            link.unlink()

    def test_admin_settings_api_uses_sdk_storage_without_executing_disabled_or_removed_code(self):
        folder = write_ext(
            self.ctx.extensions.root, "demo", "raise AssertionError('must not execute')"
        )
        client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://127.0.0.1")
        self.addCleanup(client.close)
        path = "/api/v2/extensions/demo/settings"
        tokens = {}
        for scope in ("read", "write", "render", "admin"):
            token, plain = issue(scope, [scope])
            self.ctx.store.put_doc(token)
            tokens[scope] = {"Authorization": f"Bearer {plain}"}
        self.assertEqual(client.get(path).status_code, 401)
        for scope in ("read", "write", "render"):
            self.assertEqual(client.get(path, headers=tokens[scope]).status_code, 403)
            self.assertEqual(client.put(path, headers=tokens[scope], json={}).status_code, 403)
        admin = tokens["admin"]
        self.assertEqual(client.get(path, headers=admin).json(), {})
        value = {"nested": {"enabled": True, "names": ["中文", None, 3]}, "api_key": "PRIVATE"}
        written = client.put(path, headers=admin, json=value)
        self.assertEqual(written.status_code, 200, written.text)
        self.assertEqual(written.json(), value)
        self.assertEqual(self.sdk.load_settings(), value)
        self.assertEqual(self.ctx.extensions.loaded, {})
        self.assertEqual(client.put(path, headers=admin, json=[]).status_code, 422)
        self.assertEqual(
            client.put(
                path, headers=admin, json={"large": "x" * extension_data.MAX_EXTENSION_JSON}
            ).status_code,
            400,
        )
        self.assertEqual(self.sdk.load_settings(), value)
        shutil.rmtree(folder)
        self.assertEqual(client.get(path, headers=admin).json(), value)
        self.assertEqual(client.put(path, headers=admin, json={"retained": True}).status_code, 200)
        self.assertEqual(self.sdk.load_settings(), {"retained": True})
        self.assertEqual(
            client.put("/api/v2/extensions/missing/settings", headers=admin, json={}).status_code,
            404,
        )
        self.assertEqual(
            client.get("/api/v2/extensions/INVALID/settings", headers=admin).status_code, 400
        )
        self.assertFalse((self.data / "extensions_data" / "missing" / "settings.json").exists())
