"""Self-update: check the signed release feed, download, stage (installed at next start)."""

from __future__ import annotations

from fastapi import Query
from pydantic import BaseModel, Field, StrictBool

from ..update import UpdateError
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["update"])


class ReleaseInstall(BaseModel):
    tag: str = Field(min_length=1, max_length=100)


class UpdatePreferences(BaseModel):
    auto_check: StrictBool


def _feed(ctx) -> str:
    return ctx.settings().update_feed


@router.get("/update")
def update_status(ctx: Ctx) -> dict:
    return ctx.updater.status()


@router.post("/update/check")
def check_update(ctx: Ctx, background: bool = False) -> dict:
    if background:
        return ctx.updater.start_check(_feed(ctx))
    return {**ctx.updater.status(), "last_check": ctx.updater.check(_feed(ctx))}


@router.post("/update/download")
def download_update(ctx: Ctx, background: bool = False) -> dict:
    """Download and verify, then stage; the launcher installs it on the next start."""
    if background:
        return ctx.updater.install_checked()
    if ctx.updater.dev_checkout:
        raise UpdateError("这是 git 开发目录，请用 git pull 更新")
    return {**ctx.updater.status(), "pending": ctx.updater.download_and_stage()}


@router.get("/update/releases")
def release_catalog(
    ctx: Ctx,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=50),
    refresh: bool = False,
) -> dict:
    return ctx.updater.releases(page, per_page, refresh=refresh)


@router.post("/update/install")
def install_release(ctx: Ctx, body: ReleaseInstall) -> dict:
    tag = body.tag.strip()
    if not tag:
        raise UpdateError("请选择要安装的版本")
    return ctx.updater.install(tag)


@router.post("/update/cancel")
def cancel_update(ctx: Ctx) -> dict:
    return ctx.updater.cancel_pending()


@router.patch("/update/preferences")
def update_preferences(ctx: Ctx, body: UpdatePreferences) -> dict:
    return ctx.updater.preferences(body.auto_check)
