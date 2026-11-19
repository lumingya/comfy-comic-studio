"""Extension private: shared local and v2 routes."""

from __future__ import annotations

from fastapi import Header, Request, Response
from pydantic import JsonValue
from starlette.concurrency import run_in_threadpool

from ..backups.extension_data import load_settings, save_settings, settings_exist
from ..extension_preferences import (
    MAX_PREFERENCES_JSON,
    load_preferences,
    preferences_exist,
)
from ..extensions.manager import ExtensionError
from ..private_store import (
    PreferencePatch,
    PrivateStore,
    if_match_revision,
    read_bounded_bytes,
    validate_json,
)
from ..storage import NotFound
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["extensions"])
PREFERENCE_RESPONSES = {
    200: {
        "headers": {
            "ETag": {
                "description": "Strong content revision for conditional preference writes",
                "schema": {"type": "string", "pattern": r'^"[a-f0-9]{64}"$'},
            }
        }
    },
    409: {"description": "Preference revision changed; reload before applying this intent"},
}


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


def _preference_response(response: Response, value: dict) -> dict:
    response.headers["ETag"] = f'"{PrivateStore.revision(value)}"'
    response.headers["Cache-Control"] = "private, no-store"
    return value


async def _preference_body(request: Request) -> bytes:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise ValueError("extension preferences require application/json")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_PREFERENCES_JSON:
        raise ValueError("extension preferences exceed 1 MiB")
    return await read_bounded_bytes(request.stream(), limit=MAX_PREFERENCES_JSON)


@router.get(
    "/ext/{ext_id}/preferences", response_model=dict[str, JsonValue], responses=PREFERENCE_RESPONSES
)
def get_extension_preferences(ctx: Ctx, ext_id: str, response: Response) -> dict[str, JsonValue]:
    with ctx.engine.hold_operation():
        _preferences_target(ctx, ext_id)
        return _preference_response(response, load_preferences(ctx.data_dir, ext_id))


@router.put(
    "/ext/{ext_id}/preferences",
    response_model=dict[str, JsonValue],
    responses=PREFERENCE_RESPONSES,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        },
    },
)
async def put_extension_preferences(
    ctx: Ctx,
    ext_id: str,
    request: Request,
    response: Response,
    if_match: str | None = Header(default=None),
) -> dict[str, JsonValue]:
    """Replace the complete object; omit If-Match only for an explicit unconditional replace."""
    expected = if_match_revision(if_match)
    body = validate_json(await _preference_body(request), limit=MAX_PREFERENCES_JSON)

    def replace_preferences() -> dict[str, JsonValue]:
        with ctx.engine.hold_operation():
            _preferences_target(ctx, ext_id)
            return PrivateStore(ctx.data_dir, "extension", ext_id).replace_json(
                body, expected_revision=expected, limit=MAX_PREFERENCES_JSON
            )

    return _preference_response(response, await run_in_threadpool(replace_preferences))


@router.patch(
    "/ext/{ext_id}/preferences",
    response_model=dict[str, JsonValue],
    responses=PREFERENCE_RESPONSES,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": PreferencePatch.model_json_schema()}},
        }
    },
)
async def patch_extension_preferences(
    ctx: Ctx, ext_id: str, request: Request, response: Response
) -> dict[str, JsonValue]:
    """Conditionally replace one subtree; callers retry only after fetching its current revision."""
    command = PreferencePatch.from_bytes(
        await _preference_body(request), limit=MAX_PREFERENCES_JSON
    )

    def patch_preferences() -> dict[str, JsonValue]:
        with ctx.engine.hold_operation():
            _preferences_target(ctx, ext_id)
            return PrivateStore(ctx.data_dir, "extension", ext_id).patch_json(
                command, limit=MAX_PREFERENCES_JSON
            )

    return _preference_response(response, await run_in_threadpool(patch_preferences))
