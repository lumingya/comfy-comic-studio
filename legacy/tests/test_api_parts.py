"""Public API: storyboard frames, preset entries and album pages."""
import unittest

from tests.api_support import PNG_DATA_URL, ApiServerCase


class PartsApiTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.store().apply(
            [{"kind": "collections", "id": "c1", "document": {"id": "c1", "title": "C"}, "expected": None},
             {"kind": "storyboards", "id": "s1", "expected": None, "document": {
                 "id": "s1", "title": "S", "projectId": "c1",
                 "frames": [{"id": "f1", "name": "一", "prompt": "a"}, {"id": "f2", "name": "二", "prompt": "b"}]}},
             {"kind": "characters", "id": "hero", "expected": None, "document": {
                 "id": "hero", "title": "Hero", "projectId": "c1", "entries": [{"id": "e1", "key": "hair", "type": "text", "value": "black"}]}},
             {"kind": "albums", "id": "b1", "expected": None, "document": {
                 "id": "b1", "title": "B", "projectId": "c1", "totalSteps": 2, "steps": []}}],
            settings_changes=[{"name": "workspace", "expected": None,
                               "document": {"ui": {"comfyStudio": {"activeProjectId": "c1"}}}}])

    def test_frames_add_patch_reorder_delete(self):
        base = "/api/v1/library/storyboards/s1/frames"
        listed = self.ok(self.get(base))
        self.assertEqual([f["index"] for f in listed["frames"]], [0, 1])
        added = self.ok(self.post(base + "?index=1", {"prompt": "middle"}), 201)
        self.assertEqual(added["index"], 1)
        self.assertEqual(added["frames"][0]["name"], "第 2 幕")
        batch = self.ok(self.post(base, {"count": 2, "namePattern": "新 {n}", "basePrompt": "{character}, "}), 201)
        self.assertEqual([f["name"] for f in batch["frames"]], ["新 4", "新 5"])
        self.assertEqual(batch["frames"][0]["prompt"], "{character}, ")
        patched = self.ok(self.patch(base + "/f2", {"caption": "台词", "camera": "close"}))
        self.assertEqual((patched["frame"]["caption"], patched["frame"]["prompt"]), ("台词", "b"))
        by_index = self.ok(self.get(base + "/0"))
        self.assertEqual(by_index["id"], "f1")
        reordered = self.ok(self.post(base + "/reorder", {"ids": ["f2", "f1"]}))
        self.assertEqual(reordered["order"][:2], ["f2", "f1"])
        removed = self.ok(self.delete(base + "/f1"))
        self.assertEqual(removed["removed"]["id"], "f1")
        self.assertEqual(self.get(base + "/f1").status, 404)
        stale = self.patch(base + "/f2", {"caption": "x"}, headers={"If-Match": '"stale"'})
        self.assertEqual(stale.status, 409)
        duplicate = self.post(base, {"id": "f2", "prompt": "dup"})
        self.assertEqual(duplicate.error["code"], "duplicate_frame")

    def test_preset_entries(self):
        base = "/api/v1/library/characters/hero/entries"
        self.assertEqual(self.ok(self.get(base))["entries"][0]["key"], "hair")
        updated = self.ok(self.put(base + "/hair", {"value": "silver"}))
        self.assertEqual((updated["entry"]["value"], updated["created"]), ("silver", False))
        created = self.ok(self.put(base + "/outfit", {"value": "coat", "type": "text"}))
        self.assertTrue(created["created"])
        self.assertTrue(created["entry"]["id"])
        entries = self.ok(self.get(base))["entries"]
        self.assertEqual([e["key"] for e in entries], ["hair", "outfit"])
        self.ok(self.delete(base + "/hair"))
        self.assertEqual(self.delete(base + "/hair").status, 404)
        self.assertEqual(self.put(base + "/bad-key", {"value": 1}).error["code"], "invalid_key")
        self.assertEqual(self.get("/api/v1/library/storyboards/s1/entries").status, 404)

    def test_album_steps_and_document_patch(self):
        page = self.ok(self.patch("/api/v1/albums/b1/steps/1", {"caption": "第二页", "image": PNG_DATA_URL}))
        self.assertEqual(page["step"]["stepIndex"], 1)
        self.assertTrue(page["step"]["image"].startswith("/images/library/albums/b1/images/"))
        read = self.ok(self.get("/api/v1/albums/b1/steps/1"))
        self.assertTrue(read["assetEndpoint"])
        self.assertEqual(self.get("/api/v1/albums/b1/steps/0").status, 404)
        album = self.ok(self.patch("/api/v1/albums/b1", {"title": "新标题", "tags": ["夏"], "liked": True}))
        self.assertEqual(album["document"]["title"], "新标题")
        self.assertEqual(album["document"]["generatedSteps"], 1)
        detail = self.ok(self.get("/api/v1/albums/b1"))
        self.assertEqual((detail["title"], detail["tags"]), ("新标题", ["夏"]))
        cleared = self.ok(self.patch("/api/v1/albums/b1/steps/1", {"caption": None}))
        self.assertNotIn("caption", cleared["step"])
        self.ok(self.delete("/api/v1/albums/b1/steps/1"))
        self.assertEqual(self.get("/api/v1/albums/b1/steps/1").status, 404)
        self.assertEqual(self.patch("/api/v1/albums/b1/steps/999", {}).status, 400)

    def test_album_create_and_delete_aliases(self):
        created = self.ok(self.post("/api/v1/albums", {"title": "新画册", "steps": [{"caption": "a", "image": PNG_DATA_URL}]}), 201)
        self.assertEqual(created["document"]["status"], "complete")
        deleted = self.ok(self.delete("/api/v1/albums/" + created["id"]))
        self.assertEqual(deleted["deleted"][0]["id"], created["id"])
        self.assertEqual(self.get("/api/v1/albums/" + created["id"]).status, 404)
        recreate = self.post("/api/v1/albums", {"id": created["id"], "title": "复活"})
        self.assertEqual(recreate.error["code"], "album_deleted")


