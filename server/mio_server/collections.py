"""Atomic shelf collection edits over a single workspace-local document."""

from __future__ import annotations

from .collection_models import (
    Collection,
    CollectionAssignment,
    CollectionAssignmentResult,
    CollectionAssignments,
    CollectionCard,
    CollectionCreate,
    CollectionLibrary,
    CollectionMembership,
    CollectionMembershipChange,
    CollectionPatch,
    CollectionsIndex,
)
from .models import now_iso
from .storage import Conflict, NotFound, SQLiteStore


class CollectionService:
    def __init__(self, store: SQLiteStore):
        self.store = store

    def _library(self) -> CollectionLibrary:
        try:
            return self.store.get_doc("collection_library", "shelf")
        except NotFound:
            return CollectionLibrary()

    @staticmethod
    def _collection(library: CollectionLibrary, collection_id: str) -> Collection:
        for collection in library.collections:
            if collection.id == collection_id:
                return collection
        raise NotFound(f"collection not found: {collection_id}")

    @staticmethod
    def _unique_name(library: CollectionLibrary, name: str, exclude: str | None = None) -> None:
        if any(
            item.id != exclude and item.name.casefold() == name.casefold()
            for item in library.collections
        ):
            raise Conflict("a collection with this name already exists")

    def _index(self, library: CollectionLibrary) -> CollectionsIndex:
        counts = {collection.id: 0 for collection in library.collections}
        memberships = {}
        unfiled = 0
        for series in self.store.list_series():
            if series.kind != "album":
                continue
            membership = library.memberships.get(series.id, CollectionMembership())
            memberships[series.id] = membership
            if membership.collection_id is None:
                unfiled += 1
            else:
                counts[membership.collection_id] += 1
        return CollectionsIndex(
            collections=[
                CollectionCard(**collection.model_dump(), album_count=counts[collection.id])
                for collection in library.collections
            ],
            memberships=memberships,
            total_count=len(memberships),
            unfiled_count=unfiled,
        )

    def index(self) -> CollectionsIndex:
        # A savepoint gives document and live-album reads one SQLite snapshot without a write.
        with self.store.tx():
            return self._index(self._library())

    def create(self, name: str) -> Collection:
        name = CollectionCreate(name=name).name
        with self.store.tx():
            library = self._library()
            self._unique_name(library, name)
            collection = Collection(name=name)
            library.collections.append(collection)
            self.store.put_doc(library)
            return collection

    def rename(self, collection_id: str, name: str) -> Collection:
        name = CollectionPatch(name=name).name
        with self.store.tx():
            library = self._library()
            collection = self._collection(library, collection_id)
            self._unique_name(library, name, exclude=collection_id)
            if collection.name != name:
                collection.name = name
                collection.updated_at = now_iso()
                self.store.put_doc(library)
            return collection

    def delete(self, collection_id: str) -> None:
        with self.store.tx():
            library = self._library()
            self._collection(library, collection_id)
            library.collections = [item for item in library.collections if item.id != collection_id]
            # Include trashed albums: restoring them must never resurrect a deleted collection.
            for series_id, membership in library.memberships.items():
                if membership.collection_id == collection_id:
                    library.memberships[series_id] = CollectionMembership(
                        revision=membership.revision + 1
                    )
            self.store.put_doc(library)

    def assign(self, assignments: list[CollectionAssignment]) -> CollectionAssignmentResult:
        assignments = CollectionAssignments(assignments=assignments).assignments
        with self.store.tx():
            library = self._library()
            changes = []
            # Validate the entire batch before changing or persisting the library.
            for assignment in assignments:
                if assignment.collection_id is not None:
                    self._collection(library, assignment.collection_id)
                try:
                    series = self.store.get_series(assignment.series_id)
                except NotFound:
                    raise Conflict(
                        f"album is no longer available: {assignment.series_id}"
                    ) from None
                if series.kind != "album":
                    raise Conflict(f"album is no longer available: {assignment.series_id}")
                before = library.memberships.get(assignment.series_id, CollectionMembership())
                if before.revision != assignment.expected_revision:
                    raise Conflict(
                        f"album membership changed (revision {before.revision}, "
                        f"expected {assignment.expected_revision})"
                    )
                if before.collection_id != assignment.collection_id:
                    changes.append(
                        CollectionMembershipChange(
                            series_id=assignment.series_id,
                            before=before,
                            after=CollectionMembership(
                                collection_id=assignment.collection_id,
                                revision=before.revision + 1,
                            ),
                        )
                    )
            if changes:
                for change in changes:
                    library.memberships[change.series_id] = change.after
                self.store.put_doc(library)
            return CollectionAssignmentResult(changes=changes, index=self._index(library))
