"""Planning, management, retry and callbacks coordinate without reversing engine locks."""

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from mio_server.checkpoints import Checkpoints
from mio_server.checkpoints.models import CheckpointCreate
from mio_server.context import AppContext
from mio_server.jobs import ItemSpec, JobConflict
from mio_server.models import Episode, Series


class OperationGuardTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.ctx = AppContext.create(Path(tmp.name), autostart=False, seed_instance=False)
        self.addCleanup(self.ctx.close)
        self.engine = self.ctx.engine
        self.series = self.ctx.store.create_series(Series(title="Guarded"))
        self.ep = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="One", order=0)
        )

    def test_unrelated_owned_work_can_continue_but_unknown_owner_blocks(self):
        job = self.engine.submit("test", [ItemSpec({})], owner="another-work")
        with self.engine.operation_guard({self.ep.id}):
            pass
        with self.assertRaises(JobConflict):
            with self.engine.operation_guard():
                pass
        self.engine.cancel(job["id"])
        job = self.engine.submit("extension", [ItemSpec({})])
        with self.assertRaises(JobConflict):
            with self.engine.operation_guard({self.ep.id}):
                pass

    def test_callbacks_fail_fast_while_another_thread_holds_operation(self):
        finished, refused = threading.Event(), threading.Event()

        def callback():
            try:
                with self.engine.lock, self.engine._callback_scope():
                    self.engine.submit("followup", [ItemSpec({})], owner=self.ep.id)
            except JobConflict:
                refused.set()
            finally:
                finished.set()

        with self.engine.hold_operation():
            thread = threading.Thread(target=callback)
            thread.start()
            completed_inside_guard = finished.wait(1)
        thread.join(2)
        self.assertTrue(
            completed_inside_guard, "callback waited for operation while holding engine lock"
        )
        self.assertTrue(refused.is_set())
        self.assertEqual(self.engine.list(), [])

    def test_management_cannot_reenter_from_an_engine_listener(self):
        with self.engine.lock, self.engine._callback_scope():
            with self.assertRaisesRegex(JobConflict, "inside a job callback"):
                with self.engine.operation_guard({self.ep.id}):
                    self.fail("management entered while its caller still holds engine.lock")

    def test_retry_cannot_revive_a_finished_job_during_management(self):
        job = self.engine.submit("test", [ItemSpec({})], owner=self.ep.id)
        self.engine.cancel(job["id"])
        entered, done = threading.Event(), threading.Event()

        def retry():
            entered.set()
            self.engine.retry(job["id"])
            done.set()

        with self.engine.operation_guard({self.ep.id}):
            thread = threading.Thread(target=retry)
            thread.start()
            self.assertTrue(entered.wait(1))
            completed_inside_guard = done.wait(0.03)
        thread.join(2)
        self.assertFalse(completed_inside_guard)
        self.assertTrue(done.is_set())
        self.assertEqual(self.engine.get(job["id"])["state"], "queued")

    def test_restore_waits_for_render_planning_then_rejects_the_submitted_job(self):
        checkpoints = Checkpoints(self.ctx)
        saved = checkpoints.create(self.series.id, CheckpointCreate(name="Before"))
        expected_head = checkpoints.head(self.series.id)
        read, release, attempted, refused = (threading.Event() for _ in range(4))
        failures = []

        def plan(episode_id, **kwargs):
            episode = self.ctx.store.get_episode(episode_id)
            read.set()
            if not release.wait(2):
                raise RuntimeError("test did not release planning")
            return self.engine.submit("test", [ItemSpec({})], owner=episode.id)

        def render():
            try:
                self.ctx.render.render(self.ep.id)
            except Exception as exc:
                failures.append(exc)

        def restore():
            attempted.set()
            try:
                checkpoints.restore(self.series.id, saved.id, expected_head)
            except JobConflict:
                refused.set()
            except Exception as exc:
                failures.append(exc)

        with patch.object(self.ctx.render, "_render", side_effect=plan):
            planning = threading.Thread(target=render)
            planning.start()
            self.assertTrue(read.wait(1))
            management = threading.Thread(target=restore)
            management.start()
            self.assertTrue(attempted.wait(1))
            release.set()
            planning.join(3)
            management.join(3)
        self.assertFalse(planning.is_alive() or management.is_alive())
        self.assertEqual(failures, [])
        self.assertTrue(refused.is_set())
        self.assertEqual(len(checkpoints.list(self.series.id)), 1)
