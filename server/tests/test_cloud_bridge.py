"""Cloud queue regressions. All backends are local doubles; no paid image requests."""

from __future__ import annotations

import unittest
from unittest import mock

import httpx

from mio_server import llm as L
from mio_server.jobs import ExecError
from mio_server.models import TakeStatus, VariantSet
from mio_server.pipeline import cloud_jobs
from mio_server.pipeline import providers as PV
from mio_server.pipeline.cloud import CloudRenderer

from .test_providers import Recorder, channel, png
from .test_render_qa import FakeCloudRenderer, Harness


class CloudBridgeTests(Harness):
    def profile(self, refine=False):
        profile = self.render.profile(None).model_copy(
            update={"id": "cloud-test", "cloud_shape": True, "candidates": 1}
        )
        if not refine:
            profile.final = []
            profile.draft = profile.draft[:1]
        return self.store.put_doc(profile)

    def test_cloud_one_click_adopts_without_manual_board_step(self):
        profile = self.profile()
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(
                self.render.render(
                    self.episode.id, ["p02"], profile_id=profile.id, adopt_first=True
                )
            )
        self.assertIsNotNone(ep.adopted("p02"))

    def test_hybrid_adopts_after_local_refinement_not_just_cloud_shape(self):
        profile = self.profile(refine=True)
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(
                self.render.render(
                    self.episode.id, ["p02"], profile_id=profile.id, adopt_first=True
                )
            )
        self.assertIsNone(ep.adopted("p02"))
        refine = next(j for j in self.engine.list() if j["kind"] == "comfy.render")
        ep = self.run_job(refine)
        self.assertIsNotNone(ep.adopted("p02"))
        self.assertEqual(ep.adopted("p02").stage, "draft")

    def test_cloud_respects_candidate_count_and_variant_ids(self):
        profile = self.profile()
        self.store.update_series(
            self.series.id,
            lambda s: s.variants.append(VariantSet(id="v1", name="Alternate")),
        )
        with mock.patch.object(cloud_jobs, "CloudRenderer", FakeCloudRenderer):
            ep = self.run_job(
                self.render.render(
                    self.episode.id,
                    ["p02"],
                    profile_id=profile.id,
                    candidates=2,
                    variant_ids=[None, "v1"],
                    adopt_first=True,
                )
            )
        self.assertEqual(len(ep.takes), 4)
        self.assertEqual({t.variant_id for t in ep.takes}, {None, "v1"})
        self.assertEqual(sum(t.status == TakeStatus.adopted for t in ep.takes), 2)

    def test_cloud_request_uses_raw_prompt_and_preset_variables(self):
        profile = self.profile()
        self.store.update_series(self.series.id, lambda s: s.variables.update({"subject": "cat"}))
        self.store.update_episode(
            self.episode.id,
            lambda e: setattr(e.panel("p02").overrides, "raw_prompt", "{subject}, red umbrella"),
        )
        backend = mock.Mock()
        backend.generate_image.return_value = (png(), L.Reply("", "fake", 0.0))
        with mock.patch.object(cloud_jobs, "CloudRenderer", lambda _: CloudRenderer(backend)):
            self.run_job(self.render.render(self.episode.id, ["p02"], profile_id=profile.id))
        self.assertEqual(backend.generate_image.call_args.args[0], "cat, red umbrella")

    def test_cloud_request_snapshot_is_idempotent(self):
        profile = self.profile()
        first = self.render.render(
            self.episode.id,
            ["p02"],
            profile_id=profile.id,
            candidates=2,
            adopt_first=True,
            idempotency_key="cloud-button-click",
        )
        again = self.render.render(
            self.episode.id,
            ["p02"],
            profile_id=profile.id,
            candidates=2,
            adopt_first=True,
            idempotency_key="cloud-button-click",
        )
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(len(self.engine.list()), 1)

    def test_finalize_does_not_overwrite_a_later_manual_selection(self):
        ep = self.run_job(self.render.render(self.episode.id, ["p02"], candidates=2))
        first, second = ep.takes
        self.adopt(first.id)
        job = self.render.finalize(ep.id)

        def choose(ep):
            ep.take(first.id).status = TakeStatus.candidate
            ep.take(second.id).status = TakeStatus.adopted

        self.store.update_episode(ep.id, choose)
        ep = self.run_job(job)
        self.assertEqual(ep.adopted("p02").id, second.id)


