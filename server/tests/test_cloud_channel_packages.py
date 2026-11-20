"""Offline wire, ambiguity and install lifecycle tests for the independent channel package."""

from __future__ import annotations

import base64
import gzip
import importlib.util
import io
import json
import struct
import sys
import time
import unittest
import zipfile
import zlib
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from unittest import mock

import httpx
from PIL import Image

from mio_server import settings
from mio_server.auth import issue
from mio_server.extensions.ctk import check_package
from mio_server.llm import LLMError
from mio_server.pipeline import cloud_request as CR
from mio_server.pipeline import providers as PV

from .api_harness import ApiCase

PACKAGE = Path(__file__).resolve().parents[2] / "examples/extensions/standard-image-channels"
PRIVATE = "synthetic-channel-credential"
SPEC = importlib.util.spec_from_file_location(
    "standard_channels_fixture", PACKAGE / "main.py", submodule_search_locations=[str(PACKAGE)]
)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
OUTPUT = io.BytesIO()
Image.new("RGB", (8, 8), (21, 42, 63)).save(OUTPUT, "PNG")
PNG = OUTPUT.getvalue()
ENCODED = base64.b64encode(PNG).decode("ascii")


def channel(kind="compatible_images", **changes):
    return PV.ImageChannel(
        id="package-test",
        kind=kind,
        base_url="https://api.invalid/v1",
        model="image-test",
        api_key=PRIVATE,
        width=128,
        height=192,
        **changes,
    )


def adapter(handler, kind="compatible_images", options=None, **changes):
    current = channel(kind, extra_options={"min_interval": 0, **(options or {})}, **changes)
    return MODULE.ADAPTERS[kind][0](current, httpx.MockTransport(handler))


def package_zip():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for path in sorted(PACKAGE.iterdir()):
            if path.is_file():
                archive.write(path, path.name)
    return output.getvalue()


