"""Workspace-local shelf collections and revision-checked album membership."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints, field_validator

from .models import StrictModel, new_id, now_iso

CollectionName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
ShelfId = Annotated[str, Field(min_length=1)]


class Collection(StrictModel):
    id: str = Field(default_factory=lambda: new_id("collection"))
    name: CollectionName
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class CollectionMembership(StrictModel):
    collection_id: ShelfId | None = None
    revision: int = Field(default=0, ge=0, strict=True)


class CollectionLibrary(StrictModel):
    """One local document; membership never becomes part of a portable Series."""

    id: Literal["shelf"] = "shelf"
    collections: list[Collection] = Field(default_factory=list)
    memberships: dict[str, CollectionMembership] = Field(default_factory=dict)


class CollectionCard(Collection):
    album_count: int = Field(default=0, ge=0)


class CollectionsIndex(StrictModel):
    collections: list[CollectionCard]
    memberships: dict[str, CollectionMembership]
    total_count: int = Field(ge=0)
    unfiled_count: int = Field(ge=0)


class CollectionCreate(StrictModel):
    name: CollectionName


class CollectionPatch(StrictModel):
    name: CollectionName


class CollectionAssignment(StrictModel):
    series_id: ShelfId
    collection_id: ShelfId | None
    expected_revision: int = Field(ge=0, strict=True)


class CollectionAssignments(StrictModel):
    assignments: list[CollectionAssignment] = Field(min_length=1)

    @field_validator("assignments")
    @classmethod
    def unique_series(cls, value: list[CollectionAssignment]) -> list[CollectionAssignment]:
        if len({assignment.series_id for assignment in value}) != len(value):
            raise ValueError("assignments must list each series exactly once")
        return value


class CollectionMembershipChange(StrictModel):
    series_id: str
    before: CollectionMembership
    after: CollectionMembership


class CollectionAssignmentResult(StrictModel):
    changes: list[CollectionMembershipChange]
    index: CollectionsIndex
