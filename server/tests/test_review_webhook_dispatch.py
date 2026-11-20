"""Review regressions: live webhook configuration, isolation and worker shutdown."""

from __future__ import annotations

import json
import threading
import unittest
from unittest.mock import patch

import httpx

from mio_server.storage import SQLiteStore
from mio_server.webhooks import Dispatcher, Webhook, sign

from .api_harness import ApiCase


class WebhookConfigurationTests(ApiCase):
    def hook(self, **data):
        return self.ok(
            self.client.post(
                "/api/webhooks",
                json={"url": "https://example.test/hook", "events": ["*"], **data},
            ),
            201,
        )

    def receive(self, request):
        self.requests.append(request)
        return httpx.Response(503 if len(self.requests) == 1 else 200)

    def setUp(self):
        super().setUp()
        self.requests = []
        self.ctx.webhooks.transport = httpx.MockTransport(self.receive)

    def test_retry_uses_current_key_and_url_with_same_delivery(self):
        hook = self.hook()
        updated = {}

        def reconfigure(_):
            updated.update(
                self.ok(
                    self.client.patch(
                        f"/api/webhooks/{hook['id']}",
                        json={"rotate_secret": True, "url": "https://example.test/current"},
                    )
                )
            )

        self.ctx.webhooks.sleep = reconfigure
        self.ctx.webhooks._fan_out("take.created", {"probe": True})
        self.assertEqual(len(self.requests), 2)
        first, last = self.requests
        self.assertEqual(str(last.url), updated["url"])
        self.assertEqual(first.content, last.content)
        self.assertEqual(first.headers["x-mio-delivery"], last.headers["x-mio-delivery"])
        self.assertEqual(json.loads(first.content)["id"], first.headers["x-mio-delivery"])
        stamp = last.headers["x-mio-timestamp"]
        self.assertEqual(
            last.headers["x-mio-signature"], sign(updated["secret"], stamp, last.content)
        )
        self.assertNotEqual(
            last.headers["x-mio-signature"], sign(hook["secret"], stamp, last.content)
        )

    def test_disable_delete_or_unsubscribe_during_backoff_prevents_retry(self):
        for change in ("disable", "delete", "unsubscribe"):
            with self.subTest(change=change):
                self.requests.clear()
                hook = self.hook()

                def reconfigure(_, change=change):
                    path = f"/api/webhooks/{hook['id']}"
                    if change == "delete":
                        self.ok(self.client.delete(path), 204)
                    else:
                        body = (
                            {"enabled": False}
                            if change == "disable"
                            else {"events": ["job.failed"]}
                        )
                        self.ok(self.client.patch(path, json=body))

                self.ctx.webhooks.sleep = reconfigure
                self.ctx.webhooks._fan_out("take.created", {})
                self.assertEqual(len(self.requests), 1)
                if change != "delete":
                    self.ok(self.client.delete(f"/api/webhooks/{hook['id']}"), 204)

    def test_retry_revalidates_url_and_secret_before_sending(self):
        for replacement in (
            {"url": "http://example.test:abc/hook"},
            {"secret": ""},
            {"events": ["no-longer-valid"]},
        ):
            with self.subTest(field=next(iter(replacement))):
                self.requests.clear()
                created = self.hook()
                hook = self.ctx.store.get_doc("webhook", created["id"])

                def corrupt(_):
                    self.ctx.store.put_doc(hook.model_copy(update=replacement))

                self.ctx.webhooks.sleep = corrupt
                self.ctx.webhooks._fan_out("take.created", {})
                self.assertEqual(len(self.requests), 1)
                record = self.ctx.webhooks.deliveries[hook.id][0]
                self.assertEqual(record["attempts"], 1)
                self.assertTrue(record["error"])
                self.ctx.store.delete_doc("webhook", hook.id)

    def test_invalid_urls_are_rejected_at_create_and_update_without_echo(self):
        hook = self.hook()
        for url in (
            "http://example.test:abc/private?token=private-value",
            "https://example.test:65536/hook",
            "https:///missing-host",
            "http://[broken/hook",
            "https://user:private-value@example.test/hook",
            "HTTP://example.test/hook?token=private-value",
            "https://example.test/" + "private-value" * 200,
        ):
            with self.subTest(url=url):
                for method, path in (
                    (self.client.post, "/api/webhooks"),
                    (self.client.patch, f"/api/webhooks/{hook['id']}"),
                ):
                    response = method(path, json={"url": url})
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertNotIn(url, response.text)
                    self.assertNotIn("private-value", response.text)
        self.assertEqual(len(self.ctx.store.list_docs("webhook")), 1)
        self.assertEqual(self.ctx.store.get_doc("webhook", hook["id"]).url, hook["url"])

    def test_legacy_bad_url_is_isolated_and_later_hook_still_receives(self):
        bad = Webhook(id="invalid", name="a", url="http://example.test:abc/private?token=hidden")
        bad.events = ["*"]
        self.ctx.store.put_doc(bad)
        valid = self.hook(name="z")
        self.ctx.webhooks.transport = httpx.MockTransport(
            lambda request: self.requests.append(request) or httpx.Response(200)
        )
        self.ctx.webhooks._fan_out("take.created", {})
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(str(self.requests[0].url), valid["url"])
        record = self.ctx.webhooks.deliveries[bad.id][0]
        self.assertEqual(record["attempts"], 0)
        self.assertIsNone(record["status"])
        self.assertTrue(record["error"])
        self.assertNotIn("hidden", record["error"])
        self.assertNotIn(bad.url, record["error"])
        self.assertNotIn(bad.secret, record["error"])

    def test_transport_errors_and_response_bodies_do_not_echo_secrets(self):
        hook = self.hook()

        def receive(request):
            raise httpx.ConnectError(f"failed at {hook['url']} secret={hook['secret']}")

        self.ctx.webhooks.transport = httpx.MockTransport(receive)
        self.ctx.webhooks.sleep = lambda _: None
        stored = self.ctx.store.get_doc("webhook", hook["id"])
        record = self.ctx.webhooks.deliver(stored, "take.created", {})
        self.assertNotIn(hook["url"], record["error"])
        self.assertNotIn(hook["secret"], record["error"])
        self.ctx.webhooks.transport = httpx.MockTransport(
            lambda _: httpx.Response(503, text=f"{hook['url']} {hook['secret']}")
        )
        record = self.ctx.webhooks.deliver(stored, "take.created", {}, retries=())
        self.assertNotIn(hook["url"], record["error"])
        self.assertNotIn(hook["secret"], record["error"])

    def test_manual_ping_allows_disabled_unsubscribed_hook(self):
        hook = self.hook(enabled=False, events=["job.failed"])
        record = self.ok(self.client.post(f"/api/webhooks/{hook['id']}/test"))
        self.assertEqual((record["status"], record["attempts"]), (503, 1))
        self.assertEqual(self.requests[0].headers["x-mio-event"], "ping")


class WebhookLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore(":memory:")
        self.addCleanup(self.store.close)
        self.dispatcher = Dispatcher(self.store)
        self.addCleanup(self.dispatcher.close)

    def test_simultaneous_first_emits_start_one_worker_and_close_joins_it(self):
        d = self.dispatcher
        workers = []
        real_thread = threading.Thread
        construct_barrier = threading.Barrier(2)
        start_barrier = threading.Barrier(3)

        def construct(*args, **kwargs):
            worker = real_thread(*args, **kwargs)
            workers.append(worker)
            try:
                construct_barrier.wait(0.25)
            except threading.BrokenBarrierError:
                pass
            return worker

        def emit(n):
            start_barrier.wait(2)
            d.emit("take.created", {"n": n})

        senders = [real_thread(target=emit, args=(n,)) for n in range(2)]
        try:
            with patch("mio_server.webhooks.threading.Thread", side_effect=construct):
                for sender in senders:
                    sender.start()
                start_barrier.wait(2)
                for sender in senders:
                    sender.join(2)
                    self.assertFalse(sender.is_alive())
            d.flush()
            d.close()
            self.assertEqual(len(workers), 1)
            self.assertFalse(any(worker.is_alive() for worker in workers))
            self.assertEqual(d._queue.unfinished_tasks, 0)
        finally:
            for worker in workers:
                if worker.is_alive():
                    d._queue.put(None)
            for worker in workers:
                worker.join(2)

    def test_close_finishes_inflight_request_and_drops_unstarted_events(self):
        d = self.dispatcher
        self.store.put_doc(Webhook(url="https://example.test/hook", events=["*"]))
        entered, release, closing = threading.Event(), threading.Event(), threading.Event()
        requests = []

        def receive(request):
            requests.append(request)
            entered.set()
            if not release.wait(2):
                raise AssertionError("test did not release the in-flight request")
            return httpx.Response(200)

        put = d._queue.put

        def queue_put(item):
            put(item)
            if item is None:
                closing.set()

        d.transport = httpx.MockTransport(receive)
        d._queue.put = queue_put
        closer = threading.Thread(target=d.close)
        try:
            d.emit("take.created", {"n": 1})
            self.assertTrue(entered.wait(2))
            d.emit("take.created", {"n": 2})
            d.emit("take.created", {"n": 3})
            closer.start()
            self.assertTrue(closing.wait(2))
            d.emit("take.created", {"n": 4})
            release.set()
            closer.join(2)
            self.assertFalse(closer.is_alive())
            self.assertFalse(d._thread.is_alive())
            self.assertEqual(len(requests), 1)
            self.assertEqual(d._queue.unfinished_tasks, 0)
            d.close()
            self.assertEqual(d._queue.unfinished_tasks, 0)
        finally:
            release.set()
            if closer.ident is not None:
                closer.join(2)

    def test_close_interrupts_backoff_and_no_retry_starts(self):
        d = self.dispatcher
        self.store.put_doc(Webhook(url="https://example.test/hook", events=["*"]))
        requests, sleeping = [], threading.Event()
        sleep = d.sleep

        def backoff(delay):
            sleeping.set()
            sleep(delay)

        d.sleep = backoff
        d.transport = httpx.MockTransport(lambda req: requests.append(req) or httpx.Response(503))
        d.emit("take.created", {})
        self.assertTrue(sleeping.wait(2))
        d.close()
        self.assertEqual(len(requests), 1)
        self.assertFalse(d._thread.is_alive())
        self.assertEqual(d._queue.unfinished_tasks, 0)
