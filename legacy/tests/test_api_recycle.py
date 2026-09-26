"""Public API: recycle bin round trips and asset maintenance."""
import unittest

from tests.api_support import PNG_DATA_URL, ApiServerCase


class RecycleApiTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.store().apply(
            [{"kind": "collections", "id": "c1", "document": {"id": "c1", "title": "C"}, "expected": None}],
            settings_changes=[{"name": "workspace", "expected": None,
                               "document": {"ui": {"comfyStudio": {"activeProjectId": "c1"}}}}])

    def test_delete_list_restore_purge(self):
        story = self.ok(self.post("/api/v1/library/storyboards", {"title": "可恢复"}), 201)
        self.ok(self.delete("/api/v1/library/storyboards/" + story["id"]))
        listing = self.ok(self.get("/api/v1/recycle"))
        item = next(i for i in listing["items"] if i["id"] == story["id"])
        self.assertEqual((item["kind"], item["conflict"]), ("storyboards", ""))
        restored = self.ok(self.post("/api/v1/recycle/restore", {"kind": "storyboards", "id": story["id"]}))
        self.assertEqual(restored["restored"]["id"], story["id"])
        self.assertEqual(self.ok(self.get("/api/v1/library/storyboards/" + story["id"]))["document"]["title"], "可恢复")

        self.ok(self.delete("/api/v1/library/storyboards/" + story["id"]))
        trash_id = next(i["trashId"] for i in self.ok(self.get("/api/v1/recycle"))["items"] if i["id"] == story["id"])
        refused = self.post("/api/v1/recycle/purge", {"trashId": trash_id})
        self.assertEqual((refused.status, refused.error["code"]), (403, "confirmation_required"))
        self.ok(self.post("/api/v1/recycle/purge", {"trashId": trash_id, "confirm": True}))
        self.assertFalse(any(i["id"] == story["id"] for i in self.ok(self.get("/api/v1/recycle"))["items"]))
        self.assertEqual(self.post("/api/v1/recycle/restore", {}).status, 400)

    def test_album_restore_clears_the_tombstone(self):
        album = self.ok(self.post("/api/v1/albums", {"title": "回来吧", "steps": [{"caption": "a", "image": PNG_DATA_URL}]}), 201)
        self.ok(self.delete("/api/v1/albums/" + album["id"]))
        self.assertEqual(self.get("/api/v1/albums/" + album["id"]).status, 404)
        self.ok(self.post("/api/v1/recycle/restore", {"kind": "albums", "id": album["id"]}))
        detail = self.ok(self.get("/api/v1/albums/" + album["id"]))
        self.assertEqual(detail["steps"][0]["caption"], "a")

    def test_empty_auto_clean_and_maintenance(self):
        self.assertEqual(self.post("/api/v1/recycle/empty", {}).status, 403)
        self.ok(self.post("/api/v1/recycle/empty", {"confirm": True}))
        self.ok(self.post("/api/v1/recycle/auto-clean", {"retentionDays": 30}))
        self.assertEqual(self.post("/api/v1/recycle/auto-clean", {"retentionDays": 5}).status, 400)
        inventory = self.ok(self.get("/api/v1/maintenance/assets?graceHours=0"))
        self.assertIn("token", inventory)
        preview = self.ok(self.post("/api/v1/maintenance/assets/gc", {"graceHours": 0}))
        self.assertEqual(preview["token"], inventory["token"])
        collected = self.ok(self.post("/api/v1/maintenance/assets/gc", {"apply": True, "token": preview["token"], "graceHours": 0}))
        self.assertIsInstance(collected, dict)
        self.assertEqual(self.post("/api/v1/maintenance/assets/gc", {"graceHours": -1}).status, 400)
        self.assertEqual(self.post("/api/v1/maintenance/trash/purge", {"olderThanDays": 30}).status, 403)
        self.ok(self.post("/api/v1/maintenance/trash/purge", {"olderThanDays": 30, "confirm": True}))


if __name__ == "__main__":
    unittest.main()
