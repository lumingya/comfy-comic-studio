"""Self-update: check the signed release feed, download, stage (installed at next start)."""

from __future__ import annotations

from fastapi import APIRouter

from ..update import UpdateError
from .deps import Ctx

router = APIRouter(tags=["update"])


def _feed(ctx) -> str:
    return ctx.settings().update_feed


@router.get("/update")
def update_status(ctx: Ctx) -> dict:
    return ctx.updater.status()


@router.post("/update/check")
def check_update(ctx: Ctx) -> dict:
    return {**ctx.updater.status(), "last_check": ctx.updater.check(_feed(ctx))}


@router.post("/update/download")
def download_update(ctx: Ctx) -> dict:
    """Download and verify, then stage; the launcher installs it on the next start."""
    if ctx.updater.dev_checkout:
        raise UpdateError("这是 git 开发目录，请用 git pull 更新")
    ctx.updater.download()
    return {**ctx.updater.status(), "pending": ctx.updater.stage()}
