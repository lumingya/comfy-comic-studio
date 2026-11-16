"""Typed background exports shared by the interface and the token-authenticated API."""

from fastapi.responses import FileResponse
from pydantic import Field

from ..models import StrictModel
from .album import AlbumExport, PortableExport
from .deps import Ctx
from .operations import Router

router = Router(tags=["exports"])


class StripExport(StrictModel):
    episode_id: str
    fmt: str = "slices"
    preset: str = "webtoon"
    variant_id: str | None = None
    quality: int | None = Field(default=None, ge=0, le=100)


class StripExportJob(StripExport):
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=160)


class AlbumExportJob(AlbumExport):
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=160)


class PortableExportJob(PortableExport):
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=160)


@router.post("/export/jobs/strip", status_code=202)
def submit_strip_export(ctx: Ctx, body: StripExportJob) -> dict:
    return ctx.exports.submit(
        "strip", body.model_dump(exclude={"idempotency_key"}), body.idempotency_key
    )


@router.post("/export/jobs/album", status_code=202)
def submit_album_export(ctx: Ctx, body: AlbumExportJob) -> dict:
    return ctx.exports.submit(
        "album", body.model_dump(exclude={"idempotency_key"}), body.idempotency_key
    )


@router.post("/export/jobs/portable", status_code=202)
def submit_portable_export(ctx: Ctx, body: PortableExportJob) -> dict:
    return ctx.exports.submit(
        "portable", body.model_dump(exclude={"idempotency_key"}), body.idempotency_key
    )


@router.get("/export/jobs/{job_id}/file")
def download_export(ctx: Ctx, job_id: str) -> FileResponse:
    path, result = ctx.exports.result(job_id)
    return FileResponse(
        path,
        media_type=result["mime"],
        filename=result["filename"],
        headers={**result.get("headers", {}), "ETag": f'"{result["sha256"]}"'},
    )


@router.delete("/export/jobs/{job_id}", status_code=204)
def delete_export(ctx: Ctx, job_id: str) -> None:
    job = ctx.engine.get(job_id)
    if job["kind"] != "export.render":
        raise ValueError("不是导出任务")
    ctx.engine.delete(job_id)
    ctx.exports.remove(job_id)
