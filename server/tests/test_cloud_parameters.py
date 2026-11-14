"""Image request contracts, checked at the HTTP boundary and on persisted candidates."""

import base64
import io
import json
import unittest
from email import policy
from email.parser import BytesParser
from types import SimpleNamespace
from unittest import mock

import httpx
from PIL import Image

from mio_server import llm as L
from mio_server.models import AssetRef, PanelOverrides
from mio_server.pipeline import cloud_request as CR
from mio_server.pipeline import providers as PV
from mio_server.pipeline.cloud_jobs import CloudExecutor

from .test_jobs import drain
from .test_providers import Recorder, png
from .test_render_qa import Harness


def image_answer():
    return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})


def choice(slot, asset_id):
    return {
        "slot": slot,
        "asset_id": asset_id,
        "role": "reference",
        "owner": "manual",
        "reason": "manual",
    }


def multipart(request):
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {request.headers['content-type']}\r\nMIME-Version: 1.0\r\n\r\n".encode()
        + request.content
    )
    return [
        (part.get_param("name", header="content-disposition"), part.get_payload(decode=True))
        for part in message.iter_parts()
    ]


class ProviderParameterTests(unittest.TestCase):
    def test_images_json_uses_exact_panel_size_and_prompt_constraints(self):
        rec = Recorder(image_answer())
        channel = PV.ImageChannel(
            id="images",
            negative="channel defect",
            size="1024x1024",
            quality="high",
            api_key="secret-test",
        )
        client = PV.OpenAIImages(channel, rec.transport())
        request = CR.freeze_request(
            client,
            {
                "prompt": "raw author text",
                "negative": "panel defect",
                "width": 777,
                "height": 999,
                "seed": 123,
            },
        )
        _, reply = client.generate_image_request(request, retries=0)
        body = json.loads(rec.requests[0].content)
        self.assertEqual(body["size"], "777x999")
        self.assertEqual(body["quality"], "high")
        self.assertEqual(body["prompt"], "raw author text\nAvoid: panel defect, channel defect")
        self.assertNotIn("seed", body)
        self.assertNotIn("negative_prompt", body)
        snap = reply.image_request
        self.assertEqual(snap["requested"]["prompt"], "raw author text")
        self.assertEqual(snap["effective"]["prompt"], body["prompt"])
        self.assertEqual((snap["effective"]["width"], snap["effective"]["height"]), (777, 999))
        self.assertIsNone(snap["effective"]["seed"])
        self.assertEqual(
            snap["parameter_modes"], {"negative": "prompt", "size": "native", "seed": "unsupported"}
        )
        self.assertNotIn("secret-test", json.dumps(request))
        self.assertNotIn("api_key", json.dumps(snap))

    def test_images_edit_multipart_has_same_parameters_and_ordered_images(self):
        rec = Recorder(image_answer())
        client = PV.OpenAIImages(PV.ImageChannel(id="images", negative="channel"), rec.transport())
        refs = [png("#ff0000"), png("#0000ff")]
        request = CR.freeze_request(
            client,
            {
                "prompt": "two cats",
                "negative": "blur",
                "width": 1152,
                "height": 768,
                "seed": 7,
                "reference_mode": "manual",
                "refs": [choice(1, "red"), choice(2, "blue")],
            },
        )
        _, reply = client.generate_image_request(request, refs, retries=0)
        parts = multipart(rec.requests[0])
        fields = dict((name, data.decode()) for name, data in parts if name != "image[]")
        self.assertTrue(str(rec.requests[0].url).endswith("/images/edits"))
        self.assertEqual(fields["size"], "1152x768")
        self.assertEqual(fields["prompt"], "two cats\nAvoid: blur, channel")
        self.assertNotIn("seed", fields)
        self.assertNotIn("negative_prompt", fields)
        pixels = [
            Image.open(io.BytesIO(data)).getpixel((0, 0))
            for name, data in parts
            if name == "image[]"
        ]
        self.assertEqual(pixels, [(255, 0, 0), (0, 0, 255)])
        self.assertEqual(reply.image_request["effective"]["refs"], request["requested"]["refs"])

    def test_novelai_v3_and_v4_use_panel_parameters_and_reference_order(self):
        for model in ("nai-diffusion-3", "nai-diffusion-4-5-full"):
            with self.subTest(model=model):
                v4 = "diffusion-4" in model
                encoded = (
                    [httpx.Response(200, content=value) for value in (b"RED", b"BLUE")]
                    if v4
                    else []
                )
                rec = Recorder(*encoded, httpx.Response(200, content=png()))
                client = PV.NovelAI(
                    PV.ImageChannel(
                        id="nai",
                        kind="novelai",
                        model=model,
                        width=512,
                        height=512,
                        negative="channel",
                        ref_strength=0.4,
                    ),
                    rec.transport(),
                )
                refs = [png("#ff0000"), png("#0000ff")]
                request = CR.freeze_request(
                    client,
                    {
                        "prompt": "@image_1 cat",
                        "negative": "panel",
                        "width": 830,
                        "height": 1210,
                        "seed": 2**40 + 7,
                        "reference_mode": "manual",
                        "refs": [choice(1, "red"), choice(2, "blue")],
                    },
                )
                _, reply = client.generate_image_request(request, refs, retries=0)
                body = json.loads(rec.requests[-1].content)
                params = body["parameters"]
                self.assertEqual(body["input"], "cat")
                self.assertEqual(
                    (params["width"], params["height"], params["seed"]), (832, 1216, 7)
                )
                self.assertEqual(params["negative_prompt"], "panel, channel")
                self.assertEqual(params["reference_strength_multiple"], [0.4, 0.4])
                if v4:
                    self.assertEqual(
                        params["v4_negative_prompt"]["caption"]["base_caption"], "panel, channel"
                    )
                    expected = [base64.b64encode(value).decode() for value in (b"RED", b"BLUE")]
                    self.assertEqual(params["reference_image_multiple"], expected)
                else:
                    pixels = [
                        Image.open(io.BytesIO(base64.b64decode(value))).getpixel((0, 0))
                        for value in params["reference_image_multiple"]
                    ]
                    self.assertEqual(pixels, [(255, 0, 0), (0, 0, 255)])
                    self.assertNotIn("v4_negative_prompt", params)
                snap = reply.image_request
                self.assertEqual(snap["effective"]["reference_mode"], "vibe")
                self.assertEqual(snap["effective"]["seed"], 7)
                self.assertEqual(
                    set(snap["adjustments"]),
                    {
                        "width_aligned_64",
                        "height_aligned_64",
                        "seed_modulo_32bit",
                        "novelai_reference_tokens_removed",
                    },
                )

    def test_novelai_retry_preserves_generated_seed_and_channel_defaults(self):
        rec = Recorder(httpx.Response(503, text="busy"), httpx.Response(200, content=png()))
        client = PV.NovelAI(
            PV.ImageChannel(id="nai", kind="novelai", width=768, height=1024), rec.transport()
        )
        request = CR.freeze_request(client, {"prompt": "cat"})
        with mock.patch.object(PV.time, "sleep"):
            _, reply = client.generate_image_request(request, retries=2)
        bodies = [json.loads(req.content) for req in rec.requests]
        self.assertEqual(bodies[0], bodies[1])
        params = bodies[0]["parameters"]
        self.assertEqual((params["width"], params["height"]), (768, 1024))
        self.assertEqual(params["seed"], reply.image_request["effective"]["seed"])
        self.assertIsNone(reply.image_request["requested"]["seed"])

    def test_chat_custom_model_receives_all_refs_and_reports_actual_prompt(self):
        client = PV.build(
            PV.ImageChannel(id="chat", kind="chat_image", model="custom-image", negative="channel"),
            lambda: L.Client(pace=0),
        )
        refs = [png("#ff0000"), png("#0000ff"), png("#00ff00")]
        request = CR.freeze_request(
            client,
            {
                "prompt": "raw author text",
                "negative": "panel",
                "width": 777,
                "height": 999,
                "seed": 123,
                "reference_mode": "manual",
                "refs": [choice(i + 1, str(i)) for i in range(3)],
            },
        )
        answer = {
            "choices": [
                {
                    "message": {
                        "images": [
                            {"url": "data:image/png;base64," + base64.b64encode(png()).decode()}
                        ]
                    }
                }
            ]
        }
        with mock.patch.object(client, "_post", return_value=answer) as post:
            _, reply = client.generate_image_request(request, refs, retries=0)
        body = post.call_args.args[1]
        self.assertEqual(body["model"], "custom-image")
        self.assertNotIn("seed", body)
        self.assertNotIn("size", body)
        content = body["messages"][0]["content"]
        self.assertEqual(len([p for p in content if p["type"] == "image_url"]), 3)
        self.assertIn("Avoid: panel, channel", content[0]["text"])
        self.assertIn("777 x 999", content[0]["text"])
        self.assertEqual(reply.image_request["effective"]["prompt"], content[0]["text"])
        self.assertEqual(reply.image_request["requested"]["prompt"], "raw author text")
        self.assertIsNone(reply.image_request["effective"]["seed"])
        self.assertEqual(
            reply.image_request["parameter_modes"],
            {"negative": "prompt", "size": "prompt", "seed": "unsupported"},
        )


