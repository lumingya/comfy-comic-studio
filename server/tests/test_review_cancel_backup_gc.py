"""Canceled publication diagnostics do not block backup or leak orphan staging files."""

import json
import os
import sqlite3
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest import mock

from mio_server.assets import AssetStore
from mio_server.backups import Backups
from mio_server.backups.models import BackupOptions
from mio_server.jobs import ExecError, JobConflict
from mio_server.jobs.publication import result_sha

from .test_compile_executor import png
from .test_result_delivery import DeliveryCase, ProcessLost


class CanceledPublicationBackupGCTests(DeliveryCase):
    def interrupted_publication(self, *, saved=0, partial=False):
        job = self.render_job()
        ctx = self.claim(job)
        pairs = [
            (self.ctx.assets.describe(data), data) for data in (png((1, 2, 3)), png((4, 5, 6)))
        ]
        result = {"images": [{"asset_id": asset.id} for asset, _ in pairs]}
        original = self.ctx.assets.publish
        calls = 0

        def crash(asset, data):
            nonlocal calls
            calls += 1
            if calls <= saved:
                return original(asset, data)
            if partial:
                staging = self.staging(asset)
                staging.parent.mkdir(parents=True, exist_ok=True)
                staging.write_bytes(data[: len(data) // 2])
            raise ProcessLost()

        with (
            mock.patch.object(self.ctx.assets, "publish", side_effect=crash),
            self.assertRaises(ProcessLost),
        ):
            ctx.publish_result(result, pairs)
        self.reopen()
        return job, pairs

    def staging(self, asset):
        target = self.ctx.assets.path(asset)
        return target.with_name(f".{target.name}.publishing")

    def test_canceled_missing_publication_exports_and_inspects_with_saved_assets_and_logs(self):
        for saved in (0, 1):
            with self.subTest(saved=saved):
                job, pairs = self.interrupted_publication(saved=saved)
                self.ctx.engine.cancel(job["id"])
                self.assertEqual(self.ctx.engine.active_operation_jobs(), [])
                before = self.ctx.engine.deliveries(job["id"])
                self.assertEqual(before[0]["state"], "discarded")
                service = Backups(self.ctx)
                backup = service.export(BackupOptions())
                inspection = service.inspect(service.download(backup.id), self.ctx.data_dir)
                self.assertEqual(inspection.asset_count, saved)
                with (
                    zipfile.ZipFile(service.download(backup.id)) as archive,
                    closing(sqlite3.connect(":memory:")) as database,
                ):
                    database.deserialize(archive.read("jobs.sqlite3"))
                    self.assertEqual(
                        database.execute(
                            "SELECT result_json FROM job_deliveries WHERE job_id = ?",
                            (job["id"],),
                        ).fetchone()[0],
                        self.ctx.engine.db.execute(
                            "SELECT result_json FROM job_deliveries WHERE job_id = ?",
                            (job["id"],),
                        ).fetchone()[0],
                    )
                self.assertEqual(self.ctx.engine.deliveries(job["id"]), before)
                self.assertEqual(self.ctx.store.asset_ids(), {a.id for a, _ in pairs[:saved]})
                for asset, data in pairs[:saved]:
                    self.assertEqual(self.ctx.assets.read(asset.id), data)
                self.ctx.engine.delete(job["id"])
                self.ctx.assets.collect_garbage(set())

    def test_unresolved_missing_publication_still_blocks_backup(self):
        self.interrupted_publication()
        with self.assertRaises(JobConflict):
            Backups(self.ctx).export(BackupOptions())

    def failed_retry_after_cancel(self):
        job, pairs = self.interrupted_publication()
        canceled = self.ctx.engine.cancel(job["id"])
        previous = canceled["items"][0]["result"]
        retried = self.ctx.engine.retry(job["id"], indexes=[0], confirm_uncertain=True)
        ctx = self.claim(retried)
        executor = self.ctx.engine.executors[job["kind"]]
        with mock.patch.object(
            executor, "execute", side_effect=ExecError("pre-submit rejected", sent=False)
        ):
            self.ctx.engine._run(ctx, "comfy", "local")
        item = self.ctx.engine.get(job["id"])["items"][0]
        self.assertEqual((item["state"], item["attempts"]), ("failed", 2))
        self.assertEqual(item["result"], previous)
        self.assertEqual(
            [(row["attempt"], row["state"]) for row in self.ctx.engine.deliveries(job["id"])],
            [(1, "discarded")],
        )
        return job, pairs

    def test_failed_retry_keeps_discarded_result_auditable_without_blocking_backup(self):
        job, _ = self.failed_retry_after_cancel()
        before = self.ctx.engine.deliveries(job["id"])
        service = Backups(self.ctx)
        backup = service.export(BackupOptions())
        self.assertEqual(backup.inspection.asset_count, 0)
        self.assertEqual(service.inspect(service.download(backup.id)).asset_count, 0)
        self.assertEqual(self.ctx.engine.deliveries(job["id"]), before)

    def test_failed_retry_does_not_excuse_strong_inputs_or_unmatched_results(self):
        job, pairs = self.failed_retry_after_cancel()
        original = self.ctx.engine.db.execute(
            "SELECT input_json FROM job_items WHERE job_id = ?", (job["id"],)
        ).fetchone()[0]
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_items SET input_json = ? WHERE job_id = ?",
                (json.dumps({"asset_id": pairs[0][0].id}), job["id"]),
            )
        with self.assertRaisesRegex(ValueError, "missing asset metadata"):
            Backups(self.ctx).export(BackupOptions())
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_items SET input_json = ?, result_json = ? WHERE job_id = ?",
                (original, json.dumps({"asset_id": "f" * 64}), job["id"]),
            )
        with self.assertRaisesRegex(ValueError, "missing asset metadata"):
            Backups(self.ctx).export(BackupOptions())

    def test_discarded_diagnostics_do_not_hide_missing_strong_input_references(self):
        job, pairs = self.interrupted_publication()
        self.ctx.engine.cancel(job["id"])
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_items SET input_json = ? WHERE job_id = ?",
                (json.dumps({"asset_id": pairs[0][0].id}), job["id"]),
            )
        with self.assertRaisesRegex(ValueError, "missing asset metadata"):
            Backups(self.ctx).export(BackupOptions())

    def test_unmatched_item_result_is_not_excused_by_another_discarded_result(self):
        job, _ = self.interrupted_publication()
        self.ctx.engine.cancel(job["id"])
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_items SET result_json = ? WHERE job_id = ?",
                (json.dumps({"asset_id": "f" * 64}), job["id"]),
            )
        with self.assertRaisesRegex(ValueError, "missing asset metadata"):
            Backups(self.ctx).export(BackupOptions())

    def test_unlisted_error_asset_remains_a_strong_reference(self):
        job, _ = self.interrupted_publication()
        self.ctx.engine.cancel(job["id"])
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_items SET error_json = ? WHERE job_id = ?",
                (json.dumps({"asset_id": "f" * 64}), job["id"]),
            )
        with self.assertRaisesRegex(ValueError, "missing asset metadata"):
            Backups(self.ctx).export(BackupOptions())

    def test_discarded_publication_still_rejects_corrupt_manifest_and_saved_bytes(self):
        job, pairs = self.interrupted_publication(saved=1)
        self.ctx.engine.cancel(job["id"])
        original = self.ctx.engine.db.execute(
            "SELECT result_json FROM job_deliveries WHERE job_id = ?", (job["id"],)
        ).fetchone()[0]
        document = json.loads(original)
        document["owner"]["job_id"] = "job_bad"
        document["publication_sha"] = result_sha(
            {key: value for key, value in document.items() if key != "publication_sha"}
        )
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_deliveries SET result_json = ? WHERE job_id = ?",
                (json.dumps(document), job["id"]),
            )
        with self.assertRaisesRegex(ValueError, "different owner"):
            Backups(self.ctx).export(BackupOptions())
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_deliveries SET result_json = ? WHERE job_id = ?",
                (original, job["id"]),
            )
        self.ctx.assets.path(pairs[0][0]).write_bytes(b"corrupted saved artifact")
        with self.assertRaises(ValueError):
            Backups(self.ctx).export(BackupOptions())

    def test_gc_reclaims_unregistered_staging_only_after_last_owner_is_deleted(self):
        job, pairs = self.interrupted_publication(partial=True)
        asset, _ = pairs[0]
        staging = self.staging(asset)
        self.assertTrue(staging.exists())
        self.ctx.engine.cancel(job["id"])
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])
        self.assertTrue(staging.exists())
        self.ctx.engine.delete(job["id"])
        self.assertEqual(self.ctx.store.asset_ids(), set())
        self.assertEqual(self.ctx.engine.retained_result_assets(), set())
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [asset.id])
        self.assertFalse(staging.exists())
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])

    def test_gc_keeps_staging_shared_with_another_tasks_discarded_journal(self):
        first, pairs = self.interrupted_publication(partial=True)
        second, _ = self.interrupted_publication(partial=True)
        staging = self.staging(pairs[0][0])
        for job in (first, second):
            self.ctx.engine.cancel(job["id"])
        self.ctx.engine.delete(first["id"])
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])
        self.assertTrue(staging.exists())
        self.ctx.engine.delete(second["id"])
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [pairs[0][0].id])
        self.assertFalse(staging.exists())

    def test_gc_staging_sweep_respects_registered_assets_and_explicit_references(self):
        data = png()
        asset = self.ctx.assets.put(data)
        staging = self.staging(asset)
        staging.write_bytes(data[: len(data) // 2])
        self.assertEqual(self.ctx.assets.collect_garbage({asset.id}), [])
        self.assertTrue(staging.exists())
        self.assertEqual(self.ctx.assets.read(asset.id), data)
        # Registered asset GC keeps its original semantics; its staging is outside the
        # orphan sweep until a subsequent explicit GC sees no registered asset.
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [asset.id])
        self.assertTrue(staging.exists())
        self.assertEqual(self.ctx.assets.collect_garbage({asset.id}), [])
        self.assertTrue(staging.exists())
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [asset.id])

    def test_gc_waits_for_a_live_managed_publication(self):
        data = png()
        asset = self.ctx.assets.describe(data)
        entered, release, collecting = threading.Event(), threading.Event(), threading.Event()
        original = self.ctx.assets._write

        def writing(target, contents):
            staging = self.staging(asset)
            staging.parent.mkdir(parents=True, exist_ok=True)
            staging.write_bytes(contents[: len(contents) // 2])
            entered.set()
            if not release.wait(5):
                raise AssertionError("test did not release writer")
            original(target, contents)

        def collecting_garbage():
            collecting.set()
            return self.ctx.assets.collect_garbage({asset.id})

        with (
            mock.patch.object(self.ctx.assets, "_write", side_effect=writing),
            ThreadPoolExecutor(max_workers=2) as pool,
        ):
            writer = pool.submit(self.ctx.assets.publish, asset, data)
            try:
                self.assertTrue(entered.wait(5))
                collector = pool.submit(collecting_garbage)
                self.assertTrue(collecting.wait(5))
                self.assertFalse(collector.done())
                self.assertTrue(self.staging(asset).exists())
            finally:
                release.set()
            self.assertEqual(writer.result(timeout=5).id, asset.id)
            self.assertEqual(collector.result(timeout=5), [])
        self.assertEqual(self.ctx.assets.read(asset.id), data)

    def test_gc_rejects_hardlinked_staging_without_touching_external_bytes(self):
        asset = self.ctx.assets.describe(png())
        staging = self.staging(asset)
        staging.parent.mkdir(parents=True, exist_ok=True)
        victim = self.root / "unrelated.bin"
        victim.write_bytes(b"retain unrelated file")
        try:
            os.link(victim, staging)
        except OSError as exc:
            self.skipTest(f"hard links unavailable: {exc}")
        with self.assertRaisesRegex(ValueError, "hard link"):
            self.ctx.assets.collect_garbage(set())
        self.assertEqual(victim.read_bytes(), b"retain unrelated file")
        self.assertTrue(staging.exists())

    def test_gc_rejects_linked_managed_directories_without_traversing_them(self):
        asset = self.ctx.assets.describe(png())
        victim = self.root / "outside-assets"
        victim.mkdir()
        external = victim / self.staging(asset).name
        external.write_bytes(b"retain external staging")
        try:
            (self.ctx.assets.root / asset.id[:2]).symlink_to(victim, target_is_directory=True)
        except OSError as exc:
            self.skipTest(f"directory links unavailable: {exc}")
        with self.assertRaisesRegex(ValueError, "links or reparse points"):
            self.ctx.assets.collect_garbage(set())
        self.assertEqual(external.read_bytes(), b"retain external staging")

    def test_gc_ignores_unmanaged_names_and_wrong_hash_prefixes(self):
        asset = self.ctx.assets.describe(png())
        directory = self.ctx.assets.root / "00"
        directory.mkdir()
        paths = [
            directory / self.staging(asset).name,
            directory / f".{asset.id}.exe.publishing",
            directory / "notes.publishing",
        ]
        for path in paths:
            path.write_bytes(b"unmanaged")
        self.assertEqual(self.ctx.assets.collect_garbage(set()), [])
        self.assertTrue(all(path.read_bytes() == b"unmanaged" for path in paths))

    def test_gc_rejects_out_of_root_registered_asset_without_deleting_files(self):
        assets = AssetStore(self.root / "nested" / "assets", self.ctx.store)
        unsafe = assets.describe(png()).model_copy(update={"id": "../outside"})
        self.ctx.store.put_asset(unsafe)
        victim = self.root / "outside.png"
        victim.write_bytes(b"retain external file")
        with self.assertRaisesRegex(ValueError, "invalid result artifact manifest"):
            assets.collect_garbage(set())
        self.assertEqual(victim.read_bytes(), b"retain external file")
        self.assertIn(unsafe.id, self.ctx.store.asset_ids())
