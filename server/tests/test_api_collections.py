"""HTTP contracts for shelf collections, atomic moves and compare-and-swap undo."""

from __future__ import annotations

from mio_server.models import Series

from .api_harness import ApiCase


class CollectionsApiTests(ApiCase):
    def collection(self, name="Group"):
        return self.ok(self.client.post("/api/collections", json={"name": name}), 201)

    def album(self, title="Album", **kwargs):
        return self.ctx.store.create_series(Series(title=title, **kwargs)).model_dump(mode="json")

    def assign(self, *assignments, code=200):
        return self.ok(
            self.client.post(
                "/api/collections/memberships", json={"assignments": list(assignments)}
            ),
            code,
        )

    @staticmethod
    def item(album, collection, revision=0):
        return {
            "series_id": album["id"],
            "collection_id": collection["id"] if collection else None,
            "expected_revision": revision,
        }

    def test_empty_get_and_crud_return_exact_contracts(self):
        album = self.album()
        self.album(kind="workshop")
        index = self.ok(self.client.get("/api/collections"))
        self.assertEqual(
            index,
            {
                "collections": [],
                "memberships": {album["id"]: {"collection_id": None, "revision": 0}},
                "total_count": 1,
                "unfiled_count": 1,
            },
        )
        self.assertEqual(self.ctx.store.list_docs("collection_library"), [])
        collection = self.collection("  First  ")
        self.assertEqual(set(collection), {"id", "name", "created_at", "updated_at"})
        self.assertEqual(collection["name"], "First")
        self.assertTrue(collection["id"].startswith("collection_"))
        renamed = self.ok(
            self.client.patch(f"/api/collections/{collection['id']}", json={"name": " Renamed "})
        )
        self.assertEqual(renamed["name"], "Renamed")
        self.assertEqual(renamed["created_at"], collection["created_at"])
        self.ok(self.client.delete(f"/api/collections/{collection['id']}"), 204)
        self.assertEqual(self.ok(self.client.get("/api/collections")), index)
        self.assertEqual(self.ctx.store.get_series(album["id"]).id, album["id"])

    def test_duplicate_names_are_conflicts_and_unknown_ids_are_not_found(self):
        first, second = self.collection("Stra\u00dfe"), self.collection("Other")
        self.ok(self.client.post("/api/collections", json={"name": " STRASSE "}), 409)
        self.ok(
            self.client.patch(f"/api/collections/{second['id']}", json={"name": "strasse"}), 409
        )
        self.ok(self.client.patch("/api/collections/missing", json={"name": "Name"}), 404)
        self.ok(self.client.delete("/api/collections/missing"), 404)
        self.assertEqual(len(self.ok(self.client.get("/api/collections"))["collections"]), 2)
        self.assertEqual(
            self.ctx.store.get_doc("collection_library", "shelf").collections[0].id, first["id"]
        )

    def test_malformed_names_and_assignments_are_422_without_writes(self):
        album = self.album()
        good = self.item(album, None)
        bad_names = [
            {},
            {"name": ""},
            {"name": " \t "},
            {"name": "x" * 81},
            {"name": 1},
            {"name": "A", "extra": 1},
        ]
        for payload in bad_names:
            with self.subTest(payload=payload):
                self.ok(self.client.post("/api/collections", json=payload), 422)
        bad_batches = [
            {},
            {"assignments": []},
            {"assignments": [good, good]},
            {"assignments": [{"series_id": album["id"], "collection_id": None}]},
            {"assignments": [{**good, "series_id": ""}]},
            {"assignments": [{**good, "collection_id": ""}]},
            {"assignments": [{**good, "collection_id": 1}]},
            {"assignments": [good], "extra": True},
        ]
        for revision in (-1, True, "0", 0.1):
            bad_batches.append({"assignments": [{**good, "expected_revision": revision}]})
        for payload in bad_batches:
            with self.subTest(payload=payload):
                self.ok(self.client.post("/api/collections/memberships", json=payload), 422)
        self.assertEqual(self.ctx.store.list_docs("collection_library"), [])

    def test_batch_returns_changes_and_atomic_counts_without_changing_series(self):
        a, b, unfiled = self.album("A"), self.album("B"), self.album("Unfiled")
        collection = self.collection()
        result = self.assign(self.item(a, collection), self.item(b, collection))
        self.assertEqual(set(result), {"changes", "index"})
        self.assertEqual([change["series_id"] for change in result["changes"]], [a["id"], b["id"]])
        for change in result["changes"]:
            self.assertEqual(set(change), {"series_id", "before", "after"})
            self.assertEqual(change["before"], {"collection_id": None, "revision": 0})
            self.assertEqual(change["after"], {"collection_id": collection["id"], "revision": 1})
        index = result["index"]
        self.assertEqual(index["total_count"], 3)
        self.assertEqual(index["unfiled_count"], 1)
        self.assertEqual(index["collections"], [{**collection, "album_count": 2}])
        self.assertEqual(
            index["memberships"][unfiled["id"]], {"collection_id": None, "revision": 0}
        )
        self.assertEqual(self.ok(self.client.get("/api/collections")), index)
        for album in (a, b, unfiled):
            self.assertEqual(self.ok(self.client.get(f"/api/series/{album['id']}")), album)

    def test_invalid_source_or_target_and_conflicts_reject_whole_batch(self):
        a, b = self.album("A"), self.album("B")
        source, target = self.collection("Source"), self.collection("Target")
        self.assign(self.item(a, source), self.item(b, source))
        previous = self.ok(self.client.get("/api/collections"))
        self.assign(self.item(a, target, 1), self.item(b, target, 0), code=409)
        invalid_sources = [
            {"id": "missing"},
            self.album(kind="workshop"),
            self.album(kind="kit"),
            self.album(),
        ]
        self.ok(self.client.delete(f"/api/series/{invalid_sources[-1]['id']}"), 204)
        for invalid in invalid_sources:
            with self.subTest(source=invalid["id"]):
                self.assign(self.item(a, target, 1), self.item(invalid, target), code=409)
        self.assign(self.item(a, target, 1), self.item(b, {"id": "missing"}, 1), code=404)
        self.assertEqual(self.ok(self.client.get("/api/collections")), previous)

    def test_mixed_origins_undo_and_later_changes_cannot_be_overwritten(self):
        a, b, c = self.album("A"), self.album("B"), self.album("C")
        source_a, source_b, target = [self.collection(name) for name in ("A", "B", "Target")]
        self.assign(self.item(a, source_a), self.item(b, source_b))
        result = self.assign(self.item(a, target, 1), self.item(b, target, 1), self.item(c, target))
        undo = [
            {
                "series_id": change["series_id"],
                "collection_id": change["before"]["collection_id"],
                "expected_revision": change["after"]["revision"],
            }
            for change in result["changes"]
        ]
        restored = self.assign(*undo)["index"]
        self.assertEqual(
            restored["memberships"][a["id"]], {"collection_id": source_a["id"], "revision": 3}
        )
        self.assertEqual(
            restored["memberships"][b["id"]], {"collection_id": source_b["id"], "revision": 3}
        )
        self.assertEqual(restored["memberships"][c["id"]], {"collection_id": None, "revision": 2})
        self.assign(self.item(a, target, 3))
        previous = self.ok(self.client.get("/api/collections"))
        self.assign(*undo, code=409)
        self.assertEqual(self.ok(self.client.get("/api/collections")), previous)

    def test_source_trashed_or_changed_kind_after_snapshot_conflicts_without_writes(self):
        a, b = self.album("A"), self.album("B")
        source, target = self.collection("Source"), self.collection("Target")
        self.assign(self.item(a, source), self.item(b, source))
        before = self.ctx.store.get_doc("collection_library", "shelf").model_dump_json()
        self.ok(self.client.delete(f"/api/series/{b['id']}"), 204)
        self.assign(self.item(a, target, 1), self.item(b, target, 1), code=409)
        self.assertEqual(
            self.ctx.store.get_doc("collection_library", "shelf").model_dump_json(), before
        )
        self.ok(self.client.post(f"/api/series/{b['id']}/restore"))
        self.assertEqual(
            self.ok(self.client.get("/api/collections"))["memberships"][b["id"]],
            {"collection_id": source["id"], "revision": 1},
        )
        self.ctx.store.update_series(b["id"], lambda series: setattr(series, "kind", "workshop"))
        self.assign(self.item(a, target, 1), self.item(b, target, 1), code=409)
        self.assertEqual(
            self.ctx.store.get_doc("collection_library", "shelf").model_dump_json(), before
        )

    def test_same_target_is_noop_and_deleted_collection_invalidates_old_revisions(self):
        album = self.album()
        collection = self.collection()
        first = self.assign(self.item(album, collection))
        self.assertEqual(
            self.assign(self.item(album, collection, 1)), {"changes": [], "index": first["index"]}
        )
        self.ok(self.client.delete(f"/api/series/{album['id']}"), 204)
        self.ok(self.client.delete(f"/api/collections/{collection['id']}"), 204)
        self.ok(self.client.post(f"/api/series/{album['id']}/restore"))
        index = self.ok(self.client.get("/api/collections"))
        self.assertEqual(index["memberships"][album["id"]], {"collection_id": None, "revision": 2})
        self.assertEqual(index["unfiled_count"], 1)
        self.assign(self.item(album, None, 1), code=409)

    def test_v2_requires_read_and_write_scopes(self):
        album = self.album()
        self.ok(self.client.get("/api/v2/collections"), 401)

        def headers(scopes):
            issued = self.ok(
                self.client.post(
                    "/api/tokens", json={"name": "collections-test", "scopes": scopes}
                ),
                201,
            )
            return {"Authorization": f"Bearer {issued['token']}"}

        read, write = headers(["read"]), headers(["read", "write"])
        self.ok(self.client.get("/api/v2/collections", headers=read))
        self.ok(self.client.post("/api/v2/collections", headers=read, json={"name": "No"}), 403)
        collection = self.ok(
            self.client.post("/api/v2/collections", headers=write, json={"name": "V2"}), 201
        )
        self.ok(
            self.client.post(
                "/api/v2/collections/memberships",
                headers=read,
                json={"assignments": [self.item(album, collection)]},
            ),
            403,
        )
        moved = self.ok(
            self.client.post(
                "/api/v2/collections/memberships",
                headers=write,
                json={"assignments": [self.item(album, collection)]},
            )
        )
        self.assertEqual(
            moved["index"]["memberships"][album["id"]]["collection_id"], collection["id"]
        )
        self.ok(
            self.client.patch(
                f"/api/v2/collections/{collection['id']}", headers=write, json={"name": "Renamed"}
            )
        )
        self.ok(self.client.delete(f"/api/v2/collections/{collection['id']}", headers=write), 204)
