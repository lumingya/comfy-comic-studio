"""Platform-neutral automation uses the generated SDK and isolated fake image executor."""

from __future__ import annotations

import http.client
import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import threading
import types
import unittest
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, redirect_stdout
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import urlsplit
from urllib.response import addinfourl

from mio_server.webhooks import sign

from .api_harness import ApiCase
from .test_album import metadata

CLIENTS = Path(__file__).resolve().parents[2] / "clients" / "python"
STORY = "# Window light\nA quiet morning.\n\n## First\na {subject} by a window\n> Hello.\n\n## Second\na {subject} in a garden\n> See you.\n"
SECRET = "test-only-signing-secret"
NOW = 1_800_000_000


def load_file(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fresh_client():
    """Exercise the actual generator without changing any checked-in generated copy."""
    generator = load_file("sdk_automation_generator", CLIENTS / "generate.py")
    module = types.ModuleType("mio_client")
    exec(
        compile(generator.render_client(generator.load_schema()), "<generated SDK>", "exec"),
        module.__dict__,
    )
    return module


def load_example(name, sdk):
    with patch.dict(sys.modules, {"mio_client": sdk}):
        return load_file("automation_" + name, CLIENTS / (name + ".py"))


def delivery(identifier="delivery-1", *, at=NOW, body=None):
    body = (
        body
        if body is not None
        else json.dumps(
            {"id": identifier, "event": "job.completed", "data": {"job_id": "fake-job"}},
            separators=(",", ":"),
        ).encode()
    )
    headers = {
        "X-Mio-Timestamp": str(at),
        "X-Mio-Signature": sign(SECRET, str(at), body),
        "X-Mio-Delivery": identifier,
        "X-Mio-Event": "job.completed",
    }
    return body, headers


class SDKWebhookReceiverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sdk = fresh_client()
        cls.debug = load_example("webhook_debug", cls.sdk)

    def verify(self, body, headers, *, store=None, now=NOW, **options):
        return self.sdk.verify_webhook(
            body,
            headers,
            SECRET,
            replay_store=store or self.sdk.MemoryReplayStore(),
            clock=lambda: now,
            **options,
        )

    def test_accepts_sender_signature_and_binds_unsigned_headers_to_signed_body(self):
        body, headers = delivery()
        expected = self.verify(body, {name.lower(): value for name, value in headers.items()})
        self.assertEqual(expected["id"], "delivery-1")
        for header in ("X-Mio-Delivery", "X-Mio-Event"):
            store = Mock()
            with self.subTest(header=header), self.assertRaises(self.sdk.WebhookError):
                self.verify(body, {**headers, header: "another-value"}, store=store)
            store.claim.assert_not_called()

    def test_invalid_signatures_never_reserve_a_nonce(self):
        body, headers = delivery()
        store = Mock()
        for altered in (
            {**headers, "X-Mio-Signature": "sha256=" + "0" * 64},
            {**headers, "X-Mio-Signature": "sha256=雪"},
            {**headers, "x-mio-signature": headers["X-Mio-Signature"]},
        ):
            with self.subTest(headers=altered), self.assertRaises(self.sdk.WebhookError):
                self.verify(body, altered, store=store)
        with self.assertRaises(self.sdk.WebhookError):
            self.verify(body + b" ", headers, store=store)
        store.claim.assert_not_called()
        with patch.object(
            self.sdk.hmac, "compare_digest", wraps=self.sdk.hmac.compare_digest
        ) as compare:
            self.verify(body, headers)
        compare.assert_called_once()

    def test_time_window_is_inclusive_and_checks_past_future_and_invalid_clocks(self):
        for offset in (-300, 300):
            body, headers = delivery(at=NOW + offset)
            self.verify(body, headers)
        for offset in (-301, 301):
            body, headers = delivery(at=NOW + offset)
            with self.subTest(offset=offset), self.assertRaises(self.sdk.WebhookError):
                self.verify(body, headers)
        body, headers = delivery()
        for now in (float("nan"), float("inf")):
            with self.assertRaises(self.sdk.WebhookError):
                self.verify(body, headers, now=now)
        for stamp in ("-1", "nan", "1" * 40, "１２３"):
            with self.assertRaises(self.sdk.WebhookError):
                self.verify(body, {**headers, "X-Mio-Timestamp": stamp})

    def test_signed_malformed_json_and_duplicate_keys_do_not_consume_delivery(self):
        for malformed in (b"[]", b"null", b"{", b'{"id":"a","id":"b"}', b"\xff"):
            body, headers = delivery(body=malformed)
            store = Mock()
            with self.subTest(body=malformed), self.assertRaises(self.sdk.WebhookError):
                self.verify(body, headers, store=store)
            store.claim.assert_not_called()

    def test_sqlite_replay_protection_survives_restart_and_rejects_changed_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "replays.sqlite3"
            body, headers = delivery()
            self.verify(body, headers, store=self.debug.SQLiteReplayStore(database))
            restarted = self.debug.SQLiteReplayStore(database)
            with self.assertRaises(self.sdk.WebhookError) as caught:
                self.verify(body, headers, store=restarted)
            self.assertTrue(caught.exception.replayed)
            changed = json.dumps(
                {"id": "delivery-1", "event": "job.completed", "data": "different"}
            ).encode()
            changed_body, changed_headers = delivery(body=changed, at=NOW + 1)
            with self.assertRaises(self.sdk.WebhookError) as caught:
                self.verify(changed_body, changed_headers, store=restarted, now=NOW + 1)
            self.assertTrue(caught.exception.replayed)
            with closing(sqlite3.connect(database)) as connection:
                self.assertEqual(
                    connection.execute("SELECT COUNT(*) FROM deliveries").fetchone()[0], 1
                )
                self.assertNotIn(
                    SECRET, str(connection.execute("SELECT * FROM deliveries").fetchall())
                )
            # Equality at expiry remains a duplicate; strictly later, the old signature expires.
            with self.assertRaises(self.sdk.WebhookError):
                self.verify(body, headers, store=restarted, now=NOW + 300)
            with self.assertRaises(self.sdk.WebhookError) as caught:
                self.verify(body, headers, store=restarted, now=NOW + 301)
            self.assertFalse(caught.exception.replayed)

    def test_later_signed_retry_cannot_replay_after_the_initial_signature_expires(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "late-retry.sqlite3"
            for store in (self.sdk.MemoryReplayStore(), self.debug.SQLiteReplayStore(database)):
                first_body, first_headers = delivery()
                self.verify(first_body, first_headers, store=store)
                # This legitimate retry was intercepted, never seen by this receiver.
                retry_body, retry_headers = delivery(body=first_body, at=NOW + 12)
                persistent = (
                    self.debug.SQLiteReplayStore(database)
                    if isinstance(store, self.debug.SQLiteReplayStore)
                    else store
                )
                with self.assertRaises(self.sdk.WebhookError) as caught:
                    self.verify(retry_body, retry_headers, store=persistent, now=NOW + 301)
                self.assertTrue(caught.exception.replayed)
                # Failure is deduplication, not an accidental rejection of all current stamps.
                self.verify(*delivery("fresh-id", at=NOW + 301), store=persistent, now=NOW + 301)

    def test_memory_capacity_refuses_new_deliveries_without_discarding_consumed_ids(self):
        store = self.sdk.MemoryReplayStore(max_entries=1)
        self.verify(*delivery(), store=store)
        with self.assertRaises(RuntimeError):
            self.verify(*delivery("another-id", at=NOW + 301), store=store, now=NOW + 301)
        with self.assertRaises(self.sdk.WebhookError) as caught:
            self.verify(*delivery(at=NOW + 12), store=store, now=NOW + 301)
        self.assertTrue(caught.exception.replayed)

    def test_two_sqlite_instances_atomically_reject_same_id_with_different_bodies(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "shared.sqlite3"
            stores = [self.debug.SQLiteReplayStore(path), self.debug.SQLiteReplayStore(path)]
            barrier = threading.Barrier(2)

            def claim(index):
                barrier.wait()
                return stores[index].claim("same-event", f"digest-{index}", NOW + 300, NOW)

            with ThreadPoolExecutor(max_workers=2) as pool:
                self.assertEqual(sum(pool.map(claim, range(2))), 1)

    def test_memory_and_persistent_claims_are_atomic_and_store_errors_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            for store in (
                self.sdk.MemoryReplayStore(),
                self.debug.SQLiteReplayStore(Path(folder) / "replay.sqlite3"),
            ):
                barrier = threading.Barrier(8)

                def claim(_):
                    barrier.wait()
                    return store.claim("same-id", "digest", NOW + 300, NOW)

                with ThreadPoolExecutor(max_workers=8) as pool:
                    self.assertEqual(sum(pool.map(claim, range(8))), 1)
            failed = Mock()
            failed.claim.side_effect = OSError("storage offline")
            with self.assertRaises(OSError):
                self.verify(*delivery(), store=failed)

    def test_subscribe_saves_server_secret_without_echo_and_debug_output_is_allowlisted(self):
        client = Mock()
        hook = {
            "id": "hook-1",
            "events": ["job.completed"],
            "enabled": True,
            "name": "Receiver",
            "secret": SECRET,
        }
        client.create_webhook.return_value = hook
        client.list_webhooks.return_value = {
            "events": {"job.completed": "Completed"},
            "items": [hook],
        }
        client.test_webhook.return_value = {
            "id": "delivery-1",
            "event": "ping",
            "status": 202,
            "attempts": 1,
            "error": SECRET,
        }
        client.webhook_deliveries.return_value = [client.test_webhook.return_value]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "private.json"
            with redirect_stdout(io.StringIO()) as output:
                summaries = [
                    self.debug.subscribe(
                        client, "http://receiver.invalid/mio-webhook", ["job.completed"], path
                    )
                ]
                summaries.extend(
                    self.debug.debug_subscription(client, name, "hook-1")
                    for name in ("list", "test", "deliveries")
                )
            self.assertEqual(self.debug.read_secret(path), SECRET)
            self.assertNotIn(SECRET, output.getvalue() + json.dumps(summaries))
            with self.assertRaises(FileExistsError):
                self.debug.subscribe(client, "http://receiver.invalid", ["job.completed"], path)
            self.assertEqual(client.create_webhook.call_count, 1)

    def test_real_local_receiver_acknowledges_retries_without_reprocessing_or_payload_logs(self):
        with tempfile.TemporaryDirectory() as folder:
            store = self.debug.SQLiteReplayStore(Path(folder) / "receiver.sqlite3")
            handler = self.debug.receiver_handler(SECRET, store, clock=lambda: NOW)
            with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    body, headers = delivery()
                    statuses = []
                    with redirect_stdout(io.StringIO()) as output:
                        for supplied in ({**headers, "X-Mio-Signature": "bad"}, headers, headers):
                            with closing(
                                http.client.HTTPConnection("127.0.0.1", server.server_port)
                            ) as connection:
                                connection.request("POST", "/mio-webhook", body, supplied)
                                response = connection.getresponse()
                                statuses.append(response.status)
                                response.read()
                    self.assertEqual(statuses, [401, 202, 200])
                    self.assertEqual(output.getvalue().count('"accepted": true'), 1)
                    self.assertNotIn(SECRET, output.getvalue())
                    self.assertNotIn("fake-job", output.getvalue())
                finally:
                    server.shutdown()
                    thread.join(timeout=2)

    def test_receiver_capacity_failure_is_503_and_not_a_duplicate_acknowledgment(self):
        store = self.sdk.MemoryReplayStore(max_entries=1)
        self.verify(*delivery(), store=store)
        handler = self.debug.receiver_handler(SECRET, store, clock=lambda: NOW)
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                body, headers = delivery("new-id")
                with closing(
                    http.client.HTTPConnection("127.0.0.1", server.server_port)
                ) as connection:
                    connection.request("POST", "/mio-webhook", body, headers)
                    response = connection.getresponse()
                    self.assertEqual(response.status, 503)
                    response.read()
            finally:
                server.shutdown()
                thread.join(timeout=2)


class SDKMarkdownAutomationTests(ApiCase):
    @classmethod
    def setUpClass(cls):
        cls.sdk = fresh_client()
        cls.automation = load_example("markdown_album", cls.sdk)

    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty"
        token = self.ok(
            self.client.post(
                "/api/tokens", json={"name": "automation", "scopes": ["read", "write", "render"]}
            ),
            201,
        )["token"]
        self.mio = self.sdk.MioClient("http://127.0.0.1", token=token)
        self.requests = []
        transport = patch.object(self.sdk.urllib.request, "urlopen", side_effect=self.request)
        transport.start()
        self.addCleanup(transport.stop)

    def request(self, request, *, timeout):
        url = urlsplit(request.full_url)
        self.assertEqual(url.netloc, "127.0.0.1")
        self.assertTrue(url.path.startswith("/api/v2/"))
        self.requests.append((request.get_method(), url.path))
        if request.get_method() == "GET" and url.path.startswith("/api/v2/jobs/"):
            self.ctx.engine.tick()
        response = self.client.request(
            request.get_method(),
            request.full_url,
            headers=dict(request.header_items()),
            content=request.data,
        )
        stream = io.BytesIO(response.content)
        if response.status_code >= 400:
            raise urllib.error.HTTPError(
                request.full_url,
                response.status_code,
                response.reason_phrase,
                response.headers,
                stream,
            )
        return addinfourl(stream, response.headers, request.full_url, response.status_code)

    def run_album(self, folder, *, adopt=True, **options):
        return self.automation.run_album(
            self.mio,
            STORY,
            folder,
            source={"workflow_id": "builtin_t2i_sdxl"},
            idempotency_key="markdown-example-001",
            adopt_first=adopt,
            timeout=15,
            poll=0.01,
            **options,
        )

    def test_markdown_to_frozen_task_adoption_html_pdf_and_idempotent_resume(self):
        preset = self.mio.create_preset(
            {"title": "Subject", "entries": [{"key": "subject", "value": "red chair"}]}
        )
        destination = Path(self.tmp) / "album"
        receipt = self.run_album(destination, preset_ids=[preset["id"]])
        self.assertEqual(receipt["status"], "completed")
        job = self.mio.get_job(receipt["job_id"])
        self.assertEqual(
            [item["input"]["meta"]["prompt"] for item in job["items"]],
            ["a red chair by a window", "a red chair in a garden"],
        )
        html = (destination / "album.html").read_text(encoding="utf-8")
        self.assertIn('data-layout="gallery"', html)
        self.assertIn("MONOGRAPH", html)
        self.assertEqual(metadata(html)["schema"], "mio.album-html.v1")
        self.assertEqual(len(metadata(html)["books"][0]["album"]["steps"]), 2)
        self.assertTrue((destination / "album.pdf").read_bytes().startswith(b"%PDF-"))
        stored = (destination / "mio-automation.json").read_text(encoding="utf-8")
        self.assertNotIn(self.mio.token, stored)
        self.assertNotIn("red chair", stored)
        before = len(self.ctx.engine.list())
        replay = self.run_album(destination, preset_ids=[preset["id"]])
        self.assertEqual(replay, receipt)
        self.assertEqual(len(self.ctx.engine.list()), before)
        self.assertEqual(
            sum(
                path == "/api/v2/workshop/storyboards" and verb == "POST"
                for verb, path in self.requests
            ),
            1,
        )
        count = len(self.requests)
        with self.assertRaises(ValueError):
            self.run_album(destination, preset_ids=[])
        self.assertEqual(len(self.requests), count)

    def test_manual_adoption_is_the_default_and_resumes_without_new_render(self):
        destination = Path(self.tmp) / "manual"
        first = self.run_album(destination, adopt=False)
        self.assertEqual(first["status"], "awaiting_adoption")
        self.assertFalse((destination / "album.html").exists())
        episode = self.mio.get_episode(first["episode_id"])
        self.assertTrue(all(take["status"] == "candidate" for take in episode["takes"]))
        for take in episode["takes"]:
            self.mio.adopt_take(episode["id"], take["id"])
        second = self.run_album(destination, adopt=False)
        self.assertEqual(second["status"], "completed")
        self.assertEqual(second["job_id"], first["job_id"])

    def test_existing_outputs_and_changed_intents_are_never_overwritten(self):
        folder = Path(self.tmp) / "existing"
        folder.mkdir()
        output = folder / "album.html"
        output.write_bytes(b"keep my work")
        count = len(self.requests)
        with self.assertRaises(FileExistsError):
            self.run_album(folder)
        self.assertEqual(len(self.requests), count)
        self.assertEqual(output.read_bytes(), b"keep my work")

    def test_lost_creation_response_survives_restart_without_blind_recreation(self):
        destination = Path(self.tmp) / "lost-response"
        create = self.mio.create_storyboard
        created_ids = []

        def lose_response(body):
            created_ids.append(create(body)["id"])
            raise OSError("simulated lost response")

        with patch.object(self.mio, "create_storyboard", side_effect=lose_response):
            with self.assertRaises(self.automation.CreationPendingError):
                self.run_album(destination)
        receipt = json.loads((destination / "mio-automation.json").read_text(encoding="utf-8"))
        self.assertEqual(receipt["creation"], "pending")
        restarted = load_example("markdown_album", self.sdk)
        with patch.object(self.mio, "create_storyboard", wraps=create) as new_create:
            with self.assertRaises(restarted.CreationPendingError):
                restarted.run_album(
                    self.mio,
                    STORY,
                    destination,
                    source={"workflow_id": "builtin_t2i_sdxl"},
                    idempotency_key="markdown-example-001",
                    adopt_first=True,
                )
            new_create.assert_not_called()
        recovered = self.run_album(destination, bind_storyboard=created_ids[0])
        self.assertEqual(recovered["status"], "completed")
        self.assertEqual(recovered["storyboard_id"], created_ids[0])
        self.assertEqual(
            sum(
                verb == "POST" and path == "/api/v2/workshop/storyboards"
                for verb, path in self.requests
            ),
            1,
        )

    def test_failed_receipt_after_successful_create_keeps_pending_and_exposes_only_resource_id(
        self,
    ):
        destination = Path(self.tmp) / "receipt-failure"
        save = self.automation.save_receipt
        calls = 0

        def fail_second(path, receipt):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated disk full")
            save(path, receipt)

        with patch.object(self.automation, "save_receipt", side_effect=fail_second):
            with self.assertRaises(self.automation.CreationPendingError) as caught:
                self.run_album(destination)
        identifier = caught.exception.storyboard_id
        self.assertTrue(identifier)
        self.assertEqual(
            json.loads((destination / "mio-automation.json").read_text())["creation"], "pending"
        )
        with patch.object(self.mio, "create_storyboard") as create:
            with self.assertRaises(self.automation.CreationPendingError):
                self.run_album(destination)
            create.assert_not_called()
        self.assertEqual(
            self.run_album(destination, bind_storyboard=identifier)["status"], "completed"
        )

    def test_pending_cli_binding_rejects_different_story_content_without_creating_or_generating(
        self,
    ):
        destination = Path(self.tmp) / "mismatched-binding"
        with patch.object(self.mio, "create_storyboard", side_effect=OSError("lost response")):
            with self.assertRaises(self.automation.CreationPendingError):
                self.run_album(destination)
        receipt_path = destination / "mio-automation.json"
        pending = receipt_path.read_bytes()
        self.assertEqual(json.loads(pending)["creation"], "pending")
        story_path = Path(self.tmp) / "binding-story.md"
        story_path.write_text(STORY, encoding="utf-8")
        board = self.automation.parse_markdown(STORY)
        mismatches = {}
        for field in ("title", "description", "prompt", "dialogue", "count", "order"):
            changed = json.loads(json.dumps(board))
            if field == "title":
                changed["title"] = "PRIVATE unrelated title"
            elif field == "description":
                changed["panels"][0]["description"] = "PRIVATE unrelated panel"
            elif field == "prompt":
                changed["panels"][0]["overrides"]["raw_prompt"] = "PRIVATE unrelated prompt"
            elif field == "dialogue":
                changed["panels"][0]["dialogues"][0]["text"] = "PRIVATE unrelated dialogue"
            elif field == "count":
                changed["panels"].pop()
            else:
                changed["panels"].reverse()
            mismatches[field] = self.mio.create_storyboard(changed)["id"]

        for field, identifier in mismatches.items():
            with (
                self.subTest(mismatch=field),
                patch.dict("os.environ", {"MIO_TOKEN": self.mio.token}),
                patch.object(self.automation, "MioClient", return_value=self.mio),
                patch.object(self.mio, "create_storyboard") as create,
                patch.object(self.mio, "generate_workshop_task") as generate,
                redirect_stdout(io.StringIO()) as output,
            ):
                before = len(self.requests)
                code = self.automation.main(
                    [
                        str(story_path),
                        "--out",
                        str(destination),
                        "--base-url",
                        "http://127.0.0.1",
                        "--workflow",
                        "builtin_t2i_sdxl",
                        "--idempotency-key",
                        "markdown-example-001",
                        "--adopt-first",
                        "--bind-storyboard",
                        identifier,
                    ]
                )
                self.assertEqual(code, 1)
                self.assertEqual(json.loads(output.getvalue())["status"], "stopped")
                self.assertEqual(
                    self.requests[before:],
                    [("GET", f"/api/v2/workshop/storyboards/{identifier}")],
                )
                create.assert_not_called()
                generate.assert_not_called()
                self.assertEqual(receipt_path.read_bytes(), pending)
                for private in (
                    STORY,
                    "a {subject} by a window",
                    "PRIVATE unrelated",
                    self.mio.token,
                ):
                    self.assertNotIn(private, output.getvalue())

    def test_pending_marker_write_failure_makes_no_creation_request(self):
        with patch.object(self.automation, "save_receipt", side_effect=OSError("disk unavailable")):
            with patch.object(self.mio, "create_storyboard") as create:
                with self.assertRaises(OSError):
                    self.run_album(Path(self.tmp) / "never-created")
                create.assert_not_called()

    def test_one_command_cli_runs_the_sdk_flow_without_printing_credentials(self):
        story = Path(self.tmp) / "story.md"
        story.write_text(STORY.replace("{subject}", "red chair"), encoding="utf-8")
        with (
            patch.dict("os.environ", {"MIO_TOKEN": self.mio.token}),
            redirect_stdout(io.StringIO()) as output,
        ):
            code = self.automation.main(
                [
                    str(story),
                    "--out",
                    str(Path(self.tmp) / "cli-output"),
                    "--base-url",
                    "http://127.0.0.1",
                    "--workflow",
                    "builtin_t2i_sdxl",
                    "--idempotency-key",
                    "one-command-test",
                    "--adopt-first",
                ]
            )
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())["status"], "completed")
        self.assertNotIn(self.mio.token, output.getvalue())

    def test_parser_keeps_variables_dialogue_and_rejects_ambiguous_empty_input(self):
        result = self.automation.parse_markdown(STORY)
        self.assertEqual(result["title"], "Window light")
        self.assertEqual(result["panels"][0]["overrides"]["raw_prompt"], "a {subject} by a window")
        self.assertEqual(result["panels"][1]["dialogues"], [{"text": "See you.", "kind": "speech"}])
        for text in (
            "",
            "# Empty",
            "## Missing title\nprompt",
            "# Title\n## Panel\n> only dialogue",
            "# Title\n```\ncode\n```",
            "# First\n# Second\n## Panel\nprompt",
        ):
            with self.subTest(markdown=text), self.assertRaises(ValueError):
                self.automation.parse_markdown(text)
