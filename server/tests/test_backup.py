"""All workspace backup tests use small disposable directories and no external services."""

import io
import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.auth import issue
from mio_server.backups import Backups
from mio_server.backups.__main__ import main
from mio_server.backups.archive import inspect_archive
from mio_server.backups.models import BackupOptions, RestoreApply
from mio_server.backups.paths import recovery_root, sha_file
from mio_server.backups.startup import prepare_workspace
from mio_server.checkpoints import Checkpoints
from mio_server.checkpoints.models import CheckpointCreate
from mio_server.context import AppContext
from mio_server.jobs import ItemSpec, JobConflict
from mio_server.jobs.lease import FileLease, LeaseHeld
from mio_server.models import Episode, Panel, Series, Take, WorkshopQueue
from mio_server.render_models import ComfyInstance, WorkflowDoc
from mio_server.settings import ExtensionState
from mio_server.storage import Conflict, SQLiteStore
from mio_server.webhooks import Webhook


class ProcessLost(BaseException):
    pass


class BackupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.data = self.base / "workspace"
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        self.addCleanup(lambda: self.ctx.close() if self.ctx else None)
        self.service = Backups(self.ctx)
        self.series = self.ctx.store.create_series(Series(title="Saved work"))
        self.asset = self.ctx.assets.put(b"small retained picture")
        panel = Panel(order=0)
        self.ep = self.ctx.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="Saved episode",
                order=0,
                panels=[panel],
                takes=[Take(panel_id=panel.id, asset_id=self.asset.id)],
            )
        )
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "synopsis", "history"))
        self.checkpoint = Checkpoints(self.ctx).create(
            self.series.id, CheckpointCreate(name="Saved")
        )

    def options(self):
        settings = self.ctx.settings()
        settings.llm.api_key = "PRIVATE-TEST-CREDENTIAL-ONLY"
        settings.llm.base_url = (
            "HTTPS://name:PRIVATE-URL-SECRET@example.invalid/v1?API_KEY=PRIVATE-URL-SECRET"
        )
        settings.extensions = {"unsafe": ExtensionState(enabled=True, digest="old")}
        self.ctx.store.put_doc(settings)
        token, _ = issue("Private token", ["admin"])
        self.ctx.store.put_doc(token)
        self.ctx.store.put_doc(
            Webhook(
                url="https://user:pass@example.invalid/hook?api_key=private",
                secret="WEBHOOK-SECRET",
            )
        )
        self.ctx.store.put_doc(
            ComfyInstance(id="private", base_url="http://user:pass@127.0.0.1:8188?token=private")
        )
        self.ctx.store.put_doc(WorkshopQueue(lane=[self.series.id], paused=False))
        return token

    def export(self, **options):
        return self.service.export(BackupOptions(**options))

    def scheduled(self):
        backup = self.export()
        self.ctx.store.update_series(
            self.series.id, lambda series: setattr(series, "title", "Current work")
        )
        plan = self.service.stage(self.service.download(backup.id))
        scheduled = self.service.apply(
            plan.id,
            RestoreApply(
                expected_head=plan.expected_head,
                expected_archive_sha256=plan.inspection.sha256,
            ),
        )
        return backup, scheduled.plan

    def close(self):
        self.ctx.close()
        self.ctx = None

    def install(self):
        startup = prepare_workspace(self.data)
        self.addCleanup(startup.release)
        return startup

    def title(self):
        db = sqlite3.connect(self.data / "mio.sqlite3")
        try:
            return db.execute(
                "SELECT title FROM series WHERE id = ?", (self.series.id,)
            ).fetchone()[0]
        finally:
            db.close()

    def rewrite(self, source, change):
        path = self.base / "altered.zip"
        with zipfile.ZipFile(source) as archive:
            members = {name: archive.read(name) for name in archive.namelist()}
        change(members)
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in members.items():
                archive.writestr(name, data)
        return path

    def test_export_redacts_credentials_and_retains_assets_checkpoints_and_receipts(self):
        self.options()
        with self.ctx.store.tx() as db:
            db.execute(
                "INSERT INTO delivery_receipts VALUES (?, ?, ?, ?, ?)",
                ("job:0:1", self.ep.id, "sha", '["original-take"]', "date"),
            )
            db.execute(
                "CREATE TABLE kit_receipts (key TEXT PRIMARY KEY, sha TEXT NOT NULL, result_json TEXT NOT NULL)"
            )
            db.execute("INSERT INTO kit_receipts VALUES ('import', 'sha', '{}')")
        backup = self.export()
        self.assertEqual(backup.inspection.asset_count, 1)
        self.assertEqual(backup.inspection.checkpoint_count, 1)
        target = self.base / "verified"
        inspect_archive(self.service.download(backup.id), target)
        raw = (target / "mio.sqlite3").read_bytes()
        self.assertNotIn(b"PRIVATE-TEST-CREDENTIAL-ONLY", raw)
        self.assertNotIn(b"WEBHOOK-SECRET", raw)
        self.assertNotIn(b"PRIVATE-URL-SECRET", raw)
        store = SQLiteStore(target / "mio.sqlite3")
        try:
            self.assertEqual(store.list_docs("api_token"), [])
            self.assertFalse(store.get_doc("instance", "private").enabled)
            self.assertNotIn("user:pass", store.get_doc("instance", "private").base_url)
            self.assertEqual(store.get_doc("settings", "app").extensions, {})
            self.assertTrue(store.get_doc("workshop_queue", "queue").paused)
            self.assertEqual(
                store._rows("SELECT value_json FROM delivery_receipts")[0][0], '["original-take"]'
            )
            self.assertEqual(len(store._rows("SELECT * FROM kit_receipts")), 1)
            self.assertTrue(store.episode_snapshots(self.ep.id))
        finally:
            store.close()
        self.assertEqual(self.ctx.settings().llm.api_key, "PRIVATE-TEST-CREDENTIAL-ONLY")
        self.assertEqual(self.service.download(backup.id).stat().st_size, backup.inspection.size)

    def test_embedded_workflow_credentials_require_explicit_export_option(self):
        self.ctx.store.put_doc(
            WorkflowDoc(
                id="private-workflow",
                name="Private",
                graph={
                    "1": {"class_type": "CustomNode", "inputs": {"api_key": "EMBEDDED-SECRET"}},
                },
            )
        )
        with self.assertRaisesRegex(ValueError, "embedded credentials"):
            self.export()
        backup = self.export(include_credentials=True)
        self.assertTrue(backup.inspection.manifest.includes_credentials)
        self.assertEqual(
            Backups.inspect(self.service.download(backup.id)).sha256, backup.inspection.sha256
        )

    def test_active_jobs_prevent_export_and_head_exposes_diagnostic(self):
        job = self.ctx.engine.submit("test", [ItemSpec({})], owner=self.ep.id, paused=True)
        with self.assertRaises(JobConflict):
            self.export()
        self.assertIsNone(self.service.head().head)
        self.assertEqual(self.service.head().active_job_ids, [job["id"]])
        self.ctx.engine.cancel(job["id"])
        self.export()

    def test_terminal_job_snapshots_keep_pipeline_image_placeholders(self):
        job = self.ctx.engine.submit(
            "test",
            [
                ItemSpec(
                    {
                        "stages": [
                            {"graph": {"1": {"inputs": {"image": {"$asset": "__previous__"}}}}},
                            {"graph": {"1": {"inputs": {"image": {"$asset": "__cloud_source__"}}}}},
                        ]
                    }
                )
            ],
            owner=self.ep.id,
        )
        self.ctx.engine.cancel(job["id"])
        self.assertEqual(self.export().inspection.job_count, 1)

    def test_archive_rejects_path_escape_checksum_and_executable_schema(self):
        backup = self.export()
        original = self.service.download(backup.id)
        escaped = self.rewrite(original, lambda members: members.update({"../escape": b"bad"}))
        with self.assertRaisesRegex(ValueError, "forbidden path"):
            Backups.inspect(escaped)
        corrupted = self.rewrite(original, lambda members: members.update({"jobs.sqlite3": b"bad"}))
        with self.assertRaisesRegex(ValueError, "size mismatch"):
            Backups.inspect(corrupted)
        dbfile = self.base / "bad.sqlite3"

        def add_trigger(members):
            dbfile.write_bytes(members["mio.sqlite3"])
            db = sqlite3.connect(dbfile)
            db.execute("CREATE TRIGGER bad BEFORE INSERT ON series BEGIN SELECT 1; END")
            db.commit()
            db.close()
            members["mio.sqlite3"] = dbfile.read_bytes()
            manifest = json.loads(members["manifest.json"])
            for entry in manifest["entries"]:
                if entry["path"] == "mio.sqlite3":
                    entry.update(size=dbfile.stat().st_size, sha256=sha_file(dbfile))
            members["manifest.json"] = json.dumps(manifest).encode()

        bad_schema = self.rewrite(original, add_trigger)
        with self.assertRaisesRegex(ValueError, "unsupported schema"):
            Backups.inspect(bad_schema)

    def test_archive_requires_complete_asset_closure(self):
        backup = self.export()
        original = self.service.download(backup.id)

        def remove_asset(members):
            name = next(name for name in members if name.startswith("assets/"))
            del members[name]
            manifest = json.loads(members["manifest.json"])
            manifest["entries"] = [entry for entry in manifest["entries"] if entry["path"] != name]
            members["manifest.json"] = json.dumps(manifest).encode()

        with self.assertRaisesRegex(ValueError, "asset files"):
            Backups.inspect(self.rewrite(original, remove_asset))

    def test_stage_apply_checks_head_hash_and_keeps_live_data_until_restart(self):
        backup = self.export()
        plan = self.service.stage(self.service.download(backup.id))
        self.ctx.store.update_series(
            self.series.id, lambda series: setattr(series, "title", "Edited")
        )
        with self.assertRaises(Conflict):
            self.service.apply(
                plan.id,
                RestoreApply(
                    expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
                ),
            )
        plan = self.service.stage(self.service.download(backup.id))
        with self.assertRaises(Conflict):
            self.service.apply(
                plan.id,
                RestoreApply(expected_head=plan.expected_head, expected_archive_sha256="0" * 64),
            )
        applied = self.service.apply(
            plan.id,
            RestoreApply(
                expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
            ),
        )
        self.assertTrue(applied.requires_restart)
        self.assertEqual(self.ctx.store.get_series(self.series.id).title, "Edited")
        self.assertTrue(applied.plan.protection_backup_id)
        with self.assertRaises(Conflict):
            self.service.delete(applied.plan.protection_backup_id)
        self.assertEqual(self.service.cancel(plan.id).state, "rejected")
        self.assertFalse((recovery_root(self.data) / "pending.json").exists())

    def test_active_job_after_stage_blocks_apply_and_duplicate_apply_is_idempotent(self):
        backup = self.export()
        plan = self.service.stage(self.service.download(backup.id))
        job = self.ctx.engine.submit("test", [ItemSpec({})], owner=self.ep.id)
        command = RestoreApply(
            expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
        )
        with self.assertRaises(JobConflict):
            self.service.apply(plan.id, command)
        self.ctx.engine.cancel(job["id"])
        plan = self.service.stage(self.service.download(backup.id))
        command = RestoreApply(
            expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
        )
        first = self.service.apply(plan.id, command)
        second = self.service.apply(plan.id, command)
        self.assertEqual(first.plan.protection_backup_id, second.plan.protection_backup_id)

    def test_staged_asset_tampering_prevents_apply(self):
        backup = self.export()
        plan = self.service.stage(self.service.download(backup.id))
        folder = recovery_root(self.data) / "plans" / plan.id / "workspace"
        next((folder / "assets").rglob("*.bin")).write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.service.apply(
                plan.id,
                RestoreApply(
                    expected_head=plan.expected_head, expected_archive_sha256=plan.inspection.sha256
                ),
            )
        self.assertFalse((recovery_root(self.data) / "pending.json").exists())

    def test_install_restores_full_workspace_and_retains_original_directory(self):
        self.options()
        extension = self.data / "extensions" / "old"
        extension.mkdir(parents=True)
        (extension / "main.py").write_text("raise RuntimeError('do not execute')", encoding="utf-8")
        _, plan = self.scheduled()
        self.close()
        startup = self.install()
        self.assertTrue(startup.restored)
        self.assertEqual(self.title(), "Saved work")
        folder = recovery_root(self.data) / "plans" / plan.id
        self.assertTrue((folder / "previous" / "extensions" / "old" / "main.py").is_file())
        self.assertFalse((self.data / "extensions").exists())
        self.assertEqual(self.service.get_plan(plan.id).state, "installed")
        startup.release()
        second = self.install()
        self.assertTrue(
            second.restored, "successful install must survive a context construction crash"
        )
        second.acknowledge_startup()

    def test_post_schedule_edit_rejects_install_without_touching_current_work(self):
        _, plan = self.scheduled()
        self.ctx.store.update_series(
            self.series.id, lambda series: setattr(series, "title", "Later edit")
        )
        self.close()
        startup = self.install()
        self.assertFalse(startup.restored)
        self.assertEqual(self.title(), "Later edit")
        self.assertEqual(self.service.get_plan(plan.id).state, "rejected")

    def test_prepare_rejects_live_workspace_and_releases_stable_lease(self):
        _, plan = self.scheduled()
        with self.assertRaises(RuntimeError):
            prepare_workspace(self.data)
        self.assertEqual(self.ctx.store.get_series(self.series.id).title, "Current work")
        # An old-version engine without a stable workspace lease still protects its directory.
        self.assertIn(self.service.get_plan(plan.id).state, {"pending", "rejected"})

    def test_crash_after_each_directory_move_resumes_without_losing_either_version(self):
        from mio_server.backups import startup as installer

        for boundary in (1, 2):
            with self.subTest(boundary=boundary):
                _, plan = self.scheduled()
                self.close()
                moves, original = [], installer.move_directory

                def crash(source, destination):
                    original(source, destination)
                    moves.append(1)
                    if len(moves) == boundary:
                        raise ProcessLost()

                with patch.object(installer, "move_directory", side_effect=crash):
                    with self.assertRaises(ProcessLost):
                        prepare_workspace(self.data)
                startup = self.install()
                self.assertTrue(startup.restored)
                self.assertEqual(self.title(), "Saved work")
                self.assertTrue(
                    (recovery_root(self.data) / "plans" / plan.id / "previous").exists()
                )
                startup.acknowledge_startup()
                startup.release()
                self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
                self.service = Backups(self.ctx)

    def test_failed_install_rolls_back_and_interrupted_rollback_resumes(self):
        from mio_server.backups import startup as installer

        _, plan = self.scheduled()
        self.close()
        original, calls = installer.move_directory, []

        def fail_and_crash(source, destination):
            calls.append(1)
            if len(calls) == 2:
                raise OSError("simulated replace failure")
            original(source, destination)
            if len(calls) == 3:
                raise ProcessLost()

        with patch.object(installer, "move_directory", side_effect=fail_and_crash):
            with self.assertRaises(ProcessLost):
                prepare_workspace(self.data)
        startup = self.install()
        self.assertFalse(startup.restored)
        self.assertEqual(self.title(), "Current work")
        self.assertEqual(self.service.get_plan(plan.id).state, "rolled_back")

    def test_api_and_cli_offer_verified_export_stage_apply_without_live_mutation(self):
        app = create_app(self.ctx, serve_web=False)
        client = TestClient(app, base_url="http://127.0.0.1")
        created = client.post("/api/backups", json={})
        self.assertEqual(created.status_code, 201, created.text)
        identifier = created.json()["id"]
        archive = client.get(f"/api/backups/{identifier}/download")
        self.assertEqual(archive.status_code, 200)
        inspected = client.post(
            "/api/backups/inspect",
            content=archive.content,
            headers={"Content-Type": "application/octet-stream"},
        )
        self.assertEqual(inspected.status_code, 200, inspected.text)
        staged = client.post(
            "/api/backups/restore-plans",
            content=archive.content,
            headers={"Content-Type": "application/octet-stream"},
        )
        self.assertEqual(staged.status_code, 201, staged.text)
        plan = staged.json()
        applied = client.post(
            f"/api/backups/restore-plans/{plan['id']}/apply",
            json={
                "expected_head": plan["expected_head"],
                "expected_archive_sha256": plan["inspection"]["sha256"],
            },
        )
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertTrue(applied.json()["requires_restart"])
        output = io.StringIO()
        with redirect_stdout(output):
            main(["inspect", str(self.service.download(identifier))])
        self.assertEqual(
            json.loads(output.getvalue())["sha256"], created.json()["inspection"]["sha256"]
        )

    def test_real_context_restart_installs_api_plan_keeps_trash_and_skips_default_instance(self):
        past = "2000-01-01T00:00:00+00:00"
        discarded = self.ctx.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="Keep trashed episode",
                order=1,
                deleted_at=past,
            )
        )
        trashed = self.ctx.store.create_series(Series(title="Keep trashed work", deleted_at=past))
        self.ctx.store.put_doc(WorkshopQueue(lane=[self.series.id], paused=False))
        client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://127.0.0.1")
        created = client.post("/api/backups", json={})
        self.assertEqual(created.status_code, 201, created.text)
        archive = client.get(f"/api/backups/{created.json()['id']}/download")
        self.ctx.store.update_series(
            self.series.id, lambda series: setattr(series, "title", "Later")
        )
        staged = client.post("/api/backups/restore-plans", content=archive.content)
        self.assertEqual(staged.status_code, 201, staged.text)
        plan = staged.json()
        applied = client.post(
            f"/api/backups/restore-plans/{plan['id']}/apply",
            json={
                "expected_head": plan["expected_head"],
                "expected_archive_sha256": plan["inspection"]["sha256"],
            },
        )
        self.assertEqual(applied.status_code, 200, applied.text)
        client.close()
        self.close()
        self.ctx = AppContext.create(self.data, autostart=False)
        self.service = Backups(self.ctx)
        self.assertEqual(self.ctx.store.get_series(self.series.id).title, "Saved work")
        self.assertEqual(
            self.ctx.store.get_episode(discarded.id, include_deleted=True).deleted_at, past
        )
        self.assertEqual(
            self.ctx.store.get_series(trashed.id, include_deleted=True).deleted_at, past
        )
        self.assertEqual(self.ctx.store.list_docs("instance"), [])
        self.assertEqual(self.ctx.settings().extensions, {})
        self.assertTrue(self.ctx.queue.state().paused)
        self.assertEqual(self.ctx.engine.list(), [])
        self.assertEqual(self.service.get_plan(plan["id"]).state, "installed")
        self.assertFalse((recovery_root(self.data) / "restored.json").exists())

    def test_context_construction_failure_closes_databases_and_both_leases(self):
        self.close()
        captured = []

        def fail(ctx):
            captured.append(ctx)
            raise RuntimeError("simulated registration failure")

        with patch.object(AppContext, "_register_builtins", new=fail):
            with self.assertRaisesRegex(RuntimeError, "registration failure"):
                AppContext.create(self.data, autostart=False, seed_instance=False)
        broken = captured[0]
        self.assertTrue(broken.engine.closed)
        with self.assertRaises(sqlite3.ProgrammingError):
            broken.store._rows("SELECT 1")
        with self.assertRaises(sqlite3.ProgrammingError):
            broken.engine.db.execute("SELECT 1")
        for path in (
            self.data / "jobs.sqlite3.lease",
            recovery_root(self.data) / "workspace.lease",
        ):
            probe = FileLease(str(path))
            probe.release()
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        self.assertEqual(self.ctx.store.get_series(self.series.id).title, "Saved work")

    def test_failed_context_after_install_preserves_recovery_marker_for_next_start(self):
        discarded = self.ctx.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="Retained trash",
                order=1,
                deleted_at="2000-01-01T00:00:00+00:00",
            )
        )
        _, plan = self.scheduled()
        self.close()
        with patch.object(
            AppContext, "_register_builtins", side_effect=RuntimeError("boot failure")
        ):
            with self.assertRaisesRegex(RuntimeError, "boot failure"):
                AppContext.create(self.data, autostart=False)
        self.assertTrue((recovery_root(self.data) / "restored.json").exists())
        self.ctx = AppContext.create(self.data, autostart=False)
        self.service = Backups(self.ctx)
        self.assertEqual(self.ctx.store.get_series(self.series.id).title, "Saved work")
        self.assertIsNotNone(
            self.ctx.store.get_episode(discarded.id, include_deleted=True).deleted_at
        )
        self.assertEqual(self.ctx.store.list_docs("instance"), [])
        self.assertEqual(self.service.get_plan(plan.id).state, "installed")
        self.assertFalse((recovery_root(self.data) / "restored.json").exists())

    def test_active_context_rejects_second_context_before_opening_stores(self):
        with patch("mio_server.context.SQLiteStore", side_effect=AssertionError("store opened")):
            with self.assertRaises(LeaseHeld):
                AppContext.create(self.data, autostart=False)
        self.assertEqual(self.ctx.store.get_series(self.series.id).title, "Saved work")
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "title", "Still usable"))
        self.close()
        self.ctx = AppContext.create(self.data, autostart=False, seed_instance=False)
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).title, "Still usable")

    def test_v2_backup_endpoints_require_admin_and_admin_can_complete_the_api_flow(self):
        client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://127.0.0.1")
        self.addCleanup(client.close)
        denied_tokens = []
        for scopes in (["read"], ["write"], ["render"], ["read", "write", "render"]):
            token, raw = issue("Restricted", scopes)
            self.ctx.store.put_doc(token)
            denied_tokens.append(raw)
        token, admin = issue("Backup administrator", ["admin"])
        self.ctx.store.put_doc(token)
        endpoints = (
            ("GET", "/backups/head"),
            ("POST", "/backups"),
            ("POST", "/backups/inspect"),
            ("POST", "/backups/restore-plans"),
            ("GET", "/backups/restore-plans/restore_000000000000"),
            ("POST", "/backups/restore-plans/restore_000000000000/apply"),
            ("POST", "/backups/restore-plans/restore_000000000000/cancel"),
            ("GET", "/backups/backup_000000000000"),
            ("GET", "/backups/backup_000000000000/download"),
            ("DELETE", "/backups/backup_000000000000"),
        )
        for raw in denied_tokens:
            for method, path in endpoints:
                with self.subTest(method=method, path=path):
                    response = client.request(
                        method,
                        "/api/v2" + path,
                        headers={"Authorization": f"Bearer {raw}"},
                        json={},
                    )
                    self.assertEqual(response.status_code, 403, response.text)
        headers = {"Authorization": f"Bearer {admin}"}
        created = client.post("/api/v2/backups", json={}, headers=headers)
        self.assertEqual(created.status_code, 201, created.text)
        identifier = created.json()["id"]
        self.assertEqual(
            client.get(f"/api/v2/backups/{identifier}", headers=headers).status_code, 200
        )
        archive = client.get(f"/api/v2/backups/{identifier}/download", headers=headers)
        self.assertEqual(archive.status_code, 200)
        inspected = client.post("/api/v2/backups/inspect", content=archive.content, headers=headers)
        self.assertEqual(inspected.status_code, 200, inspected.text)
        staged = client.post(
            "/api/v2/backups/restore-plans", content=archive.content, headers=headers
        )
        self.assertEqual(staged.status_code, 201, staged.text)
        plan = staged.json()
        self.assertEqual(client.get("/api/v2/backups/head", headers=headers).status_code, 200)
        url = f"/api/v2/backups/restore-plans/{plan['id']}"
        self.assertEqual(client.get(url, headers=headers).status_code, 200)
        applied = client.post(
            url + "/apply",
            headers=headers,
            json={
                "expected_head": plan["expected_head"],
                "expected_archive_sha256": plan["inspection"]["sha256"],
            },
        )
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertTrue(applied.json()["requires_restart"])
        self.assertEqual(client.post(url + "/cancel", headers=headers).status_code, 200)
        self.assertEqual(
            client.delete(f"/api/v2/backups/{identifier}", headers=headers).status_code, 204
        )
