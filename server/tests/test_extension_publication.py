"""An extension's wrappers become callable only after its entire activation commits."""

import threading
from types import SimpleNamespace
from unittest.mock import patch

from starlette.concurrency import run_in_threadpool

from .api_harness import ApiCase
from .test_extensions import write_ext


class ExtensionPublicationTests(ApiCase):
    def install(self):
        write_ext(
            self.ctx.extensions.root,
            "publication",
            "def activate(mio): pass\n",
            themes=[],
            sfx_presets={},
            slice_presets=[],
        )
        return self.ctx.extensions.info("publication").digest

    def transition(self, *, fail, replacement=False):
        manager = self.ctx.extensions
        digest = self.install()
        calls = []
        if replacement:

            async def original(next, ctx, payload):
                calls.append("old")
                return await next(payload=payload.model_copy(update={"title": "Old"}))

            def previous(api, manifest):
                api.operation("POST /series")(original)
                return SimpleNamespace()

            with patch.object(manager, "_run_main", side_effect=previous):
                self.assertEqual(manager.enable("publication", digest).status, "active")

        registered, release = threading.Event(), threading.Event()
        statuses, failures = [], []

        def activate(api, manifest):
            @api.operation("POST /series")
            async def unpublished(next, ctx, payload):
                calls.append("new")
                return await next(payload=payload.model_copy(update={"title": "New"}))

            registered.set()
            if not release.wait(5):
                raise AssertionError("test did not finish activation")
            if fail:
                raise RuntimeError("deliberate activation failure")
            return SimpleNamespace()

        def enable():
            try:
                statuses.append(manager.enable("publication", digest).status)
            except Exception as exc:
                failures.append(exc)

        with patch.object(manager, "_run_main", side_effect=activate):
            thread = threading.Thread(target=enable)
            thread.start()
            try:
                self.assertTrue(registered.wait(2))
                response = self.client.post("/api/series", json={"title": "During"})
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(response.json()["kind"], "conflict")
                self.assertEqual(calls, [])
                self.assertEqual(len(self.ctx.store.list_series()), 0)
            finally:
                release.set()
                thread.join(6)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(statuses, ["active" if replacement or not fail else "error"])
        after = self.ok(self.client.post("/api/series", json={"title": "After"}), 201)
        if not fail:
            self.assertEqual((after["title"], calls), ("New", ["new"]))
        elif replacement:
            self.assertEqual((after["title"], calls), ("Old", ["old"]))
        else:
            self.assertEqual((after["title"], calls), ("After", []))
        self.assertEqual(manager._catalog_transitions, 0)

    def test_failed_activation_never_executes_its_unpublished_wrapper(self):
        self.transition(fail=True)

    def test_successful_activation_publishes_only_after_activate_returns(self):
        self.transition(fail=False)

    def test_failed_reactivation_preserves_old_policy_without_temporary_core_fallback(self):
        self.transition(fail=True, replacement=True)

    def test_activation_can_call_local_http_without_waiting_on_itself(self):
        digest = self.install()
        responses = []

        def activate(api, manifest):
            responses.append(self.client.get("/api/series").status_code)
            return SimpleNamespace()

        with patch.object(self.ctx.extensions, "_run_main", side_effect=activate):
            self.assertEqual(self.ctx.extensions.enable("publication", digest).status, "active")
        self.assertEqual(responses, [409])
        self.assertEqual(self.client.get("/api/series").status_code, 200)

    def test_ordinary_operation_lock_does_not_block_http_reads(self):
        finished = threading.Event()
        responses = []

        def read():
            try:
                responses.append(self.client.get("/api/series").status_code)
            finally:
                finished.set()

        with self.ctx.engine.hold_operation():
            thread = threading.Thread(target=read)
            thread.start()
            finished_without_releasing_operation = finished.wait(2)
        thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertTrue(finished_without_releasing_operation)
        self.assertEqual(responses, [200])

    def test_started_async_wrapper_can_finish_while_its_source_is_disabled(self):
        digest = self.install()
        started, release = threading.Event(), threading.Event()
        responses, failures = [], []

        def activate(api, manifest):
            @api.operation("POST /series")
            async def old(next, ctx, payload):
                started.set()
                if not await run_in_threadpool(release.wait, 5):
                    raise AssertionError("test did not release async wrapper")
                return await next(payload=payload.model_copy(update={"title": "Captured"}))

            return SimpleNamespace()

        with patch.object(self.ctx.extensions, "_run_main", side_effect=activate):
            self.ctx.extensions.enable("publication", digest)

        def request():
            try:
                responses.append(self.client.post("/api/series", json={"title": "Before"}))
            except Exception as exc:
                failures.append(exc)

        thread = threading.Thread(target=request)
        thread.start()
        try:
            self.assertTrue(started.wait(2))
            self.assertEqual(self.ctx.extensions.disable("publication").status, "disabled")
        finally:
            release.set()
            thread.join(6)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(self.ok(responses[0], 201)["title"], "Captured")
        self.assertEqual(
            self.ok(self.client.post("/api/series", json={"title": "Plain"}), 201)["title"], "Plain"
        )
