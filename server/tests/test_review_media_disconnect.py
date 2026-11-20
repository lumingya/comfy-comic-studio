"""Media response ownership survives ASGI disconnects before the iterator is consumed."""

import asyncio
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from starlette.requests import ClientDisconnect, Request
from starlette.responses import Response

from mio_server.extensions.panel_media import dispatch_media

PAYLOAD = b"x" * (128 * 1024)


class TrackedFile:
    def __init__(self, file):
        self.file = file
        self.close_calls = 0

    def __getattr__(self, name):
        return getattr(self.file, name)

    def close(self):
        self.close_calls += 1
        self.file.close()


class PanelMediaDisconnectTests(unittest.IsolatedAsyncioTestCase):
    async def response(self, *, app=None, still_active=lambda: True):
        if app is None:

            async def app(scope, receive, send):
                await Response(PAYLOAD, media_type="application/octet-stream")(scope, receive, send)

        output = TrackedFile(tempfile.TemporaryFile())
        self.addCleanup(output.file.close)
        release = Mock()
        validate = Mock()
        with patch("mio_server.extensions.panel_media.tempfile.TemporaryFile", return_value=output):
            response = await dispatch_media(
                Request({"type": "http", "headers": [], "app": app}),
                SimpleNamespace(response="download", method="GET"),
                "/api/test",
                SimpleNamespace(body=None, query={}),
                validate,
                still_active,
                release,
            )
        validate.assert_called_once_with()
        self.assertFalse(output.closed)
        release.assert_not_called()
        return response, output, release

    def assert_released(self, output, release):
        self.assertTrue(output.closed)
        self.assertEqual(output.close_calls, 1)
        release.assert_called_once_with()

    @staticmethod
    def scope(version="2.4"):
        return {"type": "http", "asgi": {"spec_version": version}}

    @staticmethod
    async def no_disconnect():
        await asyncio.Future()

    async def test_asgi_24_disconnect_at_headers_or_first_chunk_closes_immediately(self):
        for message_type in ("http.response.start", "http.response.body"):
            with self.subTest(message_type=message_type):
                response, output, release = await self.response()

                async def send(message):
                    if message["type"] == message_type:
                        raise OSError("client disconnected")

                with self.assertRaises(ClientDisconnect):
                    await response(self.scope(), self.no_disconnect, send)
                # Keep the response and iterator alive: cleanup must precede GC/aclose.
                self.assert_released(output, release)
                await response.body_iterator.aclose()
                self.assert_released(output, release)

    async def test_send_error_closes_immediately_without_reclassifying_error(self):
        response, output, release = await self.response()

        async def send(message):
            if message["type"] == "http.response.body":
                raise RuntimeError("send failed")

        with self.assertRaisesRegex(RuntimeError, "send failed"):
            await response(self.scope(), self.no_disconnect, send)
        self.assert_released(output, release)

    async def test_task_cancelled_at_headers_or_first_chunk_closes_immediately(self):
        for message_type in ("http.response.start", "http.response.body"):
            with self.subTest(message_type=message_type):
                response, output, release = await self.response()
                sending = asyncio.Event()

                async def send(message):
                    if message["type"] == message_type:
                        sending.set()
                        await asyncio.Future()

                task = asyncio.create_task(response(self.scope(), self.no_disconnect, send))
                try:
                    await asyncio.wait_for(sending.wait(), 2)
                    self.assertFalse(output.closed)
                    release.assert_not_called()
                finally:
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                self.assert_released(output, release)

    async def test_asgi_23_disconnect_before_or_after_first_chunk_closes_immediately(self):
        for message_type in ("http.response.start", "http.response.body"):
            with self.subTest(message_type=message_type):
                response, output, release = await self.response()
                sending = asyncio.Event()

                async def send(message):
                    if message["type"] == message_type:
                        sending.set()
                        await asyncio.Future()

                async def receive():
                    await sending.wait()
                    return {"type": "http.disconnect"}

                await asyncio.wait_for(response(self.scope("2.3"), receive, send), 2)
                self.assert_released(output, release)

    async def test_success_keeps_slot_until_final_send_and_releases_once(self):
        for version in ("2.3", "2.4"):
            with self.subTest(version=version):
                response, output, release = await self.response()
                messages = []

                async def send(message):
                    self.assertFalse(output.closed)
                    release.assert_not_called()
                    messages.append(message)

                await response(self.scope(version), self.no_disconnect, send)
                self.assertEqual(
                    b"".join(m["body"] for m in messages if m["type"] == "http.response.body"),
                    PAYLOAD,
                )
                self.assertFalse(messages[-1]["more_body"])
                self.assert_released(output, release)

    async def test_inactive_extension_stops_body_and_releases_once(self):
        response, output, release = await self.response(still_active=lambda: False)
        messages = []

        async def send(message):
            messages.append(message)

        await response(self.scope(), self.no_disconnect, send)
        self.assertEqual([m["body"] for m in messages if m["type"] == "http.response.body"], [b""])
        self.assert_released(output, release)

    async def test_cancelled_producer_closes_before_response_is_returned(self):
        async def app(scope, receive, send):
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"application/octet-stream")],
                }
            )
            raise asyncio.CancelledError

        output = TrackedFile(tempfile.TemporaryFile())
        self.addCleanup(output.file.close)
        release = Mock()
        with (
            patch("mio_server.extensions.panel_media.tempfile.TemporaryFile", return_value=output),
            self.assertRaises(asyncio.CancelledError),
        ):
            await dispatch_media(
                Request({"type": "http", "headers": [], "app": app}),
                SimpleNamespace(response="download", method="GET"),
                "/api/test",
                SimpleNamespace(body=None, query={}),
                Mock(),
                lambda: True,
                release,
            )
        self.assert_released(output, release)