class CloudRequestSafetyTests(unittest.TestCase):
    def test_download_does_not_send_provider_key_to_image_cdn(self):
        rec = Recorder(
            httpx.Response(200, json={"data": [{"url": "https://cdn.test/image.png"}]}),
            httpx.Response(200, content=png()),
        )
        PV.OpenAIImages(channel(base_url="https://api.test/v1"), rec.transport()).generate_image(
            "cat"
        )
        self.assertIn("authorization", rec.requests[0].headers)
        self.assertNotIn("authorization", rec.requests[1].headers)

    def test_uncertain_multi_reference_failure_does_not_submit_a_second_paid_request(self):
        client = mock.Mock()
        client.generate_image.side_effect = L.LLMError("timed out", None, True)
        story = {"characters": [], "locations": []}
        panel = {}
        with mock.patch(
            "mio_server.pipeline.cloud.P.natural", return_value=("two cats", ["a", "b"])
        ):
            with self.assertRaises(L.LLMError):
                CloudRenderer(client).panel(story, panel, {"a": png(), "b": png()})
        self.assertEqual(client.generate_image.call_count, 1)
        self.assertEqual(client.generate_image.call_args.kwargs["retries"], 0)

    def test_single_cloud_request_disables_hidden_adapter_retries(self):
        client = mock.Mock()
        client.generate_image.return_value = (png(), L.Reply("", "fake", 0.0))
        with mock.patch("mio_server.pipeline.cloud.P.natural", return_value=("cat", [])):
            CloudRenderer(client).panel({}, {}, {})
        self.assertEqual(client.generate_image.call_args.kwargs.get("retries"), 0)

    def test_zero_retry_chat_image_preserves_status_and_does_not_fallback(self):
        client = L.Client(pace=0)
        with mock.patch.object(
            client, "_post", side_effect=L.LLMError("timeout", 504, True)
        ) as post:
            with mock.patch.object(L.time, "sleep"):
                with self.assertRaises(L.LLMError) as caught:
                    client.generate_image("cat", models=("one",), retries=0)
        self.assertEqual(post.call_count, 1)
        self.assertEqual(caught.exception.status, 504)

    def test_configured_model_is_not_replaced_with_the_builtin_proxy_model(self):
        client = mock.Mock()
        client.image_models = ["chosen-model", "fallback-model"]
        client.generate_image.return_value = (png(), L.Reply("", "fake", 0.0))
        with mock.patch("mio_server.pipeline.cloud.P.natural", return_value=("cat", [])):
            CloudRenderer(client).panel({}, {}, {})
        self.assertEqual(client.generate_image.call_args.kwargs["models"], ("chosen-model",))

    def test_download_failure_never_reposts_an_already_generated_image(self):
        rec = Recorder(
            httpx.Response(200, json={"data": [{"url": "https://cdn.test/image.png"}]}),
            httpx.Response(503, text="CDN unavailable"),
        )
        with mock.patch.object(PV.time, "sleep") as sleep:
            with self.assertRaises(L.LLMError) as caught:
                PV.OpenAIImages(channel(), rec.transport()).generate_image("cat")
        self.assertTrue(caught.exception.sent)
        self.assertFalse(caught.exception.retryable)
        self.assertEqual([r.method for r in rec.requests], ["POST", "GET"])
        sleep.assert_not_called()

    def test_error_text_cannot_turn_a_read_timeout_into_a_safe_unsent_failure(self):
        client = mock.Mock()
        client.generate_image.side_effect = L.LLMError("连接已建立，但读取响应超时", None, True)
        assets = mock.Mock()
        assets.read.return_value = png()
        executor = cloud_jobs.CloudExecutor(assets, lambda: client, mock.Mock())
        ctx = mock.Mock()
        ctx.input = {"mode": "edit", "image": "image", "instruction": "blue sky"}
        with self.assertRaises(ExecError) as caught:
            executor.execute(ctx)
        self.assertTrue(caught.exception.sent)
        ctx.mark_sent.assert_called_once()
        self.assertEqual(client.generate_image.call_count, 1)

    def test_zero_retry_http_channel_keeps_original_failure(self):
        rec = Recorder(httpx.Response(503, text="busy"))
        with mock.patch.object(PV.time, "sleep") as sleep:
            with self.assertRaises(L.LLMError) as caught:
                PV.OpenAIImages(channel(), rec.transport()).generate_image("cat", retries=0)
        self.assertEqual(caught.exception.status, 503)
        sleep.assert_not_called()
