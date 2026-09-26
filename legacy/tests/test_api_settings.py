"""Public API: settings documents with write-only credentials."""
import json
import os
import unittest

from tests.api_support import ApiServerCase


class SettingsApiTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.store().apply([], settings_changes=[
            {"name": "llm", "expected": None, "document": {"mode": "real", "provider": "openai",
                                                           "baseUrl": "https://api.example.com/v1", "key": "", "model": "m1"}},
            {"name": "workspace", "expected": None, "document": {"ui": {"comfyStudio": {"settings": {
                "critic": {"baseUrl": "https://api.example.com/v1", "model": "vision", "key": ""}}}}}}])

    def vault(self):
        path = os.path.join(self.root, "settings", "secrets.json")
        if not os.path.exists(path):
            return ""
        with open(path, encoding="utf-8") as handle:
            return handle.read()

    def test_list_and_read(self):
        names = [item["name"] for item in self.ok(self.get("/api/v1/settings"))]
        self.assertEqual(names, ["workspace", "comfy", "llm", "xml"])
        llm = self.get("/api/v1/settings/llm")
        self.assertIn(llm.data["document"]["model"], ("m1", "m2"))  # other tests may have edited it
        self.assertEqual(llm.headers["ETag"], '"%s"' % llm.data["etag"])
        self.assertEqual(self.get("/api/v1/settings/secrets").status, 404)
        self.assertEqual(self.get("/api/v1/settings/appearance").error["code"], "unknown_settings")
        self.assertIn("baseUrl", self.ok(self.get("/api/v1/settings/comfy?view=true"))["document"])

    def test_keys_are_write_only_and_bound_to_the_endpoint(self):
        current = self.ok(self.get("/api/v1/settings/llm"))
        saved = self.ok(self.put("/api/v1/settings/llm", {**current["document"], "key": "sk-private-1"}))
        self.assertEqual(saved["secrets"], ["/key"])
        self.assertEqual(saved["document"]["key"], "")
        self.assertIn("sk-private-1", self.vault())
        read = self.get("/api/v1/settings/llm")
        self.assertNotIn("sk-private-1", read.raw.decode())
        self.assertNotIn("_secretRefs", read.raw.decode())

        patched = self.ok(self.patch("/api/v1/settings/llm", {"model": "m2"}))
        self.assertEqual((patched["document"]["model"], patched["secrets"]), ("m2", ["/key"]))
        moved = self.patch("/api/v1/settings/llm", {"baseUrl": "https://other.example.com/v1"})
        self.assertEqual((moved.status, moved.error["code"]), (409, "credential_binding_changed"))
        both = self.ok(self.patch("/api/v1/settings/llm", {"baseUrl": "https://other.example.com/v1", "key": "sk-private-2"}))
        self.assertEqual(both["secrets"], ["/key"])

        replaced = self.ok(self.put("/api/v1/settings/llm/secrets", {"pointer": "/key", "value": "sk-private-3"}))
        self.assertEqual(replaced["stored"], ["/key"])
        self.assertIn("sk-private-3", self.vault())
        self.assertNotIn("sk-private-2", self.vault())  # the superseded key is removed from the vault
        removed = self.ok(self.delete("/api/v1/settings/llm/secrets?pointer=/key"))
        self.assertEqual(removed, {"stored": [], "removed": True})
        self.assertNotIn("sk-private-3", self.vault())
        self.assertEqual(self.ok(self.get("/api/v1/settings/llm/secrets"))["slots"], ["/key"])

    def test_nested_critic_key_and_validation(self):
        pointer = "/ui/comfyStudio/settings/critic/key"
        stored = self.ok(self.put("/api/v1/settings/workspace/secrets", {"pointer": pointer, "value": "critic-secret"}))
        self.assertIn(pointer, stored["stored"])
        self.assertNotIn("critic-secret", self.get("/api/v1/settings/workspace").raw.decode())
        self.assertEqual(self.put("/api/v1/settings/workspace/secrets", {"pointer": "/ui/title", "value": "x"}).error["code"], "invalid_pointer")
        self.assertEqual(self.put("/api/v1/settings/llm/secrets", {"pointer": "key", "value": "x"}).status, 400)
        self.ok(self.delete("/api/v1/settings/workspace/secrets?pointer=" + pointer))

    def test_etag_conflicts_and_patching_workspace(self):
        stale = self.patch("/api/v1/settings/workspace", {"ui": {"comfyStudio": {"activeProjectId": "x"}}}, headers={"If-Match": '"stale"'})
        self.assertEqual(stale.status, 409)
        updated = self.ok(self.patch("/api/v1/settings/workspace", {"ui": {"comfyStudio": {"activeProjectId": "c9"}}}))
        self.assertEqual(updated["document"]["ui"]["comfyStudio"]["activeProjectId"], "c9")
        self.assertEqual(updated["document"]["ui"]["comfyStudio"]["settings"]["critic"]["model"], "vision")
        self.assertEqual(self.put("/api/v1/settings/xml", {"model": "x"}, headers={"If-Match": '"bad"'}).status, 409)
        self.assertEqual(self.ok(self.put("/api/v1/settings/xml", {"model": "x"}))["document"], {"model": "x"})


if __name__ == "__main__":
    unittest.main()