class CloudParameterIntegrationTests(Harness):
    def configure(self, rec, **changes):
        self.current_channel = PV.ImageChannel(id="params", api_key="test-secret", **changes)

        def backend(channel_id):
            self.assertEqual(channel_id, "params")
            if self.current_channel is None:
                raise LookupError("channel removed")
            return PV.build(
                self.current_channel, lambda: L.Client(pace=0), transport=rec.transport()
            )

        self.render.cloud_backend = backend
        self.engine.register(
            "cloud.render", CloudExecutor(self.assets, lambda: None, self.render, backend=backend)
        )
        return self.store.put_doc(
            self.render.profile(None).model_copy(
                update={
                    "id": "cloud-params",
                    "cloud_shape": True,
                    "cloud_channel": "params",
                    "candidates": 1,
                }
            )
        )

    def panel(self, panel_id="p02", **changes):
        def mutate(ep):
            panel = ep.panel(panel_id)
            panel.reference_mode = "off"
            panel.overrides = PanelOverrides(**changes)

        self.store.update_episode(self.episode.id, mutate)

    def submit(self, profile, panels=None):
        return self.render.render(self.episode.id, panels or ["p02"], profile_id=profile.id)

    def test_panel_options_and_model_are_frozen_without_secrets(self):
        rec = Recorder(image_answer(), image_answer())
        profile = self.configure(
            rec, model="selected-model", negative="channel", size="512x512", quality="high"
        )
        self.panel(
            "p02", raw_prompt="first", raw_negative="first negative", width=777, height=999, seed=1
        )
        self.panel(
            "p03",
            raw_prompt="second",
            raw_negative="second negative",
            width=888,
            height=666,
            seed=2,
        )
        job = self.submit(profile, ["p02", "p03"])
        self.assertNotIn("test-secret", json.dumps(job))
        self.assertNotIn("api_key", json.dumps(job))
        self.current_channel = self.current_channel.model_copy(
            update={
                "model": "changed-model",
                "negative": "changed",
                "size": "1024x1024",
                "quality": "low",
            }
        )
        ep = self.run_job(job)
        bodies = {
            json.loads(r.content)["prompt"].split("\n")[0]: json.loads(r.content)
            for r in rec.requests
        }
        for prompt, size in (("first", "777x999"), ("second", "888x666")):
            self.assertEqual(bodies[prompt]["size"], size)
            self.assertEqual(bodies[prompt]["model"], "selected-model")
            self.assertEqual(bodies[prompt]["quality"], "high")
            self.assertEqual(
                bodies[prompt]["prompt"], f"{prompt}\nAvoid: {prompt} negative, channel"
            )
        for take in ep.takes:
            snap = take.cloud_request
            self.assertIsNotNone(snap)
            self.assertIsNone(take.seed)
            self.assertEqual(snap.effective.prompt, bodies[snap.requested.prompt]["prompt"])
            self.assertEqual((take.width, take.height), (8, 8))
            self.assertNotIn("test-secret", take.model_dump_json())

    def test_manual_references_keep_every_image_and_off_sends_none(self):
        rec = Recorder(image_answer(), image_answer())
        profile = self.configure(rec)
        colors = [(i * 30, 10, 20) for i in range(1, 7)]
        ids = [self.assets.put(png(color), source="test").id for color in colors]

        def mutate(ep):
            manual = ep.panel("p02")
            manual.reference_mode = "manual"
            manual.references = [AssetRef(asset_id=aid) for aid in ids]
            ep.panel("p03").reference_mode = "off"

        self.store.update_episode(self.episode.id, mutate)
        ep = self.run_job(self.submit(profile, ["p02", "p03"]))
        edit = next(r for r in rec.requests if str(r.url).endswith("/images/edits"))
        generated = next(r for r in rec.requests if str(r.url).endswith("/images/generations"))
        images = [data for name, data in multipart(edit) if name == "image[]"]
        self.assertEqual([Image.open(io.BytesIO(data)).getpixel((0, 0)) for data in images], colors)
        self.assertNotIn("image", json.loads(generated.content))
        by_panel = {take.panel_id: take.cloud_request for take in ep.takes}
        self.assertEqual([ref.asset_id for ref in by_panel["p02"].effective.refs], ids)
        self.assertEqual(by_panel["p02"].requested.reference_mode, "manual")
        self.assertEqual(by_panel["p03"].effective.refs, [])
        self.assertEqual(by_panel["p03"].effective.reference_mode, "none")

    def test_novelai_take_seed_is_actual_native_seed(self):
        rec = Recorder(httpx.Response(200, content=png()))
        profile = self.configure(rec, kind="novelai")
        self.panel(raw_prompt="cat", raw_negative="blur", width=830, height=1210, seed=2**40 + 9)
        take = self.run_job(self.submit(profile)).takes[0]
        params = json.loads(rec.requests[0].content)["parameters"]
        self.assertEqual(take.seed, params["seed"])
        self.assertEqual(take.seed, 9)
        self.assertEqual(take.cloud_request.requested.seed, 2**40 + 9)
        self.assertEqual(take.cloud_request.parameter_modes.seed, "native")
        self.assertEqual(
            (take.cloud_request.effective.width, take.cloud_request.effective.height), (832, 1216)
        )
        self.assertEqual((take.width, take.height), (8, 8))

    def test_removed_or_changed_channel_fails_without_any_paid_request(self):
        rec = Recorder()
        for change in ("removed", "kind"):
            with self.subTest(change=change):
                profile = self.configure(rec)
                self.panel(raw_prompt="cat")
                job = self.submit(profile)
                self.current_channel = (
                    None
                    if change == "removed"
                    else self.current_channel.model_copy(update={"kind": "novelai"})
                )
                done = drain(self.engine, job["id"])
                self.assertEqual(done["items"][0]["state"], "failed")
                self.assertEqual(done["items"][0]["error"]["kind"], "bad_input")
                self.assertEqual(rec.requests, [])
                self.assertEqual(self.store.get_episode(self.episode.id).takes, [])

    def test_cloud_unsupported_seed_does_not_erase_frozen_local_refinement_seed(self):
        rec = Recorder(image_answer())
        profile = self.configure(rec)
        profile.cloud_refine = True
        self.store.put_doc(profile)
        self.panel(raw_prompt="cat", seed=2**40 + 5)
        self.engine.pool.set_instances([])
        job = self.submit(profile)
        shape = self.run_job(job).takes[0]
        self.assertIsNone(shape.seed)
        self.assertIsNone(shape.cloud_request.effective.seed)
        local = next(j for j in self.engine.list() if j["kind"] == "comfy.render")
        self.engine.pool.set_instances(
            [SimpleNamespace(id="c1", base_url="http://x", capacity=2, enabled=True)]
        )
        ep = self.run_job(local)
        refined = next(t for t in ep.takes if t.parent_take_id == shape.id)
        self.assertEqual(refined.seed, 2**40 + 5)

    def test_generic_400_with_multiple_images_never_triggers_a_second_request(self):
        rec = Recorder(httpx.Response(400, text="size must be 1024x1024"))
        profile = self.configure(rec)
        ids = [self.assets.put(png(color), source="test").id for color in ("#ff0000", "#0000ff")]

        def mutate(ep):
            ep.panel("p02").reference_mode = "manual"
            ep.panel("p02").references = [AssetRef(asset_id=aid) for aid in ids]

        self.store.update_episode(self.episode.id, mutate)
        done = drain(self.engine, self.submit(profile)["id"])
        self.assertEqual(done["items"][0]["state"], "failed")
        self.assertEqual(len(rec.requests), 1)
        self.assertEqual(self.store.get_episode(self.episode.id).takes, [])

    def test_default_channel_changes_do_not_redirect_frozen_cloud_or_chat_jobs(self):
        original, other = Recorder(image_answer()), Recorder()
        profile = self.configure(original)
        profile.cloud_channel = ""
        self.store.put_doc(profile)
        self.panel(raw_prompt="cat", seed=42)
        clients = {
            "original": PV.OpenAIImages(PV.ImageChannel(id="original"), original.transport()),
            "other": PV.OpenAIImages(PV.ImageChannel(id="other"), other.transport()),
        }
        chat = L.Client(pace=0)
        chat.image_models = ("original-chat-model",)
        default = {"id": "original"}

        def backend(channel_id):
            chosen = channel_id or default["id"]
            return clients[chosen] if chosen else chat

        self.engine.register(
            "cloud.render", CloudExecutor(self.assets, lambda: chat, self.render, backend=backend)
        )
        cloud_job = self.submit(profile)
        self.assertEqual(cloud_job["items"][0]["input"]["request"]["channel_id"], "original")
        default["id"] = "other"
        take = self.run_job(cloud_job).takes[0]
        self.assertEqual(take.cloud_request.channel_id, "original")
        self.assertEqual(len(original.requests), 1)
        self.assertEqual(other.requests, [])

        default["id"] = ""
        chat_job = self.submit(profile)
        frozen = chat_job["items"][0]["input"]["request"]
        self.assertEqual((frozen["channel_id"], frozen["kind"]), ("", "chat_image"))
        default["id"] = "other"
        chat.image_models = ("changed-chat-model",)
        answer = {
            "choices": [
                {
                    "message": {
                        "images": [
                            {"url": "data:image/png;base64," + base64.b64encode(png()).decode()}
                        ]
                    }
                }
            ]
        }
        with mock.patch.object(chat, "_post", return_value=answer) as post:
            ep = self.run_job(chat_job)
        self.assertEqual(post.call_args.args[1]["model"], "original-chat-model")
        self.assertEqual(other.requests, [])
        take = next(t for t in ep.takes if t.job_id == chat_job["id"])
        self.assertEqual(take.cloud_request.kind, "chat_image")
        self.assertEqual(take.cloud_request.model, "original-chat-model")
        self.assertIsNone(take.seed)

    def test_legacy_extension_keeps_old_signature_refs_and_frozen_model(self):
        calls = []
        resolved_ids = []

        class LegacyAdapter:
            __slots__ = ("configured_model", "configured_negative", "credential")

            def __init__(self, channel, transport=None):
                self.configured_model = channel.model
                self.configured_negative = channel.negative
                self.credential = channel.api_key

            def generate_image(self, prompt, refs=(), models=None, timeout=360.0, retries=3):
                calls.append(
                    (
                        prompt,
                        list(refs),
                        models,
                        self.configured_model,
                        self.configured_negative,
                        self.credential,
                    )
                )
                return png(), L.Reply("", models[0], 0.0)

        profile = self.configure(
            Recorder(), kind="legacy", model="original-model", negative="original-negative"
        )
        self.current_channel = self.current_channel.model_copy(update={"id": "mine"})
        profile.cloud_channel = ""
        self.store.put_doc(profile)
        default = {"id": "mine"}

        def backend(channel_id):
            resolved_ids.append(channel_id)
            self.assertEqual(channel_id or default["id"], "mine")
            return PV.build(self.current_channel, lambda: None, kinds={"legacy": LegacyAdapter})

        self.engine.register(
            "cloud.render", CloudExecutor(self.assets, lambda: None, self.render, backend=backend)
        )
        refs = [png((30 * i, 10, 20)) for i in range(1, 7)]
        ids = [self.assets.put(data, source="test").id for data in refs]

        def mutate(ep):
            panel = ep.panel("p02")
            panel.reference_mode = "manual"
            panel.references = [AssetRef(asset_id=aid) for aid in ids]
            panel.overrides = PanelOverrides(
                raw_prompt="exact prompt", seed=42, width=777, height=999
            )

        self.store.update_episode(self.episode.id, mutate)
        job = self.submit(profile)
        frozen = job["items"][0]["input"]["request"]
        self.assertEqual((frozen["channel_id"], frozen["kind"]), ("mine", "legacy"))
        default["id"] = "other"
        self.current_channel = self.current_channel.model_copy(
            update={
                "model": "changed-model",
                "negative": "changed-negative",
                "api_key": "rotated-test-key",
            }
        )
        take = self.run_job(job).takes[0]
        self.assertEqual(resolved_ids, ["", "mine"])
        self.assertEqual(
            calls[0],
            (
                "exact prompt",
                refs,
                ("original-model",),
                "original-model",
                "original-negative",
                "rotated-test-key",
            ),
        )
        self.assertEqual(
            take.cloud_request.parameter_modes.model_dump(),
            {
                "negative": "unknown",
                "size": "unknown",
                "seed": "unknown",
            },
        )
        self.assertIsNone(take.seed)
        self.assertIsNone(take.cloud_request.effective.seed)
        self.assertEqual(take.cloud_request.effective.reference_mode, "unknown")
        self.assertEqual(
            (take.cloud_request.channel_id, take.cloud_request.kind), ("mine", "legacy")
        )
        self.assertEqual([ref.asset_id for ref in take.cloud_request.requested.refs], ids)

        edited = self.render.edit(
            self.episode.id,
            take.id,
            "edit",
            {
                "instruction": "blue sky",
                "channel": "mine",
                "ref_asset_ids": ids,
            },
        )
        self.current_channel = self.current_channel.model_copy(update={"model": "changed-again"})
        ep = self.run_job(edited)
        self.assertEqual(calls[1][1], [self.assets.read(take.asset_id), *refs])
        self.assertEqual(calls[1][2:4], (("changed-model",), "changed-model"))
        result = next(t for t in ep.takes if t.parent_take_id == take.id)
        self.assertIsNone(result.seed)
        self.assertEqual(result.cloud_request.parameter_modes.seed, "unknown")
