"""Deterministic, offline coverage of updater ownership and workspace shutdown."""

from __future__ import annotations

import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.backups.paths import recovery_root
from mio_server.context import AppContext
from mio_server.jobs.lease import FileLease, LeaseHeld
from mio_server.update import UpdateError, Updater

from . import test_longform_api as longform
from . import test_update as update_fixture
from . import test_update_catalog as catalog_fixture


class ContextShutdownTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.respond = lambda request: httpx.Response(200, json=[])

        def respond(request):
            self.requests.append(request.url)
            return self.respond(request)

        transport = httpx.MockTransport(respond)

        def fake_http(updater, timeout):
            return httpx.Client(timeout=timeout, transport=transport)

        # Install the fake before any AppContext/Updater exists, including nested cases.
        patcher = patch.object(Updater, "_http", fake_http)
        patcher.start()
        self.addCleanup(patcher.stop)

    def context(self, *, autostart=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        ctx = AppContext.create(
            Path(temporary.name) / "workspace", autostart=autostart, seed_instance=False
        )
        self.addCleanup(ctx.close)
        return ctx

    def blocked_response(self):
        entered, release = threading.Event(), threading.Event()

        def respond(request):
            entered.set()
            if not release.wait(5):
                raise AssertionError("test did not release the update response")
            return httpx.Response(200, json=[])

        self.respond = respond
        self.addCleanup(release.set)
        return entered, release

    def assert_close_waits(self, ctx, entered, release, request_thread=None):
        self.assertTrue(entered.wait(1), "update request did not enter the fake transport")
        started, closed = threading.Event(), threading.Event()
        errors = []

        def close():
            started.set()
            try:
                ctx.close()
            except BaseException as exc:
                errors.append(exc)
            finally:
                closed.set()

        closer = threading.Thread(target=close, name="test-context-close")
        closer.start()
        try:
            self.assertTrue(started.wait(1))
            self.assertFalse(
                closed.wait(0.1),
                "AppContext.close returned while its update operation could still write state",
            )
            lease_path = str(recovery_root(ctx.data_dir) / "workspace.lease")
            with self.assertRaises(LeaseHeld):
                FileLease(lease_path)
        finally:
            release.set()
            if request_thread is not None:
                request_thread.join(5)
            closer.join(5)
        self.assertFalse(closer.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(closed.is_set())
        if request_thread is not None:
            self.assertFalse(request_thread.is_alive())
        # The real lease is released only after the updater has finished its last write.
        lease = FileLease(str(recovery_root(ctx.data_dir) / "workspace.lease"))
        lease.release()

    def test_longform_api_with_autostart_false_has_no_implicit_update_request(self):
        case = longform.LongformApiTests(
            "test_v2_read_previews_write_commands_and_revision_contract"
        )
        case.setUp()
        self.addCleanup(shutil.rmtree, recovery_root(case.ctx.data_dir))
        self.addCleanup(
            lambda: self.assertTrue(case.doCleanups(), "longform fixture cleanup failed")
        )
        case.test_v2_read_previews_write_commands_and_revision_contract()
        self.assertEqual(self.requests, [])
        self.assertIsNone(case.ctx.updater._worker)
        self.assertIsNone(case.ctx.updater.check()["latest"])
        self.assertEqual(len(self.requests), 1)

    def test_default_context_still_checks_on_http_startup(self):
        ctx = self.context(autostart=True)
        entered, release = self.blocked_response()
        with TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1"):
            self.assertTrue(entered.wait(1))
        self.assert_close_waits(ctx, entered, release, ctx.updater._worker)
        self.assertEqual(ctx.updater.activity["phase"], "idle")

    def test_close_joins_explicit_update_worker_and_refuses_late_mutations(self):
        ctx = self.context()
        entered, release = self.blocked_response()
        ctx.updater.start_check()
        worker = ctx.updater._worker
        self.assert_close_waits(ctx, entered, release, worker)
        self.assertFalse(worker.is_alive())
        self.assertTrue((ctx.updater.dir / "state.json").is_file())
        self.assertEqual(ctx.updater.activity["phase"], "idle")
        shutil.rmtree(ctx.updater.dir)
        requests = len(self.requests)
        for command in (
            ctx.updater.check,
            ctx.updater.start_check,
            lambda: ctx.updater.preferences(False),
        ):
            with self.assertRaisesRegex(UpdateError, "closed|关闭"):
                command()
        ctx.updater.startup_check()
        ctx.close()
        self.assertEqual(len(self.requests), requests)
        self.assertFalse(ctx.updater.dir.exists())

    def test_close_also_waits_for_a_synchronous_update_check(self):
        ctx = self.context()
        entered, release = self.blocked_response()
        errors = []

        def check():
            try:
                ctx.updater.check()
            except BaseException as exc:
                errors.append(exc)

        request = threading.Thread(target=check, name="test-synchronous-update")
        request.start()
        self.assert_close_waits(ctx, entered, release, request)
        self.assertEqual(errors, [])
        self.assertTrue((ctx.updater.dir / "state.json").is_file())

    def test_concurrent_context_closes_share_the_update_completion_barrier(self):
        ctx = self.context()
        entered, release = self.blocked_response()
        ctx.updater.start_check()
        self.assertTrue(entered.wait(1))
        worker = ctx.updater._worker
        joining, first_done, second_done = (threading.Event() for _ in range(3))
        original_join = worker.join

        def join(timeout=None):
            joining.set()
            return original_join(timeout)

        def close(done):
            try:
                ctx.close()
            finally:
                done.set()

        first = threading.Thread(target=close, args=(first_done,), name="test-first-close")
        second = threading.Thread(target=close, args=(second_done,), name="test-second-close")
        with patch.object(worker, "join", side_effect=join):
            first.start()
            try:
                self.assertTrue(joining.wait(1))
                second.start()
                self.assertFalse(
                    second_done.wait(0.1),
                    "a concurrent close bypassed the updater's workspace shutdown barrier",
                )
                self.assertFalse(first_done.is_set())
                with self.assertRaises(LeaseHeld):
                    FileLease(str(recovery_root(ctx.data_dir) / "workspace.lease"))
                self.assertIsInstance(ctx.store.list_docs("series"), list)
            finally:
                release.set()
                first.join(5)
                if second.ident is not None:
                    second.join(5)
        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertFalse(worker.is_alive())
        self.assertTrue((ctx.updater.dir / "state.json").is_file())

    def test_same_thread_context_close_reentry_keeps_remaining_resources_open(self):
        ctx = self.context()
        observations = []

        def reenter():
            ctx.close()
            observations.append(ctx.store.list_docs("series"))
            with self.assertRaises(LeaseHeld):
                FileLease(str(recovery_root(ctx.data_dir) / "workspace.lease"))
            observations.append("lease still held")

        ctx.closers.append(reenter)
        ctx.close()
        self.assertEqual(observations, [[], "lease still held"])
        ctx.close()

    def test_an_admitted_install_finishes_nested_steps_before_close_returns(self):
        ctx = self.context()
        updater = ctx.updater
        updater.root = ctx.data_dir.parent / "install"
        updater.root.mkdir()
        updater.keys = update_fixture.TRUSTED
        archive = update_fixture.release_zip()
        manifest = update_fixture.manifest_for(archive)
        entered, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)

        def respond(request):
            if "/tags/" in request.url.path:
                entered.set()
                if not release.wait(5):
                    raise AssertionError("test did not release the release catalog")
                return httpx.Response(200, json=catalog_fixture.github_release())
            if request.url.path.endswith("mio-release.json"):
                return httpx.Response(200, content=manifest)
            return httpx.Response(200, content=archive)

        self.respond = respond
        updater.install("v4.1.0")
        self.assert_close_waits(ctx, entered, release, updater._worker)
        self.assertEqual(updater.activity["phase"], "ready", updater.activity)
        self.assertEqual(updater.pending()["version"], "4.1.0")


if __name__ == "__main__":
    unittest.main()