if __name__ == "__main__":
    unittest.main()


class AlbumTransferTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.store().apply(
            [{"kind": "collections", "id": "c1", "document": {"id": "c1", "title": "C"}, "expected": None},
             {"kind": "albums", "id": "trip", "expected": None, "document": {
                 "id": "trip", "title": "旅行", "projectId": "c1", "totalSteps": 2, "tags": ["夏"],
                 "steps": [{"stepIndex": 0, "caption": "出发", "prompt": "p", "image": PNG_DATA_URL},
                           {"stepIndex": 1, "caption": "到达", "prompt": "q"}]}}],
            settings_changes=[{"name": "workspace", "expected": None,
                               "document": {"ui": {"comfyStudio": {"activeProjectId": "c1"}}}}])

    def test_pages_zip_export_and_import_round_trip(self):
        import io
        import zipfile

        self.assertIn("pages-zip", [e["id"] for e in self.ok(self.get("/api/v1/exporters"))])
        self.assertIn("pages-zip", [i["id"] for i in self.ok(self.get("/api/v1/importers"))])
        exported = self.post("/api/v1/albums/trip/export", {"exporter": "pages-zip"})
        self.assertEqual(exported.status, 200, exported.raw[:300])
        names = zipfile.ZipFile(io.BytesIO(exported.raw)).namelist()
        self.assertIn("album.json", names)
        self.assertIn("pages/001.png", names)
        imported = self.ok(self.call("POST", "/api/v1/albums/import?filename=trip.zip", raw=exported.raw,
                                     content_type="application/zip"), 201)
        self.assertEqual(imported["kind"], "albums")
        self.assertNotEqual(imported["id"], "trip")
        album = self.ok(self.get("/api/v1/albums/" + imported["id"]))
        self.assertEqual((album["title"], album["projectId"]), ("旅行", "c1"))
        self.assertEqual([s["caption"] for s in album["steps"]], ["出发", "到达"])
        self.assertTrue(album["steps"][0]["image"].startswith("/images/library/albums/" + imported["id"]))
        self.assertEqual(self.post("/api/v1/albums/trip/export", {"exporter": "nope"}).status, 404)
        self.assertEqual(self.post("/api/v1/albums/missing/export").status, 404)
