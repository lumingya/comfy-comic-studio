import logging
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from mio_server.jobs import (
    COMFY,
    Candidate,
    ExecError,
    ItemSpec,
    JobConflict,
    JobEngine,
    LeaseHeld,
    ResourcePool,
)


class Recorder:
    """Configurable fake executor."""

    def __init__(self, behaviour=None):
        self.behaviour = behaviour or (lambda ctx: {"ok": ctx.input["n"]})
        self.applied = []
        self.aborted = []
        self.calls = 0
        self.lock = threading.Lock()

    def execute(self, ctx):
        with self.lock:
            self.calls += 1
        return self.behaviour(ctx)

    def on_complete(self, job, item, result):
        self.applied.append((item["idx"], result))


logging.getLogger("mio.jobs").setLevel(logging.CRITICAL)


def drain(engine, job_id, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        engine.tick()
        job = engine.get(job_id)
        if job["state"] not in ("queued", "running"):
            return job
        time.sleep(0.01)
    raise TimeoutError(job_id)


def items(n, **kw):
    return [ItemSpec(input={"n": i}, **kw) for i in range(n)]


class EngineTests(unittest.TestCase):
    def make(self, **kw):
        engine = JobEngine(":memory:", poll=0.01, **kw)
        self.addCleanup(engine.close)
        return engine

    def test_complete_applies_results_once(self):
        engine, ex = self.make(), Recorder()
        engine.register("demo", ex)
        job = engine.submit("demo", items(3), {"episode": "e1"}, window=2)
        job = engine.wait(job["id"])
        self.assertEqual(job["state"], "completed")
        self.assertEqual(sorted(ex.applied), [(0, {"ok": 0}), (1, {"ok": 1}), (2, {"ok": 2})])
        self.assertEqual([i["result"] for i in job["items"]], [{"ok": 0}, {"ok": 1}, {"ok": 2}])

    def test_list_carries_item_counts(self):
        engine, ex = self.make(), Recorder()
        engine.register("demo", ex)
        job = engine.wait(engine.submit("demo", items(3), {"episode": "e1"})["id"])
        summary = engine.list()[0]
        self.assertEqual(summary["id"], job["id"])
        self.assertEqual((summary["done"], summary["total"], summary["failed"]), (3, 3, 0))
        self.assertNotIn("items", summary)
        self.assertEqual(engine.list(owner="nobody"), [])

    def test_idempotency_and_frozen_snapshot(self):
        engine = self.make(autostart=False)
        payload = {"prompt": "rain"}
        first = engine.submit("demo", [ItemSpec(input=payload)], {"v": 1}, idempotency_key="k1")
        payload["prompt"] = "changed later"
        self.assertEqual(engine.get(first["id"])["items"][0]["input"], {"prompt": "rain"})
        again = engine.submit(
            "demo", [ItemSpec(input={"prompt": "rain"})], {"v": 1}, idempotency_key="k1"
        )
        self.assertEqual(again["id"], first["id"])
        with self.assertRaises(JobConflict):
            engine.submit(
                "demo", [ItemSpec(input={"prompt": "other"})], {"v": 1}, idempotency_key="k1"
            )

    def test_safe_failure_is_not_retried_and_limit_pauses(self):
        engine = self.make()

        def fail(ctx):
            raise ExecError("bad workflow", kind="validation", sent=False)

        ex = Recorder(fail)
        engine.register("demo", ex)
        job = engine.submit("demo", items(5), failure_limit=2)
        job = engine.wait(job["id"])
        self.assertEqual(job["state"], "paused")
        self.assertTrue(job["error"])
        states = [i["state"] for i in job["items"]]
        self.assertEqual(states.count("failed"), 2)
        self.assertEqual(ex.calls, 2)  # never retried implicitly
        time.sleep(0.05)
        self.assertEqual(ex.calls, 2)

    def test_failure_after_send_is_uncertain_and_blocks(self):
        engine = self.make()
        mode = {"fail": True}

        def run(ctx):
            ctx.checkpoint("prompt-1")
            if mode["fail"]:
                raise ConnectionError("socket closed")
            return {"ok": True}

        ex = Recorder(run)
        engine.register("demo", ex)
        job = engine.wait(engine.submit("demo", items(2))["id"])
        self.assertEqual(job["state"], "blocked")
        self.assertEqual(job["items"][0]["state"], "uncertain")
        self.assertEqual(job["items"][0]["upstream"], "prompt-1")
        self.assertEqual(job["items"][1]["state"], "pending")  # blocked job stops dispatching
        with self.assertRaises(JobConflict):
            engine.retry(job["id"], indexes=[0])
        mode["fail"] = False
        engine.retry(job["id"], indexes=[0], confirm_uncertain=True)
        job = engine.wait(job["id"])
        self.assertEqual(job["state"], "completed")

    def test_immediate_stop_drops_late_result(self):
        engine = self.make()
        release = threading.Event()
        started = threading.Event()

        def slow(ctx):
            ctx.on_abort(lambda: ex.aborted.append(ctx.idx))
            ctx.mark_sent("p")
            started.set()
            release.wait(2)
            return {"late": True}

        ex = Recorder(slow)
        engine.register("demo", ex)
        job = engine.submit("demo", items(3))
        self.assertTrue(started.wait(2))
        job = engine.cancel(job["id"])
        self.assertEqual(job["state"], "canceled")
        self.assertEqual(ex.aborted, [0])
        self.assertEqual(job["items"][0]["error"]["kind"], "canceled_after_send")
        release.set()
        time.sleep(0.1)
        self.assertEqual(ex.applied, [])
        self.assertIn("stale_result", [e["type"] for e in engine.events(job["id"])])

    def test_window_limits_parallelism(self):
        engine = self.make(pool=ResourcePool(local_capacity=4))
        peak, live, lock = [0], [0], threading.Lock()

        def run(ctx):
            with lock:
                live[0] += 1
                peak[0] = max(peak[0], live[0])
            time.sleep(0.03)
            with lock:
                live[0] -= 1
            return {}

        engine.register("demo", Recorder(run))
        engine.wait(engine.submit("demo", items(6), window=2)["id"])
        self.assertEqual(peak[0], 2)

    def test_pause_resume_and_suffix_rerun(self):
        engine = self.make(autostart=False)
        ex = Recorder()
        engine.register("demo", ex)
        job = engine.submit("demo", items(3))
        engine.pause(job["id"])
        self.assertEqual(engine.tick(), 0)
        engine.resume(job["id"])
        job = drain(engine, job["id"])
        self.assertEqual(job["state"], "completed")
        engine.retry(job["id"], from_index=1, include_complete=True)
        self.assertEqual(
            [i["state"] for i in engine.get(job["id"])["items"]], ["complete", "pending", "pending"]
        )

    def test_restart_recovery_and_reconcile(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = str(Path(tmp) / "jobs.sqlite3")
            engine = JobEngine(db, autostart=False)
            job = engine.submit("demo", items(2), window=2)
            for idx, sent in ((0, True), (1, False)):
                ctx = engine._claim(Candidate(job["id"], idx, "local"), None)
                if sent:
                    ctx.checkpoint("prompt-7")
            with self.assertRaises(LeaseHeld):
                JobEngine(db, autostart=False)
            engine.close()

            class Reconciler(Recorder):
                def reconcile(self, ctx):
                    return {"from_history": ctx.upstream}

            again = JobEngine(db, autostart=False)
            try:  # close before the temp dir goes away (Windows cannot delete an open SQLite file)
                ex = Reconciler()
                again.register("demo", ex)
                job = again.get(job["id"])
                self.assertEqual([i["state"] for i in job["items"]], ["uncertain", "pending"])
                self.assertEqual(job["state"], "blocked")
                self.assertEqual(again.reconcile_all(), 1)
                job = again.get(job["id"])
                self.assertEqual(job["items"][0]["result"], {"from_history": "prompt-7"})
                self.assertEqual(ex.applied, [(0, {"from_history": "prompt-7"})])
                self.assertNotEqual(job["state"], "blocked")
            finally:
                again.close()

    def test_comfy_items_wait_for_an_instance(self):
        pool = ResourcePool()
        engine = self.make(pool=pool, autostart=False)
        engine.register("demo", Recorder())
        job = engine.submit("demo", items(1, resource=COMFY, group="ckptA"))
        self.assertEqual(engine.tick(), 0)
        pool.set_instances(
            [SimpleNamespace(id="gpu0", base_url="http://x", capacity=1, enabled=True, tags=[])]
        )
        self.assertEqual(engine.tick(), 1)
        job = engine.wait(job["id"])
        self.assertEqual(job["items"][0]["instance_id"], "gpu0")
        self.assertEqual(pool.snapshot()["instances"][0]["last_group"], "ckptA")


class PoolTests(unittest.TestCase):
    def test_model_group_affinity(self):
        pool = ResourcePool()
        pool.set_instances(
            [
                SimpleNamespace(id=i, base_url="http://x", capacity=1, enabled=True, tags=[])
                for i in ("a", "b")
            ]
        )
        pool.instances["a"].last_group = "illustrious"
        pool.instances["b"].last_group = "noob"
        cands = [
            Candidate("j", i, COMFY, g, (), (0, 0, i))
            for i, g in enumerate(["noob", "illustrious", "noob"])
        ]
        plan = {iid: c.group for c, iid in pool.plan(cands)}
        self.assertEqual(plan, {"a": "illustrious", "b": "noob"})

    def test_cold_instance_prefers_group_nobody_holds(self):
        pool = ResourcePool()
        pool.set_instances(
            [
                SimpleNamespace(id=i, base_url="http://x", capacity=1, enabled=True, tags=[])
                for i in ("a", "b")
            ]
        )
        pool.instances["a"].last_group = "x"
        pool.instances["a"].busy = 1
        cands = [
            Candidate("j", 0, COMFY, "x", (), (0, 0, 0)),
            Candidate("j", 1, COMFY, "y", (), (0, 0, 1)),
        ]
        self.assertEqual([(c.group, iid) for c, iid in pool.plan(cands)], [("y", "b")])

    def test_instance_restriction_and_disabled(self):
        pool = ResourcePool()
        pool.set_instances(
            [
                SimpleNamespace(id="a", base_url="http://x", capacity=2, enabled=True, tags=[]),
                SimpleNamespace(id="b", base_url="http://y", capacity=1, enabled=False, tags=[]),
            ]
        )
        cands = [
            Candidate("j", 0, COMFY, "g", ("b",), (0, 0, 0)),
            Candidate("j", 1, COMFY, "g", (), (0, 0, 1)),
        ]
        self.assertEqual([(c.idx, iid) for c, iid in pool.plan(cands)], [(1, "a")])


if __name__ == "__main__":
    unittest.main()
