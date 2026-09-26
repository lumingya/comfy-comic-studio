"""Settings, registry, recycle bin, `.mio.zip` bundles and the legacy importer."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel

from .. import bundle as B
from .. import settings as SET
from ..importer import LegacyImporter
from ..models import now_iso
from .deps import Ctx
from .library import read_body

router = APIRouter(tags=["system"])
MAX_BUNDLE = 1024 * 1024 * 1024
LEGACY_ROOT = Path(__file__).resolve().parents[3] / "data"


class LegacyRequest(BaseModel):
    root: str | None = None
    overwrite: bool = False


# ---------------------------------------------------------------- settings
@router.get("/settings")
def get_settings(ctx: Ctx) -> dict:
    return SET.public(ctx.settings())


@router.patch("/settings")
def patch_settings(ctx: Ctx, patch: dict[str, Any]) -> dict:
    """Deep-merges one level; sending the masked api key back keeps the stored one."""
    updated = SET.apply_patch(ctx.settings(), patch)
    updated.updated_at = now_iso()
    ctx.store.put_doc(updated)
    return SET.public(updated)


@router.get("/registry")
def registry(ctx: Ctx) -> dict:
    return ctx.registry.describe()


# ------------------------------------------------------------------- trash
@router.get("/trash")
def list_trash(ctx: Ctx) -> dict:
    return {**ctx.trash.list(), "retention_days": ctx.settings().trash_days}


@router.delete("/trash/{kind}/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def purge(ctx: Ctx, kind: Literal["series", "episode"], item_id: str) -> None:
    """Permanent delete (only for items already in the recycle bin)."""
    ctx.trash.purge(kind, item_id)


@router.post("/trash/expire")
def expire(ctx: Ctx) -> dict:
    return {"purged": ctx.trash.expire(ctx.settings().trash_days)}


# ----------------------------------------------------------------- bundles
@router.get("/series/{series_id}/bundle")
def export_bundle(ctx: Ctx, series_id: str) -> Response:
    series = ctx.store.get_series(series_id)
    data = B.export_series(ctx.store, ctx.assets, series_id)
    name = quote(f"{series.title or series.id}.mio.zip")
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{name}"},
    )


@router.post("/bundles", status_code=status.HTTP_201_CREATED)
async def import_bundle(ctx: Ctx, request: Request) -> dict:
    """Raw request body = the ``.mio.zip`` file."""
    data = await read_body(request, MAX_BUNDLE, "压缩包超过 1 GB")
    return B.import_series(ctx.store, ctx.assets, data)


# ------------------------------------------------------------------ legacy
def _legacy(ctx, root: str | None) -> LegacyImporter:
    path = Path(root) if root else LEGACY_ROOT
    if not path.is_dir():
        raise ValueError(f"找不到旧版数据目录：{path}")
    return LegacyImporter(ctx.store, path)


@router.get("/legacy/scan")
def legacy_scan(ctx: Ctx, root: str | None = None) -> dict:
    return _legacy(ctx, root).scan()


@router.post("/legacy/import")
def legacy_import(ctx: Ctx, body: LegacyRequest) -> dict:
    """One-time import of old storyboards / presets / workflows; idempotent unless overwrite."""
    return _legacy(ctx, body.root).run(overwrite=body.overwrite).to_json()
