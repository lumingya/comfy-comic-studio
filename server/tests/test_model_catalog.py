"""Model discovery is read-only, scoped, credential-bound, and independent of generation."""

import unittest
from unittest import mock

import httpx

from mio_server import model_catalog as C
from mio_server import settings as SET
from mio_server.llm import LLMError
from mio_server.pipeline.providers import ImageChannel
from mio_server.settings import MASK, AppSettings, LLMSettings

from .api_harness import ApiCase


class ModelCatalogTests(unittest.TestCase):
    def setUp(self):
        self.settings = AppSettings(
            llm=LLMSettings(base_url="https://shared.test/v1", api_key="shared-secret"),
            image_channels=[
                ImageChannel(
                    id="images",
                    kind="openai_images",
                    base_url="https://images.test/v1",
                    api_key="image-secret",
                ),
                ImageChannel(id="chat", kind="chat_image", api_key="chat-secret"),
            ],
        )
        self.requests = []

    def discover(self, body, response=None, handler=None):
        def handle(request):
            self.requests.append(request)
            if handler:
                return handler(request)
            return response or httpx.Response(200, json={"data": [{"id": "test-model"}]})

        return C.discover_models(
            C.ModelCatalogRequest(**body), self.settings, transport=httpx.MockTransport(handle)
        )

    def test_unsaved_draft_fetch_does_not_change_settings(self):
        before = self.settings.model_dump()
        result = self.discover(
            {"kind": "openai", "base_url": "https://draft.test/v1/", "api_key": "draft-secret"},
            httpx.Response(
                200,
                json={"data": [{"id": "z", "name": "Z"}, {"id": "z"}, {"id": "a"}, {}]},
            ),
        )
        self.assertEqual([m.id for m in result.models], ["z", "a"])
        self.assertEqual(result.models[0].name, "Z")
        self.assertEqual(result.source, "remote")
        self.assertEqual(self.settings.model_dump(), before)
        request = self.requests[0]
        self.assertEqual(request.method, "GET")
        self.assertEqual(str(request.url), "https://draft.test/v1/models")
        self.assertEqual(request.headers["authorization"], "Bearer draft-secret")

    def test_shared_mask_reuses_only_same_normalized_endpoint(self):
        self.discover(
            {"kind": "openai", "base_url": "https://SHARED.test:443/v1/", "api_key": MASK}
        )
        self.assertEqual(self.requests[0].headers["authorization"], "Bearer shared-secret")
        for base in ("https://other.test/v1", "http://shared.test/v1", "https://shared.test/v2"):
            with self.subTest(base=base), self.assertRaisesRegex(ValueError, "地址已改变"):
                self.discover({"kind": "openai", "base_url": base, "api_key": MASK})
        self.assertEqual(len(self.requests), 1)

    def test_channel_mask_requires_same_id_kind_and_address(self):
        body = {
            "kind": "openai_images",
            "channel_id": "images",
            "base_url": "https://images.test/v1/",
            "api_key": MASK,
        }
        self.discover(body)
        self.assertEqual(self.requests[0].headers["authorization"], "Bearer image-secret")
        for change in (
            {"channel_id": "new"},
            {"kind": "chat_image"},
            {"base_url": "https://changed.test/v1"},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.discover({**body, **change})
        self.assertEqual(len(self.requests), 1)

    def test_independent_chat_never_inherits_shared_key(self):
        self.discover({"kind": "chat_image", "base_url": "https://independent.test/v1"})
        self.assertNotIn("authorization", self.requests[0].headers)
        self.discover({"kind": "chat_image", "base_url": "https://shared.test/v1"})
        self.assertNotIn("authorization", self.requests[1].headers)

    def test_empty_chat_address_inherits_shared_connection_or_uses_own_key(self):
        self.discover({"kind": "chat_image"})
        self.discover({"kind": "chat_image", "api_key": "draft-secret"})
        self.discover({"kind": "chat_image", "channel_id": "chat", "api_key": MASK})
        self.assertTrue(all(str(r.url) == "https://shared.test/v1/models" for r in self.requests))
        self.assertEqual(
            [r.headers["authorization"] for r in self.requests],
            ["Bearer shared-secret", "Bearer draft-secret", "Bearer chat-secret"],
        )

    def test_clear_key_and_new_key_allow_changed_address(self):
        for key in ("", "fresh-secret"):
            self.discover({"kind": "openai", "base_url": "https://changed.test/v1", "api_key": key})
        self.assertNotIn("authorization", self.requests[0].headers)
        self.assertEqual(self.requests[1].headers["authorization"], "Bearer fresh-secret")

    def test_mask_prefix_must_not_be_sent_as_a_real_key(self):
        with self.assertRaisesRegex(ValueError, "占位符"):
            self.discover({"base_url": "https://shared.test/v1", "api_key": MASK + "new-secret"})
        self.assertFalse(self.requests)

    def test_openai_images_default_and_pasted_endpoint(self):
        self.discover({"kind": "openai_images"})
        for suffix in ("chat/completions", "images/generations", "images/edits", "models"):
            self.discover({"base_url": f"https://gateway.test/prefix/v1/{suffix}"})
        self.assertEqual(str(self.requests[0].url), "https://api.openai.com/v1/models")
        self.assertTrue(
            all(str(r.url) == "https://gateway.test/prefix/v1/models" for r in self.requests[1:])
        )

    def test_unsafe_or_malformed_addresses_do_not_send_a_request(self):
        for base in (
            "file:///tmp/models",
            "https://user:secret@example.test/v1",
            "https://example.test/v1?api_key=secret",
            "https://example.test/v1#key",
            "https://example.test:broken/v1",
            "",
            "ftp://example.test/v1",
        ):
            with self.subTest(base=base), self.assertRaises(ValueError):
                self.discover({"base_url": base, "api_key": "secret"})
        self.assertFalse(self.requests)

    def test_remote_failures_are_actionable_without_leaking_response_or_key(self):
        for status, text in (
            (401, "密钥"),
            (403, "权限"),
            (404, "手动"),
            (429, "频繁"),
            (500, "重试"),
        ):
            with self.subTest(status=status), self.assertRaises(LLMError) as error:
                self.discover(
                    {"base_url": "https://provider.test/v1", "api_key": "secret"},
                    httpx.Response(status, text="secret <script>server details</script>"),
                )
            self.assertIn(text, str(error.exception))
            self.assertNotIn("secret", str(error.exception))
            self.assertNotIn("script", str(error.exception))

    def test_redirect_is_not_followed_and_does_not_forward_key(self):
        with self.assertRaisesRegex(LLMError, "跳转"):
            self.discover(
                {"base_url": "https://provider.test/v1", "api_key": "secret"},
                httpx.Response(302, headers={"Location": "https://other.test/models"}),
            )
        self.assertEqual(len(self.requests), 1)

    def test_timeout_and_transport_failure_do_not_include_secrets(self):
        for error in (httpx.ReadTimeout("secret"), httpx.ConnectError("secret")):

            def handler(request):
                raise error

            with self.subTest(error=type(error)), self.assertRaises(LLMError) as caught:
                self.discover({"base_url": "https://provider.test/v1"}, handler=handler)
            self.assertNotIn("secret", str(caught.exception))

    def test_malformed_success_is_not_an_empty_catalog(self):
        for data in ({"message": "wrong endpoint"}, [], {"data": [{}]}, {"data": ["x"]}):
            with self.subTest(data=data), self.assertRaises(LLMError):
                C.openai_catalog(data)
        self.assertEqual(C.openai_catalog({"data": []}).models, [])
        with self.assertRaisesRegex(LLMError, "有效模型目录"):
            self.discover(
                {"base_url": "https://provider.test/v1"},
                httpx.Response(200, text="<html>wrong</html>"),
            )
        with mock.patch.object(C, "MAX_RESPONSE", 8), self.assertRaisesRegex(LLMError, "过大"):
            self.discover({"base_url": "https://provider.test/v1"})

    def test_novelai_is_an_explicit_reference_catalog_without_network(self):
        result = self.discover({"kind": "novelai", "api_key": MASK})
        self.assertFalse(self.requests)
        self.assertEqual(result.source, "bundled")
        self.assertIn("未查询服务", result.notice)
        self.assertIn("nai-diffusion-4-5-full", [m.id for m in result.models])

    def test_unknown_extension_kind_can_still_be_configured_manually(self):
        with self.assertRaisesRegex(ValueError, "手动"):
            self.discover({"kind": "custom.adapter"})
        self.assertFalse(self.requests)

    def test_comfy_catalog_reads_core_and_custom_model_combos(self):
        data = {
            "CheckpointLoaderSimple": {
                "input": {
                    "required": {
                        "ckpt_name": [["main.safetensors", "main.safetensors"], {}],
                    }
                }
            },
            "AnotherCheckpointLoader": {
                "input": {
                    "optional": {
                        "ckpt_name": [["main.safetensors", "folder/other.ckpt"], {}],
                    }
                }
            },
            "PluginGGUFLoader": {
                "input": {
                    "required": {
                        "file": ["COMBO", {"options": ["custom.gguf", "None"]}],
                        "mode": [["fast", "accurate"], {}],
                        "preview": [["picture.png"], {}],
                    }
                }
            },
            "CLIPLoader": {"input": {"required": {"clip_name": [["encoder.bin"], {}]}}},
            "BrokenPlugin": {"input": {"required": []}},
        }
        result = self.discover(
            {"kind": "comfyui", "base_url": "http://127.0.0.1:8188"},
            httpx.Response(200, json=data),
        )
        self.assertEqual(str(self.requests[0].url), "http://127.0.0.1:8188/object_info")
        self.assertEqual(len(result.models), 4)
        self.assertIn(
            ("PluginGGUFLoader.file", "custom.gguf"), [(m.group, m.id) for m in result.models]
        )
        self.assertIn("工作流决定", result.notice)


class ModelCatalogApiTests(ApiCase):
    def test_saving_full_endpoints_keeps_catalog_and_generation_bases_consistent(self):
        result = self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "llm": {"base_url": " https://GATEWAY.test:443/proxy/v1/chat/completions/ "},
                    "image_channels": [
                        {
                            "id": "images",
                            "kind": "openai_images",
                            "base_url": "https://images.test/gateway/v1/images/generations",
                        },
                        {
                            "id": "chat",
                            "kind": "chat_image",
                            "base_url": "https://chat.test/proxy/v1/chat/completions",
                        },
                    ],
                },
            )
        )
        self.assertEqual(result["llm"]["base_url"], "https://gateway.test/proxy/v1")
        self.assertEqual(result["image_channels"][0]["base_url"], "https://images.test/gateway/v1")
        self.assertEqual(result["image_channels"][1]["base_url"], "https://chat.test/proxy/v1")
        stored = self.ctx.settings()
        text_client = SET.ConfiguredClient(stored.llm)
        self.assertEqual(text_client.base_url, "https://gateway.test/proxy/v1")
        image_client = SET.image_backend(stored, lambda: text_client, "images")
        self.assertEqual(image_client.channel.base_url, "https://images.test/gateway/v1")
        chat_client = SET.image_backend(stored, lambda: text_client, "chat")
        self.assertEqual(chat_client.base_url, "https://chat.test/proxy/v1")
        with mock.patch.object(C, "_get_json", return_value={"data": []}) as get:
            self.ok(
                self.client.post(
                    "/api/settings/models",
                    json={
                        "kind": "openai",
                        "base_url": result["llm"]["base_url"],
                    },
                )
            )
        get.assert_called_once_with("https://gateway.test/proxy/v1/models", "", None)

    def test_only_edited_openai_addresses_are_normalized(self):
        original = AppSettings(
            llm=LLMSettings(base_url="https://legacy.test/v1/chat/completions"),
            image_channels=[
                ImageChannel(id="old", base_url="not-a-valid-old-url"),
                ImageChannel(id="old2", kind="chat_image", base_url="https://old.test/v1/models"),
            ],
        )
        updated = SET.apply_patch(original, {"trash_days": 7})
        self.assertEqual(updated.llm.base_url, original.llm.base_url)
        self.assertEqual(updated.image_channels, original.image_channels)
        patch = SET.public(original)
        patch["llm"]["timeout"] = 100
        patch["image_channels"][0]["label"] = "Renamed only"
        patch["image_channels"].extend(
            [
                {
                    "id": "custom",
                    "kind": "custom.adapter",
                    "base_url": "https://custom.test/models",
                },
                {"id": "nai", "kind": "novelai", "base_url": "https://nai.test/chat/completions"},
                {"id": "new", "kind": "chat_image", "base_url": "   "},
            ]
        )
        updated = SET.apply_patch(original, patch)
        self.assertEqual(updated.llm.base_url, original.llm.base_url)
        self.assertEqual(updated.image_channels[0].base_url, "not-a-valid-old-url")
        self.assertEqual(updated.image_channels[1].base_url, "https://old.test/v1/models")
        self.assertEqual(updated.image_channels[2].base_url, "https://custom.test/models")
        self.assertEqual(updated.image_channels[3].base_url, "https://nai.test/chat/completions")
        self.assertEqual(updated.image_channels[4].base_url, "")

    def test_draft_endpoint_preserves_persisted_settings_and_jobs(self):
        # An empty store creates fresh defaults on every read, including a fresh timestamp.
        # Persist a fixed baseline so this tests writes rather than wall-clock coincidence.
        self.ctx.store.put_doc(AppSettings(updated_at="2000-01-01T00:00:00+00:00"))
        before = self.ctx.settings().model_dump()
        jobs = self.ok(self.client.get("/api/jobs"))
        with (
            mock.patch.object(
                C, "_get_json", return_value={"data": [{"id": "draft-model"}]}
            ) as get,
            mock.patch.object(self.ctx.store, "put_doc", wraps=self.ctx.store.put_doc) as write,
        ):
            result = self.ok(
                self.client.post(
                    "/api/settings/models",
                    json={
                        "kind": "openai",
                        "base_url": "https://draft.test/v1",
                        "api_key": "draft-secret",
                    },
                )
            )
        write.assert_not_called()
        self.assertEqual(result["models"][0]["id"], "draft-model")
        get.assert_called_once_with("https://draft.test/v1/models", "draft-secret", None)
        self.assertEqual(self.ctx.settings().model_dump(), before)
        self.assertEqual(self.ok(self.client.get("/api/jobs")), jobs)

    def test_open_api_catalog_requires_admin_and_has_typed_schema(self):
        body = {"kind": "novelai"}
        self.assertEqual(self.client.post("/api/v2/settings/models", json=body).status_code, 401)
        for scopes, status in ((["read", "write"], 403), (["admin"], 200)):
            token = self.ok(
                self.client.post("/api/tokens", json={"name": "test", "scopes": scopes}), 201
            )
            response = self.client.post(
                "/api/v2/settings/models",
                json=body,
                headers={"Authorization": "Bearer " + token["token"]},
            )
            self.assertEqual(response.status_code, status)
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        operation = schema["paths"]["/settings/models"]["post"]
        self.assertEqual(operation["operationId"], "fetch_models")
        self.assertEqual(operation["x-mio-operation"], "POST /settings/models")
        self.assertIn("ModelCatalogRequest", schema["components"]["schemas"])

    def test_api_failure_never_returns_raw_upstream_text(self):
        with mock.patch.object(
            C, "_get_json", side_effect=LLMError("获取模型超时，请检查服务状态后重试")
        ):
            response = self.client.post(
                "/api/settings/models", json={"base_url": "https://example.test/v1"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["kind"], "upstream")
