"""Public API: generic file-library CRUD on a temporary workspace."""
import io
import json
import unittest
import urllib.parse
import zipfile

from backend import server
from backend.ecosystem import api as ecosystem_api
from tests.api_support import PNG_DATA_URL, ApiServerCase


class LibraryApiTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.store().apply(
            [{"kind": "collections", "id": "c1", "document": {"id": "c1", "title": "夏日"}, "expected": None},
             {"kind": "collections", "id": "c2", "document": {"id": "c2", "title": "冬日"}, "expected": None}],
            settings_changes=[{"name": "workspace", "expected": None,
                               "document": {"ui": {"comfyStudio": {"activeProjectId": "c1"}}}}])

    def create(self, kind, document, status=201):
        response = self.post("/api/v1/library/" + kind, document)
        self.assertEqual(response.status, status, response.raw[:500])
        return response

    def test_overview_lists_every_kind(self):
        data = self.ok(self.get("/api/v1/library"))
        kinds = {k["kind"]: k for k in data["kinds"]}
        self.assertEqual(kinds["collections"]["count"], 2)
        self.assertFalse(kinds["tasks"]["writable"])
        self.assertEqual(data["activeProjectId"], "c1")

    def test_create_read_replace_patch_with_etags(self):
        response = self.create("storyboards", {"title": "远行", "frames": [{"prompt": "sea"}, {"prompt": "train", "name": "车站"}]})
        created = response.data
        self.assertTrue(created["id"].startswith("storyboard_"))
        self.assertEqual(response.headers["ETag"], '"%s"' % created["etag"])
        doc = created["document"]
        self.assertEqual(doc["projectId"], "c1")  # defaults to the active collection
        self.assertEqual([f["name"] for f in doc["frames"]], ["第 1 幕", "车站"])
        self.assertTrue(all(f["id"] for f in doc["frames"]))
        path = "/api/v1/library/storyboards/" + created["id"]

        read = self.get(path)
        self.assertEqual(read.data["etag"], created["etag"])
        stale = self.put(path, {**doc, "title": "改"}, headers={"If-Match": '"stale"'})
        self.assertEqual((stale.status, stale.error["code"]), (409, "revision_conflict"))
        replaced = self.ok(self.put(path, {**doc, "title": "改名"}, headers={"If-Match": read.headers["ETag"]}))
        self.assertEqual(replaced["document"]["title"], "改名")
        self.assertNotEqual(replaced["etag"], created["etag"])

        patched = self.ok(self.patch(path, {"outline": "海边", "note": "临时", "frames": [{"prompt": "only"}]}))
        self.assertEqual(patched["document"]["outline"], "海边")
        self.assertEqual(len(patched["document"]["frames"]), 1)
        self.assertEqual(patched["document"]["title"], "改名")
        removed = self.ok(self.patch(path, {"note": None}))
        self.assertNotIn("note", removed["document"])
        self.assertEqual(self.patch(path, {"id": "other"}).error["code"], "id_mismatch")
        self.assertEqual(self.patch(path, {"title": "x"}, headers={"If-Match": '"old"'}).status, 409)

    def test_put_creates_and_if_none_match_only_creates(self):
        path = "/api/v1/library/characters/hero_one"
        first = self.put(path, {"title": "主角", "entries": [{"key": "hair", "value": "black"}]})
        self.assertEqual(first.status, 201, first.raw)
        self.assertEqual(first.data["document"]["category"], "characters")
        self.assertTrue(first.data["document"]["entries"][0]["id"])
        again = self.put(path, {"title": "主角"}, headers={"If-None-Match": "*"})
        self.assertEqual((again.status, again.error["code"]), (409, "already_exists"))
        self.assertEqual(self.put("/api/v1/library/scenes/hero_one", {"title": "同名"}).status, 409)

    def test_image_data_urls_become_owned_assets(self):
        album = self.create("albums", {"title": "画册", "steps": [{"caption": "一", "image": PNG_DATA_URL}, {"caption": "二"}]}).data
        step = album["document"]["steps"][0]
        self.assertTrue(step["image"].startswith("/images/library/albums/%s/images/" % album["id"]), step["image"])
        self.assertEqual(album["document"]["generatedSteps"], 1)
        self.assertEqual(album["document"]["totalSteps"], 2)
        self.assertEqual(album["document"]["status"], "partial")
        data = self.ok(self.get("/api/v1/assets?path=" + step["image"]))
        self.assertTrue(data["dataUrl"].startswith("data:image/png"))
        detail = self.ok(self.get("/api/v1/albums/" + album["id"]))
        self.assertEqual(detail["steps"][0]["caption"], "一")
        # Reading and writing back unchanged URLs keeps the same asset.
        same = self.ok(self.put("/api/v1/library/albums/" + album["id"], album["document"]))
        self.assertEqual(same["document"]["steps"][0]["image"], step["image"])

    def test_listing_filters_sorts_and_pages(self):
        for title, project in (("甲", "c1"), ("乙", "c2"), ("丙", "c2")):
            self.create("plans", {"title": "计划" + title, "projectId": project, "templateId": "t", "rowId": "r"})
        data = self.ok(self.get("/api/v1/library/plans?projectId=c2&sort=title"))
        self.assertEqual(data["total"], 2)
        self.assertEqual({i["projectId"] for i in data["items"]}, {"c2"})
        page = self.ok(self.get("/api/v1/library/plans?limit=1&offset=1&full=true"))
        self.assertEqual(len(page["items"]), 1)
        self.assertIn("document", page["items"][0])
        self.assertEqual(self.ok(self.get("/api/v1/library/plans?q=" + urllib.parse.quote("计划乙")))["total"], 1)
        self.assertEqual(self.get("/api/v1/library/plans?limit=500").status, 400)

    def test_duplicate_bundle_export_inspect_and_import(self):
        source = self.create("storyboards", {"title": "原稿", "frames": [{"prompt": "a"}]}).data
        copy = self.ok(self.post("/api/v1/library/storyboards/%s/duplicate" % source["id"]), 201)
        self.assertNotEqual(copy["id"], source["id"])
        self.assertEqual(copy["document"]["title"], "原稿 副本")
        self.assertNotEqual(copy["document"]["frames"][0]["id"], source["document"]["frames"][0]["id"])

        bundle = self.get("/api/v1/library/storyboards/%s/bundle" % source["id"])
        self.assertEqual(bundle.status, 200)
        self.assertIn("attachment", bundle.headers["Content-Disposition"])
        self.assertIn("resource.json", zipfile.ZipFile(io.BytesIO(bundle.raw)).namelist())
        inspected = self.ok(self.call("POST", "/api/v1/library/inspect?kind=storyboards", raw=bundle.raw, content_type="application/zip"))
        self.assertEqual((inspected["kind"], inspected["count"]), ("storyboards", 1))
        imported = self.ok(self.call("POST", "/api/v1/library/import?projectId=c2", raw=bundle.raw, content_type="application/zip"), 201)
        self.assertEqual(imported["kind"], "storyboards")
        stored = self.ok(self.get("/api/v1/library/storyboards/" + imported["id"]))
        self.assertEqual((stored["document"]["projectId"], stored["document"]["title"]), ("c2", "原稿"))
        exported = self.post("/api/v1/library/export", {"kind": "storyboards", "document": {"title": "临时", "frames": []}})
        self.assertEqual(exported.raw[:2], b"PK")

    def test_delete_goes_to_recycle_and_collections_refuse_without_cascade(self):
        doomed = self.create("storyboards", {"title": "删掉我"}).data
        deleted = self.ok(self.delete("/api/v1/library/storyboards/" + doomed["id"]))
        self.assertEqual(deleted["deleted"], [{"kind": "storyboards", "id": doomed["id"]}])
        self.assertEqual(self.get("/api/v1/library/storyboards/" + doomed["id"]).status, 404)
        self.assertEqual(self.delete("/api/v1/library/storyboards/" + doomed["id"]).status, 404)

        collection = self.create("collections", {"title": "临时集"}).data
        member = self.create("storyboards", {"title": "成员", "projectId": collection["id"]}).data
        book = self.create("albums", {"title": "成员画册", "projectId": collection["id"]}).data
        refused = self.delete("/api/v1/library/collections/" + collection["id"])
        self.assertEqual((refused.status, refused.error["code"]), (409, "collection_not_empty"))
        self.assertEqual(refused.error["details"], {"storyboards": 1, "albums": 1})
        gone = self.ok(self.delete("/api/v1/library/collections/%s?cascade=true" % collection["id"]))
        self.assertEqual({(d["kind"], d["id"]) for d in gone["deleted"]},
                         {("collections", collection["id"]), ("storyboards", member["id"]), ("albums", book["id"])})
        self.assertEqual(self.get("/api/v1/library/albums/" + book["id"]).status, 404)
        self.assertNotIn(book["id"], [a["id"] for a in self.ok(self.get("/api/v1/library/albums"))["items"]])

    def test_validation_errors(self):
        self.assertEqual(self.get("/api/v1/library/nope").error["code"], "unknown_kind")
        self.assertEqual(self.post("/api/v1/library/tasks", {"title": "x"}).error["code"], "read_only_kind")
        self.assertEqual(self.post("/api/v1/library/storyboards", {"title": "x", "projectId": "missing"}).error["code"], "unknown_collection")
        self.assertEqual(self.post("/api/v1/library/storyboards", {"title": "x", "id": "bad id"}).error["code"], "invalid_id")
        self.assertEqual(self.post("/api/v1/library/storyboards", {"title": "长" * 501}).status, 400)
        self.assertEqual(self.post("/api/v1/library/storyboards", {"title": "x", "frames": "no"}).status, 400)
        self.assertEqual(self.put("/api/v1/library/storyboards/a1", {"id": "b1", "title": "x"}).error["code"], "id_mismatch")
        self.create("collections", {"id": "dup_c", "title": "重复"})
        self.assertEqual(self.post("/api/v1/library/collections", {"id": "dup_c", "title": "重复"}).error["code"], "already_exists")

    def test_reorder_updates_the_display_order(self):
        ids = [self.create("layouts", {"title": "版式%d" % i, "html": "<div></div>"}).data["id"] for i in range(3)]
        result = self.ok(self.post("/api/v1/library/layouts/reorder", {"ids": [ids[2], ids[0]]}))
        self.assertEqual(result["order"][:2], [ids[2], ids[0]])
        listed = [i["id"] for i in self.ok(self.get("/api/v1/library/layouts"))["items"]]
        self.assertEqual(listed[:2], [ids[2], ids[0]])
        self.assertEqual(self.post("/api/v1/library/layouts/reorder", {"ids": ["missing"]}).status, 404)
        presets = [self.create("scenes", {"title": "场景%d" % i}).data["id"] for i in range(2)]
        self.ok(self.post("/api/v1/library/scenes/reorder", {"ids": [presets[1], presets[0]]}))
        listed = [i["id"] for i in self.ok(self.get("/api/v1/library/scenes"))["items"]]
        self.assertEqual(listed, [presets[1], presets[0]])

    def test_extension_host_library_put_and_delete_work(self):
        eco = ecosystem_api.service(server.application_services())
        stored = eco.host_call("demo", "library.put", {"kind": "storyboards", "document": {"title": "扩展写入", "frames": []}})
        self.assertTrue(stored["id"].startswith("storyboard_"))
        self.assertEqual(self.ok(self.get("/api/v1/library/storyboards/" + stored["id"]))["document"]["title"], "扩展写入")
        updated = eco.host_call("demo", "library.put", {"kind": "storyboards", "document": {**stored["document"], "title": "扩展改名"}})
        self.assertEqual(updated["document"]["title"], "扩展改名")
        eco.host_call("demo", "library.delete", {"kind": "storyboards", "id": stored["id"]})
        self.assertEqual(self.get("/api/v1/library/storyboards/" + stored["id"]).status, 404)
        events = [e["name"] for e in eco.events.recent]
        self.assertIn("library.saved", events)
        self.assertIn("library.deleted", events)



class NoActiveCollectionTests(ApiServerCase):
    """Without an active collection, creates and imports both fall back to the first collection."""

    @classmethod
    def seed(cls):
        cls.store().apply([{"kind": "collections", "id": "only", "document": {"id": "only", "title": "唯一"}, "expected": None}])

    def test_create_and_import_share_the_default_collection(self):
        self.assertIsNone(self.ok(self.get("/api/v1/workspace"))["activeProjectId"])
        source = self.ok(self.post("/api/v1/library/storyboards", {"title": "原稿", "frames": [{"prompt": "a"}]}), 201)
        self.assertEqual(source["document"]["projectId"], "only")
        bundle = self.get("/api/v1/library/storyboards/%s/bundle" % source["id"])
        imported = self.ok(self.call("POST", "/api/v1/library/import", raw=bundle.raw, content_type="application/zip"), 201)
        self.assertEqual(self.ok(self.get("/api/v1/library/storyboards/" + imported["id"]))["document"]["projectId"], "only")


if __name__ == "__main__":
    unittest.main()