class ChannelPackageTests(unittest.TestCase):
    def test_four_protocols_generate_real_image_bytes(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("image.png", PNG)
        for kind in MODULE.ADAPTERS:
            seen = []

            def respond(request):
                seen.append(request)
                self.assertEqual(request.headers["authorization"], f"Bearer {PRIVATE}")
                if kind == "compatible_images":
                    return httpx.Response(200, json={"data": [{"b64_json": ENCODED}]})
                if kind == "compatible_chat_images":
                    return httpx.Response(
                        200,
                        json={
                            "choices": [
                                {
                                    "message": {
                                        "images": [
                                            {
                                                "image_url": {
                                                    "url": "data:image/png;base64," + ENCODED
                                                }
                                            }
                                        ]
                                    }
                                }
                            ]
                        },
                    )
                if kind == "novel_style_images":
                    return httpx.Response(200, content=archive.getvalue())
                return (
                    httpx.Response(202, json={"id": "task_1", "status": "queued"})
                    if request.method == "POST"
                    else httpx.Response(
                        200, json={"status": "completed", "image": {"b64_json": ENCODED}}
                    )
                )

            with self.subTest(kind=kind):
                current = adapter(
                    respond,
                    kind,
                    options={"max_polls": 1, "poll_interval": 0.01}
                    if kind == "async_images"
                    else None,
                    negative="blur",
                )
                data, reply = current.generate_image("a copper kettle", retries=8)
                self.assertEqual(data, PNG)
                self.assertEqual(sum(request.method == "POST" for request in seen), 1)
                self.assertNotIn(PRIVATE, json.dumps(reply.image_request))
                body = json.loads(seen[0].content)
                self.assertEqual(body["model"], "image-test")
                if kind == "novel_style_images":
                    self.assertEqual(body["parameters"]["seed"], 0)
                    self.assertEqual(body["parameters"]["negative_prompt"], "blur")
                elif kind == "compatible_images":
                    self.assertEqual(body["n"], 1)
                    self.assertIn("Avoid: blur", body["prompt"])

    def test_images_and_chat_send_references_and_novel_v4_parameters(self):
        for kind in ("compatible_images", "compatible_chat_images"):
            seen = []

            def respond(request):
                seen.append(request)
                value = (
                    {"data": [{"b64_json": ENCODED}]}
                    if kind == "compatible_images"
                    else {
                        "choices": [
                            {
                                "message": {
                                    "content": [
                                        {
                                            "type": "image_url",
                                            "image_url": {
                                                "url": "data:image/png;base64," + ENCODED
                                            },
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                )
                return httpx.Response(200, json=value)

            current = adapter(respond, kind)
            self.assertEqual(current.generate_image("a kettle", refs=[PNG])[0], PNG)
            if kind == "compatible_images":
                self.assertEqual(seen[0].url.path, "/v1/images/edits")
                self.assertIn(b'name="image[]"', seen[0].content)
            else:
                content = json.loads(seen[0].content)["messages"][0]["content"]
                self.assertEqual(content[1]["type"], "image_url")
                self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/png;base64,"))
        seen = []
        current = adapter(
            lambda request: (
                seen.append(json.loads(request.content)) or httpx.Response(200, content=PNG)
            ),
            "novel_style_images",
        )
        current.channel.model = "nai-diffusion-4-test"
        current.generate_image("a kettle")
        self.assertIn("v4_prompt", seen[0]["parameters"])
        self.assertEqual(seen[0]["parameters"]["v4_prompt"]["caption"]["base_caption"], "a kettle")

    def test_post_fault_matrix_never_repeats_or_echoes_credentials(self):
        cases = [
            (400, False),
            (401, False),
            (403, False),
            (422, False),
            (408, True),
            (409, True),
            (425, True),
            (429, False),
            (500, True),
            (503, True),
            (302, True),
            (httpx.ConnectError, False),
            (httpx.ConnectTimeout, False),
            (httpx.ReadTimeout, True),
            (httpx.ReadError, True),
        ]
        for failure, sent in cases:
            seen = []

            def respond(request):
                seen.append(request)
                if isinstance(failure, type):
                    raise failure(PRIVATE, request=request)
                return httpx.Response(
                    failure,
                    text=PRIVATE,
                    headers={"Retry-After": "0", "Location": "https://evil.invalid/"},
                )

            with self.subTest(failure=failure), self.assertRaises(LLMError) as caught:
                adapter(respond).generate_image("a kettle", retries=10)
            self.assertEqual(len(seen), 1)
            self.assertEqual(caught.exception.sent, sent)
            self.assertFalse(caught.exception.retryable)
            self.assertNotIn(PRIVATE, str(caught.exception))

    def test_malformed_success_remains_uncertain_without_resubmission(self):
        for content in (
            b"not-json",
            b"[]",
            b'{"data":[]}',
            b'{"data":[{"b64_json":"bad"}]}',
            json.dumps(
                {"data": [{"b64_json": base64.b64encode(b"invalid image").decode()}]}
            ).encode(),
        ):
            seen = []
            with self.subTest(content=content[:25]), self.assertRaises(LLMError) as caught:
                adapter(
                    lambda request: seen.append(request) or httpx.Response(200, content=content)
                ).generate_image("a kettle", retries=5)
            self.assertTrue(caught.exception.sent)
            self.assertEqual(len(seen), 1)

    def test_downloads_strip_credentials_and_reject_external_or_redirected_urls(self):
        seen = []

        def respond(request):
            seen.append(request)
            if request.method == "POST":
                return httpx.Response(
                    200,
                    json={"data": [{"url": "/art.png"}]},
                    headers={"Set-Cookie": f"session={PRIVATE}; Path=/"},
                )
            self.assertNotIn("authorization", request.headers)
            self.assertNotIn("cookie", request.headers)
            return httpx.Response(200, content=PNG)

        self.assertEqual(adapter(respond).generate_image("a kettle")[0], PNG)
        self.assertEqual([request.method for request in seen], ["POST", "GET"])
        urls = (
            "https://evil.invalid/art.png",
            "http://127.0.0.1/admin",
            "file:///private",
            "//evil.invalid/art",
            "https://api.invalid@evil.invalid/a",
            "https://api.invalid:444/a",
        )
        for url in urls:
            seen = []
            with self.subTest(url=url), self.assertRaises(LLMError) as caught:
                adapter(
                    lambda request: (
                        seen.append(request) or httpx.Response(200, json={"data": [{"url": url}]})
                    )
                ).generate_image("a kettle", retries=8)
            self.assertTrue(caught.exception.sent)
            self.assertEqual(len(seen), 1)
        seen = []

        def redirect(request):
            seen.append(request)
            return (
                httpx.Response(200, json={"data": [{"url": "/art"}]})
                if request.method == "POST"
                else httpx.Response(302, headers={"Location": "https://evil.invalid/art"})
            )

        with self.assertRaises(LLMError) as caught:
            adapter(redirect).generate_image("a kettle")
        self.assertTrue(caught.exception.sent)
        self.assertEqual(len(seen), 2)

        for succeed in (True, False):
            seen = []

            def limited(request):
                seen.append(request)
                if request.method == "POST":
                    return httpx.Response(200, json={"data": [{"url": "/art"}]})
                self.assertNotIn("authorization", request.headers)
                self.assertNotIn("cookie", request.headers)
                if len(seen) == 4 and succeed:
                    return httpx.Response(200, content=PNG)
                return httpx.Response(429 if len(seen) == 2 else 503, headers={"Retry-After": "0"})

            if succeed:
                self.assertEqual(adapter(limited).generate_image("a kettle")[0], PNG)
            else:
                with self.assertRaises(LLMError) as caught:
                    adapter(limited).generate_image("a kettle", retries=10)
                self.assertTrue(caught.exception.sent)
            self.assertEqual([request.method for request in seen], ["POST"] + ["GET"] * 3)

    def test_poll_get_faults_retry_with_a_finite_budget_and_one_post(self):
        seen = []

        def respond(request):
            seen.append(request)
            if request.method == "POST":
                return httpx.Response(202, json={"id": "task_1", "status": "queued"})
            if len(seen) == 2:
                return httpx.Response(429, headers={"Retry-After": "0"})
            if len(seen) == 3:
                return httpx.Response(503, headers={"Retry-After": "0"})
            if len(seen) == 4:
                raise httpx.ReadTimeout(PRIVATE, request=request)
            return httpx.Response(
                200, json={"status": "completed", "result": {"b64_json": ENCODED}}
            )

        with mock.patch.object(MODULE.channels.Transfer, "wait"):
            data, _ = adapter(respond, "async_images", {"max_polls": 4}).generate_image(
                "a kettle", retries=8
            )
        self.assertEqual(data, PNG)
        self.assertEqual([request.method for request in seen], ["POST"] + ["GET"] * 4)
        seen = []
        with (
            mock.patch.object(MODULE.channels.Transfer, "wait"),
            self.assertRaises(LLMError) as caught,
        ):
            adapter(
                lambda request: (
                    seen.append(request)
                    or httpx.Response(200, json={"id": "task_1", "status": "running"})
                ),
                "async_images",
                {"max_polls": 2},
            ).generate_image("a kettle")
        self.assertTrue(caught.exception.sent)
        self.assertEqual([request.method for request in seen], ["POST", "GET", "GET"])

    def test_local_cancel_shutdown_and_deadline_preserve_submission_truth(self):
        seen = []
        current = adapter(lambda request: seen.append(request) or httpx.Response(200))
        current.cancel()
        with self.assertRaises(LLMError) as caught:
            current.generate_image("a kettle")
        self.assertFalse(caught.exception.sent)
        self.assertFalse(seen)
        for stop in ("cancel", "shutdown", "deadline"):
            seen = []

            def respond(request):
                seen.append(request)
                if stop == "cancel":
                    current.cancel()
                elif stop == "shutdown":
                    current.scope.close()
                else:
                    time.sleep(0.02)
                return httpx.Response(202, json={"id": "task_1", "status": "queued"})

            current = adapter(respond, "async_images")
            with self.subTest(stop=stop), self.assertRaises(LLMError) as caught:
                current.generate_image("a kettle", timeout=0.01 if stop == "deadline" else 10)
            self.assertTrue(caught.exception.sent)
            self.assertEqual(len(seen), 1)

    def test_tiny_transport_chunks_check_deadline_cancel_and_shutdown_before_aggregation(self):
        for stop in ("deadline", "cancel", "shutdown"):
            clock, chunks = [0.0], []

            class Trickle(httpx.SyncByteStream):
                def __iter__(self):
                    for index in range(40):
                        clock[0] += 0.005
                        chunks.append(index)
                        if index == 2 and stop != "deadline":
                            current.cancel() if stop == "cancel" else current.scope.close()
                        yield b" "

            current = adapter(lambda request: httpx.Response(200, stream=Trickle()))
            with (
                self.subTest(stop=stop),
                mock.patch.object(MODULE.channels.time, "monotonic", side_effect=lambda: clock[0]),
                self.assertRaises(LLMError) as caught,
            ):
                current.generate_image("a kettle", timeout=0.02 if stop == "deadline" else 10)
            self.assertTrue(caught.exception.sent)
            self.assertEqual(len(chunks), 4 if stop == "deadline" else 3)
            self.assertLessEqual(clock[0], 0.02)

    def test_rate_cooldowns_accept_http_dates_and_never_store_plain_keys(self):
        scope = MODULE.Scope()
        with mock.patch.object(MODULE.channels.time, "monotonic", return_value=100):
            self.assertEqual(scope.reserve("origin", 2), 0)
            self.assertEqual(scope.reserve("origin", 2), 2)
            scope.reserve("origin", 0, cooldown=30)
            self.assertEqual(scope.reserve("origin", 0), 30)
            self.assertEqual(scope.cooldown("origin"), 30)
        from standard_channels_fixture.transport import retry_after

        self.assertEqual(retry_after("99999"), 30)
        self.assertEqual(retry_after("nan"), 1)
        date = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=20), usegmt=True)
        self.assertTrue(0 <= retry_after(date) <= 20)

        for index in range(300):
            scope.reserve(index, 0)
        self.assertEqual(len(scope.next_at), 256)
        with MODULE.channels.Transfer(
            channel(), None, MODULE.Scope(), MODULE.channels.threading.Event(), 10
        ) as transfer:
            self.assertNotIn(PRIVATE, repr(transfer.key))

    def test_waiting_senders_are_readmitted_to_distinct_slots_after_a_429_cooldown(self):
        scope, clock, interval = MODULE.Scope(), [0.0], 0.03
        with mock.patch.object(MODULE.channels.time, "monotonic", side_effect=lambda: clock[0]):
            self.assertEqual(scope.reserve("shared", interval), 0)
            # Two callers are already waiting when the first response imposes cooldown.
            self.assertEqual(scope.reserve("shared", interval), interval)
            self.assertEqual(scope.reserve("shared", interval), interval)
            scope.reserve("shared", 0, cooldown=0.15)
            clock[0] = 0.15
            self.assertEqual(scope.reserve("shared", interval), 0)
            self.assertAlmostEqual(scope.reserve("shared", interval), interval)
            clock[0] = 0.18
            self.assertEqual(scope.reserve("shared", interval), 0)

        # The transfer must re-enter that gate after every wait, rather than only checking
        # a shared cooldown timestamp and sending all previously reserved requests at once.
        current = adapter(
            lambda request: httpx.Response(200, json={"data": [{"b64_json": ENCODED}]})
        )
        with (
            mock.patch.object(current.scope, "reserve", side_effect=[0.03, 0.12, 0]) as gate,
            mock.patch.object(MODULE.channels.Transfer, "wait") as wait,
        ):
            self.assertEqual(current.generate_image("a kettle")[0], PNG)
        self.assertEqual(gate.call_count, 3)
        self.assertEqual(wait.call_args_list, [mock.call(0.03), mock.call(0.12)])

    def test_oversized_encoded_zip_compressed_http_and_pixel_bombs_are_rejected(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            output.writestr("image.png", b"x" * 2048)
        bomb = bytearray(PNG)
        bomb[16:24] = struct.pack(">II", 100000, 100000)
        bomb[29:33] = struct.pack(">I", zlib.crc32(bomb[12:29]))
        cases = [
            ("compatible_images", httpx.Response(200, json={"data": [{"b64_json": "A" * 2048}]})),
            (
                "compatible_images",
                httpx.Response(200, content=b"x", headers={"Content-Length": "999999"}),
            ),
            (
                "compatible_images",
                httpx.Response(
                    200, content=gzip.compress(b"x"), headers={"Content-Encoding": "gzip"}
                ),
            ),
            ("novel_style_images", httpx.Response(200, content=archive.getvalue())),
            ("novel_style_images", httpx.Response(200, content=bytes(bomb))),
        ]
        for kind, response in cases:
            seen = []
            with self.subTest(kind=kind), self.assertRaises(LLMError) as caught:
                adapter(
                    lambda request: seen.append(request) or response,
                    kind,
                    {"max_result_bytes": 1024},
                ).generate_image("a kettle", retries=8)
            self.assertTrue(caught.exception.sent)
            self.assertEqual(len(seen), 1)

        chunks = []

        class TooLarge(httpx.SyncByteStream):
            def __iter__(self):
                for index in range(5):
                    chunks.append(index)
                    yield b"x" * 1024

        seen = []

        def streamed(request):
            seen.append(request)
            return (
                httpx.Response(200, json={"data": [{"url": "/art"}]})
                if request.method == "POST"
                else httpx.Response(200, stream=TooLarge())
            )

        with self.assertRaises(LLMError) as caught:
            adapter(streamed, options={"max_result_bytes": 1024}).generate_image("a kettle")
        self.assertTrue(caught.exception.sent)
        self.assertEqual(len(seen), 2)
        self.assertLessEqual(len(chunks), 2)

    def test_invalid_async_options_and_task_ids_cannot_redirect_requests(self):
        for options in (
            {"poll_path": "https://evil.invalid/{id}"},
            {"poll_path": "/jobs/{id}/{other}"},
            {"submit_path": "/%2e%2e/admin"},
            {"api_key": PRIVATE},
            {"max_polls": True},
        ):
            seen = []
            with self.subTest(options=list(options)), self.assertRaises(LLMError) as caught:
                adapter(
                    lambda request: seen.append(request), "async_images", options
                ).generate_image("a kettle")
            self.assertFalse(caught.exception.sent)
            self.assertNotIn(PRIVATE, str(caught.exception))
            self.assertFalse(seen)
        for response in (
            {"id": "../admin", "status": "queued"},
            {"id": "safe", "status": "unknown"},
            {"id": "safe", "status": "failed", "error": PRIVATE},
        ):
            seen = []
            with self.subTest(response=response["status"]), self.assertRaises(LLMError) as caught:
                adapter(
                    lambda request: seen.append(request) or httpx.Response(202, json=response),
                    "async_images",
                ).generate_image("a kettle", retries=8)
            self.assertTrue(caught.exception.sent)
            self.assertNotIn(PRIVATE, str(caught.exception))
            self.assertEqual(len(seen), 1)

    def test_large_or_forged_zip_directories_are_rejected_before_zipinfo_allocation(self):
        cases = []
        for count in (17, 20001):
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w") as archive:
                for index in range(count):
                    archive.writestr(f"{index}.png", b"")
            body = output.getvalue()
            cases.append(body)
            # Do not trust a footer claiming one image while the actual directory is huge.
            forged = bytearray(body)
            struct.pack_into("<HH", forged, len(forged) - 14, 1, 1)
            cases.append(bytes(forged))
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            entry = zipfile.ZipInfo("image.png")
            entry.extra = struct.pack("<HH", 1, 0)  # Explicit unsupported ZIP64 field.
            archive.writestr(entry, PNG)
        cases.append(output.getvalue())
        transfer = type("Limits", (), {"limit": 16 * 1024 * 1024})()
        for body in cases:
            with (
                self.subTest(size=len(body)),
                mock.patch.object(MODULE.channels.images.zipfile, "ZipFile") as construct,
                self.assertRaises(LLMError) as caught,
            ):
                MODULE.channels.images.zipped_image(body, transfer)
            self.assertTrue(caught.exception.sent)
            construct.assert_not_called()

    def test_jpeg_must_fully_decode_without_reencoding_or_accepting_truncated_bytes(self):
        output = io.BytesIO()
        Image.new("RGB", (8, 8), (21, 42, 63)).save(output, "JPEG")
        original = output.getvalue()
        self.assertEqual(MODULE.channels.images.image_bytes(original, 1024), original)
        for kind in ("compatible_images", "novel_style_images"):
            truncated = original[:-2]
            reply = {"data": [{"b64_json": base64.b64encode(truncated).decode("ascii")}]}
            seen = []
            with self.subTest(kind=kind), self.assertRaises(LLMError) as caught:
                adapter(
                    lambda request: (
                        seen.append(request)
                        or (
                            httpx.Response(200, json=reply)
                            if kind == "compatible_images"
                            else httpx.Response(200, content=truncated)
                        )
                    ),
                    kind,
                ).generate_image("a kettle", retries=8)
            self.assertTrue(caught.exception.sent)
            self.assertEqual(len(seen), 1)

    def test_host_freezes_ordinary_options_and_uses_only_current_credentials(self):
        seen = []
        current = channel(
            extra_options={"min_interval": 0, "response_format": "b64_json"}, quality="draft"
        )
        client = PV.build(
            current,
            lambda: None,
            transport=httpx.MockTransport(
                lambda request: (
                    seen.append(request)
                    or httpx.Response(200, json={"data": [{"b64_json": ENCODED}]})
                )
            ),
            kinds={"compatible_images": MODULE.channels.CompatibleImages},
        )
        frozen = CR.freeze_request(client, {"prompt": "a kettle", "negative": "noise"})
        current.model, current.quality, current.api_key = (
            "changed-model",
            "final",
            "rotated-synthetic-credential",
        )
        data, reply = CR.call(client, frozen, [], retries=9)
        self.assertEqual(data, PNG)
        self.assertEqual(seen[0].headers["authorization"], "Bearer rotated-synthetic-credential")
        self.assertEqual(json.loads(seen[0].content)["quality"], "draft")
        self.assertEqual(json.loads(seen[0].content)["model"], "image-test")
        for private in (PRIVATE, current.api_key):
            self.assertNotIn(private, json.dumps(reply.image_request))
            self.assertNotIn(
                private, json.dumps(settings.public(settings.AppSettings(image_channels=[current])))
            )
        self.assertEqual(current.model, "changed-model")


class ChannelPackageLifecycleTests(ApiCase):
    def test_ctk_install_review_enable_disable_reenable_and_remove(self):
        self.assertTrue(check_package(PACKAGE, "extension").valid)
        info = self.ok(self.client.post("/api/extensions", content=package_zip()), 201)
        self.assertEqual(info["status"], "disabled")
        root = "/api/extensions/standard-image-channels"
        self.assertEqual(
            self.client.post(root + "/enable", json={"digest": "0" * 64}).status_code, 400
        )
        self.ok(self.client.post(root + "/enable", json={"digest": info["digest"]}))
        token, raw = issue("Channel package read fixture", ["read"])
        self.ctx.store.put_doc(token)
        response = self.ok(
            self.client.get("/api/v2/image-adapters", headers={"Authorization": "Bearer " + raw})
        )
        descriptors = response["items"] if isinstance(response, dict) else response
        self.assertTrue(set(MODULE.ADAPTERS).issubset(item["id"] for item in descriptors))
        factory = self.ctx.registry.get("cloud_adapter", "compatible_images")
        client = factory(
            channel(extra_options={"min_interval": 0}),
            httpx.MockTransport(
                lambda request: httpx.Response(200, json={"data": [{"b64_json": ENCODED}]})
            ),
        )
        self.assertEqual(client.generate_image("a kettle")[0], PNG)
        self.ok(self.client.post(root + "/disable"))
        self.assertNotIn(
            "compatible_images", {item.id for item in self.ctx.registry.all("cloud_adapter")}
        )
        with self.assertRaises(LLMError) as caught:
            client.generate_image("a kettle")
        self.assertFalse(caught.exception.sent)
        self.ok(self.client.post(root + "/enable", json={"digest": info["digest"]}))
        self.assertIsNotNone(self.ctx.registry.get("cloud_adapter", "compatible_images"))
        self.ok(self.client.delete(root), 204)
        self.assertFalse((self.ctx.extensions.root / "standard-image-channels").exists())
        self.assertNotIn(
            "compatible_images", {item.id for item in self.ctx.registry.all("cloud_adapter")}
        )
