"""Complete work history through the same typed local and token-authenticated routes."""

from fastapi import Response

from ..checkpoints import Checkpoints
from ..checkpoints.models import (
    Checkpoint,
    CheckpointCreate,
    CheckpointPreview,
    CheckpointRestore,
    CheckpointRestored,
    CheckpointSummary,
    WorkHead,
)
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["checkpoints"])


@router.get("/series/{series_id}/head", response_model=WorkHead)
def get_work_head(series_id: str, ctx: Ctx):
    return WorkHead(series_id=series_id, head=Checkpoints(ctx).head(series_id))


@router.get("/series/{series_id}/checkpoints", response_model=list[CheckpointSummary])
def list_checkpoints(series_id: str, ctx: Ctx):
    return Checkpoints(ctx).list(series_id)


@router.post("/series/{series_id}/checkpoints", response_model=Checkpoint, status_code=201)
def create_checkpoint(series_id: str, body: CheckpointCreate, ctx: Ctx):
    return Checkpoints(ctx).create(series_id, body)


@router.get("/series/{series_id}/checkpoints/{checkpoint_id}", response_model=Checkpoint)
def get_checkpoint(series_id: str, checkpoint_id: str, ctx: Ctx):
    return Checkpoints(ctx).get(series_id, checkpoint_id)


@router.get(
    "/series/{series_id}/checkpoints/{checkpoint_id}/preview", response_model=CheckpointPreview
)
def preview_checkpoint(series_id: str, checkpoint_id: str, ctx: Ctx):
    return Checkpoints(ctx).preview(series_id, checkpoint_id)


@router.post(
    "/series/{series_id}/checkpoints/{checkpoint_id}/restore", response_model=CheckpointRestored
)
def restore_checkpoint(series_id: str, checkpoint_id: str, body: CheckpointRestore, ctx: Ctx):
    return Checkpoints(ctx).restore(series_id, checkpoint_id, body.expected_head)


@router.delete("/series/{series_id}/checkpoints/{checkpoint_id}", status_code=204)
def delete_checkpoint(series_id: str, checkpoint_id: str, ctx: Ctx):
    Checkpoints(ctx).delete(series_id, checkpoint_id)
    return Response(status_code=204)
