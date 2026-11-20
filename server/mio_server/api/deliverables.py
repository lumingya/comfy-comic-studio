"""Generation progress and reusable exports for a finished episode."""

from __future__ import annotations

from typing import Literal

from fastapi import Query, Response, status
from pydantic import Field

from ..models import Episode, StrictModel, TakeStatus
from ..storage import NotFound
from .album import AlbumExport, PortableExport
from .deps import Ctx
from .export_jobs import StripExport
from .operations import Router

router = Router(tags=["exports"])
Format = Literal["html", "pdf", "zip", "png"]
FORMATS: tuple[Format, ...] = ("html", "pdf", "zip", "png")
GENERATION_KINDS = ("comfy.render", "cloud.render")


class GenerationProgress(StrictModel):
    id: str
    kind: str
    state: str
    total: int
    done: int
    failed: int


class EpisodeDeliverables(StrictModel):
    episode_id: str
    variant_id: str | None
    panel_count: int
    generated_panels: int
    adopted_panels: int
    ready: bool
    formats: list[Format]
    jobs: list[GenerationProgress]


class DeliverableRequest(StrictModel):
    format: Format = "html"
    template_id: str | None = Field(default=None, min_length=1, max_length=100)
    variant_id: str | None = Field(default=None, min_length=1, max_length=256)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=160)


class DeliverableExport(StrictModel):
    job_id: str
    state: str
    format: Format


def _episode(ctx: Ctx, episode_id: str, variant_id: str | None) -> Episode:
    episode = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(episode.series_id)
    if variant_id is not None and all(variant.id != variant_id for variant in series.variants):
        raise NotFound(f"variant not found: {variant_id}")
    return episode


@router.get("/episodes/{episode_id}/deliverables")
def get_episode_deliverables(
    ctx: Ctx, episode_id: str, variant_id: str | None = Query(default=None, max_length=256)
) -> EpisodeDeliverables:
    """Count generated and adopted panels for the requested variant and report recent jobs."""
    episode = _episode(ctx, episode_id, variant_id)
    panel_ids = {panel.id for panel in episode.panels}
    generated, adopted = set(), set()
    for take in episode.takes:
        if take.panel_id not in panel_ids or take.variant_id != variant_id:
            continue
        if take.panel_id in adopted or (
            take.panel_id in generated and take.status != TakeStatus.adopted
        ):
            continue
        if take.status != TakeStatus.rejected and ctx.assets.exists(take.asset_id):
            generated.add(take.panel_id)
            if take.status == TakeStatus.adopted:
                adopted.add(take.panel_id)
    jobs = [
        GenerationProgress(**{field: job[field] for field in GenerationProgress.model_fields})
        for job in ctx.engine.list(owner=episode.id, limit=50, kinds=GENERATION_KINDS)
    ]
    return EpisodeDeliverables(
        episode_id=episode.id,
        variant_id=variant_id,
        panel_count=len(panel_ids),
        generated_panels=len(generated),
        adopted_panels=len(adopted),
        ready=bool(panel_ids and panel_ids == adopted),
        formats=list(FORMATS),
        jobs=jobs,
    )


@router.post(
    "/episodes/{episode_id}/deliverables/export",
    status_code=status.HTTP_202_ACCEPTED,
)
def export_episode_deliverable(
    ctx: Ctx, episode_id: str, body: DeliverableRequest, response: Response
) -> DeliverableExport:
    """Submit a frozen export. Use its job ID with the existing job and file routes."""
    if body.template_id is not None and body.format != "html":
        raise ValueError("template_id is only supported for HTML export")
    if body.format == "html":
        kind = "album"
        options = AlbumExport(
            episode_ids=[episode_id],
            template_id=body.template_id or "export-paper",
            variant_id=body.variant_id,
            image_profile="auto",
        ).model_dump()
    elif body.format == "png":
        kind = "strip"
        options = StripExport(
            episode_id=episode_id, fmt="long", variant_id=body.variant_id, quality=0
        ).model_dump()
    else:
        kind = "portable"
        options = PortableExport(
            episode_ids=[episode_id], format=body.format, variant_id=body.variant_id
        ).model_dump()
    key = f"deliverable:{body.idempotency_key}" if body.idempotency_key else None
    job = ctx.exports.submit(kind, options, key, require_complete=True)
    response.headers["Location"] = f"../../../jobs/{job['id']}"
    return DeliverableExport(job_id=job["id"], state=job["state"], format=body.format)
