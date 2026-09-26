"""P5 cloud adapter regression: NovelAI / OpenAI Images channels (offline, mocked HTTP)."""

from __future__ import annotations

import base64
import io
import json
import unittest
import zipfile
from unittest import mock

import httpx
from PIL import Image

from mio_server import llm as L
from mio_server import settings as SET
from mio_server.pipeline import providers as PV

from .api_harness import ApiCase


def png(color="#336699", size=(8, 8)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


class Recorder:
    """httpx.MockTransport handler that records requests and replays queued responses."""

    def __init__(self, *responses):
        self.responses, self.requests = list(responses), []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.responses.pop(0)

    def transport(self):
        return httpx.MockTransport(self)


def channel(**kw) -> PV.ImageChannel:
    return PV.ImageChannel(id="c1", api_key="sk-test", **kw)


class OpenAIImagesTests(unittest.TestCase):
    def test_generation_json_and_b64_answer(self):
        rec = Recorder(
            httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})
        )
        ch = channel(
            kind="openai_images",
            base_url="https://api.test/v1",
            model="gpt-image-1",
            negative="blurry",
            size="1024x1536",
        )
        data, reply = PV.OpenAIImages(ch, rec.transport()).generate_image("a cat")
        self.assertEqual(data, png())
        self.assertEqual(reply.model, "gpt-image-1")
        req = rec.requests[0]
        self.assertEqual(str(req.url), "https://api.test/v1/images/generations")
        self.assertEqual(req.headers["authorization"], "Bearer sk-test")
        body = json.loads(req.content)
        self.assertEqual(body["prompt"], "a cat\nAvoid: blurry")
        self.assertEqual((body["n"], body["size"]), (1, "1024x1536"))

    def test_references_use_edits_multipart_and_url_answers_are_downloaded(self):
        rec = Recorder(
            httpx.Response(200, json={"data": [{"url": "https://cdn.test/x.png"}]}),
            httpx.Response(200, content=png("#ff0000")),
        )
        ch = channel(kind="openai_images", base_url="https://api.test/v1")
        data, _ = PV.OpenAIImages(ch, rec.transport()).generate_image("edit", refs=[png(), png()])
        self.assertEqual(data, png("#ff0000"))
        edit = rec.requests[0]
        self.assertTrue(str(edit.url).endswith("/images/edits"))
        self.assertIn("multipart/form-data", edit.headers["content-type"])
        self.assertEqual(edit.content.count(b'name="image[]"'), 2)
        self.assertEqual(str(rec.requests[1].url), "https://cdn.test/x.png")

    def test_retryable_status_then_success_and_definitive_failure(self):
        ok = httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})
        rec = Recorder(httpx.Response(429, text="slow down"), ok)
        with mock.patch.object(PV.time, "sleep"):
            data, reply = PV.OpenAIImages(channel(), rec.transport()).generate_image("x")
        self.assertEqual(len(reply.attempts), 1)
        rec = Recorder(httpx.Response(400, text="content policy"))
        with self.assertRaises(L.LLMError) as caught:
            PV.OpenAIImages(channel(), rec.transport()).generate_image("x")
        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(len(rec.requests), 1)  # definitive: not retried


