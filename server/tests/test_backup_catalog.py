"""Retained backup discovery and explicit cleanup never remove active recovery protection."""

import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.auth import issue
from mio_server.backups import Backups
from mio_server.backups.models import BackupOptions, RestoreApply
from mio_server.backups.paths import atomic_json
from mio_server.context import AppContext
from mio_server.storage import Conflict, NotFound


class BackupCatalogTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.ctx = AppContext.create(self.base / "work", autostart=False, seed_instance=False)
        self.addCleanup(self.ctx.close)
        self.service = Backups(self.ctx)
        self.backup = self.service.export(BackupOptions())

    def stage(self):
        return self.service.stage(self.service.download(self.backup.id))

    def apply(self, plan):
        return self.service.apply(
            plan.id,
            RestoreApply(
                expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
            ),
        ).plan

    def save(self, plan):
        atomic_json(
            self.service.root / "plans" / plan.id / "plan.json", plan.model_dump(mode="json")
        )

    def test_catalog_pages_are_stable_compact_and_show_retained_bytes(self):
        self.service.export(BackupOptions(include_credentials=True))
        plans = [self.stage(), self.stage()]
        first = self.service.list_backups(limit=1)
        second = self.service.list_backups(offset=first.next_offset, limit=1)
        self.assertEqual(first.total, 2)
        self.assertIsNone(second.next_offset)
        self.assertNotEqual(first.items[0].id, second.items[0].id)
        for record in first.items + second.items:
            self.assertGreater(record.retained_bytes, record.size)
            self.assertTrue(record.can_delete)
            self.assertNotIn("inspection", record.model_dump())
        page = self.service.list_plans(limit=1)
        self.assertEqual(page.total, 2)
        self.assertIn(page.items[0].id, [p.id for p in plans])
        self.assertGreater(page.items[0].staged_bytes, 0)
        self.assertEqual(page.items[0].previous_bytes, 0)
        self.assertFalse(page.items[0].pending)
        self.assertTrue(page.items[0].can_delete)
        self.assertEqual(self.service.list_plans(offset=9).items, [])

    def test_pending_requires_cancel_then_explicit_plan_and_protection_deletion(self):
        plan = self.apply(self.stage())
        record = self.service.list_plans().items[0]
        self.assertTrue(record.pending)
        self.assertFalse(record.can_delete)
        protection = next(
            r for r in self.service.list_backups().items if r.id == plan.protection_backup_id
        )
        self.assertTrue(protection.includes_credentials)
        self.assertEqual(protection.protection_plan_ids, [plan.id])
        self.assertFalse(protection.can_delete)
        with self.assertRaises(Conflict):
            self.service.delete_plan(plan.id)
        with self.assertRaises(Conflict):
            self.service.delete(protection.id)
        self.service.cancel(plan.id)
        self.service.delete_plan(plan.id)
        with self.assertRaises(NotFound):
            self.service.get_plan(plan.id)
        self.assertEqual(self.service.get(protection.id).id, protection.id)
        self.assertTrue(
            next(r for r in self.service.list_backups().items if r.id == protection.id).can_delete
        )
        self.service.delete(protection.id)
        self.assertEqual(self.service.list_backups().total, 1)

    def test_journal_phases_and_unacknowledged_startup_marker_block_cleanup(self):
        plan = self.stage()
        folder = self.service.root / "plans" / plan.id
        for phase in ("pending", "prepared", "old_moved", "installed", "rolling_back"):
            with self.subTest(phase=phase):
                atomic_json(
                    self.service.root / "pending.json", {"plan_id": plan.id, "phase": phase}
                )
                with self.assertRaises(Conflict):
                    self.service.delete_plan(plan.id)
                self.assertEqual(self.service.list_plans().items[0].blocked_reason, "installation")
                self.assertTrue(folder.exists())
        (self.service.root / "pending.json").unlink()
        plan.state = "installed"
        self.save(plan)
        atomic_json(self.service.root / "restored.json", {"plan_id": plan.id})
        with self.assertRaises(Conflict):
            self.service.delete_plan(plan.id)
        self.assertEqual(self.service.list_plans().items[0].blocked_reason, "startup")
        (self.service.root / "restored.json").unlink()
        self.service.delete_plan(plan.id)
        self.assertFalse(folder.exists())

    def test_finished_and_unarranged_plans_delete_only_their_own_retained_directories(self):
        untouched = self.ctx.data_dir / "keep.txt"
        untouched.write_bytes(b"live work")
        for state in ("staged", "installed", "rejected", "rolled_back"):
            with self.subTest(state=state):
                plan = self.stage()
                plan.state = state
                self.save(plan)
                folder = self.service.root / "plans" / plan.id
                for name in ("previous", "failed", "incoming"):
                    (folder / name).mkdir()
                    (folder / name / "retained.txt").write_bytes(b"old work")
                record = next(r for r in self.service.list_plans().items if r.id == plan.id)
                self.assertEqual(record.previous_bytes, 8)
                self.assertGreater(
                    record.retained_bytes, record.staged_bytes + record.previous_bytes
                )
                self.service.delete_plan(plan.id)
                self.assertFalse(folder.exists())
                self.assertEqual(untouched.read_bytes(), b"live work")
                self.assertTrue(self.service.download(self.backup.id).is_file())

    def test_links_and_windows_reparse_points_are_rejected_before_any_payload_deletion(self):
        plan = self.stage()
        folder = self.service.root / "plans" / plan.id
        outside = self.base / "outside"
        outside.mkdir()
        sentinel = outside / "keep.txt"
        sentinel.write_bytes(b"keep")
        original = Path.lstat

        def reparse(path, *args, **kwargs):
            if path == folder / "workspace":
                return SimpleNamespace(
                    st_mode=stat.S_IFDIR, st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT
                )
            return original(path, *args, **kwargs)

        with patch.object(Path, "lstat", new=reparse):
            with self.assertRaisesRegex(ValueError, "reparse"):
                self.service.delete_plan(plan.id)
        self.assertTrue((folder / "workspace.zip").exists())
        link = folder / "external"
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError:
            return  # The reparse test above covers Windows without symlink privileges.
        try:
            with self.assertRaisesRegex(ValueError, "links"):
                self.service.delete_plan(plan.id)
            self.assertEqual(sentinel.read_bytes(), b"keep")
            self.assertTrue((folder / "workspace.zip").exists())
        finally:
            link.unlink()

    def test_wrong_kind_escape_and_reparse_parent_never_resolve_to_external_cleanup(self):
        plan = self.stage()
        with self.assertRaises(NotFound):
            self.service.delete_plan(self.backup.id)
        with self.assertRaises(NotFound):
            self.service.delete_plan("../" + plan.id)
        original = Path.lstat

        def reparse(path, *args, **kwargs):
            if path == self.service.root / "plans":
                return SimpleNamespace(
                    st_mode=stat.S_IFDIR, st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT
                )
            return original(path, *args, **kwargs)

        with patch.object(Path, "lstat", new=reparse):
            with self.assertRaisesRegex(ValueError, "reparse"):
                self.service.delete_plan(plan.id)
        self.assertEqual(self.service.get_plan(plan.id).state, "staged")

    def test_partial_cleanup_failure_keeps_record_discoverable_for_retry(self):
        plan = self.stage()
        original = Path.unlink

        def fail_archive(path, *args, **kwargs):
            if path.name == "workspace.zip":
                raise PermissionError("simulated file in use")
            return original(path, *args, **kwargs)

        with patch.object(Path, "unlink", new=fail_archive):
            with self.assertRaises(PermissionError):
                self.service.delete_plan(plan.id)
        self.assertEqual(self.service.list_plans().items[0].id, plan.id)
        self.service.delete_plan(plan.id)
        self.assertEqual(self.service.list_plans().total, 0)

    def test_catalog_and_cleanup_api_require_admin_with_static_routes_and_page_bounds(self):
        tokens = {}
        for scope in ("read", "write", "admin"):
            token, plain = issue(scope, [scope])
            self.ctx.store.put_doc(token)
            tokens[scope] = {"Authorization": f"Bearer {plain}"}
        plan = self.stage()
        client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://127.0.0.1")
        self.addCleanup(client.close)
        for path in ("/api/v2/backups", "/api/v2/backups/restore-plans"):
            self.assertEqual(client.get(path).status_code, 401)
            for scope in ("read", "write"):
                self.assertEqual(client.get(path, headers=tokens[scope]).status_code, 403)
            response = client.get(path, headers=tokens["admin"], params={"limit": 1})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["total"], 1)
            for query in ({"limit": 0}, {"limit": 101}, {"offset": -1}):
                self.assertEqual(
                    client.get(path, headers=tokens["admin"], params=query).status_code, 422
                )
        path = f"/api/v2/backups/restore-plans/{plan.id}"
        self.assertEqual(client.delete(path, headers=tokens["write"]).status_code, 403)
        self.assertEqual(client.delete(path, headers=tokens["admin"]).status_code, 204)
        self.assertEqual(client.get(path, headers=tokens["admin"]).status_code, 404)
