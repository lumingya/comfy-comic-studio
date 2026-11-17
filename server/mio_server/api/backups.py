"""Admin-only workspace recovery endpoints; applying a plan schedules the next startup."""

import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Query, Request, Response
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from ..backups import Backups
from ..backups.archive import MAX_ARCHIVE
from ..backups.models import (
    BackupCreated,
    BackupHead,
    BackupInspection,
    BackupOptions,
    BackupPage,
    RestoreApply,
    RestorePage,
    RestorePlan,
    RestoreScheduled,
)
from .deps import Ctx
from .library import BINARY_BODY
from .operations import Router as APIRouter

router = APIRouter(tags=["workspace-backups"])


@asynccontextmanager
async def uploaded(request: Request):
    with tempfile.TemporaryDirectory(prefix="mio-backup-upload-") as temporary:
        path, size = Path(temporary) / "workspace.zip", 0
        with path.open("xb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_ARCHIVE:
                    raise ValueError("workspace archive exceeds 2 GiB")
                output.write(chunk)
        yield path


@router.get("/backups/head", response_model=BackupHead)
def workspace_backup_head(ctx: Ctx):
    return Backups(ctx).head()


@router.post("/backups", response_model=BackupCreated, status_code=201)
def create_workspace_backup(ctx: Ctx, body: BackupOptions):
    return Backups(ctx).export(body)


@router.get("/backups", response_model=BackupPage)
def list_workspace_backups(
    ctx: Ctx, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)
):
    return Backups(ctx).list_backups(offset=offset, limit=limit)


@router.post("/backups/inspect", response_model=BackupInspection, openapi_extra=BINARY_BODY)
async def inspect_workspace_backup(ctx: Ctx, request: Request):
    async with uploaded(request) as path:
        return await run_in_threadpool(Backups.inspect, path, ctx.data_dir)


@router.post(
    "/backups/restore-plans", response_model=RestorePlan, status_code=201, openapi_extra=BINARY_BODY
)
async def stage_workspace_restore(ctx: Ctx, request: Request):
    async with uploaded(request) as path:
        return await run_in_threadpool(Backups(ctx).stage, path)


@router.get("/backups/restore-plans", response_model=RestorePage)
def list_workspace_restore_plans(
    ctx: Ctx, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)
):
    return Backups(ctx).list_plans(offset=offset, limit=limit)


@router.delete("/backups/restore-plans/{plan_id}", status_code=204)
def delete_workspace_restore_plan(ctx: Ctx, plan_id: str):
    Backups(ctx).delete_plan(plan_id)
    return Response(status_code=204)


@router.get("/backups/restore-plans/{plan_id}", response_model=RestorePlan)
def get_workspace_restore_plan(ctx: Ctx, plan_id: str):
    return Backups(ctx).get_plan(plan_id)


@router.post("/backups/restore-plans/{plan_id}/apply", response_model=RestoreScheduled)
def apply_workspace_restore(ctx: Ctx, plan_id: str, body: RestoreApply):
    return Backups(ctx).apply(plan_id, body)


@router.post("/backups/restore-plans/{plan_id}/cancel", response_model=RestorePlan)
def cancel_workspace_restore(ctx: Ctx, plan_id: str):
    return Backups(ctx).cancel(plan_id)


@router.get("/backups/{backup_id}", response_model=BackupCreated)
def get_workspace_backup(ctx: Ctx, backup_id: str):
    return Backups(ctx).get(backup_id)


@router.get("/backups/{backup_id}/download")
def download_workspace_backup(ctx: Ctx, backup_id: str):
    return FileResponse(
        Backups(ctx).download(backup_id),
        media_type="application/zip",
        filename=f"{backup_id}.mio-workspace.zip",
    )


@router.delete("/backups/{backup_id}", status_code=204)
def delete_workspace_backup(ctx: Ctx, backup_id: str):
    Backups(ctx).delete(backup_id)
    return Response(status_code=204)