class NovelAITests(unittest.TestCase):
    def zipped(self, data: bytes) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("image_0.png", data)
        return buf.getvalue()

    def test_v4_prompt_format_and_vibe_references(self):
        rec = Recorder(
            httpx.Response(200, content=b"VIBE"),
            httpx.Response(200, content=self.zipped(png())),
        )
        ch = channel(
            kind="novelai",
            model="nai-diffusion-4-5-full",
            width=830,
            height=1210,
            negative="lowres",
        )
        data, _ = PV.NovelAI(ch, rec.transport()).generate_image(
            "@image_1 girl, rain", refs=[png()]
        )
        self.assertEqual(data, png())
        self.assertTrue(str(rec.requests[0].url).endswith("/ai/encode-vibe"))
        body = json.loads(rec.requests[1].content)
        self.assertEqual(str(rec.requests[1].url), "https://image.novelai.net/ai/generate-image")
        p = body["parameters"]
        self.assertEqual(body["input"], "girl, rain")
        self.assertEqual((p["width"], p["height"]), (832, 1216))
        self.assertEqual(p["v4_prompt"]["caption"]["base_caption"], "girl, rain")
        self.assertEqual(p["v4_negative_prompt"]["caption"]["base_caption"], "lowres")
        self.assertEqual(p["reference_image_multiple"], [base64.b64encode(b"VIBE").decode()])
        self.assertNotIn("reference_information_extracted_multiple", p)

    def test_v3_raw_references(self):
        rec = Recorder(httpx.Response(200, content=png()))  # some proxies answer the PNG directly
        ch = channel(kind="novelai", model="nai-diffusion-3")
        PV.NovelAI(ch, rec.transport()).generate_image("girl", refs=[png(), png()])
        p = json.loads(rec.requests[0].content)["parameters"]
        self.assertNotIn("v4_prompt", p)
        self.assertEqual(len(p["reference_image_multiple"]), 2)
        self.assertEqual(p["reference_information_extracted_multiple"], [1.0, 1.0])

    def test_non_image_answer_is_an_error(self):
        rec = Recorder(httpx.Response(200, content=b"not an image"))
        with self.assertRaises(L.LLMError):
            PV.NovelAI(channel(kind="novelai"), rec.transport()).generate_image("x")


class ChannelSettingsTests(unittest.TestCase):
    def test_keys_are_masked_and_kept(self):
        s = SET.AppSettings(image_channels=[channel(kind="novelai")])
        pub = SET.public(s)
        self.assertEqual(pub["image_channels"][0]["api_key"], SET.MASK)
        patched = SET.apply_patch(
            s, {"image_channels": pub["image_channels"], "image_channel": "c1"}
        )
        self.assertEqual(patched.image_channels[0].api_key, "sk-test")

    def test_backend_resolution(self):
        s = SET.AppSettings(image_channels=[channel(kind="novelai")], image_channel="c1")
        self.assertIsInstance(SET.image_backend(s, lambda: "llm"), PV.NovelAI)
        self.assertEqual(
            SET.image_backend(s.model_copy(update={"image_channel": ""}), lambda: "llm"), "llm"
        )
        with self.assertRaises(LookupError):
            SET.image_backend(s, lambda: "llm", "missing")
        odd = SET.AppSettings(image_channels=[channel(kind="ext.kind")], image_channel="c1")
        with self.assertRaises(LookupError):
            SET.image_backend(odd, lambda: "llm")


class FakeKind:
    what = "测试渠道"
    calls: list = []

    def __init__(self, channel, transport=None):
        self.channel = channel

    def generate_image(self, prompt, refs=(), models=None, timeout=360.0, retries=3):
        FakeKind.calls.append((self.channel.id, prompt, len(list(refs))))
        return png("#00ff00", (64, 64)), L.Reply("", "fake-model", 0.1)


class ChannelExecutorTests(ApiCase):
    def test_cloud_edit_uses_the_requested_extension_channel(self):
        FakeKind.calls = []
        self.ctx.registry.register("cloud_adapter", "fake", FakeKind, source="ext:demo")
        ch = {"id": "mine", "kind": "fake"}
        self.ok(self.client.patch("/api/settings", json={"image_channels": [ch]}))
        _, ep = self.make_episode()
        ep = self.adopt_all(ep)
        take = ep["takes"][0]
        body = {
            "take_id": take["id"],
            "kind": "edit",
            "params": {"instruction": "close her eyes", "channel": "mine"},
        }
        job = self.ok(self.client.post(f"/api/episodes/{ep['id']}/edit", json=body))
        self.drain(job)
        self.assertEqual(FakeKind.calls[0][0], "mine")
        self.assertEqual(FakeKind.calls[0][2], 1)  # the current image is reference 1

        body["params"]["channel"] = "gone"
        job = self.ok(self.client.post(f"/api/episodes/{ep['id']}/edit", json=body))
        from .test_jobs import drain

        done = drain(self.ctx.engine, job["id"])
        self.assertEqual(done["state"], "failed")


if __name__ == "__main__":
    unittest.main()
