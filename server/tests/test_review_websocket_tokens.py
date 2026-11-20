"""R3-ACCESS-01: existing job sockets lose access with their original credential."""

from __future__ import annotations

import asyncio
import gc
import tempfile
import unittest
import weakref
from concurrent.futures import TimeoutError
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from mio_server.api import create_app
from mio_server.auth import issue
from mio_server.context import AppContext

LOCAL = "http://127.0.0.1"
WS = "ws://127.0.0.1"


class Clock(datetime):
    current = datetime(2030, 1, 1, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls.current if tz else cls.current.replace(tzinfo=None)


class Preview(dict):
    """A weak-referenceable preview payload for checking connection resource cleanup."""


class WebSocketTokenTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="mio-ws-token-test-")
        self.addCleanup(temporary.cleanup)
        self.ctx = AppContext.create(
            temporary.name, autostart=False, seed_instance=False, memory=True
        )
        self.addCleanup(self.ctx.close)
        self.ctx.legacy_root = Path(temporary.name) / "empty-legacy"
        self.client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)
        self.baseline_listeners = list(self.ctx.engine.listeners)

    def issue(self, **extra):
        response = self.client.post(
            "/api/tokens", json={"name": "offline fixture", "scopes": ["read"], **extra}
        )
        self.assertEqual(response.status_code, 201)
        return response.json()

    def connect(self, issued):
        return self.client.websocket_connect(
            WS + "/api/v2/ws/jobs", headers={"Authorization": "Bearer " + issued["token"]}
        )

    def receive(self, ws):
        # Starlette's public receive() has no deadline; bound the test transport read so a
        # missing idle close fails rather than hanging the suite.
        future = ws.portal.start_task_soon(ws._send_rx.receive)
        try:
            return future.result(timeout=3)
        except TimeoutError:
            future.cancel()
            self.fail("socket did not send or close within three seconds")

    def emit(self, **data):
        self.ctx.engine._emit("offline-sentinel", None, "review-event", data, persist=False)

    def assert_released(self, ws):
        async def pending_io():
            deadline = asyncio.get_running_loop().time() + 1
            while True:
                pending = [
                    task.get_coro().__qualname__
                    for task in asyncio.all_tasks()
                    if not task.done()
                    and task.get_coro().__qualname__ in {"Queue.get", "WebSocket.receive_text"}
                ]
                if not pending or asyncio.get_running_loop().time() >= deadline:
                    return pending
                await asyncio.sleep(0.01)

        self.assertEqual(ws.portal.call(pending_io), [])
        self.assertEqual(self.ctx.engine.listeners, self.baseline_listeners)

    def assert_closed(self, ws):
        message = self.receive(ws)
        self.assertEqual(message["type"], "websocket.close")
        self.assertEqual(message["code"], 1008)
        self.assert_released(ws)

    def test_revoked_connection_closes_before_forwarding_next_event(self):
        issued = self.issue()
        with self.connect(issued) as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            self.assertEqual(self.client.delete("/api/tokens/" + issued["id"]).status_code, 204)
            self.assertEqual(
                self.client.get(
                    "/api/v2/jobs", headers={"Authorization": "Bearer " + issued["token"]}
                ).status_code,
                401,
            )
            self.emit(marker="neutral-after-revoke")
            self.assert_closed(ws)
        self.assertEqual(self.ctx.engine.listeners, self.baseline_listeners)

    def test_expired_connection_drops_queued_preview_and_releases_its_payload(self):
        issued = self.issue()
        with self.connect(issued) as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            token = self.ctx.store.get_doc("api_token", issued["id"])
            token.expires_at = "2000-01-01T00:00:00Z"
            self.ctx.store.put_doc(token)
            payload = Preview(type="preview", image="neutral-preview")
            reference = weakref.ref(payload)
            self.ctx.engine._emit("offline-sentinel", None, "progress", payload, persist=False)
            del payload
            self.assert_closed(ws)
            gc.collect()
            self.assertIsNone(reference())

    def test_idle_connection_closes_when_its_unchanged_expiry_passes(self):
        Clock.current = datetime(2030, 1, 1, tzinfo=timezone.utc)
        with patch("mio_server.auth.datetime", Clock):
            issued = self.issue(expires_at=(Clock.current + timedelta(seconds=1)).isoformat())
            with self.connect(issued) as ws:
                self.assertEqual(ws.receive_json()["type"], "hello")
                Clock.current += timedelta(seconds=2)
                self.assert_closed(ws)
                self.assertEqual(
                    self.ctx.store.get_doc("api_token", issued["id"]).expires_at,
                    issued["expires_at"],
                )

    def test_idle_revoked_connection_releases_subscription_without_a_new_event(self):
        issued = self.issue()
        with self.connect(issued) as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            self.assertEqual(self.client.delete("/api/tokens/" + issued["id"]).status_code, 204)
            self.assert_closed(ws)

    def test_scope_removed_after_handshake_cannot_receive_new_events(self):
        issued = self.issue()
        with self.connect(issued) as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            token = self.ctx.store.get_doc("api_token", issued["id"])
            token.scopes = ["write"]
            self.ctx.store.put_doc(token)
            self.emit(marker="neutral-after-scope-removal")
            self.assert_closed(ws)

    def test_rotated_credential_with_same_id_does_not_inherit_old_socket(self):
        issued = self.issue()
        with self.connect(issued) as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            replacement, _ = issue("offline replacement", ["read"])
            replacement.id = issued["id"]
            self.ctx.store.put_doc(replacement)
            self.emit(marker="neutral-after-rotation")
            self.assert_closed(ws)

    def test_handshake_rejects_missing_revoked_expired_and_non_reader_credentials(self):
        revoked = self.issue()
        self.assertEqual(self.client.delete("/api/tokens/" + revoked["id"]).status_code, 204)
        expired = self.issue(expires_at="2000-01-01T00:00:00Z")
        writer = self.issue(scopes=["write"])
        for issued in (None, revoked, expired, writer):
            with self.subTest(kind="missing" if issued is None else issued["name"]):
                with self.assertRaises(WebSocketDisconnect) as caught:
                    connection = (
                        self.client.websocket_connect(WS + "/api/v2/ws/jobs")
                        if issued is None
                        else self.connect(issued)
                    )
                    with connection:
                        self.fail("invalid credential was accepted")
                self.assertEqual(caught.exception.code, 1008)
        self.assertEqual(self.ctx.engine.listeners, self.baseline_listeners)

    def test_valid_reader_receives_job_and_preview_without_activity_writes(self):
        issued = self.issue()
        with self.connect(issued) as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            changes = self.ctx.store._conn.total_changes
            before = self.ctx.store.get_doc("api_token", issued["id"]).last_used_at
            # A frame reusing verify() would now hit its minute-level activity update.
            with patch("mio_server.auth.time", SimpleNamespace(monotonic=lambda: 1e30)):
                for data in ({"marker": "neutral-job"}, {"type": "preview", "image": "neutral"}):
                    self.emit(**data)
                    self.assertEqual(ws.receive_json()["data"], data)
            after = self.ctx.store.get_doc("api_token", issued["id"]).last_used_at
            self.assertEqual(after, before)
            self.assertEqual(self.ctx.store._conn.total_changes, changes)
        self.assertEqual(self.ctx.engine.listeners, self.baseline_listeners)

    def test_query_credential_is_revalidated_after_handshake(self):
        issued = self.issue()
        with self.client.websocket_connect(
            WS + "/api/v2/ws/jobs?access_token=" + issued["token"]
        ) as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            self.assertEqual(self.client.delete("/api/tokens/" + issued["id"]).status_code, 204)
            self.emit(marker="neutral-after-query-token-revoke")
            self.assert_closed(ws)

    def test_local_socket_remains_token_free_and_keeps_preview_filter(self):
        with self.client.websocket_connect(WS + "/api/ws/jobs?previews=false") as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")
            self.emit(type="preview", image="neutral-filtered")
            self.emit(marker="neutral-local-job")
            self.assertEqual(ws.receive_json()["data"], {"marker": "neutral-local-job"})
        self.assertEqual(self.ctx.engine.listeners, self.baseline_listeners)


if __name__ == "__main__":
    unittest.main()
