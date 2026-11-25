"""Workspace-local shelf collections and atomic album moves."""

from __future__ import annotations

from fastapi import status

from ..collection_models import (
    Collection,
    CollectionAssignmentResult,
    CollectionAssignments,
    CollectionCreate,
    CollectionPatch,
    CollectionsIndex,
)
from ..collections import CollectionService
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["collections"])


@router.get("/collections", response_model=CollectionsIndex)
def list_collections(ctx: Ctx) -> CollectionsIndex:
    return CollectionService(ctx.store).index()


@router.post("/collections", response_model=Collection, status_code=status.HTTP_201_CREATED)
def create_collection(ctx: Ctx, payload: CollectionCreate) -> Collection:
    return CollectionService(ctx.store).create(payload.name)


@router.patch("/collections/{collection_id}", response_model=Collection)
def rename_collection(ctx: Ctx, collection_id: str, payload: CollectionPatch) -> Collection:
    return CollectionService(ctx.store).rename(collection_id, payload.name)


@router.delete("/collections/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(ctx: Ctx, collection_id: str) -> None:
    CollectionService(ctx.store).delete(collection_id)


@router.post("/collections/memberships", response_model=CollectionAssignmentResult)
def assign_collection_memberships(
    ctx: Ctx, payload: CollectionAssignments
) -> CollectionAssignmentResult:
    return CollectionService(ctx.store).assign(payload.assignments)
