"""Extension private: shared local and v2 routes."""

from __future__ import annotations

from fastapi import Request
from pydantic import JsonValue
from starlette.concurrency import run_in_threadpool

from ..backups.extension_data import load_settings, save_settings, settings_exist
from ..extension_preferences import (
    MAX_PREFERENCES_JSON,
    load_preferences,
    preferences_exist,
    save_preferences,
    validate_preferences,
)
from ..extensions.manager import ExtensionError
from ..storage import NotFound
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["extensions"])


def _settings_target(ctx, ext_id: str):
    # Data can outlive an uninstalled package. Never create arbitrary names through this API.
    if settings_exist(ctx.data_dir, ext_id):
        return
    try:
        info = ctx.extensions.info(ext_id)
    except ExtensionError:
        raise NotFound("extension or retained settings not found") from None
    if info.manifest is None:
        raise NotFound("extension manifest is invalid")


@router.get("/extensions/{ext_id}/settings", response_model=dict[str, JsonValue])
def get_extension_settings(ctx: Ctx, ext_id: str) -> dict[str, JsonValue]:
    """Read bounded JSON settings without activating or executing an extension."""
    with ctx.engine.hold_operation():
        _settings_target(ctx, ext_id)
        return load_settings(ctx.data_dir, ext_id)


@router.put("/extensions/{ext_id}/settings", response_model=dict[str, JsonValue])
def put_extension_settings(
    ctx: Ctx, ext_id: str, body: dict[str, JsonValue]
) -> dict[str, JsonValue]:
    """Atomically replace extension settings; the same storage contract is used by its SDK."""
    with ctx.engine.hold_operation():
        _settings_target(ctx, ext_id)
        save_settings(ctx.data_dir, ext_id, body)
        return load_settings(ctx.data_dir, ext_id)


def _preferences_target(ctx: Ctx, ext_id: str) -> None:
    if preferences_exist(ctx.data_dir, ext_id):
        return
    try:
        info = ctx.extensions.info(ext_id)
    except ExtensionError:
        raise NotFound("extension or retained preferences not found") from None
    if info.manifest is None:
        raise NotFound("extension manifest is invalid")


@router.get("/ext/{ext_id}/preferences", response_model=dict[str, JsonValue])
def get_extension_preferences(ctx: Ctx, ext_id: str) -> dict[str, JsonValue]:
    with ctx.engine.hold_operation():
        _preferences_target(ctx, ext_id)
        return load_preferences(ctx.data_dir, ext_id)


@router.put(
    "/ext/{ext_id}/preferences",
    response_model=dict[str, JsonValue],
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        },
    },
)
async def put_extension_preferences(
    ctx: Ctx, ext_id: str, request: Request
) -> dict[str, JsonValue]:
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_PREFERENCES_JSON:
            raise ValueError("extension preferences exceed 1 MiB")
        raw.extend(chunk)

    def replace_preferences() -> dict[str, JsonValue]:
        body = validate_preferences(raw)
        with ctx.engine.hold_operation():
            _preferences_target(ctx, ext_id)
            save_preferences(ctx.data_dir, ext_id, body)
        return body

    return await run_in_threadpool(replace_preferences)
