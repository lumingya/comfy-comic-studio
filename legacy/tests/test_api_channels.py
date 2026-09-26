"""Public API: provider registry, channels, key pools and ComfyUI helpers (no network)."""
import os
import unittest
from unittest.mock import patch

from backend import server
from tests.api_support import ApiServerCase


class ChannelApiTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.store().apply([], settings_changes=[
            {"name": "comfy", "expected": None, "document": {"baseUrl": "http://127.0.0.1:8188"}},
            {"name": "workspace", "expected": None, "document": {"ui": {"comfyStudio": {"settings": {"imageGeneration": {
                "active": "comfyui", "profiles": [
                    {"id": "comfyui", "title": "ComfyUI", "provider": "comfyui", "keyMode": "none"},
                    {"id": "openai", "title": "OpenAI", "provider": "openai", "baseUrl": "https://api.openai.com/v1",
                     "model": "gpt-image-1", "protocol": "images", "keyMode": "none"}]}}}}}}])

    def vault(self):
        path = os.path.join(self.root, "settings", "secrets.json")
        if not os.path.exists(path):
            return ""
        with open(path, encoding="utf-8") as handle:
            return handle.read()

    def test_provider_registry(self):
        providers = {p["id"]: p for p in self.ok(self.get("/api/v1/providers"))}
        self.assertTrue({"comfyui", "novelai", "openai"} <= set(providers))
        self.assertTrue(providers["comfyui"]["capabilities"]["workflow"])
        self.assertIn("protocol", [f["key"] for f in self.ok(self.get("/api/v1/providers/openai"))["fields"]])
        self.assertEqual(self.get("/api/v1/providers/nope").status, 404)

    def test_channel_lifecycle_with_write_only_keys(self):
        listed = self.ok(self.get("/api/v1/channels"))
        comfy = next(c for c in listed["items"] if c["id"] == "comfyui")
        self.assertEqual((comfy["baseUrl"], comfy["usesWorkflow"], comfy["active"]), ("http://127.0.0.1:8188", True, True))

        created = self.post("/api/v1/channels", {"provider": "openai", "title": "网关", "baseUrl": "https://gw.example.com/v1",
                                                 "model": "img", "apiKey": "sk-channel-one", "activate": True})
        channel = self.ok(created, 201)
        self.assertNotIn("sk-channel-one", created.raw.decode())
        self.assertIn("sk-channel-one", self.vault())
        self.assertEqual((channel["keyMode"], channel["keyCount"], channel["active"]), ("stored", 1, True))
        self.assertEqual(channel["protocol"], "images")  # provider default
        base = "/api/v1/channels/" + channel["id"]

        keys = self.ok(self.get(base + "/keys"))["keys"]
        self.assertEqual(len(keys), 1)
        self.assertTrue(keys[0]["inUse"])
        self.assertNotIn("secret", keys[0])
        second = self.ok(self.post(base + "/keys", {"key": "sk-channel-two", "label": "备用"}), 201)
        self.assertEqual(self.ok(self.get(base))["keyCount"], 2)
        self.ok(self.delete(base + "/keys/" + second["id"]))
        self.assertNotIn("sk-channel-two", self.vault())
        self.assertEqual(self.delete(base + "/keys/key_missing").status, 404)

        with patch.object(server, "generate_provider_image", return_value={"image": "/images/x.png"}) as generate:
            self.ok(self.post("/api/v1/images/generations", {"channelId": channel["id"], "prompt": "hi"}))
        sent = generate.call_args.args[0]["config"]
        self.assertEqual((sent["keyMode"], len(sent["keyIds"])), ("stored", 1))

        patched = self.ok(self.patch(base, {"model": "img-2"}))
        self.assertEqual((patched["channel"]["model"], patched["keysReset"]), ("img-2", False))
        moved = self.ok(self.patch(base, {"baseUrl": "https://gw2.example.com/v1"}))
        self.assertTrue(moved["keysReset"])
        self.assertEqual(moved["channel"]["keyMode"], "none")
        rekeyed = self.ok(self.patch(base, {"apiKey": "sk-channel-three"}))
        self.assertEqual(rekeyed["channel"]["keyCount"], 1)

        self.assertEqual(self.ok(self.post("/api/v1/channels/openai/activate"))["active"], "openai")
        deleted = self.ok(self.delete(base))
        self.assertEqual(deleted["deleted"], channel["id"])
        self.assertNotIn("sk-channel-three", self.vault())
        self.assertEqual(self.get(base).status, 404)

    def test_comfy_channel_rules(self):
        self.assertEqual(self.delete("/api/v1/channels/comfyui").error["code"], "builtin_channel")
        self.assertEqual(self.post("/api/v1/channels", {"provider": "comfyui"}).error["code"], "builtin_channel")
        updated = self.ok(self.patch("/api/v1/channels/comfyui", {"baseUrl": "http://127.0.0.1:9999"}))
        self.assertEqual(updated["channel"]["baseUrl"], "http://127.0.0.1:9999")
        self.assertEqual(self.ok(self.get("/api/v1/settings/comfy"))["document"]["baseUrl"], "http://127.0.0.1:9999")
        self.ok(self.patch("/api/v1/channels/comfyui", {"baseUrl": "http://127.0.0.1:8188"}))

    def test_validation(self):
        self.assertEqual(self.post("/api/v1/channels", {"provider": "nope"}).error["code"], "unknown_provider")
        self.assertEqual(self.post("/api/v1/channels", {"provider": "openai", "colour": "red"}).error["code"], "unknown_field")
        self.assertEqual(self.post("/api/v1/channels", {"provider": "openai", "keyIds": ["k"]}).status, 400)
        self.assertEqual(self.post("/api/v1/channels", {"provider": "openai", "sendSize": "yes"}).status, 400)
        self.assertEqual(self.post("/api/v1/channels", {"provider": "openai", "protocol": "fax"}).status, 400)
        self.assertEqual(self.post("/api/v1/channels", {"provider": "openai", "id": "openai"}).error["code"], "already_exists")
        self.assertEqual(self.post("/api/v1/channels", {"provider": "openai", "baseUrl": "http://public.example.com/v1",
                                                        "apiKey": "sk"}).status, 400)  # keys need HTTPS off-LAN
        self.assertEqual(self.post("/api/v1/channels/missing/activate").status, 404)

    def test_check_and_models_use_saved_configuration(self):
        calls = []

        def operation(op, payload):
            calls.append((op, payload["config"]))
            return {"models": ["a", "b"]} if op == "models" else {"ok": True, "latencyMs": 3}

        with patch.object(server, "provider_operation", side_effect=operation):
            checked = self.ok(self.post("/api/v1/channels/comfyui/check"))
            self.assertEqual(checked["via"], "check")
            self.assertEqual(calls[-1][1]["baseUrl"], "http://127.0.0.1:8188")
            cloud = self.ok(self.post("/api/v1/channels/openai/check"))
            self.assertEqual((cloud["via"], cloud["models"]), ("models", 2))
            self.assertEqual(self.ok(self.get("/api/v1/channels/openai/models"))["models"], ["a", "b"])
            self.ok(self.post("/api/v1/comfy/check", {"baseUrl": "http://127.0.0.1:7777"}))
            self.assertEqual(calls[-1][1], {"provider": "comfyui", "baseUrl": "http://127.0.0.1:7777"})
            self.ok(self.get("/api/v1/comfy/object-info"))
        with patch.object(server, "provider_operation", side_effect=OSError("connection refused")):
            failed = self.post("/api/v1/channels/comfyui/check")
        self.assertEqual((failed.status, failed.error["code"]), (502, "upstream_error"))


if __name__ == "__main__":
    unittest.main()
