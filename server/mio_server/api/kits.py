"""Portable creation kits; saving or assembling never calls a model."""

from fastapi import Request, Response, status

from .. import creation_kits as K
from .. import workshop as W
from ..assembly import AssemblyPreview
from ..creation_kits.archive import MAX_ARCHIVE
from ..creation_kits.models import KitAssembly, KitImport, KitImported, KitInspection, KitSelection
from ..models import Series
from .deps import Ctx
from .library import BINARY_BODY, binary_responses, read_body
from .operations import Router as APIRouter
from .workshop import Assembled, PreviewRequest

router = APIRouter(tags=["creation-kits"])


@router.get("/creation-kits", response_model=list[Series])
def list_creation_kits(ctx: Ctx):
    return [series for series in ctx.store.list_series() if series.kind == "kit"]


@router.post(
    "/creation-kits/export",
    response_class=Response,
    responses=binary_responses("application/zip"),
)
def export_creation_kit(ctx: Ctx, body: KitSelection):
    return Response(
        K.export_kit(ctx, body),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="creation-kit.mio-kit.zip"'},
    )


@router.post("/creation-kits/inspect", response_model=KitInspection, openapi_extra=BINARY_BODY)
async def inspect_creation_kit(ctx: Ctx, request: Request):
    data = await read_body(request, MAX_ARCHIVE, "创作套装超过 64 MB")
    return K.inspect_kit(data)


@router.post(
    "/creation-kits/import", response_model=KitImported, status_code=status.HTTP_201_CREATED
)
def import_creation_kit(ctx: Ctx, body: KitImport):
    return K.import_kit(ctx, body)


@router.post("/creation-kits/{series_id}/preview", response_model=AssemblyPreview)
def preview_creation_kit(ctx: Ctx, series_id: str, body: KitAssembly):
    return K.preview_kit(ctx, series_id, body)


@router.post(
    "/creation-kits/{series_id}/assemble",
    response_model=Assembled,
    status_code=status.HTTP_201_CREATED,
)
def assemble_creation_kit(ctx: Ctx, series_id: str, body: KitAssembly):
    series, episode = K.assemble_kit(ctx, series_id, body)
    ctx.queue.track(series.id)
    return Assembled(series=series, episode=episode)


@router.post(
    "/creation-kits/{series_id}/preview-preset",
    response_model=Assembled,
    status_code=status.HTTP_201_CREATED,
)
def preview_kit_preset(ctx: Ctx, series_id: str, body: PreviewRequest):
    """Freeze a kit's selected presets into a one-panel standby album without generation."""
    series, episode = W.preview(
        ctx.store,
        body.preset_ids,
        body.prompt,
        body.title,
        body.profile_id,
        source_id=series_id,
        generation=body.generation,
        idempotency_key=body.idempotency_key,
    )
    ctx.queue.track(series.id)
    return Assembled(series=series, episode=episode)
