"""Public API: workspace status/snapshot, workflows, assets (raw/upload/fetch) and marketplace."""
import json
import unittest
from unittest.mock import patch

from backend import server
from tests.api_support import PNG, PNG_DATA_URL, ApiServerCase

GRAPH = {"3": {"class_type": "KSampler", "inputs": {"seed": 1, "steps": 20, "cfg": 7, "model": ["4", 0]}},
         "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "a.safetensors"}},
         "9": {"class_type": "SaveImage", "inputs": {"images": ["3", 0]}}}


class WorkspaceApiTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.store().apply(
            [{"kind": "collections", "id": "c1", "document": {"id": "c1", "title": "一"}, "expected": None},
             {"kind": "collections", "id": "c2", "document": {"id": "c2", "title": "二"}, "expected": None},
             {"kind": "workflows", "id": "wf1", "expected": None, "document": {
                 "id": "wf1", "title": "基础", "workflow": GRAPH, "outputNodeId": "9"}}],
            settings_changes=[
                {"name": "llm", "expected": None, "document": {"baseUrl": "https://llm.example.com/v1", "key": "sk-hidden", "model": "m"}},
                {"name": "workspace", "expected": None, "document": {"ui": {"comfyStudio": {"activeProjectId": "c1"}}}}])

    def test_status_snapshot_and_content(self):
        status = self.ok(self.get("/api/v1/workspace"))
        self.assertEqual((status["activeProjectId"], status["counts"]["collections"]), ("c1", 2))
        snapshot = self.get("/api/v1/workspace/snapshot")
        self.assertEqual(snapshot.status, 200)
        text = snapshot.raw.decode()
        self.assertNotIn("sk-hidden", text)
        self.assertNotIn("_secretRefs", text)
        self.assertIn("templates", snapshot.data)
        self.assertIn("config", self.ok(self.get("/api/v1/workspace/content")))

    def test_active_collection_and_workflow(self):
        self.assertEqual(self.ok(self.put("/api/v1/workspace/active-collection", {"id": "c2"}))["activeProjectId"], "c2")
        created = self.ok(self.post("/api/v1/library/storyboards", {"title": "进入二"}), 201)
        self.assertEqual(created["document"]["projectId"], "c2")
        self.assertEqual(self.put("/api/v1/workspace/active-collection", {"id": "missing"}).status, 404)
        self.ok(self.put("/api/v1/workspace/active-collection", {"id": "c1"}))
        self.assertEqual(self.ok(self.post("/api/v1/library/workflows/wf1/activate"))["activeWorkflowId"], "wf1")
        self.assertEqual(self.ok(self.get("/api/v1/settings/comfy"))["document"]["activeWorkflowId"], "wf1")
        plan = self.ok(self.post("/api/v1/library/workflows/wf1/analyze"))
        self.assertIn("plan", plan)
        self.assertEqual(self.post("/api/v1/library/workflows/missing/activate").status, 404)
        analyzed = self.ok(self.post("/api/v1/production/analyze-slots", {"workflow": GRAPH}))
        self.assertIn("plan", analyzed)

    def test_assets_raw_thumbnail_binary_upload_and_fetch(self):
        uploaded = self.ok(self.call("POST", "/api/v1/assets/upload?name=dot.png", raw=PNG, content_type="image/png"), 201)
        raw = self.get("/api/v1/assets/raw?path=" + uploaded["url"])
        self.assertEqual((raw.status, raw.headers["Content-Type"], raw.raw), (200, "image/png", PNG))
        thumb = self.get("/api/v1/assets/raw?thumb=64x64&path=" + uploaded["url"])
        self.assertEqual((thumb.status, thumb.headers["Content-Type"]), (200, "image/webp"))
        download = self.get("/api/v1/assets/raw?download=true&path=" + uploaded["url"])
        self.assertIn("attachment", download.headers["Content-Disposition"])
        self.assertEqual(self.get("/api/v1/assets/raw?path=/images/assets/missing.png").status, 404)
        self.assertEqual(self.call("POST", "/api/v1/assets/upload", raw=b"not an image", content_type="image/png").status, 415)
        with patch.object(server, "fetch_remote_image", return_value=(PNG, "image/png")) as fetch:
            fetched = self.ok(self.post("/api/v1/assets/fetch", {"url": "https://cdn.example.com/a/dot.png"}), 201)
        fetch.assert_called_once()
        self.assertEqual((fetched["url"], fetched["name"]), (uploaded["url"], "dot.png"))  # content addressed
        self.assertEqual(self.post("/api/v1/assets/fetch", {"url": "file:///etc/passwd"}).status, 400)
        with patch.object(server, "fetch_remote_image", side_effect=OSError("timed out")):
            self.assertEqual(self.post("/api/v1/assets/fetch", {"url": "https://cdn.example.com/b.png"}).status, 502)

    def test_marketplace_catalog_and_install(self):
        catalog = self.ok(self.get("/api/v1/marketplace"))
        first = catalog["storyboards"][0]
        installed = self.ok(self.post("/api/v1/marketplace/install", {"id": first["id"]}), 201)
        self.assertEqual(len(installed["document"]["frames"]), len(first["data"]["steps"]))
        self.assertTrue(all(f["id"] for f in installed["document"]["frames"]))
        inline = self.ok(self.post("/api/v1/marketplace/install", {"data": {"title": "内联", "steps": [{"name": "a", "prompt": "p"}]},
                                                                  "projectId": "c2"}), 201)
        self.assertEqual((inline["document"]["title"], inline["document"]["projectId"]), ("内联", "c2"))
        remote = {"title": "远程", "frames": [{"prompt": "x", "caption": "y"}]}
        with patch.object(server, "fetch_remote_json", return_value=remote):
            fetched = self.ok(self.post("/api/v1/marketplace/fetch", {"url": "https://share.example.com/s.json"}))
            self.assertEqual(fetched, remote)
            from_url = self.ok(self.post("/api/v1/marketplace/install", {"url": "https://share.example.com/s.json"}), 201)
        self.assertEqual(from_url["document"]["frames"][0]["caption"], "y")
        self.assertEqual(self.post("/api/v1/marketplace/install", {"id": "missing"}).status, 404)
        self.assertEqual(self.post("/api/v1/marketplace/install", {}).status, 400)


if __name__ == "__main__":
    unittest.main()
