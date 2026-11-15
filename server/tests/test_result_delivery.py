"""Restart the real stores at result-delivery crash boundaries; never re-run a provider."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.context import AppContext
from mio_server.jobs import Candidate, ItemSpec, JobConflict, JobEngine
from mio_server.models import Episode, Panel, PanelOverrides, Series, TakeStatus
from mio_server.pipeline import cloud_jobs
from mio_server.render_models import ComfyInstance
from mio_server.storage import Conflict

from .test_compile_executor import FakeClient
from .test_render_qa import FakeCloudRenderer


class ProcessLost(BaseException):
    pass


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.ctx = None
        self.addCleanup(lambda: self.ctx.close() if self.ctx else None)
        self.open()
        self.ctx.store.put_doc(ComfyInstance(id="local", base_url="http://fake"))
        self.ctx.refresh_instances()
        self.series = self.ctx.store.create_series(Series(title="Delivery"))
        self.panel = Panel(order=0, overrides=PanelOverrides(raw_prompt="a quiet room"))
        self.episode = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="One frame", order=0, panels=[self.panel])
        )
        FakeClient.graphs, FakeClient.mode = [], "ok"

    def open(self):
        self.ctx = AppContext.create(
            self.root, autostart=False, comfy_client_factory=FakeClient, seed_instance=False
        )

    def reopen(self):
        self.ctx.close()
        self.open()

    def claim(self, job):
        item = job["items"][0]
        instance = "local" if item["resource"] == "comfy" else None
        cand = Candidate(job["id"], 0, item["resource"], "", (), (0, 0, 0))
        return self.ctx.engine._claim(cand, instance)

    def finish(self, job, hook="before"):
        engine = self.ctx.engine
        ctx = self.claim(job)
        executor = engine.executors[job["kind"]]
        result = executor.execute(ctx)
        if hook == "before":
            original = engine._record_delivery

            def crash(*args):
                original(*args)
                raise ProcessLost()

            target, name = engine, "_record_delivery"
        else:
            original = executor.on_complete

            def crash(*args):
                original(*args)
                raise ProcessLost()

            target, name = executor, "on_complete"
        with mock.patch.object(target, name, side_effect=crash), self.assertRaises(ProcessLost):
            engine._finish(job["id"], 0, ctx.epoch, "complete", result=result, apply=True)
        return result

    def render_job(self):
        return self.ctx.render.render(
            self.episode.id, [self.panel.id], candidates=1, adopt_first=True
        )

    def test_crash_before_apply_recovers_saved_result_without_comfy_submission(self):
        job = self.render_job()
        self.finish(job)
        self.assertEqual(len(self.ctx.store.get_episode(self.episode.id).takes), 0)
        self.assertEqual(len(FakeClient.graphs), 1)
        self.reopen()
        saved = self.ctx.store.get_episode(self.episode.id)
        self.assertEqual(len(saved.takes), 1)
        self.assertEqual(saved.adopted(self.panel.id).id, saved.takes[0].id)
        self.assertEqual(len(FakeClient.graphs), 1)
        self.assertEqual(self.ctx.engine.get(job["id"])["state"], "completed")
        self.assertEqual(self.ctx.engine.deliveries(job["id"])[0]["state"], "applied")

    def test_crash_after_apply_preserves_user_adoption_and_revision(self):
        job = self.render_job()
        self.finish(job, hook="after")

        def reject(ep):
            ep.takes[0].status = TakeStatus.rejected

        saved = self.ctx.store.update_episode(self.episode.id, reject)
        expected = saved.model_dump()
        delivery_id = self.ctx.engine.deliveries(job["id"])[0]["id"]
        self.reopen()
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).model_dump(), expected)
        self.assertEqual(self.ctx.engine.deliveries(job["id"])[0]["id"], delivery_id)
        self.assertEqual(self.ctx.engine.get(job["id"])["state"], "completed")
        self.assertEqual(len(FakeClient.graphs), 1)

    def test_failure_replay_does_not_execute_and_pending_cannot_be_retried(self):
        job = self.render_job()
        engine = self.ctx.engine
        ctx = self.claim(job)
        ex = engine.executors[job["kind"]]
        result = ex.execute(ctx)
        with mock.patch.object(ex, "on_complete", side_effect=RuntimeError("disk full")):
            engine._finish(job["id"], 0, ctx.epoch, "complete", result=result, apply=True)
        engine.running.clear()  # the original worker has returned
        with self.assertRaises(JobConflict):
            engine.retry(job["id"], confirm_uncertain=True)
        with self.assertRaises(JobConflict):
            engine.delete(job["id"])
        self.assertEqual(engine.replay_result(job["id"], 0)["state"], "completed")
        self.assertEqual(len(FakeClient.graphs), 1)
        self.assertEqual(len(self.ctx.store.get_episode(self.episode.id).takes), 1)

    def test_cancel_discards_pending_delivery_without_undoing_saved_work(self):
        for hook in ("before", "after"):
            with self.subTest(hook=hook):
                job = self.render_job()
                self.finish(job, hook=hook)
                expected = self.ctx.store.get_episode(self.episode.id).model_dump()
                self.ctx.engine.cancel(job["id"])
                self.assertEqual(self.ctx.engine.deliveries(job["id"])[0]["state"], "discarded")
                with self.assertRaises(JobConflict):
                    self.ctx.engine.replay_result(job["id"], 0)
                self.reopen()
                self.assertEqual(self.ctx.store.get_episode(self.episode.id).model_dump(), expected)

    def test_receipt_rejects_different_result_and_new_attempt_gets_new_receipt(self):
        job = self.render_job()
        self.finish(job, hook="after")
        receipt = self.ctx.engine.deliveries(job["id"])[0]
        with self.assertRaises(Conflict):
            self.ctx.store.apply_episode_delivery(
                self.episode.id, receipt["id"], "changed", lambda ep: []
            )
        self.reopen()
        self.ctx.engine.retry(job["id"], indexes=[0], include_complete=True)
        current = self.ctx.engine.get(job["id"])
        self.finish(current, hook="after")
        self.reopen()
        saved = self.ctx.store.get_episode(self.episode.id)
        self.assertEqual(len(saved.takes), 2)
        receipts = self.ctx.engine.deliveries(job["id"])
        self.assertEqual([r["attempt"] for r in receipts], [1, 2])

    def test_cloud_refinement_submission_is_recovered_after_saved_candidate(self):
        profile = self.ctx.render.profile(None).model_copy(
            update={"id": "hybrid", "cloud_shape": True, "cloud_refine": True}
        )
        self.ctx.store.put_doc(profile)
        job = self.ctx.render.render(
            self.episode.id, [self.panel.id], profile_id=profile.id, candidates=1
        )
        ctx = self.claim(job)
        ex = self.ctx.engine.executors["cloud.render"]
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            result = ex.execute(ctx)
        with mock.patch.object(self.ctx.render, "refine_shape", side_effect=ProcessLost()):
            with self.assertRaises(ProcessLost):
                self.ctx.engine._finish(
                    job["id"], 0, ctx.epoch, "complete", result=result, apply=True
                )
        saved_id = self.ctx.store.get_episode(self.episode.id).takes[0].id
        self.reopen()
        self.assertEqual(
            [t.id for t in self.ctx.store.get_episode(self.episode.id).takes], [saved_id]
        )
        refinements = [j for j in self.ctx.engine.list() if j["kind"] == "comfy.render"]
        self.assertEqual(len(refinements), 1)
        self.assertEqual(refinements[0]["idempotency_key"], f"refine:{saved_id}")
        self.assertEqual(self.ctx.engine.recover_deliveries(), 0)

    def test_cloud_replay_after_refinement_submission_keeps_one_followup(self):
        profile = self.ctx.render.profile(None).model_copy(
            update={"id": "hybrid", "cloud_shape": True, "cloud_refine": True}
        )
        self.ctx.store.put_doc(profile)
        job = self.ctx.render.render(
            self.episode.id, [self.panel.id], profile_id=profile.id, candidates=1
        )
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            self.finish(job, hook="after")
        original = next(j["id"] for j in self.ctx.engine.list() if j["kind"] == "comfy.render")
        self.reopen()
        followups = [j["id"] for j in self.ctx.engine.list() if j["kind"] == "comfy.render"]
        self.assertEqual(followups, [original])
        self.assertEqual(len(self.ctx.store.get_episode(self.episode.id).takes), 1)

    def test_qa_replay_does_not_overwrite_later_manual_selection(self):
        job = self.render_job()
        self.finish(job, hook="after")
        self.reopen()
        take = self.ctx.store.get_episode(self.episode.id).takes[0]
        qa = self.ctx.qa.submit(
            self.episode.id, take_ids=[take.id], votes=1, faces=False, auto_adopt=True
        )
        self.finish(qa, hook="after")
        saved = self.ctx.store.update_episode(
            self.episode.id, lambda ep: setattr(ep.takes[0], "status", TakeStatus.rejected)
        )
        self.reopen()
        self.assertEqual(
            self.ctx.store.get_episode(self.episode.id).model_dump(), saved.model_dump()
        )
        self.assertEqual(self.ctx.engine.get(qa["id"])["state"], "completed")

    def test_cancellation_before_result_does_not_create_a_delivery(self):
        job = self.render_job()
        ctx = self.claim(job)
        result = self.ctx.engine.executors[job["kind"]].execute(ctx)
        self.ctx.engine.cancel(job["id"])
        self.ctx.engine._finish(job["id"], 0, ctx.epoch, "complete", result=result, apply=True)
        self.assertEqual(self.ctx.engine.deliveries(job["id"]), [])
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes, [])

    def test_open_api_delivery_scope_and_explicit_replay(self):
        job = self.render_job()
        self.finish(job)
        self.ctx.engine.running.clear()
        client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://127.0.0.1")
        from mio_server.auth import issue

        token, plain = issue("reader", ["read"])
        self.ctx.store.put_doc(token)
        headers = {"Authorization": f"Bearer {plain}"}
        url = f"/api/v2/jobs/{job['id']}"
        self.assertEqual(client.get(url + "/deliveries", headers=headers).status_code, 200)
        self.assertEqual(
            client.post(url + "/items/0/replay-result", headers=headers).status_code, 403
        )
        token, plain = issue("renderer", ["render"])
        self.ctx.store.put_doc(token)
        response = client.post(
            url + "/items/0/replay-result", headers={"Authorization": f"Bearer {plain}"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state"], "completed")


class ThirdPartyDeliveryTests(unittest.TestCase):
    def test_unknown_callback_is_not_replayed_after_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "jobs.db"
            engine = JobEngine(path, autostart=False)
            callback = mock.Mock()
            callback.replay_safe = False
            engine.register("external", callback)
            job = engine.submit("external", [ItemSpec({})])
            engine._claim(Candidate(job["id"], 0, "local", "", (), (0, 0, 0)), None)
            engine._record_delivery(engine._item_row(job["id"], 0), {"received": True})
            engine.close()
            engine = JobEngine(path, autostart=False)
            try:
                callback = mock.Mock()
                callback.replay_safe = False
                engine.register("external", callback)
                self.assertEqual(engine.recover_deliveries(), 0)
                callback.execute.assert_not_called()
                callback.on_complete.assert_not_called()
                self.assertEqual(engine.get(job["id"])["state"], "blocked")
                with self.assertRaises(JobConflict):
                    engine.replay_result(job["id"], 0)
            finally:
                engine.close()
