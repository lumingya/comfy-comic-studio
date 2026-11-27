"""Executor identities survive layering and restart without silently generating again."""

import json
import shutil
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.backups import Backups
from mio_server.backups.database import logical_head, validate_databases
from mio_server.backups.models import BackupOptions
from mio_server.context import AppContext
from mio_server.jobs import Candidate, ExecError, ItemSpec, JobConflict, JobEngine, JobError
from mio_server.jobs.executors import RebindExecutor

from .api_harness import LOCAL, ApiCase
from .test_jobs import drain

A, B = "a" * 64, "b" * 64


class Recorder:
    replay_safe = True

    def __init__(self, marker="old", *, fail=False):
        self.marker, self.fail = marker, fail
        self.calls, self.applied, self.reconciled, self.aborted = [], [], [], []

    def execute(self, ctx):
        self.calls.append(ctx.input)
        ctx.on_abort(lambda: self.aborted.append(ctx.idx))
        if self.fail:
            ctx.mark_sent("saved-request")
            raise ExecError("unknown upstream result", sent=True)
        return {"marker": self.marker}

    def on_complete(self, job, item, result):
        self.applied.append((item["delivery_id"], result))

    def reconcile(self, ctx):
        self.reconciled.append(ctx.upstream)
        return {"marker": self.marker}


def claim(engine, job):
    return engine._claim(Candidate(job["id"], 0, "local", "", (), (0, 0, 0)), None)


def extension(root, name="demo", extra="", marker="old"):
    folder = root / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "mio-extension.json").write_text(
        json.dumps({"id": name, "name": name, "main": "main.py"}), encoding="utf-8"
    )
    (folder / "main.py").write_text(
        "class Count:\n"
        "    replay_safe = True\n"
        "    def execute(self, ctx):\n"
        f"        return {{'marker': {marker!r}}}\n"
        "def activate(mio):\n"
        "    mio.contribute('job_executor', 'demo', Count(), replace=True)\n"
        "    mio.hook('prompt.compiled', lambda value, **kw: value)\n" + extra,
        encoding="utf-8",
    )
    return folder


