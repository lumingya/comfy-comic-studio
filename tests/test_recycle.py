"""Recycle bin (UX A8): list, restore, conflicts, purge and retention."""
import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from backend import mio_assets, mio_recycle, server
from backend.mio_library import LibraryError
from backend.mio_native_store import NativeStore


class RecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = NativeStore(self.temp.name, Path(server.__file__).parent)
        self.addCleanup(self.store.library.close)
        self.root = Path(self.temp.name)

    def create(self, kind="storyboards", id="one", **extra):
        body = {"storyboards": {"frames": []}, "albums": {"steps": []}}.get(kind, {})
        doc = {"id": id, "title": "回收测试 " + id, **body, **extra}
        self.store.apply([{"kind": kind, "id": id, "document": doc, "expected": None}])
        return self.store.entity(kind, id)

    def remove(self, kind, id):
        record = self.store.entity(kind, id)
        self.store.apply([], [{"kind": kind, "id": id, "expected": record["etag"]}])

    def items(self, **kw):
        return mio_recycle.list_items(self.root, self.store.library, **kw)

    def test_deleted_storyboard_is_listed_and_restored_in_place(self):
        self.create()
        self.create("storyboards", "two")
        self.remove("storyboards", "one")
        listing = self.items()
        [item] = [i for i in listing["items"] if i["id"] == "one"]
        self.assertEqual(item["kind"], "storyboards")
        self.assertEqual(item["title"], "回收测试 one")
        self.assertEqual(item["conflict"], "")
        self.assertGreater(item["bytes"], 0)
        with self.assertRaises(LibraryError):
            self.store.entity("storyboards", "one")
        revision = self.store.revision()
        result = mio_recycle.restore(self.store, kind="storyboards", id="one")
        self.assertEqual(result["restored"]["id"], "one")
        self.assertGreater(result["revision"], revision)
        self.assertEqual(self.store.entity("storyboards", "one")["document"]["title"], "回收测试 one")
        self.assertEqual([i for i in self.items()["items"] if i["id"] == "one"], [])
        self.assertIn("one", [r["id"] for r in self.store.records("storyboards")])

    def test_restore_never_overwrites_a_newer_resource_with_the_same_id(self):
        self.create()
        self.remove("storyboards", "one")
        self.create()  # a new storyboard reusing the id
        [item] = self.items()["items"]
        self.assertIn(item["conflict"], ("id", "path"))
        with self.assertRaises(LibraryError) as caught:
            mio_recycle.restore(self.store, item["trashId"])
        self.assertEqual(caught.exception.status, 409)
        self.assertTrue((self.root / ".trash" / item["trashId"]).is_dir())

    def test_undo_uses_the_newest_receipt(self):
        self.create(title="第一版")
        self.remove("storyboards", "one")
        time.sleep(0.01)
        self.create(title="第二版")
        self.remove("storyboards", "one")
        mio_recycle.restore(self.store, kind="storyboards", id="one")
        self.assertEqual(self.store.entity("storyboards", "one")["document"]["title"], "第二版")
        self.assertEqual(len(self.items()["items"]), 1)

    def test_album_restore_moves_the_folder_and_clears_the_tombstone(self):
        self.create("albums", "book")
        folder = self.root / self.store.entity("albums", "book")["file"]
        folder = folder.parent
        db_path = self.root / "runtime" / "execution" / "jobs.sqlite3"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(db_path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS deleted_albums(id TEXT PRIMARY KEY,deleted REAL NOT NULL)")
            db.execute("INSERT INTO deleted_albums VALUES('book',1)")
        self.remove("albums", "book")
        self.assertFalse(folder.exists())
        mio_recycle.restore(self.store, kind="albums", id="book",
                            before_commit=lambda kind, id: mio_recycle.undelete_albums(self.root, [id]))
        self.assertTrue((folder / "album.json").is_file())
        with sqlite3.connect(db_path) as db:
            self.assertIsNone(db.execute("SELECT 1 FROM deleted_albums WHERE id='book'").fetchone())

    def test_side_effect_kinds_are_hidden_but_counted(self):
        trash = self.root / ".trash" / ("a" * 32)
        trash.mkdir(parents=True)
        (trash / "receipt.json").write_text(json.dumps({"kind": "tasks", "id": "t", "original": "runtime/queue/t.json", "deletedAt": 1}))
        (trash / "t.json").write_text("{}")
        listing = self.items()
        self.assertEqual(listing["items"], [])
        self.assertEqual(listing["hidden"]["count"], 1)
        self.assertEqual(len(self.items(all_kinds=True)["items"]), 1)

    def test_receipt_outside_its_kind_folder_cannot_be_restored(self):
        trash = self.root / ".trash" / ("b" * 32)
        trash.mkdir(parents=True)
        (trash / "receipt.json").write_text(json.dumps({"kind": "storyboards", "id": "x", "original": "settings/secrets.json", "deletedAt": 1}))
        (trash / "secrets.json").write_text("{}")
        with self.assertRaises(LibraryError):
            mio_recycle.restore(self.store, "b" * 32)
        self.assertTrue((trash / "secrets.json").exists())
        self.assertEqual(self.items()["items"][0]["conflict"], "invalid")

    def test_purge_empty_and_retention(self):
        self.create("storyboards", "old")
        self.create("storyboards", "new")
        self.remove("storyboards", "old")
        self.remove("storyboards", "new")
        old = next(i for i in self.items()["items"] if i["id"] == "old")
        receipt = self.root / ".trash" / old["trashId"] / "receipt.json"
        data = json.loads(receipt.read_text(encoding="utf-8"))
        data["deletedAt"] = int(time.time() * 1000) - 40 * 86400 * 1000
        receipt.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            mio_recycle.auto_purge(self.root, 5)
        self.assertEqual(mio_recycle.auto_purge(self.root, 0)["purged"], [])
        self.assertEqual(mio_recycle.auto_purge(self.root, 30)["purged"], [old["trashId"]])
        [left] = self.items()["items"]
        self.assertEqual(left["id"], "new")
        with self.assertRaises(LibraryError):
            mio_recycle.purge(self.root, "../settings")
        self.assertEqual(mio_recycle.purge(self.root, left["trashId"])["purged"], [left["trashId"]])
        self.create("storyboards", "last")
        self.remove("storyboards", "last")
        batch = self.root / ".trash" / "assets" / "20260101-000000-1"
        batch.mkdir(parents=True)
        (batch / ("a" * 64 + ".png")).write_bytes(b"x")
        self.assertEqual(len(self.items()["assets"]), 1)
        self.assertEqual(len(mio_recycle.empty(self.root)["purged"]), 2)
        self.assertEqual(self.items()["items"], [])
        self.assertEqual(self.items()["assets"], [])

    def test_deleted_documents_still_pin_their_images(self):
        name = "c" * 64 + ".png"
        trash = self.root / ".trash" / ("d" * 32)
        trash.mkdir(parents=True)
        (trash / "x.json").write_text(json.dumps({"image": "/images/assets/" + name}))
        self.assertIn(name, mio_assets.scan_references(self.root))
        batch = self.root / ".trash" / "assets" / "20260101-000000-1"
        batch.mkdir(parents=True)
        (batch / "manifest.json").write_text(json.dumps({"moved": ["e" * 64 + ".png"]}))
        self.assertNotIn("e" * 64 + ".png", mio_assets.scan_references(self.root))

    def test_legacy_file_batch_restores_to_its_url(self):
        batch = self.root / ".trash" / "files" / "123456789"
        (batch / "old").mkdir(parents=True)
        (batch / "old" / "a.png").write_bytes(b"png")
        (batch / "manifest.json").write_text(json.dumps({"at": time.time(), "moved": [{"url": "/images/old/a.png", "stored": "old/a.png"}]}))
        self.assertEqual(self.items()["files"][0]["files"], 1)
        target = self.root / "images" / "old" / "a.png"
        result = mio_recycle.restore_files(self.root, "123456789", lambda url: self.root / url.lstrip("/"))
        self.assertEqual(result["restored"], ["/images/old/a.png"])
        self.assertEqual(target.read_bytes(), b"png")
        self.assertFalse(batch.exists())


if __name__ == "__main__":
    unittest.main()
