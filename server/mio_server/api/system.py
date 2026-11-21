"""Settings, registry, recycle bin, `.mio.zip` bundles and the legacy importer."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import Request, Response, status
from pydantic import BaseModel

from .. import bundle as B
from .. import settings as SET
from ..importer import LEGACY_ROOT, LegacyImporter
from ..model_catalog import ModelCatalog, ModelCatalogRequest, discover_models
from ..models import now_iso
from ..pipeline.providers import public_cloud_adapter
from ..storage import Conflict
from .deps import Ctx
from .library import BINARY_BODY, read_body
from .operations import Router as APIRouter

router = APIRouter(tags=["system"])
MAX_BUNDLE = 1024 * 1024 * 1024


class LegacyRequest(BaseModel):
    root: str | None = None
    overwrite: bool = False


# ---------------------------------------------------------------- settings
@router.get("/settings")
def get_settings(ctx: Ctx) -> dict:
    return SET.public(ctx.settings())


@router.post("/settings/models", response_model=ModelCatalog)
def fetch_models(ctx: Ctx, body: ModelCatalogRequest) -> ModelCatalog:
    """List models using an unsaved draft; never saves settings or submits generation work."""
    return discover_models(body, ctx.settings())


@router.patch("/settings")
def patch_settings(ctx: Ctx, patch: dict[str, Any]) -> dict:
    """Deep-merge settings, optionally comparing ``expected`` fields atomically.

    ``image_channel_edits`` uses stable IDs and partial before/after fields (null creates or
    deletes). Masked field comparisons also require the GET response's opaque
    ``write_revision`` as ``expected_revision``; it expires on restart. A stale comparison
    fails with 409 and changes nothing. Legacy patches without comparisons keep their
    existing semantics, including preserving a stored key when its mask is resubmitted.
    """
    with ctx.store.tx():
        current = ctx.settings()
        updated = SET.apply_patch(current, SET.intent_patch(current, patch))
        removed = {c.id for c in current.image_channels} - {c.id for c in updated.image_channels}
        users = [p.name for p in ctx.store.list_docs("profile") if p.cloud_channel in removed]
        if users:
            raise Conflict("渠道仍被出图配置使用，请先更换渠道：" + "、".join(users))
        updated.updated_at = now_iso()
        ctx.store.put_doc(updated)
    return SET.public(updated)


@router.get("/registry")
def registry(ctx: Ctx) -> dict:
    return ctx.registry.describe()


@router.get("/image-adapters")
def image_adapters(ctx: Ctx) -> list[dict]:
    """Discover built-in and extension image channels without exposing configuration secrets."""
    return [public_cloud_adapter(item) for item in ctx.registry.all("cloud_adapter")]


@router.get("/image-channels")
def list_image_channels(ctx: Ctx) -> list[dict]:
    """List selectable channel IDs with read scope, excluding endpoints and options."""
    app = ctx.settings()
    selected = next(
        (channel for channel in app.image_channels if channel.id == app.image_channel), None
    )
    return [
        {
            "id": "",
            "label": "默认图像服务",
            "kind": selected.kind if selected else "chat_image",
            "model": selected.model if selected else next(iter(app.llm.image_models), ""),
            "default": not app.image_channel,
        },
        *[
            {
                "id": channel.id,
                "label": channel.label or channel.id,
                "kind": channel.kind,
                "model": channel.model,
                "default": channel.id == app.image_channel,
            }
            for channel in app.image_channels
        ],
    ]


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


@router.post("/bundles", status_code=status.HTTP_201_CREATED, openapi_extra=BINARY_BODY)
async def import_bundle(ctx: Ctx, request: Request) -> dict:
    """Raw request body = the ``.mio.zip`` file."""
    data = await read_body(request, MAX_BUNDLE, "压缩包超过 1 GB")
    return B.import_series(ctx.store, ctx.assets, data)


# ------------------------------------------------------------------ legacy
def _legacy(ctx, root: str | None) -> LegacyImporter:
    path = Path(root) if root else LEGACY_ROOT
    if not path.is_dir():
        raise ValueError(f"找不到旧版数据目录：{path}")
    return LegacyImporter(ctx.store, path, ctx.assets)


@router.get("/legacy/scan")
def legacy_scan(ctx: Ctx, root: str | None = None) -> dict:
    return _legacy(ctx, root).scan()


@router.post("/legacy/import")
def legacy_import(ctx: Ctx, body: LegacyRequest) -> dict:
    """One-time import of old storyboards / presets / workflows; idempotent unless overwrite."""
    with ctx.engine.operation_guard():
        return _legacy(ctx, body.root).run(overwrite=body.overwrite).to_json()
