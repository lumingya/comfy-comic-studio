"""Whole-work restore includes trash, preserves revisions and is atomic on failure."""

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.api.checkpoints import router
from mio_server.checkpoints import Checkpoints
from mio_server.checkpoints.models import CheckpointCreate
from mio_server.context import AppContext
from mio_server.jobs import Candidate, ItemSpec, JobConflict
from mio_server.models import (
    AssetRef,
    ControlInput,
    Episode,
    Panel,
    Series,
    Take,
    now_iso,
)
from mio_server.storage import Conflict, NotFound


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.ctx = AppContext.create(self.root, autostart=False, seed_instance=False)
        self.addCleanup(lambda: self.ctx.close())
        self.service = Checkpoints(self.ctx)
        self.series = self.ctx.store.create_series(Series(title="Original"))
        self.asset = self.ctx.assets.put(b"retained original image")
        panel = Panel(order=0, references=[AssetRef(asset_id=self.asset.id)])
        self.ep = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="First", order=0, panels=[panel])
        )
        self.deleted = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="Deleted", order=0, deleted_at=now_iso())
        )

    def checkpoint(self, name="Saved"):
        return self.service.create(self.series.id, CheckpointCreate(name=name))

    def restore(self, checkpoint):
        return self.service.restore(
            self.series.id,
            checkpoint.id,
            self.service.preview(self.series.id, checkpoint.id).current_head,
        )

    def test_snapshot_includes_trash_and_is_independent_after_reopen(self):
        checkpoint = self.checkpoint()
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "title", "New"))
        self.ctx.close()
        self.ctx = AppContext.create(self.root, autostart=False, seed_instance=False)
        self.service = Checkpoints(self.ctx)
        saved = self.service.get(self.series.id, checkpoint.id)
        self.assertEqual(saved.episode_count, 2)
        self.assertEqual(saved.deleted_episode_count, 1)
        self.assertEqual(
            next(ep.title for ep in saved.snapshot.episodes if ep.id == self.ep.id), "First"
        )
        self.assertEqual(self.service.referenced_assets(), {self.asset.id})

    def test_preview_restore_protects_current_and_keeps_monotonic_revisions(self):
        checkpoint = self.checkpoint()
        self.ctx.store.update_series(
            self.series.id, lambda series: setattr(series, "title", "Later")
        )
        changed = self.ctx.store.update_episode(
            self.ep.id, lambda ep: setattr(ep, "title", "Later")
        )
        later = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="Extra", order=1)
        )
        preview = self.service.preview(self.series.id, checkpoint.id)
        self.assertTrue(preview.series_changed)
        self.assertEqual(preview.changed_episode_ids, [self.ep.id])
        self.assertEqual(preview.removed_episode_ids, [later.id])
        result = self.restore(checkpoint)
        self.assertEqual(self.ctx.store.get_series(self.series.id).title, "Original")
        restored = self.ctx.store.get_episode(self.ep.id)
        self.assertEqual((restored.title, restored.revision), ("First", changed.revision + 1))
        self.assertTrue(self.ctx.store.get_episode(later.id, include_deleted=True).deleted_at)
        self.assertEqual(result.trashed_episode_ids, [later.id])
        protection = self.service.get(self.series.id, result.pre_restore_checkpoint.id)
        self.assertEqual(protection.kind, "pre_restore")
        self.assertEqual(protection.snapshot.series.title, "Later")
        self.restore(protection)
        self.assertEqual(self.ctx.store.get_episode(later.id).title, "Extra")
        self.assertGreater(self.ctx.store.get_episode(self.ep.id).revision, restored.revision)

    def test_reordered_live_episodes_can_swap_order_atomically(self):
        other = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="Second", order=1)
        )
        checkpoint = self.checkpoint()
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "order", 2))
        self.ctx.store.update_episode(other.id, lambda ep: setattr(ep, "order", 0))
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "order", 1))
        self.restore(checkpoint)
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).order, 0)
        self.assertEqual(self.ctx.store.get_episode(other.id).order, 1)

    def test_restore_recreates_purged_episode_but_requires_original_work(self):
        checkpoint = self.checkpoint()
        self.ctx.store.delete_episode(self.ep.id)
        self.assertEqual(
            self.service.preview(self.series.id, checkpoint.id).added_episode_ids, [self.ep.id]
        )
        self.restore(checkpoint)
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).revision, self.ep.revision + 1)
        self.ctx.store.delete_series(self.series.id)
        self.assertEqual(self.service.get(self.series.id, checkpoint.id).id, checkpoint.id)
        self.assertTrue(self.service.list(self.series.id))
        self.assertIn(self.asset.id, self.service.referenced_assets())
        with self.assertRaises(NotFound):
            self.restore(checkpoint)

    def test_stale_head_and_missing_asset_leave_everything_untouched(self):
        checkpoint = self.checkpoint()
        head = self.service.head(self.series.id)
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "title", "Concurrent"))
        with self.assertRaises(Conflict):
            self.service.restore(self.series.id, checkpoint.id, head)
        self.ctx.assets.path(self.asset).unlink()
        preview = self.service.preview(self.series.id, checkpoint.id)
        self.assertFalse(preview.can_restore)
        self.assertEqual(preview.missing_asset_ids, [self.asset.id])
        with self.assertRaises(Conflict):
            self.restore(checkpoint)
        self.assertEqual(len(self.service.list(self.series.id)), 1)
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).title, "Concurrent")

    def test_recreated_episode_uses_highest_retained_checkpoint_revision(self):
        checkpoint = self.checkpoint()
        self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "title", "Second"))
        latest = self.ctx.store.update_episode(self.ep.id, lambda ep: setattr(ep, "title", "Third"))
        self.checkpoint("Latest")
        self.ctx.store.delete_episode(self.ep.id)
        self.restore(checkpoint)
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).revision, latest.revision + 1)

    def test_work_in_trash_can_be_restored_or_returned_to_its_saved_trash_state(self):
        original = self.checkpoint()
        series = self.ctx.store.get_series(self.series.id)
        series.deleted_at = now_iso()
        self.ctx.store.save_series(series)
        trashed = self.checkpoint("In trash")
        self.restore(original)
        self.assertIsNone(self.ctx.store.get_series(self.series.id).deleted_at)
        self.ctx.store.delete_episode(self.ep.id)
        self.restore(trashed)
        self.assertTrue(self.ctx.store.get_series(self.series.id, include_deleted=True).deleted_at)
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).title, "First")

    def test_failure_rolls_back_work_and_pre_restore_checkpoint(self):
        checkpoint = self.checkpoint()
        self.ctx.store.update_series(
            self.series.id, lambda series: setattr(series, "title", "Current")
        )
        head = self.service.head(self.series.id)
        with patch.object(self.ctx.store, "save_episode", side_effect=RuntimeError("interrupt")):
            with self.assertRaisesRegex(RuntimeError, "interrupt"):
                self.restore(checkpoint)
        self.assertEqual(self.service.head(self.series.id), head)
        self.assertEqual(len(self.service.list(self.series.id)), 1)

    def test_validates_functional_refs_but_retains_orphan_take_provenance(self):
        def invalid(ep):
            ep.panels[0].controls = [ControlInput(source="take", take_id="missing")]

        self.ctx.store.update_episode(self.ep.id, invalid)
        with self.assertRaisesRegex(Conflict, "missing take"):
            self.checkpoint()

        def historical(ep):
            ep.panels[0].controls = []
            ep.takes = [
                Take(
                    panel_id="deleted-panel", asset_id=self.asset.id, parent_take_id="deleted-take"
                )
            ]

        self.ctx.store.update_episode(self.ep.id, historical)
        self.restore(self.checkpoint())
        self.assertEqual(self.ctx.store.get_episode(self.ep.id).takes[0].panel_id, "deleted-panel")

    def test_restore_rejects_queued_paused_uncertain_and_unacked_results(self):
        checkpoint = self.checkpoint()
        engine = self.ctx.engine
        for state in ("pending", "uncertain", "failed"):
            job = engine.submit("test", [ItemSpec({})], owner=self.ep.id, paused=True)
            with engine.lock, engine.db:
                engine.db.execute(
                    "UPDATE job_items SET state = ? WHERE job_id = ?", (state, job["id"])
                )
                if state == "failed":
                    engine._record_delivery(engine._item_row(job["id"], 0), {"value": 1})
            with self.assertRaises(JobConflict):
                self.restore(checkpoint)
            self.assertIn(
                job["id"], self.service.preview(self.series.id, checkpoint.id).active_job_ids
            )
            engine.cancel(job["id"])
        self.restore(checkpoint)

    def test_canceled_worker_blocks_restore_until_it_has_exited(self):
        checkpoint = self.checkpoint()
        engine = self.ctx.engine
        job = engine.submit("test", [ItemSpec({})], owner=self.ep.id)
        item = engine._claim(Candidate(job["id"], 0, "local", "", (), (0, 0, 0)), None)
        engine.cancel(job["id"])
        with self.assertRaises(JobConflict):
            self.restore(checkpoint)
        engine._run(item, "local", None)
        self.restore(checkpoint)

    def test_engine_operation_guard_holds_submission_until_after_restore(self):
        entered, submitted = threading.Event(), threading.Event()

        def submit():
            entered.set()
            self.ctx.engine.submit("test", [ItemSpec({})], owner=self.ep.id)
            submitted.set()

        with self.ctx.engine.operation_guard({self.ep.id}):
            thread = threading.Thread(target=submit)
            thread.start()
            self.assertTrue(entered.wait(1))
            self.assertFalse(submitted.wait(0.03))
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertTrue(submitted.is_set())

    def test_api_requires_expected_head_and_has_typed_preview(self):
        app = create_app(self.ctx, serve_web=False)
        # Root integrates the router separately; use a dedicated prefix for this contract.
        app.include_router(router, prefix="/checkpoint-test")
        client = TestClient(app)
        base = f"/checkpoint-test/series/{self.series.id}/checkpoints"
        response = client.post(base, json={"name": "API save"})
        self.assertEqual(response.status_code, 201, response.text)
        url = f"{base}/{response.json()['id']}"
        preview = client.get(url + "/preview").json()
        self.assertEqual(client.post(url + "/restore", json={}).status_code, 422)
        restored = client.post(url + "/restore", json={"expected_head": preview["current_head"]})
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()["pre_restore_checkpoint"]["kind"], "pre_restore")
        self.assertEqual(client.delete(url).status_code, 204)
        self.assertEqual(client.get(url).status_code, 404)
