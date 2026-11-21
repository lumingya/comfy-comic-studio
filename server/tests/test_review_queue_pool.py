"""Offline regressions for round-three queue submission and instance isolation."""

from __future__ import annotations

import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.api.library import create_instance, instance_health, list_instances, put_instance
from mio_server.context import AppContext
from mio_server.jobs.pool import COMFY, Candidate, ResourcePool, normalize_endpoint
from mio_server.models import Episode, Panel, PanelOverrides, Series, WorkshopQueue
from mio_server.render_models import ComfyInstance
from mio_server.storage import SQLiteStore

from .api_harness import FakeComfy, FakeLLM
from .test_compile_executor import FakeClient
from .test_jobs import drain


class QueueRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ctx = self.open_context()
        self.addCleanup(lambda: self.ctx.close())
        self.ctx.store.put_doc(ComfyInstance(id="healthy", base_url="http://fake"))
        self.ctx.refresh_instances()
        FakeClient.graphs, FakeClient.uploads, FakeClient.mode = [], [], "ok"

    def open_context(self):
        return AppContext.create(
            self.tmp.name,
            autostart=False,
            seed_instance=False,
            llm_factory=FakeLLM,
            comfy_client_factory=FakeComfy,
        )

    def album(self, title="queue recovery"):
        series = self.ctx.store.create_series(Series(title=title))
        episode = self.ctx.store.create_episode(
            Episode(
                series_id=series.id,
                order=0,
                title="one",
                panels=[
                    Panel(
                        order=0,
                        description="room",
                        overrides=PanelOverrides(raw_prompt="a quiet room"),
                    )
                ],
            )
        )
        return series.id, episode.id

    def test_restart_after_active_job_save_failure_recovers_one_submission(self):
        album_id, episode_id = self.album()
        put = self.ctx.store.put_doc

        def fail_active_job(doc):
            if type(doc).__name__ == "WorkshopQueue" and doc.active_job:
                raise OSError("injected active-job save failure")
            return put(doc)

        with patch.object(self.ctx.store, "put_doc", side_effect=fail_active_job):
            with self.assertRaisesRegex(OSError, "active-job save failure"):
                self.ctx.queue.start([album_id])
            for _ in range(2):
                with self.assertRaisesRegex(OSError, "active-job save failure"):
                    self.ctx.queue.advance()
        first = self.ctx.engine.list(owner=episode_id)
        self.assertEqual(len(first), 1)
        self.assertIsNone(self.ctx.queue.state().active_job)
        self.ctx.close()
        self.ctx = self.open_context()
        # Recovery must use the frozen task before looking at mutable render inputs.
        episode = self.ctx.store.get_episode(episode_id)
        episode.panels[0].overrides.raw_prompt = "a different room after restart"
        self.ctx.store.save_episode(episode)
        q = self.ctx.queue.advance()
        self.assertEqual(len(self.ctx.engine.list(owner=episode_id)), 1)
        self.assertEqual(q.active_job, first[0]["id"])
        self.assertEqual(drain(self.ctx.engine, q.active_job)["state"], "completed")
        self.assertEqual(len(FakeClient.graphs), len(self.ctx.engine.get(q.active_job)["items"]))
        self.assertFalse(self.ctx.queue.advance().lane_tokens)

    def test_old_lane_persists_token_before_attempting_submission(self):
        album_id, episode_id = self.album()
        self.ctx.store.put_doc(WorkshopQueue(lane=[album_id]))
        put = self.ctx.store.put_doc

        def fail_intent(doc):
            if isinstance(doc, WorkshopQueue) and doc.lane_tokens:
                raise OSError("injected intent save failure")
            return put(doc)

        with patch.object(self.ctx.store, "put_doc", side_effect=fail_intent):
            with self.assertRaisesRegex(OSError, "intent save failure"):
                self.ctx.queue.advance()
        self.assertEqual(self.ctx.engine.list(owner=episode_id), [])
        self.assertFalse(self.ctx.queue.state().lane_tokens)
        q = self.ctx.queue.advance()
        self.assertEqual(len(self.ctx.engine.list(owner=episode_id)), 1)
        self.assertTrue(self.ctx.engine.get(q.active_job)["idempotency_key"])

    def test_submission_committed_before_report_error_is_still_tracked(self):
        album_id, episode_id = self.album()
        render = self.ctx.render.render

        def submit_then_fail(*args, **kwargs):
            render(*args, **kwargs)
            raise OSError("injected post-submit response failure")

        with patch.object(self.ctx.render, "render", side_effect=submit_then_fail):
            q = self.ctx.queue.start([album_id])
        jobs = self.ctx.engine.list(owner=episode_id)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(q.active_job, jobs[0]["id"])
        self.assertNotIn(album_id, q.notices)

    def test_completed_before_receipt_recovery_and_same_panel_redraw_use_new_intent(self):
        album_id, episode_id = self.album()
        put = self.ctx.store.put_doc

        def fail_receipt(doc):
            if isinstance(doc, WorkshopQueue) and doc.active_job:
                raise OSError("injected receipt failure")
            return put(doc)

        with patch.object(self.ctx.store, "put_doc", side_effect=fail_receipt):
            with self.assertRaises(OSError):
                self.ctx.queue.start([album_id])
        first = self.ctx.engine.list(owner=episode_id)[0]
        self.assertEqual(drain(self.ctx.engine, first["id"])["state"], "completed")
        upstream_count = len(FakeClient.graphs)
        self.ctx.close()
        self.ctx = self.open_context()
        q = self.ctx.queue.advance()
        self.assertIsNone(q.active_job)
        self.assertFalse(q.lane_tokens)
        self.assertEqual(len(self.ctx.engine.list(owner=episode_id)), 1)
        self.assertEqual(len(FakeClient.graphs), upstream_count)
        # The same panel becomes missing again; this is an explicit new run, not recovery.
        episode = self.ctx.store.get_episode(episode_id)
        for take in episode.takes:
            take.status = "candidate"
        self.ctx.store.save_episode(episode)
        q = self.ctx.queue.start([album_id])
        self.assertNotEqual(q.active_job, first["id"])
        self.assertEqual(len(self.ctx.engine.list(owner=episode_id)), 2)

    def test_recovery_honors_batch_pause_cancel_and_new_round(self):
        first, first_episode = self.album("first")
        second, second_episode = self.album("second")
        put = self.ctx.store.put_doc

        def fail_receipt(doc):
            if isinstance(doc, WorkshopQueue) and doc.active_job:
                raise OSError("injected receipt failure")
            return put(doc)

        with patch.object(self.ctx.store, "put_doc", side_effect=fail_receipt):
            with self.assertRaises(OSError):
                self.ctx.queue.start([first, second])
        original = self.ctx.engine.list(owner=first_episode)[0]
        self.ctx.queue.hold(True)
        self.ctx.close()
        self.ctx = self.open_context()
        q = self.ctx.queue.advance()
        self.assertEqual(
            (q.active, q.active_job, q.lane, q.paused), (first, original["id"], [second], True)
        )
        self.ctx.engine.cancel(original["id"])
        q = self.ctx.queue.advance()
        self.assertIsNone(q.active_job)
        self.assertEqual(self.ctx.engine.list(owner=second_episode), [])
        q = self.ctx.queue.hold(False)
        self.assertEqual(q.active, second)
        self.ctx.engine.cancel(q.active_job)
        self.ctx.queue.advance()
        rerun = self.ctx.queue.start([first])
        self.assertNotEqual(rerun.active_job, original["id"])
        self.assertNotEqual(
            self.ctx.engine.get(rerun.active_job)["idempotency_key"], original["idempotency_key"]
        )
        self.assertEqual(len(self.ctx.engine.list(owner=first_episode)), 2)

    def test_reorder_does_not_overtake_accepted_but_unsaved_submission(self):
        first, first_episode = self.album("first")
        second, second_episode = self.album("second")
        put = self.ctx.store.put_doc

        def fail_receipt(doc):
            if isinstance(doc, WorkshopQueue) and doc.active_job:
                raise OSError("injected receipt failure")
            return put(doc)

        with patch.object(self.ctx.store, "put_doc", side_effect=fail_receipt):
            with self.assertRaises(OSError):
                self.ctx.queue.start([first, second])
        self.ctx.queue.set_order([second, first])
        q = self.ctx.queue.advance()
        self.assertEqual((q.active, q.lane), (first, [second]))
        self.assertEqual(len(self.ctx.engine.list(owner=first_episode)), 1)
        self.assertEqual(self.ctx.engine.list(owner=second_episode), [])

    def test_removed_cleared_or_forgotten_lane_token_is_not_reused(self):
        for command in ("remove", "clear", "forget"):
            with self.subTest(command=command):
                album_id, _ = self.album(command)
                with patch.object(self.ctx.queue, "_disk_critical", return_value=True):
                    q = self.ctx.queue.start([album_id])
                    token = q.lane_tokens[album_id]
                    if command == "clear":
                        self.ctx.queue.clear()
                    else:
                        getattr(self.ctx.queue, command)(album_id)
                    self.assertNotIn(album_id, self.ctx.queue.state().lane_tokens)
                    restarted = self.ctx.queue.start([album_id])
                    self.assertNotEqual(restarted.lane_tokens[album_id], token)
                    self.ctx.queue.clear()


class InstanceIsolationTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore(":memory:")
        self.addCleanup(self.store.close)
        self.pool = ResourcePool()
        self.ctx = SimpleNamespace(
            store=self.store,
            engine=SimpleNamespace(pool=self.pool),
            refresh_instances=lambda: self.pool.set_instances(self.store.list_docs("instance")),
        )

    def test_save_rejects_invalid_port(self):
        for url in (
            "http://fake:abc",
            "http://fake:65536",
            "http://fake:0",
            "http://fake:",
            "http:///missing",
            "http://:8188",
            "http://bad host",
            "http://bad%2fhost",
            "http://[broken",
            "http://::1:8188",
            "http://[::1]suffix",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                create_instance(self.ctx, ComfyInstance(id="bad", base_url=url))
        self.assertEqual(self.store.list_docs("instance"), [])

    def test_put_uses_same_save_boundary_and_preserves_old_instance_on_failure(self):
        create_instance(self.ctx, ComfyInstance(id="b", base_url="http://healthy"))
        with self.assertRaises(ValueError):
            put_instance(self.ctx, "b", ComfyInstance(base_url="http://fake:abc"))
        self.assertEqual(self.store.get_doc("instance", "b").base_url, "http://healthy")

    def test_valid_ipv6_and_default_ports_keep_stable_identity(self):
        for value, expected in (
            ("HTTP://HOST:80/", "http://host"),
            ("https://host:443/", "https://host"),
            ("http://[::1]:080/", "http://[::1]"),
            ("http://[::1]:8188/", "http://[::1]:8188"),
            ("http://host:8188/comfy/", "http://host:8188/comfy"),
        ):
            with self.subTest(value=value):
                self.assertEqual(normalize_endpoint(value), expected)

    def test_historical_bad_instance_does_not_block_healthy_plan_or_list(self):
        self.store.put_doc(ComfyInstance(id="b", base_url="http://healthy"))
        self.store.put_doc(ComfyInstance(id="a", base_url="http://fake:abc"))
        self.ctx.refresh_instances()
        candidate = Candidate("job", 0, COMFY, instances=("b",))
        self.assertEqual(self.pool.plan([candidate]), [(candidate, "b")])
        self.ctx.refresh_instances()
        listed = list_instances(self.ctx)
        self.assertEqual({row["id"] for row in listed["instances"]}, {"a", "b"})
        bad = next(row for row in listed["pool"]["instances"] if row["id"] == "a")
        self.assertFalse(bad["healthy"])
        self.assertTrue(bad["error"])
        self.pool.mark_health("a", True)
        self.assertFalse(self.pool.available(COMFY, "a"))
        self.assertEqual(self.pool.plan([Candidate("only-bad", 0, COMFY, instances=("a",))]), [])
        self.assertFalse(instance_health(self.ctx, "a")["ok"])
        create_instance(self.ctx, ComfyInstance(id="a", base_url="http://repaired"))
        self.assertTrue(self.pool.available(COMFY, "a"))

    def test_live_api_rejects_bad_save_and_lists_historical_bad_instance(self):
        with tempfile.TemporaryDirectory() as root:
            ctx = AppContext.create(
                root,
                autostart=False,
                seed_instance=False,
                llm_factory=FakeLLM,
                comfy_client_factory=FakeComfy,
            )
            try:
                client = TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1")
                response = client.post("/api/instances", json={"base_url": "http://fake:abc"})
                self.assertEqual(response.status_code, 400)
                ctx.store.put_doc(ComfyInstance(id="old", base_url="http://fake:abc"))
                ctx.refresh_instances()
                response = client.get("/api/instances")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["instances"][0]["id"], "old")
                self.assertFalse(response.json()["pool"]["instances"][0]["healthy"])
            finally:
                ctx.close()

    def test_invalid_reconfiguration_releases_old_captured_endpoint(self):
        self.store.put_doc(ComfyInstance(id="a", base_url="http://old"))
        self.store.put_doc(ComfyInstance(id="b", base_url="http://healthy"))
        self.ctx.refresh_instances()
        self.pool.acquire(COMFY, "a")
        self.assertEqual(self.pool.endpoint_active, {"http://old": 1})
        self.store.put_doc(ComfyInstance(id="a", base_url="http://fake:abc"))
        self.ctx.refresh_instances()
        candidate = Candidate("job", 0, COMFY, instances=("b",))
        self.assertEqual(self.pool.plan([candidate]), [(candidate, "b")])
        self.pool.release(COMFY, "a", "http://old")
        self.assertEqual(self.pool.endpoint_active, {})
        self.assertFalse(self.pool.available(COMFY, "a"))
