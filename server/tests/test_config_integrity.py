"""Configuration UI regressions. All keys, endpoints and model calls here are fake."""

import unittest
from unittest import mock

from mio_server import llm as L
from mio_server import settings as SET
from mio_server.pipeline import providers as PV
from mio_server.render_models import ComfyInstance, RenderProfile, RenderStage, WorkflowDoc

from .api_harness import ApiCase
from .test_api_system import GRAPH


class ChatChannelTests(unittest.TestCase):
    def client(self):
        return SET.ConfiguredClient(
            SET.LLMSettings(
                base_url="https://shared.test/v1",
                api_key="shared-test-key",
                image_models=["shared"],
            )
        )

    def test_chat_channel_honors_endpoint_key_model_and_negative_without_mutating_shared_client(
        self,
    ):
        shared = self.client()
        channel = PV.ImageChannel(
            id="chat",
            kind="chat_image",
            base_url="https://image.test/v1/",
            api_key="image-test-key",
            model="image-model",
            negative="blur",
        )
        with mock.patch.object(L.Client, "generate_image", autospec=True) as generate:
            client = PV.build(channel, lambda: shared)
            client.generate_image("a cat", models=("wrong",), retries=0)
        self.assertEqual(client.base_url, "https://image.test/v1")
        self.assertEqual(client.api_key, "image-test-key")
        self.assertEqual(client.image_models, ("image-model",))
        self.assertEqual(shared.base_url, "https://shared.test/v1")
        self.assertEqual(shared.api_key, "shared-test-key")
        self.assertEqual(generate.call_args.args[1], "a cat\nAvoid: blur")
        self.assertEqual(generate.call_args.kwargs["models"], ("image-model",))
        self.assertEqual(generate.call_args.kwargs["retries"], 0)

    def test_custom_chat_endpoint_never_inherits_another_services_key(self):
        client = PV.build(
            PV.ImageChannel(id="chat", kind="chat_image", base_url="http://local.test/v1"),
            self.client,
        )
        self.assertEqual(client.base_url, "http://local.test/v1")
        self.assertEqual(client.api_key, "")

    def test_blank_chat_endpoint_inherits_shared_connection_and_optional_key_override(self):
        inherited = PV.build(PV.ImageChannel(id="chat", kind="chat_image"), self.client)
        self.assertEqual(inherited.base_url, "https://shared.test/v1")
        self.assertEqual(inherited.api_key, "shared-test-key")
        self.assertEqual(inherited.image_models, ("shared",))
        own_key = PV.build(
            PV.ImageChannel(id="chat", kind="chat_image", api_key="own-test-key"), self.client
        )
        self.assertEqual(own_key.api_key, "own-test-key")

    def test_duplicate_channel_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "ID"):
            SET.apply_patch(SET.AppSettings(), {"image_channels": [{"id": "a"}, {"id": "a"}]})

    def test_missing_default_channel_is_rejected(self):
        with self.assertRaises(ValueError):
            SET.apply_patch(SET.AppSettings(), {"image_channel": "missing"})

    def test_renaming_a_masked_channel_cannot_silently_erase_the_key(self):
        settings = SET.AppSettings(image_channels=[PV.ImageChannel(id="a", api_key="test-key")])
        public = SET.public(settings)
        public["image_channels"][0]["id"] = "b"
        with self.assertRaises(ValueError):
            SET.apply_patch(settings, {"image_channels": public["image_channels"]})
        self.assertEqual(settings.image_channels[0].api_key, "test-key")

    def test_explicit_key_clear_is_preserved(self):
        settings = SET.AppSettings(image_channels=[PV.ImageChannel(id="a", api_key="test-key")])
        changed = SET.apply_patch(settings, {"image_channels": [{"id": "a", "api_key": ""}]})
        self.assertEqual(changed.image_channels[0].api_key, "")


class ConfigReferenceTests(ApiCase):
    def test_channel_in_use_cannot_be_removed_from_settings(self):
        self.ok(self.client.patch("/api/settings", json={"image_channels": [{"id": "mine"}]}))
        self.ctx.store.put_doc(
            RenderProfile(id="cloud", name="Cloud profile", cloud_channel="mine")
        )
        rejected = self.client.patch("/api/settings", json={"image_channels": []})
        self.assertEqual(rejected.status_code, 409)
        self.assertIn("Cloud profile", rejected.json()["detail"])
        self.assertEqual(self.ctx.settings().image_channels[0].id, "mine")

    def test_default_channel_must_be_changed_explicitly_before_removal(self):
        self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "image_channels": [{"id": "mine"}],
                    "image_channel": "mine",
                },
            )
        )
        rejected = self.client.patch("/api/settings", json={"image_channels": []})
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(self.ctx.settings().image_channel, "mine")
        self.ok(
            self.client.patch("/api/settings", json={"image_channels": [], "image_channel": ""})
        )

    def test_profile_cannot_reference_missing_cloud_channel(self):
        rejected = self.client.post(
            "/api/profiles", json={"name": "Broken", "cloud_channel": "gone"}
        )
        self.assertEqual(rejected.status_code, 400)

    def test_referenced_workflow_cannot_be_deleted(self):
        workflow = WorkflowDoc(id="wf_used", name="Used", graph=GRAPH)
        self.ctx.store.put_doc(workflow)
        profile = RenderProfile(
            id="uses_workflow",
            name="Keep this workflow",
            draft=[RenderStage(workflow_id=workflow.id)],
        )
        self.ctx.store.put_doc(profile)
        rejected = self.client.delete(f"/api/workflows/{workflow.id}")
        self.assertEqual(rejected.status_code, 409)
        self.assertIn(profile.name, rejected.json()["detail"])
        self.ok(self.client.get(f"/api/workflows/{workflow.id}"))

    def test_referenced_instance_cannot_be_deleted(self):
        self.ctx.store.put_doc(ComfyInstance(id="used", base_url="http://unused.test"))
        self.ctx.store.put_doc(
            RenderProfile(id="uses_instance", name="Keep instance", instances=["used"])
        )
        rejected = self.client.delete("/api/instances/used")
        self.assertEqual(rejected.status_code, 409)
        self.assertIn("Keep instance", rejected.json()["detail"])
