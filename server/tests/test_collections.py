"""Local collection persistence, atomic moves and reversible membership edits."""

from __future__ import annotations

import io
import json
import tempfile
import threading
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from mio_server.assets import AssetStore
from mio_server.bundle import export_series, import_series
from mio_server.collection_models import (
    CollectionAssignment,
    CollectionAssignments,
    CollectionMembership,
)
from mio_server.collections import CollectionService
from mio_server.models import Episode, Series
from mio_server.storage import Conflict, NotFound, SQLiteStore
from mio_server.trash import Trash


class CollectionTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.store = SQLiteStore(self.root / "library.sqlite3")
        self.addCleanup(lambda: self.store.close())
        self.service = CollectionService(self.store)

    def album(self, title="Album", **kwargs):
        return self.store.create_series(Series(title=title, **kwargs))

    def move(self, *assignments):
        return self.service.assign(
            [
                CollectionAssignment(
                    series_id=series_id,
                    collection_id=collection_id,
                    expected_revision=revision,
                )
                for series_id, collection_id, revision in assignments
            ]
        )

    def library_json(self):
        return self.store.get_doc("collection_library", "shelf").model_dump(mode="json")

    def test_empty_index_projects_defaults_without_persisting(self):
        album = self.album()
        self.album(kind="workshop")
        self.album(kind="kit")
        trashed = self.album()
        Trash(self.store).delete_series(trashed.id)
        with patch.object(self.store, "put_doc", wraps=self.store.put_doc) as save:
            index = self.service.index()
            no_op = self.move((album.id, None, 0))
        self.assertEqual(index.total_count, 1)
        self.assertEqual(index.unfiled_count, 1)
        self.assertEqual(index.memberships, {album.id: CollectionMembership()})
        self.assertEqual(index.collections, [])
        self.assertEqual(no_op.changes, [])
        self.assertEqual(no_op.index, index)
        save.assert_not_called()
        self.assertEqual(self.store.list_docs("collection_library"), [])

    def test_names_are_trimmed_bounded_and_casefold_unique(self):
        first = self.service.create("  Stra\u00dfe  ")
        self.assertTrue(first.id.startswith("collection_"))
        self.assertEqual(first.name, "Stra\u00dfe")
        for name in ("STRASSE", "  straSSe "):
            with self.subTest(name=name), self.assertRaises(Conflict):
                self.service.create(name)
        for name in ("", "  \t ", "x" * 81):
            with self.subTest(name=name), self.assertRaises(ValidationError):
                self.service.create(name)
        longest = self.service.create(" " + "x" * 80 + " ")
        self.assertEqual(longest.name, "x" * 80)
        with self.assertRaises(Conflict):
            self.service.rename(longest.id, "strasse")
        renamed = self.service.rename(first.id, " STRASSE ")
        self.assertEqual(renamed.name, "STRASSE")
        self.assertEqual(renamed.created_at, first.created_at)

    def test_collections_and_revisions_survive_reopen(self):
        album = self.album()
        collection = self.service.create("First")
        self.move((album.id, collection.id, 0))
        with patch("mio_server.collections.now_iso", return_value="2030-01-01T00:00:00+00:00"):
            renamed = self.service.rename(collection.id, "Renamed")
        expected = self.service.index()
        self.store.close()
        self.store = SQLiteStore(self.root / "library.sqlite3")
        self.service = CollectionService(self.store)
        self.assertEqual(self.service.index(), expected)
        self.assertEqual(expected.collections[0].name, "Renamed")
        self.assertEqual(expected.collections[0].album_count, 1)
        self.assertEqual(renamed.updated_at, "2030-01-01T00:00:00+00:00")
        document = self.library_json()
        self.assertEqual(set(document), {"id", "collections", "memberships"})
        self.assertEqual(document["id"], "shelf")
        self.assertNotIn("album_count", document["collections"][0])

    def test_batch_moves_save_once_and_return_before_after_and_snapshot_counts(self):
        albums = [self.album(str(index)) for index in range(3)]
        collection = self.service.create("Group")
        before = {album.id: album.model_dump_json() for album in albums}
        with patch.object(self.store, "put_doc", wraps=self.store.put_doc) as save:
            result = self.move(*[(album.id, collection.id, 0) for album in albums[:2]])
        save.assert_called_once()
        self.assertEqual(len(result.changes), 2)
        for change in result.changes:
            self.assertEqual(change.before, CollectionMembership())
            self.assertEqual(change.after.collection_id, collection.id)
            self.assertEqual(change.after.revision, 1)
        self.assertEqual(result.index.total_count, 3)
        self.assertEqual(result.index.unfiled_count, 1)
        self.assertEqual(result.index.collections[0].album_count, 2)
        self.assertEqual(result.index, self.service.index())
        for album in albums:
            self.assertEqual(self.store.get_series(album.id).model_dump_json(), before[album.id])

    def test_revision_conflict_rejects_every_assignment(self):
        a, b = self.album("A"), self.album("B")
        source, target = self.service.create("Source"), self.service.create("Target")
        self.move((a.id, source.id, 0), (b.id, source.id, 0))
        previous = self.library_json()
        with patch.object(self.store, "put_doc", wraps=self.store.put_doc) as save:
            with self.assertRaises(Conflict):
                self.move((a.id, target.id, 1), (b.id, target.id, 0))
        save.assert_not_called()
        self.assertEqual(self.library_json(), previous)

    def test_invalid_targets_and_sources_leave_batch_unchanged(self):
        album = self.album()
        collection = self.service.create("Target")
        workshop = self.album(kind="workshop")
        kit = self.album(kind="kit")
        trashed = self.album()
        Trash(self.store).delete_series(trashed.id)
        previous = self.library_json()
        invalid = [
            (album.id, "missing", 0),
            ("missing", collection.id, 0),
            (workshop.id, collection.id, 0),
            (kit.id, collection.id, 0),
            (trashed.id, collection.id, 0),
        ]
        for assignment in invalid:
            with self.subTest(assignment=assignment):
                # A valid first item must also remain untouched when a later item fails.
                batch = (
                    [assignment]
                    if assignment[0] == album.id
                    else [(album.id, collection.id, 0), assignment]
                )
                error = NotFound if assignment[1] == "missing" else Conflict
                with self.assertRaises(error):
                    self.move(*batch)
                self.assertEqual(self.library_json(), previous)

    def test_assignments_require_unique_nonempty_sources_and_strict_revisions(self):
        good = {"series_id": "album", "collection_id": None, "expected_revision": 0}
        for assignments in ([], [good, good]):
            with self.subTest(assignments=assignments), self.assertRaises(ValidationError):
                CollectionAssignments(assignments=assignments)
        for revision in (-1, True, "0", 0.5):
            with self.subTest(revision=revision), self.assertRaises(ValidationError):
                CollectionAssignment(**{**good, "expected_revision": revision})

    def test_same_target_does_not_write_or_increment_but_still_checks_revision(self):
        album = self.album()
        collection = self.service.create("Group")
        self.move((album.id, collection.id, 0))
        previous = self.library_json()
        with patch.object(self.store, "put_doc", wraps=self.store.put_doc) as save:
            result = self.move((album.id, collection.id, 1))
            self.assertEqual(result.changes, [])
            self.assertEqual(result.index.memberships[album.id].revision, 1)
            with self.assertRaises(Conflict):
                self.move((album.id, collection.id, 0))
        save.assert_not_called()
        self.assertEqual(self.library_json(), previous)

    def test_cross_collection_undo_restores_each_origin_and_is_cas_protected(self):
        albums = [self.album(str(index)) for index in range(3)]
        a, b, target = [self.service.create(name) for name in ("A", "B", "Target")]
        self.move((albums[0].id, a.id, 0), (albums[1].id, b.id, 0))
        moved = self.move(
            (albums[0].id, target.id, 1),
            (albums[1].id, target.id, 1),
            (albums[2].id, target.id, 0),
        )
        undo = [
            CollectionAssignment(
                series_id=change.series_id,
                collection_id=change.before.collection_id,
                expected_revision=change.after.revision,
            )
            for change in moved.changes
        ]
        restored = self.service.assign(undo)
        self.assertEqual(
            [restored.index.memberships[album.id].collection_id for album in albums],
            [a.id, b.id, None],
        )
        self.move((albums[0].id, target.id, 3))
        previous = self.library_json()
        with self.assertRaises(Conflict):
            self.service.assign(undo)
        self.assertEqual(self.library_json(), previous)

    def test_deleting_collection_clears_trashed_memberships_and_preserves_albums(self):
        live, trashed, other = self.album("Live"), self.album("Trash"), self.album("Other")
        collection = self.service.create("Delete")
        kept = self.service.create("Keep")
        self.move(
            (live.id, collection.id, 0), (trashed.id, collection.id, 0), (other.id, kept.id, 0)
        )
        trash = Trash(self.store)
        trash.delete_series(trashed.id)
        self.assertEqual(self.service.index().collections[0].album_count, 1)
        self.assertNotIn(trashed.id, self.service.index().memberships)
        previous_series = {
            album.id: self.store.get_series(album.id, include_deleted=True).model_dump_json()
            for album in (live, trashed, other)
        }
        self.service.delete(collection.id)
        library = self.library_json()
        for album in (live, trashed):
            self.assertEqual(
                library["memberships"][album.id], {"collection_id": None, "revision": 2}
            )
        self.assertEqual(
            library["memberships"][other.id], {"collection_id": kept.id, "revision": 1}
        )
        for album in (live, trashed, other):
            self.assertEqual(
                self.store.get_series(album.id, include_deleted=True).model_dump_json(),
                previous_series[album.id],
            )
        trash.restore_series(trashed.id)
        index = self.service.index()
        self.assertEqual(index.total_count, 3)
        self.assertEqual(index.unfiled_count, 2)
        self.assertEqual(index.memberships[trashed.id].revision, 2)
        self.assertEqual(index.collections[0].id, kept.id)
        with self.assertRaises(Conflict):
            self.move((live.id, kept.id, 1))

    def test_unknown_collection_rename_and_delete_do_not_create_document(self):
        with self.assertRaises(NotFound):
            self.service.rename("missing", "Name")
        with self.assertRaises(NotFound):
            self.service.delete("missing")
        self.assertEqual(self.store.list_docs("collection_library"), [])

    def test_nested_transaction_and_save_failure_roll_back_all_memberships(self):
        album = self.album()
        collection = self.service.create("Group")
        previous = self.library_json()
        with self.assertRaisesRegex(RuntimeError, "rollback"):
            with self.store.tx():
                self.move((album.id, collection.id, 0))
                raise RuntimeError("rollback")
        self.assertEqual(self.library_json(), previous)
        original = self.store.put_doc

        def fail_after_write(document):
            original(document)
            raise RuntimeError("save failed")

        with patch.object(self.store, "put_doc", side_effect=fail_after_write):
            with self.assertRaisesRegex(RuntimeError, "save failed"):
                self.move((album.id, collection.id, 0))
        self.assertEqual(self.library_json(), previous)

    def test_concurrent_cas_allows_only_one_move_at_the_same_revision(self):
        album = self.album()
        collections = [self.service.create(name) for name in ("A", "B")]
        barrier = threading.Barrier(2)

        def move(collection):
            barrier.wait(timeout=3)
            try:
                return self.move((album.id, collection.id, 0))
            except Conflict:
                return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(move, collections))
        successes = [result for result in results if result is not None]
        self.assertEqual(len(successes), 1)
        self.assertEqual(self.service.index(), successes[0].index)
        self.assertEqual(self.service.index().memberships[album.id].revision, 1)

    def test_portable_bundle_never_exports_membership_and_import_is_unfiled(self):
        album = self.album()
        self.store.create_episode(Episode(series_id=album.id, title="One", order=0))
        collection = self.service.create("Private local collection")
        self.move((album.id, collection.id, 0))
        assets = AssetStore(self.root / "assets", self.store)
        data = export_series(self.store, assets, album.id)
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            self.assertEqual(json.loads(bundle.read("series.json")), album.model_dump(mode="json"))
            for name in bundle.namelist():
                self.assertNotIn("collection", name)
                self.assertNotIn(collection.id.encode(), bundle.read(name))
                self.assertNotIn(collection.name.encode(), bundle.read(name))
        imported = import_series(self.store, assets, data)
        self.assertNotEqual(imported["series_id"], album.id)
        index = self.service.index()
        self.assertEqual(index.memberships[imported["series_id"]], CollectionMembership())
        self.assertEqual(index.collections[0].album_count, 1)
        self.assertEqual(index.unfiled_count, 1)
