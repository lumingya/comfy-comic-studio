"""Public API framework: routing, envelopes, migrated jobs / production / album / asset routes."""
import unittest

from backend.api_v1.core import Router, merge_patch
from tests.api_support import PNG_DATA_URL, ApiServerCase


class RouterTests(unittest.TestCase):
    def test_literal_segments_win_and_405_lists_allowed_methods(self):
        router = Router()
        router.get("/library/{kind}/{id}", summary="x", tags=["t"])(lambda ctx: "entity")
        router.post("/library/{kind}/reorder", summary="x", tags=["t"])(lambda ctx: "reorder")
        route, params = router.match("POST", "/library/storyboards/reorder")
        self.assertEqual(route.path, "/library/{kind}/reorder")
        route, params = router.match("GET", "/library/storyboards/reorder")
        self.assertEqual(params, {"kind": "storyboards", "id": "reorder"})
        with self.assertRaises(Exception) as caught:
            router.match("DELETE", "/library/storyboards/x")
        self.assertEqual(caught.exception.status, 405)
        self.assertEqual(caught.exception.headers["Allow"], "GET")

    def test_path_parameters_are_url_decoded_and_greedy_tails_supported(self):
        router = Router()
        router.get("/extensions/{id}/{tail:path}", summary="x", tags=["t"])(lambda ctx: None)
        _, params = router.match("GET", "/extensions/demo/a/b%20c")
        self.assertEqual(params, {"id": "demo", "tail": "a/b c"})

    def test_duplicate_routes_are_rejected(self):
        router = Router()
        router.get("/a", summary="x", tags=["t"])(lambda ctx: None)
        with self.assertRaises(RuntimeError):
            router.get("/a", summary="y", tags=["t"])(lambda ctx: None)

    def test_merge_patch_follows_rfc7396(self):
        self.assertEqual(merge_patch({"a": 1, "b": {"c": 2, "d": 3}}, {"a": None, "b": {"c": 5}, "e": [1]}),
                         {"b": {"c": 5, "d": 3}, "e": [1]})
        self.assertEqual(merge_patch({"a": 1}, ["x"]), ["x"])


class MigratedRouteTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.store().apply([
            {"kind": "collections", "id": "c1", "document": {"id": "c1", "title": "C"}, "expected": None},
            {"kind": "albums", "id": "b1", "expected": None, "document": {
                "id": "b1", "title": "B", "projectId": "c1", "totalSteps": 1,
                "steps": [{"stepIndex": 0, "name": "one", "caption": "hi", "prompt": "p", "image": PNG_DATA_URL}]}},
        ])

    def test_jobs_list_and_unknown_job(self):
        self.assertEqual(self.ok(self.get("/api/v1/jobs"))["jobs"], [])
        response = self.get("/api/v1/jobs/nope")
        self.assertEqual((response.status, response.error["code"]), (404, "job_not_found"))

    def test_production_queue_etag_and_enveloped_errors(self):
        first = self.get("/api/v1/production/tasks")
        self.assertEqual(first.status, 200)
        self.assertIn("tasks", first.data)
        again = self.get("/api/v1/production/tasks", headers={"If-None-Match": first.headers["ETag"]})
        self.assertEqual(again.status, 304)
        missing = self.get("/api/v1/production/tasks/assembly-missing")
        self.assertEqual((missing.status, missing.error["code"]), (404, "not_found"))
        invalid = self.post("/api/v1/production/start", {})
        self.assertEqual(invalid.status, 400)
        self.assertIn("message", invalid.error)
        no_story = self.post("/api/v1/production/assemble", {"channelId": "comfyui"})
        self.assertEqual(no_story.status, 400)
        self.assertIn("storyId", no_story.error["message"])

    def test_album_detail_and_html_export(self):
        album = self.ok(self.get("/api/v1/albums/b1"))
        self.assertEqual(album["steps"][0]["caption"], "hi")
        self.assertTrue(album["steps"][0]["assetEndpoint"].startswith("/api/v1/assets?path="))
        asset = self.ok(self.get(album["steps"][0]["assetEndpoint"]))
        self.assertTrue(asset["dataUrl"].startswith("data:image/png;base64,"))
        exported = self.post("/api/v1/albums/export", {"albumIds": ["b1"], "format": "zip"})
        self.assertEqual(exported.status, 200, exported.raw[:300])
        self.assertEqual(exported.raw[:2], b"PK")
        no_layout = self.post("/api/v1/albums/export", {"albumIds": ["b1"], "format": "html"})
        self.assertEqual(no_layout.status, 404)  # an empty workspace has no export layouts
        self.assertEqual(self.get("/api/v1/albums/missing").status, 404)

    def test_asset_upload_round_trip(self):
        uploaded = self.ok(self.post("/api/v1/assets/upload", {"dataUrl": PNG_DATA_URL, "name": "dot.png"}), 201)
        self.assertTrue(uploaded["url"].startswith("/images/"))
        self.assertEqual(self.post("/api/v1/assets/upload", {"dataUrl": "nope"}).status, 400)

    def test_catalog_views(self):
        catalog = self.ok(self.get("/api/v1/catalog"))
        self.assertEqual([c["id"] for c in catalog["collections"]], ["c1"])
        for kind in ("workflows", "presets", "characters", "scenes", "layouts", "channels", "collections"):
            self.assertIn("items", self.ok(self.get("/api/v1/resources/" + kind)))


if __name__ == "__main__":
    unittest.main()
