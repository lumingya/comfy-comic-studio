"""Endpoint ownership survives cancellation, config changes and engine restarts."""

import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.jobs import (
    COMFY,
    Candidate,
    ExecError,
    ItemSpec,
    JobConflict,
    JobEngine,
    ResourcePool,
)
from mio_server.jobs.pool import normalize_endpoint


def instance(iid, url, capacity=3):
    return SimpleNamespace(id=iid, base_url=url, capacity=capacity, enabled=True)


def spec(*, exclusive=False, iid="a", resource=COMFY):
    payload = {"stages": [{"frontend_state": {"entries": [{"node": "1"}]}}]} if exclusive else {}
    return ItemSpec(payload, resource=resource, instances=(iid,) if resource == COMFY else ())


class BarrierExecutor:
    def __init__(self, *, release_lease=False, fail=False):
        self.started = threading.Event()
        self.release = threading.Event()
        self.contexts = []
        self.release_lease = release_lease
        self.fail = fail
        self.applied = []
        self.recovered = []
        self.report = {"restored": True, "status": "restored", "result": None, "error": None}

    def execute(self, ctx):
        self.contexts.append(ctx)
        self.started.set()
        if not self.release.wait(5):
            raise AssertionError("test worker was not released")
        if self.release_lease and ctx.state_lease:
            ctx.engine.state_leases.release(ctx.state_lease["token"])
        if self.fail:
            raise ExecError("needs cleanup", sent=True)
        return {"ok": True}

    def recover_state(self, ctx, record, *, confirm_stopped=False):
        self.recovered.append((ctx.instance.base_url, record, confirm_stopped))
        return self.report

    def on_complete(self, job, item, result):
        self.applied.append(result)


