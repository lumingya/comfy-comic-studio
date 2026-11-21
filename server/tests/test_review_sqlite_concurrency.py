"""Keep every use of the shared jobs connection inside its serialization boundary."""

import threading
import unittest
from concurrent.futures import ThreadPoolExecutor

from mio_server.jobs import ItemSpec, JobEngine
from mio_server.jobs.dependencies import job_references

from .test_jobs import Recorder, drain


class CheckedCursor:
    def __init__(self, cursor, lock):
        self.cursor, self.lock = cursor, lock

    def check(self):
        if not self.lock._is_owned():
            raise AssertionError("shared SQLite cursor consumed outside engine.lock")

    def fetchone(self):
        self.check()
        return self.cursor.fetchone()

    def fetchall(self):
        self.check()
        return self.cursor.fetchall()

    def __iter__(self):
        while True:
            row = self.fetchone()
            if row is None:
                return
            yield row

    def __getattr__(self, name):
        return getattr(self.cursor, name)


class CheckedConnection:
    """Real SQLite connection; only report when a caller bypasses the shared lock."""

    def __init__(self, connection, lock):
        self.connection, self.lock = connection, lock

    def execute(self, *args, **kwargs):
        if not self.lock._is_owned():
            raise AssertionError("shared SQLite query executed outside engine.lock")
        return CheckedCursor(self.connection.execute(*args, **kwargs), self.lock)

    def __enter__(self):
        if not self.lock._is_owned():
            raise AssertionError("shared SQLite transaction entered outside engine.lock")
        self.connection.__enter__()
        return self

    def __exit__(self, *args):
        if not self.lock._is_owned():
            raise AssertionError("shared SQLite transaction left outside engine.lock")
        return self.connection.__exit__(*args)

    def __getattr__(self, name):
        return getattr(self.connection, name)


class SharedConnectionTests(unittest.TestCase):
    def make_engine(self):
        engine = JobEngine(":memory:", autostart=False)
        self.addCleanup(engine.close)
        executor = Recorder()
        executor.replay_safe = True
        engine.register("review", executor)
        return engine, executor

    def checked_connection(self, engine):
        engine.db = CheckedConnection(engine.db, engine.lock)

    def test_pending_delivery_uses_the_connection_lock(self):
        engine, _ = self.make_engine()
        job = engine.submit("review", [ItemSpec(input={"n": 0})])
        self.checked_connection(engine)
        # _record_delivery and exception classification call this without an outer DB lock.
        self.assertIsNone(engine._pending_delivery(job["id"], 0))

    def test_parallel_completion_and_reads_keep_shared_connection_serialized(self):
        engine, executor = self.make_engine()
        job = engine.submit("review", [ItemSpec(input={"n": i}) for i in range(24)], window=8)
        self.checked_connection(engine)
        done = drain(engine, job["id"])
        self.assertEqual(done["state"], "completed", done)
        self.assertEqual(len(executor.applied), 24)
        self.assertEqual(executor.calls, 24)
        self.assertEqual({item["attempts"] for item in done["items"]}, {1})
        self.assertEqual({row["state"] for row in engine.deliveries(job["id"])}, {"applied"})

    def test_dependency_iteration_snapshots_rows_before_yielding(self):
        engine, _ = self.make_engine()
        ref = {"point": "review", "id": "x", "source": "review", "digest": "a" * 64, "contract": 1}
        job = engine.submit(
            "review",
            [ItemSpec(input={"n": i, "dependencies": [ref]}) for i in range(3)],
            {"dependencies": [ref]},
        )
        self.checked_connection(engine)
        refs = job_references(engine, job["id"])
        workers = ThreadPoolExecutor(max_workers=1)
        try:
            self.assertEqual(next(refs), ref)
            # Pausing a consumer must not retain a live SQLite cursor or the engine lock.
            self.assertEqual(
                workers.submit(engine.get, job["id"]).result(timeout=2)["id"], job["id"]
            )
            self.assertEqual(list(refs), [ref] * 3)
        finally:
            refs.close()
            workers.shutdown()

    def test_result_callback_does_not_hold_the_connection_lock(self):
        engine, executor = self.make_engine()
        called = threading.Event()
        readers = ThreadPoolExecutor(max_workers=1)
        self.addCleanup(readers.shutdown)

        def completed(job, item, result):
            self.assertEqual(
                readers.submit(engine.get, job["id"]).result(timeout=2)["id"], job["id"]
            )
            called.set()

        executor.on_complete = completed
        self.checked_connection(engine)
        job = engine.submit("review", [ItemSpec(input={"n": 0})])
        self.assertEqual(drain(engine, job["id"])["state"], "completed")
        self.assertTrue(called.is_set())