class ExecutorTests(unittest.TestCase):
    def make(self, path=":memory:"):
        engine = JobEngine(path, autostart=False)
        self.addCleanup(engine.close)
        return engine

    def register(self, engine, executor=None, *, source="ext:demo", digest=A):
        executor = executor or Recorder()
        engine.register("demo", executor, source=source, digest=digest, resources=("local",))
        return executor

    def submit(self, engine):
        return engine.submit("demo", [ItemSpec({})])

    def test_unknown_kind_never_silently_binds_when_registered_later(self):
        engine = self.make()
        job = self.submit(engine)
        self.assertEqual(job["state"], "blocked")
        self.assertEqual(job["executor"]["reason"], "executor_unbound")
        executor = self.register(engine)
        self.assertEqual(engine.tick(), 0)
        self.assertEqual(executor.calls, [])
        self.assertEqual(engine.get(job["id"])["items"][0]["attempts"], 0)
        ref = engine.current_executor("demo").ref
        engine.rebind_executor(job["id"], RebindExecutor(expected=None, target=ref))
        self.assertEqual(drain(engine, job["id"])["state"], "completed")
        self.assertEqual(len(executor.calls), 1)

    def test_queued_jobs_keep_their_loaded_lower_layer_and_disable_restores_fallback(self):
        engine = self.make()
        old = self.register(engine, source="builtin")
        before = self.submit(engine)
        new = self.register(engine, Recorder("new"), source="ext:demo", digest=B)
        after = self.submit(engine)
        self.assertIs(engine.registry.get("job_executor", "demo"), new)
        self.assertEqual([i.current for i in engine.executor_catalog()], [False, True])
        self.assertEqual(drain(engine, before["id"])["items"][0]["result"], {"marker": "old"})
        self.assertEqual(drain(engine, after["id"])["items"][0]["result"], {"marker": "new"})
        self.assertEqual((len(old.calls), len(new.calls)), (1, 1))
        engine.registry.unregister_source("ext:demo")
        engine.refresh_executor_jobs()
        self.assertIs(engine.executors["demo"], old)

    def test_claim_freezes_execution_completion_and_abort_object(self):
        engine = self.make()
        old = self.register(engine)
        job = self.submit(engine)
        item = claim(engine, job)
        with self.assertRaises(JobConflict):
            self.register(engine, Recorder("new"), digest=B)
        # Even an unsupported internal registry mutation cannot misroute an in-flight callback.
        new = Recorder("new")
        engine.registry.register(
            "job_executor",
            "demo",
            new,
            source="ext:other",
            replace=True,
            executor_contract=1,
            digest=B,
            resources=("local",),
        )
        engine._run(item, "local", None)
        self.assertEqual((len(old.calls), len(old.applied)), (1, 1))
        self.assertEqual((new.calls, new.applied), ([], []))
        another = engine.submit("demo", [ItemSpec({})])
        ctx = claim(engine, another)
        new.execute(ctx)
        engine.cancel(another["id"])
        self.assertEqual(new.aborted, [0])
        self.assertEqual(old.aborted, [])

    def test_restart_missing_digest_does_not_execute_until_exact_identity_returns(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "jobs.db"
            first = self.make(path)
            self.register(first)
            job = self.submit(first)
            first.close()
            second = self.make(path)
            wrong = self.register(second, Recorder("wrong"), digest=B)
            self.assertEqual(second.get(job["id"])["state"], "blocked")
            self.assertEqual(second.get(job["id"])["executor"]["reason"], "executor_missing")
            self.assertEqual(second.tick(), 0)
            self.assertEqual(wrong.calls, [])
            exact = self.register(second)
            self.assertEqual(drain(second, job["id"])["state"], "completed")
            self.assertEqual(len(exact.calls), 1)
            second.close()

    def test_replay_restart_uses_exact_digest_and_never_executes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "jobs.db"
            first = self.make(path)
            self.register(first)
            job = self.submit(first)
            ctx = claim(first, job)
            first._record_delivery(first._item_row(job["id"], 0), {"marker": "saved"})
            first.close()
            missing = self.make(path)
            wrong = self.register(missing, Recorder("wrong"), digest=B)
            self.assertEqual(missing.recover_deliveries(), 0)
            with self.assertRaises(JobConflict):
                missing.replay_result(job["id"], 0)
            with self.assertRaises(JobConflict):
                missing.retry(job["id"], confirm_uncertain=True)
            self.assertEqual((wrong.calls, wrong.applied), ([], []))
            # A missing old identity must not pin an unrelated new version in place.
            right = self.register(missing)
            self.assertEqual(missing.recover_deliveries(), 1)
            self.assertEqual(right.calls, [])
            self.assertEqual(right.applied, [(f"{job['id']}:0:{ctx.attempt}", {"marker": "saved"})])
            self.assertEqual(missing.get(job["id"])["state"], "completed")
            missing.close()

    def test_replay_requires_explicit_declaration_even_with_correct_identity(self):
        engine = self.make()
        executor = self.register(engine)
        executor.replay_safe = False
        job = self.submit(engine)
        ctx = claim(engine, job)
        with patch.object(executor, "on_complete", side_effect=RuntimeError("disk full")):
            engine._finish(job["id"], 0, ctx.epoch, "complete", {"saved": True}, apply=True)
        engine.running.clear()
        with self.assertRaisesRegex(JobConflict, "replay-safe"):
            engine.replay_result(job["id"], 0)
        self.assertEqual(engine.recover_deliveries(), 0)

    def test_reconcile_uses_original_loaded_layer_and_blocks_its_removal(self):
        engine = self.make()
        old = self.register(engine, Recorder(fail=True), source="builtin")
        job = self.submit(engine)
        new = self.register(engine, Recorder("new"), digest=B)
        self.assertEqual(drain(engine, job["id"])["state"], "blocked")
        with self.assertRaises(JobConflict):
            engine.ensure_executor_source_idle("builtin")
        resolved = engine.resolve(job["id"], 0, "reconcile")
        self.assertEqual(resolved["items"][0]["result"], {"marker": "old"})
        self.assertEqual(old.reconciled, ["saved-request"])
        self.assertEqual((new.reconciled, new.applied), ([], []))

    def test_rebind_requires_expected_identity_zero_attempts_and_matching_resources(self):
        engine = self.make()
        self.register(engine)
        job = self.submit(engine)
        previous = engine.executor_ref(job["id"])
        self.register(engine, digest=B)
        target = engine.current_executor("demo").ref
        with self.assertRaisesRegex(JobConflict, "binding changed"):
            engine.rebind_executor(job["id"], RebindExecutor(expected=None, target=target))
        engine.rebind_executor(job["id"], RebindExecutor(expected=previous, target=target))
        self.assertEqual(drain(engine, job["id"])["state"], "completed")
        with self.assertRaisesRegex(JobConflict, "zero attempts"):
            engine.rebind_executor(job["id"], RebindExecutor(expected=target, target=target))
        engine.register("gpu", Recorder(), source="ext:gpu", digest=A, resources=("comfy",))
        with self.assertRaises(JobError):
            engine.submit("gpu", [ItemSpec({})])
        incompatible = engine.submit("unknown", [ItemSpec({}, resource="comfy")])
        engine.register("unknown", Recorder(), source="ext:test", digest=A, resources=("local",))
        with self.assertRaisesRegex(JobConflict, "resources"):
            engine.rebind_executor(
                incompatible["id"],
                RebindExecutor(expected=None, target=engine.current_executor("unknown").ref),
            )

    def test_registry_requires_executor_contract_and_cannot_create_new_resource_pools(self):
        engine = self.make()
        with self.assertRaises(JobError):
            engine.register("demo", object())
        with self.assertRaises(JobError):
            engine.register("demo", Recorder(), resources=("remote",))
        engine.registry.register("job_executor", "demo", Recorder())
        self.assertEqual(self.submit(engine)["executor"]["reason"], "executor_unbound")
        self.assertEqual(engine.tick(), 0)

    def test_state_recovery_calls_original_loaded_executor(self):
        engine = self.make()
        recovered = []
        old = Recorder()
        old.recover_state = lambda ctx, record, **kw: (
            recovered.append(ctx.executor_binding.ref.source)
            or {"restored": True, "result": {"marker": "restored"}}
        )
        self.register(engine, old, source="builtin")
        job = self.submit(engine)
        new = self.register(engine, Recorder("new"), digest=B)
        ctx = claim(engine, job)
        with engine.lock, engine.pool.lock, engine.db:
            engine.state_leases._reserve(job["id"], 0, ctx.epoch, "http://fake")
        engine.running.clear()
        engine._finish(job["id"], 0, ctx.epoch, "uncertain")
        engine.restore_state(job["id"], 0)
        self.assertEqual(recovered, ["builtin"])
        self.assertEqual(len(old.applied), 1)
        self.assertEqual(new.applied, [])

    def test_recovery_callback_and_retry_cannot_deadlock_on_reversed_locks(self):
        engine = self.make()
        entered, retry_waiting = threading.Event(), threading.Event()
        failures = {}
        executor = self.register(engine)

        def recover(ctx, record, **kwargs):
            entered.set()
            if not retry_waiting.wait(2):
                raise AssertionError("retry did not reach the result guard")
            engine.submit("followup", [ItemSpec({})])
            return {"restored": True}

        executor.recover_state = recover
        job = self.submit(engine)
        engine.cancel(job["id"])
        with engine.lock, engine.pool.lock, engine.db:
            engine.state_leases._reserve(job["id"], 0, 0, "http://fake")

        class BoundedGuard:
            # Same RLock, bounded only so a regression cannot leave deadlocked test threads.
            def __init__(self):
                self.lock = threading.RLock()

            def acquire(self, blocking=True):
                if threading.current_thread().name == "executor-test-retry":
                    retry_waiting.set()
                return self.lock.acquire(timeout=1) if blocking else self.lock.acquire(False)

            def release(self):
                self.lock.release()

        engine._job_guards[job["id"]] = (BoundedGuard(), 0)

        def run(name, fn):
            try:
                fn()
            except Exception as exc:
                failures[name] = exc

        recovery = threading.Thread(
            target=run, args=("recover", lambda: engine.restore_state(job["id"], 0))
        )
        retry = threading.Thread(
            name="executor-test-retry", target=run, args=("retry", lambda: engine.retry(job["id"]))
        )
        recovery.start()
        self.assertTrue(entered.wait(2))
        retry.start()
        recovery.join(3)
        retry.join(3)
        self.assertFalse(recovery.is_alive() or retry.is_alive())
        self.assertIsInstance(failures.get("recover"), JobConflict)
        self.assertIsInstance(failures.get("retry"), JobConflict)
        self.assertEqual(len(engine.list()), 1)


class ExecutorExtensionTests(ApiCase):
    def enable(self, name="demo"):
        manager = self.ctx.extensions
        return manager.enable(name, manager.info(name).digest)

    def test_disable_refuses_running_uncertain_delivery_and_state_lease_then_falls_back(self):
        manager, engine = self.ctx.extensions, self.ctx.engine
        original = Recorder("builtin")
        engine.register("demo", original, source="builtin", digest=A)
        extension(manager.root)
        self.enable()
        identity = engine.current_executor("demo").ref
        job = engine.submit("demo", [ItemSpec({})])
        ctx = claim(engine, job)
        with self.assertRaises(JobConflict):
            manager.disable("demo")
        self.assertTrue(self.ctx.settings().extensions["demo"].enabled)
        engine.running.clear()
        engine._finish(job["id"], 0, ctx.epoch, "uncertain", error={"kind": "test"})
        with self.assertRaises(JobConflict):
            self.enable()
        engine._record_delivery(engine._item_row(job["id"], 0), {"saved": True})
        with engine.lock, engine.db:
            engine.db.execute("UPDATE job_items SET state='failed' WHERE job_id=?", (job["id"],))
        with self.assertRaises(JobConflict):
            manager.unload("demo")
        engine.cancel(job["id"])
        with engine.lock, engine.pool.lock, engine.db:
            record = engine.state_leases._reserve(job["id"], 0, ctx.epoch, "http://fake")
        with self.assertRaises(JobConflict):
            manager.disable("demo")
        engine.state_leases.release(record["token"])
        manager.disable("demo")
        self.assertIs(engine.executors["demo"], original)
        self.assertFalse(engine.resolve_executor(identity))

    def test_failed_reactivation_restores_original_layers_hooks_and_settings(self):
        manager, engine = self.ctx.extensions, self.ctx.engine
        folder = extension(manager.root)
        self.enable()
        previous = manager.loaded["demo"]
        reference = engine.current_executor("demo").ref
        pinned = self.ctx.settings().extensions["demo"].digest
        hook = self.ctx.hooks.handlers("prompt.compiled")[0]
        engine.register("demo", Recorder("top"), source="ext:top", digest=B)
        folder.joinpath("main.py").write_text(
            folder.joinpath("main.py").read_text(encoding="utf-8")
            + "    raise RuntimeError('activation failed')\n",
            encoding="utf-8",
        )
        self.enable()
        self.assertIs(manager.loaded["demo"], previous)
        self.assertEqual(self.ctx.settings().extensions["demo"].digest, pinned)
        self.assertEqual(engine.current_executor("demo").ref.source, "ext:top")
        self.assertIs(
            engine.resolve_executor(reference).executor,
            engine.registry.layers("job_executor", "demo")[0].value,
        )
        self.assertIs(self.ctx.hooks.handlers("prompt.compiled")[0], hook)
        self.assertTrue(previous.api._enabled)
        self.assertIn("activation failed", manager.info("demo").error)

    def test_activation_cannot_submit_and_failed_initial_load_keeps_builtin(self):
        manager, engine = self.ctx.extensions, self.ctx.engine
        original = Recorder()
        engine.register("demo", original, source="builtin", digest=A)
        extension(
            manager.root,
            extra="    from mio_server.jobs import ItemSpec\n"
            "    mio.submit_job('demo', [ItemSpec({})])\n",
        )
        self.assertEqual(self.enable().status, "error")
        self.assertIs(engine.executors["demo"], original)
        self.assertEqual(engine.list(), [])
        self.assertNotIn("demo", self.ctx.settings().extensions)

    def test_disabled_queued_tasks_do_not_fall_back_and_original_digest_can_be_reloaded(self):
        manager, engine = self.ctx.extensions, self.ctx.engine
        engine.register("demo", Recorder("builtin"), source="builtin", digest=A)
        extension(manager.root)
        self.enable()
        old_api = manager.loaded["demo"].api
        job = old_api.submit_job("demo", [ItemSpec({})])
        manager.disable("demo")
        self.assertEqual(engine.get(job["id"])["state"], "blocked")
        with self.assertRaises(JobConflict):
            old_api.submit_job("demo", [ItemSpec({})])
        with self.assertRaises(JobConflict):
            old_api.contribute("job_executor", "demo", Recorder())
        self.enable()
        self.assertEqual(drain(engine, job["id"])["items"][0]["result"], {"marker": "old"})

    def test_real_context_restart_recovers_extension_result_after_registration(self):
        manager, engine = self.ctx.extensions, self.ctx.engine
        extension(manager.root)
        self.enable()
        job = engine.submit("demo", [ItemSpec({})])
        claim(engine, job)
        engine._record_delivery(engine._item_row(job["id"], 0), {"saved": "result"})
        self.ctx.close()
        reopened = AppContext.create(Path(self.tmp), autostart=False, seed_instance=False)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.engine.get(job["id"])["state"], "completed")
        self.assertEqual(reopened.engine.get(job["id"])["items"][0]["result"], {"saved": "result"})
        self.assertEqual(reopened.engine.deliveries(job["id"])[0]["state"], "applied")

    def test_missing_original_digest_can_replace_unrelated_loaded_version_for_delivery(self):
        manager, engine = self.ctx.extensions, self.ctx.engine
        folder = extension(manager.root)
        original = (folder / "main.py").read_text(encoding="utf-8")
        self.enable()
        job = engine.submit("demo", [ItemSpec({})])
        claim(engine, job)
        engine._record_delivery(engine._item_row(job["id"], 0), {"saved": "original result"})
        self.ctx.close()
        extension(manager.root, marker="new")
        reopened = AppContext.create(Path(self.tmp), autostart=False, seed_instance=False)
        self.addCleanup(reopened.close)
        manager, engine = reopened.extensions, reopened.engine
        manager.enable("demo", manager.info("demo").digest)
        self.assertFalse(engine.get(job["id"])["executor"]["available"])
        (folder / "main.py").write_text(original, encoding="utf-8")
        self.assertEqual(manager.enable("demo", manager.info("demo").digest).status, "active")
        self.assertTrue(engine.get(job["id"])["executor"]["available"])
        self.assertEqual(engine.replay_result(job["id"], 0)["state"], "completed")

    def test_sample_route_scope_submission_result_retry_and_admin_rebind(self):
        sample = Path(__file__).resolve().parents[2] / "examples/extensions/text-metrics"
        shutil.copytree(sample, self.ctx.extensions.root / "text-metrics")
        self.enable("text-metrics")
        client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)

        def request(scope, method, path, **kwargs):
            token = self.ok(
                self.client.post("/api/tokens", json={"name": "test", "scopes": [scope]}), 201
            )["token"]
            return client.request(
                method, "/api/v2" + path, headers={"Authorization": f"Bearer {token}"}, **kwargs
            )

        catalog = self.ok(request("read", "GET", "/job-executors"))
        ref = next(item for item in catalog if item["kind"] == "text-metrics.count")
        self.assertTrue(ref["current"] and ref["replay_safe"])
        body = {"text": "A quiet room", "idempotency_key": "same"}
        for scope in ("read", "write", "admin"):
            self.assertEqual(
                request(scope, "POST", "/ext/text-metrics/count", json=body).status_code, 403
            )
        submitted = self.ok(request("render", "POST", "/ext/text-metrics/count", json=body), 202)
        again = self.ok(request("render", "POST", "/ext/text-metrics/count", json=body), 202)
        self.assertEqual(submitted["job_id"], again["job_id"])
        job_id = submitted["job_id"]
        done = drain(self.ctx.engine, job_id)
        self.assertEqual(done["items"][0]["result"], {"characters": 12, "words": 3})
        self.ok(request("read", "GET", f"/jobs/{job_id}/deliveries"))
        self.ok(
            request(
                "render",
                "POST",
                f"/jobs/{job_id}/retry",
                json={"indexes": [0], "include_complete": True},
            )
        )
        self.assertEqual(drain(self.ctx.engine, job_id)["items"][0]["attempts"], 2)
        missing = self.ctx.engine.submit("text-metrics.count", [ItemSpec({"text": "test"})])
        identity = {key: ref[key] for key in ("kind", "source", "digest")}
        rebinding = {"expected": identity, "target": identity}
        for scope in ("read", "write", "render"):
            self.assertEqual(
                request(
                    scope, "POST", f"/jobs/{missing['id']}/rebind-executor", json=rebinding
                ).status_code,
                403,
            )
        self.ok(request("admin", "POST", f"/jobs/{missing['id']}/rebind-executor", json=rebinding))
        self.assertEqual(client.post("/api/jobs", json={"kind": "comfy.render"}).status_code, 405)

    def test_resolve_cannot_bypass_render_permission_for_saved_results(self):
        engine = self.ctx.engine
        engine.register("demo", Recorder(), source="test:demo", digest=A)
        job = engine.submit("demo", [ItemSpec({})])
        claim(engine, job)
        engine._record_delivery(engine._item_row(job["id"], 0), {"saved": True})
        engine.running.clear()
        base = f"/api/v2/jobs/{job['id']}/items/0"
        for scope in ("read", "write"):
            token = self.ok(
                self.client.post("/api/tokens", json={"name": "test", "scopes": [scope]}), 201
            )["token"]
            headers = {"Authorization": f"Bearer {token}"}
            for suffix, body in (("/replay-result", None), ("/resolve", {"action": "reconcile"})):
                self.assertEqual(
                    self.client.post(base + suffix, json=body, headers=headers).status_code, 403
                )
        token = self.ok(
            self.client.post("/api/tokens", json={"name": "render", "scopes": ["render"]}), 201
        )["token"]
        response = self.client.post(
            base + "/resolve",
            json={"action": "reconcile"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["state"], "completed")

    def test_backup_preserves_and_validates_executor_identity(self):
        engine = self.ctx.engine
        engine.register("demo", Recorder(), source="test:demo", digest=A)
        job = engine.submit("demo", [ItemSpec({})])
        drain(engine, job["id"])
        backup = Backups(self.ctx).export(BackupOptions())
        self.assertEqual(Backups.inspect(Backups(self.ctx).download(backup.id)).job_count, 1)
        self.assertEqual(backup.inspection.manifest.jobs_schema_version, 2)
        before = logical_head(self.ctx.store._conn, engine.db)
        with engine.db:
            engine.db.execute("UPDATE job_executor_bindings SET digest=?", (B,))
        self.assertNotEqual(logical_head(self.ctx.store._conn, engine.db), before)
        with engine.db:
            engine.db.execute("UPDATE job_executor_bindings SET kind='wrong'")
        for instance in self.ctx.store.list_docs("instance"):
            instance.enabled = False
            self.ctx.store.put_doc(instance)
        with self.assertRaisesRegex(ValueError, "executor identity"):
            validate_databases(self.ctx.store._conn, engine.db)

    def test_resolve_resubmit_explicitly_retries_only_the_uncertain_item(self):
        engine = self.ctx.engine
        executor = Recorder(fail=True)
        engine.register("demo", executor, source="test:demo", digest=A)
        job = engine.submit("demo", [ItemSpec({}), ItemSpec({})])
        self.assertEqual(drain(engine, job["id"])["state"], "blocked")
        token = self.ok(
            self.client.post("/api/tokens", json={"name": "render", "scopes": ["render"]}), 201
        )["token"]
        response = self.client.post(
            f"/api/v2/jobs/{job['id']}/items/0/resolve",
            json={"action": "resubmit"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            [item["state"] for item in response.json()["items"]], ["pending", "pending"]
        )
        self.assertEqual([item["attempts"] for item in response.json()["items"]], [1, 0])
        executor.fail = False
        self.assertEqual(drain(engine, job["id"])["state"], "completed")
        self.assertEqual(len(executor.calls), 3)

    def test_backup_without_executor_schema_version_is_explicitly_rejected(self):
        backup = Backups(self.ctx).export(BackupOptions())
        old = Path(self.tmp) / "old.zip"
        with zipfile.ZipFile(Backups(self.ctx).download(backup.id)) as source:
            with zipfile.ZipFile(old, "w") as dest:
                for name in source.namelist():
                    data = source.read(name)
                    if name == "manifest.json":
                        manifest = json.loads(data)
                        manifest.pop("jobs_schema_version")
                        data = json.dumps(manifest).encode()
                    dest.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "jobs schema"):
            Backups.inspect(old)


if __name__ == "__main__":
    unittest.main()