class StateLeaseTests(unittest.TestCase):
    def make(self, instances=None, **kw):
        pool = ResourcePool()
        pool.set_instances(instances or [instance("a", "http://old:8188")])
        engine = JobEngine(pool=pool, autostart=False, **kw)
        self.addCleanup(engine.close)
        return engine

    def worker(self, engine, **kw):
        worker = BarrierExecutor(**kw)
        engine.register("test", worker)
        self.addCleanup(worker.release.set)
        return worker

    def submit(self, engine, **kw):
        return engine.submit("test", [spec(**kw)])["id"]

    def idle(self, engine):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            with engine.lock:
                if not engine.running:
                    return
            time.sleep(0.005)
        self.fail("workers did not finish")

    def test_endpoint_identity_and_exclusive_planning_across_aliases(self):
        pool = ResourcePool()
        pool.set_instances([instance("a", "HTTP://HOST:80/"), instance("b", "http://host")])
        self.assertEqual(normalize_endpoint("HTTP://HOST:80/"), "http://host")
        exclusive = Candidate("exclusive", 0, COMFY, instances=("a",), exclusive=True)
        normal = Candidate("normal", 0, COMFY, instances=("b",))
        self.assertEqual(pool.plan([exclusive, normal]), [(exclusive, "a")])
        pool.acquire(COMFY, "b")
        self.assertEqual(pool.plan([exclusive]), [])
        pool.release(COMFY, "b", "http://host")
        self.assertEqual(pool.plan([exclusive]), [(exclusive, "a")])

    def test_plan_accounts_for_normal_chosen_before_exclusive(self):
        pool = ResourcePool()
        pool.set_instances([instance("a", "http://host"), instance("b", "http://host/")])
        normal = Candidate("normal", 0, COMFY, instances=("a",))
        exclusive = Candidate("exclusive", 0, COMFY, instances=("b",), exclusive=True)
        self.assertEqual(pool.plan([normal, exclusive]), [(normal, "a")])

    def test_worker_and_durable_blocks_are_separate(self):
        engine = self.make([instance("a", "http://host"), instance("b", "http://host/")])
        worker = self.worker(engine, fail=True)
        exclusive = self.submit(engine, exclusive=True)
        normal = self.submit(engine, iid="b")
        self.assertEqual(engine.tick(), 1)
        self.assertTrue(worker.started.wait(2))
        lease = engine.state_leases.get(exclusive, 0)
        self.assertIsNotNone(lease)
        self.assertEqual(worker.contexts[0].state_lease, lease)
        self.assertEqual(engine.tick(), 0)
        worker.release.set()
        self.idle(engine)
        self.assertEqual(engine.pool.endpoint_active, {})
        self.assertEqual(engine.tick(), 0)
        self.assertEqual(engine.get(normal)["items"][0]["state"], "pending")
        self.assertTrue(engine.state_leases.release(lease["token"]))
        self.assertEqual(engine.tick(), 1)
        self.idle(engine)

    def test_other_endpoint_and_local_work_remain_parallel(self):
        engine = self.make([instance("a", "http://one"), instance("b", "http://two")])
        worker = self.worker(engine)
        exclusive = self.submit(engine, exclusive=True)
        self.submit(engine, iid="b")
        self.submit(engine, resource="local")
        self.assertEqual(engine.tick(), 3)
        self.assertTrue(worker.started.wait(2))
        self.assertIsNotNone(engine.state_leases.get(exclusive, 0))
        worker.release.set()
        self.idle(engine)
        self.assertEqual(len(worker.contexts), 3)

    def test_normal_worker_prevents_exclusive_claim_after_url_change(self):
        engine = self.make()
        worker = self.worker(engine)
        self.submit(engine)
        self.assertEqual(engine.tick(), 1)
        self.assertTrue(worker.started.wait(2))
        engine.pool.set_instances(
            [instance("a", "http://new:8188"), instance("b", "http://old:8188/")]
        )
        exclusive = self.submit(engine, exclusive=True, iid="b")
        self.assertEqual(engine.tick(), 0)
        worker.release.set()
        self.idle(engine)
        self.assertEqual(engine.pool.endpoint_active, {})
        self.assertEqual(worker.contexts[0].instance.base_url, "http://old:8188")
        self.assertEqual(engine.tick(), 1)
        self.idle(engine)
        self.assertIsNotNone(engine.state_leases.get(exclusive, 0))

    def test_removed_worker_releases_captured_endpoint(self):
        engine = self.make()
        worker = self.worker(engine)
        self.submit(engine)
        engine.tick()
        self.assertTrue(worker.started.wait(2))
        engine.pool.set_instances([instance("b", "http://old:8188")])
        self.submit(engine, exclusive=True, iid="b")
        self.assertEqual(engine.tick(), 0)
        worker.release.set()
        self.idle(engine)
        self.assertEqual(engine.tick(), 1)
        self.idle(engine)
        self.assertNotIn("a", engine.pool.instances)

    def test_restart_keeps_presend_lease_uncertain_and_other_jobs_blocked(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "jobs.sqlite"
            first = self.make(path=path)
            job = first.submit("test", [spec(exclusive=True), spec()], window=2)["id"]
            ctx = first._claim(Candidate(job, 0, COMFY), "a")
            token = ctx.state_lease["token"]
            first.state_leases.update(token, {"phase": "snapshot", "entries": [{"value": "old"}]})
            first.close()
            second = self.make(path=path)
            try:
                self.worker(second)
                self.assertEqual(
                    [item["state"] for item in second.get(job)["items"]], ["uncertain", "pending"]
                )
                lease = second.state_leases.get(job, 0)
                self.assertEqual(lease["token"], token)
                self.assertEqual(lease["data"]["phase"], "snapshot")
                self.submit(second)
                self.assertEqual(second.tick(), 0)
                self.assertEqual(second.reconcile_all(), 0)
                self.assertEqual(second.executors["test"].recovered, [])
            finally:
                second.close()

    def failed_lease(self, engine):
        worker = self.worker(engine, fail=True)
        job = self.submit(engine, exclusive=True)
        engine.tick()
        worker.release.set()
        self.idle(engine)
        return job, worker, engine.state_leases.get(job, 0)

    def test_retry_resolve_and_delete_cannot_erase_a_lease(self):
        engine = self.make()
        job, worker, lease = self.failed_lease(engine)
        for action in (
            lambda: engine.retry(job, confirm_uncertain=True),
            lambda: engine.resolve(job, 0, "failed"),
            lambda: engine.resolve(job, 0, "complete", {"ok": True}),
            lambda: engine.delete(job),
        ):
            with self.assertRaises(JobConflict):
                action()
        engine.cancel(job)
        with self.assertRaises(JobConflict):
            engine.retry(job, confirm_uncertain=True)
        with self.assertRaises(JobConflict):
            engine.delete(job)
        self.assertEqual(engine.state_leases.get(job, 0), lease)

    def test_cancel_keeps_token_valid_and_restore_never_adopts(self):
        engine = self.make()
        worker = self.worker(engine, fail=True)
        job = self.submit(engine, exclusive=True)
        engine.tick()
        self.assertTrue(worker.started.wait(2))
        token = worker.contexts[0].state_lease["token"]
        engine.cancel(job)
        engine.state_leases.update(token, {"phase": "restoring"})
        with self.assertRaises(JobConflict):
            engine.restore_state(job, 0, confirm_stopped=True)
        worker.release.set()
        self.idle(engine)
        worker.report["result"] = {"image": "must-not-adopt"}
        engine.pool.set_instances([instance("a", "http://new:8188")])
        report = engine.restore_state(job, 0, confirm_stopped=True)
        self.assertTrue(report["restored"])
        self.assertEqual(worker.recovered[0][0], "http://old:8188")
        self.assertTrue(worker.recovered[0][2])
        self.assertEqual(engine.get(job)["items"][0]["state"], "canceled")
        self.assertEqual(worker.applied, [])
        self.assertIsNone(engine.state_leases.get(job, 0))

    def test_restore_miss_retains_block_and_confirmed_result_applies_once(self):
        engine = self.make()
        job, worker, lease = self.failed_lease(engine)
        worker.report = {"restored": False, "status": "running"}
        self.assertFalse(engine.restore_state(job, 0)["restored"])
        self.assertEqual(engine.state_leases.get(job, 0), lease)
        worker.report = {"restored": True, "status": "restored", "result": {"image": "saved"}}
        self.assertEqual(engine.resolve(job, 0, "reconcile")["items"][0]["state"], "complete")
        self.assertEqual(worker.applied, [{"image": "saved"}])
        self.assertIsNone(engine.state_leases.get(job, 0))
        with self.assertRaises(JobConflict):
            engine.restore_state(job, 0)

    def test_restore_without_result_allows_explicit_retry(self):
        engine = self.make()
        job, worker, lease = self.failed_lease(engine)
        engine.restore_state(job, 0)
        item = engine.get(job)["items"][0]
        self.assertEqual(item["state"], "failed")
        self.assertEqual(item["error"]["kind"], "state_restored")
        self.assertEqual(engine.retry(job)["items"][0]["state"], "pending")

    def test_failed_item_cleanup_does_not_adopt_result(self):
        engine = self.make()
        job, worker, lease = self.failed_lease(engine)
        with engine.lock, engine.db:
            engine.db.execute("UPDATE job_items SET state = 'failed' WHERE job_id = ?", (job,))
        worker.report["result"] = {"ok": True}
        engine.restore_state(job, 0)
        self.assertEqual(engine.get(job)["items"][0]["state"], "failed")
        self.assertEqual(worker.applied, [])
        self.assertIsNone(engine.state_leases.get(job, 0))

    def test_update_replaces_data_and_stale_token_cannot_release_new_lease(self):
        engine = self.make()
        job, worker, old = self.failed_lease(engine)
        engine.state_leases.update(old["token"], {"old": True, "phase": "first"})
        updated = engine.state_leases.update(old["token"], {"phase": "second"})
        self.assertEqual(updated["data"], {"phase": "second"})
        engine.state_leases.release(old["token"])
        engine.retry(job, confirm_uncertain=True)
        engine.tick()
        self.idle(engine)
        new = engine.state_leases.get(job, 0)
        self.assertNotEqual(new["token"], old["token"])
        self.assertFalse(engine.state_leases.release(old["token"]))
        with self.assertRaises(JobConflict):
            engine.state_leases.update(old["token"], {})
        self.assertEqual(engine.state_leases.get(job, 0), new)
        self.assertEqual(engine.pool.state_blocks[new["endpoint"]], new["token"])

    def test_lease_blocks_original_url_after_instance_reconfiguration(self):
        engine = self.make()
        job, worker, lease = self.failed_lease(engine)
        engine.pool.set_instances(
            [instance("a", "http://new:8188"), instance("b", "http://old:8188")]
        )
        self.submit(engine, iid="b")
        self.submit(engine)
        self.assertEqual(engine.tick(), 1)
        self.idle(engine)
        engine.pool.set_instances([instance("b", "http://old:8188")])
        self.assertEqual(engine.tick(), 0)
        self.assertEqual(engine.state_leases.get(job, 0), lease)

    def test_claim_rechecks_endpoint_after_configuration_changes_during_plan(self):
        for change in ("repoint", "remove", "reduce_capacity"):
            with self.subTest(change=change):
                engine = self.make([instance("a", "http://one"), instance("b", "http://two")])
                worker = self.worker(engine, fail=True)
                self.submit(engine, exclusive=True)
                self.assertEqual(engine.tick(), 1)
                self.assertTrue(worker.started.wait(2))
                self.submit(engine, iid="b")
                original = engine.pool.plan

                def configure_after_plan(candidates):
                    planned = original(candidates)
                    fresh = [instance("a", "http://one")]
                    if change == "repoint":
                        fresh.append(instance("b", "http://one/"))
                    elif change == "reduce_capacity":
                        fresh.append(instance("b", "http://two", capacity=0))
                    engine.pool.set_instances(fresh)
                    return planned

                with patch.object(engine.pool, "plan", side_effect=configure_after_plan):
                    self.assertEqual(engine.tick(), 0)
                worker.release.set()
                self.idle(engine)
                self.assertEqual(len(worker.contexts), 1)

    def test_mixed_capacity_aliases_preserve_normal_parallelism_and_exclusion(self):
        pool = ResourcePool()
        pool.set_instances(
            [instance("a", "http://host", capacity=1), instance("b", "http://HOST:80/", capacity=5)]
        )
        exclusive = Candidate("exclusive", 0, COMFY, instances=("a",), exclusive=True)
        normal = [Candidate("normal", idx, COMFY, instances=("b",)) for idx in range(5)]
        plan = pool.plan([exclusive, *normal])
        self.assertEqual(plan, [(cand, "b") for cand in normal])
        self.assertEqual(pool.plan([exclusive]), [(exclusive, "a")])

    def test_claim_rollback_clears_runtime_ownership_and_capacity(self):
        for failure in ("context", "commit"):
            with self.subTest(failure=failure):
                engine = self.make()
                job = self.submit(engine, exclusive=True)
                real_db = engine.db

                class FailedCommit:
                    def __getattr__(self, name):
                        return getattr(real_db, name)

                    def __enter__(self):
                        return real_db.__enter__()

                    def __exit__(self, typ, value, traceback):
                        if typ is None:
                            real_db.rollback()
                            raise sqlite3.OperationalError("injected commit failure")
                        return real_db.__exit__(typ, value, traceback)

                if failure == "commit":
                    with patch.object(engine, "db", FailedCommit()):
                        with self.assertRaises(sqlite3.OperationalError):
                            engine._claim(Candidate(job, 0, COMFY), "a")
                else:
                    with patch.object(
                        engine, "_context", side_effect=RuntimeError("context failed")
                    ):
                        with self.assertRaises(RuntimeError):
                            engine._claim(Candidate(job, 0, COMFY), "a")
                self.assertEqual(engine.get(job)["items"][0]["state"], "pending")
                self.assertIsNone(engine.state_leases.get(job, 0))
                self.assertEqual(engine.pool.state_blocks, {})
                self.assertEqual(engine.pool.endpoint_active, {})
                self.assertEqual(engine.pool.instances["a"].busy, 0)
                self.assertEqual(engine.running, {})

    def test_canceled_before_executor_starts_releases_only_empty_reservation(self):
        for data in ({}, {"phase": "snapshot"}):
            with self.subTest(data=data):
                engine = self.make()
                worker = self.worker(engine)
                job = self.submit(engine, exclusive=True)
                ctx = engine._claim(Candidate(job, 0, COMFY), "a")
                if data:
                    engine.state_leases.update(ctx.state_lease["token"], data)
                engine.cancel(job)
                engine._run(ctx, COMFY, "a")
                self.assertEqual(worker.contexts, [])
                self.assertEqual(engine.get(job)["items"][0]["state"], "canceled")
                self.assertEqual(engine.pool.endpoint_active, {})
                self.assertEqual(bool(engine.state_leases.get(job, 0)), bool(data))

    def test_normal_uncertain_worker_does_not_claim_durable_remote_ownership(self):
        engine = self.make()
        worker = self.worker(engine, fail=True)
        normal = self.submit(engine)
        engine.tick()
        worker.release.set()
        self.idle(engine)
        self.assertEqual(engine.get(normal)["items"][0]["state"], "uncertain")
        self.assertEqual(engine.pool.endpoint_active, {})
        # The PCP executor must check the upstream queue before modifying its state.
        # The resource pool cannot infer remote completion from a released local worker.
        exclusive = self.submit(engine, exclusive=True)
        self.assertEqual(engine.tick(), 1)
        self.idle(engine)
        self.assertIsNotNone(engine.state_leases.get(exclusive, 0))

    def test_restored_result_lease_released_only_after_terminal_result_is_saved(self):
        for outcome in ("complete", "apply_failed", "canceled", "uncertain"):
            with self.subTest(outcome=outcome):
                engine = self.make()
                worker = self.worker(engine)
                job = self.submit(engine, exclusive=True)
                ctx = engine._claim(Candidate(job, 0, COMFY), "a")

                def execute(context):
                    engine.state_leases.update(
                        context.state_lease["token"],
                        {"phase": "restored", "result": {"image": "persisted"}},
                    )
                    if outcome == "canceled":
                        engine.cancel(job)
                    elif outcome == "uncertain":
                        raise ExecError("post-restore failure", sent=True)
                    return {"image": "persisted"}

                def apply(job_record, item, result):
                    self.assertIsNotNone(engine.state_leases.get(job, 0))
                    if outcome == "apply_failed":
                        raise RuntimeError("saving result failed")
                    worker.applied.append(result)

                with patch.object(worker, "execute", side_effect=execute):
                    with patch.object(worker, "on_complete", side_effect=apply):
                        engine._run(ctx, COMFY, "a")
                state = "failed" if outcome == "apply_failed" else outcome
                self.assertEqual(engine.get(job)["items"][0]["state"], state)
                self.assertEqual(bool(engine.state_leases.get(job, 0)), outcome == "uncertain")
                self.assertEqual(len(worker.applied), int(outcome == "complete"))

    def test_failed_finish_preserves_restored_result_journal_for_restart(self):
        engine = self.make()
        worker = self.worker(engine)
        job = self.submit(engine, exclusive=True)
        ctx = engine._claim(Candidate(job, 0, COMFY), "a")

        def execute(context):
            engine.state_leases.update(
                context.state_lease["token"],
                {"phase": "restored", "result": {"image": "persisted"}},
            )
            return {"image": "persisted"}

        with patch.object(worker, "execute", side_effect=execute):
            with patch.object(engine, "_finish", side_effect=sqlite3.OperationalError("disk full")):
                with self.assertRaises(sqlite3.OperationalError):
                    engine._run(ctx, COMFY, "a")
        self.assertEqual(engine.get(job)["items"][0]["state"], "running")
        self.assertEqual(engine.state_leases.get(job, 0)["data"]["result"], {"image": "persisted"})
        self.assertEqual(engine.pool.endpoint_active, {})
        self.assertEqual(engine.running, {})


if __name__ == "__main__":
    unittest.main()
