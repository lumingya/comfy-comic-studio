"""Long-form organization uses the same domain commands for local and open APIs."""

from fastapi import status

from .. import longform as L
from ..longform.models import (
    EpisodeCopy,
    EpisodeCopyResult,
    EpisodeReorder,
    PanelTransfer,
    TransferResult,
    VariableApply,
    VariableOperation,
    VariablePreview,
    VariableQuery,
    VariableResult,
    VariableSearch,
)
from ..models import Episode
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["longform"])


@router.post("/series/{series_id}/panels/transfer", response_model=TransferResult)
def transfer_panels(ctx: Ctx, series_id: str, body: PanelTransfer):
    return L.transfer_panels(ctx, series_id, body)


@router.post(
    "/episodes/{episode_id}/copy",
    response_model=EpisodeCopyResult,
    status_code=status.HTTP_201_CREATED,
)
def copy_episode(ctx: Ctx, episode_id: str, body: EpisodeCopy):
    return L.copy_episode(ctx, episode_id, body)


@router.post("/series/{series_id}/episodes/reorder", response_model=list[Episode])
def reorder_episodes(ctx: Ctx, series_id: str, body: EpisodeReorder):
    return L.reorder_episodes(ctx, series_id, body)


@router.post("/series/{series_id}/variables/find", response_model=VariableSearch)
def find_variables(ctx: Ctx, series_id: str, body: VariableQuery):
    return L.find_variables(ctx, series_id, body)


@router.post("/series/{series_id}/variables/preview", response_model=VariablePreview)
def preview_variables(ctx: Ctx, series_id: str, body: VariableOperation):
    return L.preview_variables(ctx, series_id, body)


@router.post("/series/{series_id}/variables/apply", response_model=VariableResult)
def apply_variables(ctx: Ctx, series_id: str, body: VariableApply):
    return L.apply_variables(ctx, series_id, body)
