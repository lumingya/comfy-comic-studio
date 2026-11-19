"""Per-theme preferences and local wallpaper files."""

from __future__ import annotations

import json
import os
import re
import tempfile
import uuid
from pathlib import Path, PurePosixPath

from fastapi import Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from ..private_store import (
    MAX_WALLPAPER_BYTES,
    MAX_WALLPAPER_RECORD,
    WALLPAPER_ID,
    PrivateStore,
    atomic_write,
    read_json_file,
    regular_path,
    validate_json,
    validate_media_file,
    validate_wallpaper_record,
)
from ..storage import NotFound
from ..theme_media import (
    MAX_IMAGE_ANIMATION_PROBE,
    MEDIA_FORMATS,
    image_may_animate,
    supports_background,
)
from .deps import Ctx
from .operations import Router as APIRouter
from .uploads import multipart_uploads

router = APIRouter(tags=["themes"])

MAX_PREFERENCES_BYTES = 1024 * 1024
MAX_MULTIPART_OVERHEAD = 1024 * 1024
MIME_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "avif": "image/avif",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "ogv": "video/ogg",
}


def _registered_theme(ctx, theme_id: str) -> None:
    try:
        PrivateStore(ctx.data_dir, "theme", theme_id)
    except ValueError as exc:
        raise NotFound("主题不存在") from exc
    if not any(item.id == theme_id for item in ctx.registry.all("theme")):
        raise NotFound(f"主题不存在：{theme_id}")


def _workspace(data_dir: Path) -> Path:
    root = Path(data_dir).absolute()
    regular_path(root, directory=True, missing=False)
    return root


def _contained(root: Path, path: Path) -> None:
    regular_path(path, root=root)


def _directory(data_dir: Path, parts: tuple[str, ...], *, create: bool) -> Path:
    root = _workspace(data_dir)
    current = root
    for part in parts:
        target = current / part
        if not regular_path(target, directory=True, root=root) and create:
            try:
                target.mkdir()
            except FileExistsError:
                pass
            regular_path(target, directory=True, missing=False, root=root)
        current = target
    return current


def _regular_file(path: Path, root: Path, *, missing: bool = False) -> bool:
    return regular_path(path, directory=False, missing=missing, root=root)


def _validate_preferences(raw: bytes) -> dict:
    return validate_json(raw, limit=MAX_PREFERENCES_BYTES)


def _load_preferences(data_dir: Path, theme_id: str) -> dict:
    return PrivateStore(data_dir, "theme", theme_id).load_json(limit=MAX_PREFERENCES_BYTES)


def _write_atomic(path: Path, root: Path, raw: bytes) -> None:
    _regular_file(path, root, missing=True)
    atomic_write(path, raw)


def _save_preferences(data_dir: Path, theme_id: str, value: dict) -> None:
    PrivateStore(data_dir, "theme", theme_id).write_json(value, limit=MAX_PREFERENCES_BYTES)


async def _request_body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise ValueError("请求内容超过大小限制")
    chunks = bytearray()
    async for chunk in request.stream():
        if len(chunks) + len(chunk) > limit:
            raise ValueError("请求内容超过大小限制")
        chunks.extend(chunk)
    return bytes(chunks)


@router.get("/themes/{theme_id}/preferences")
def get_theme_preferences(ctx: Ctx, theme_id: str) -> dict:
    _registered_theme(ctx, theme_id)
    return _load_preferences(ctx.data_dir, theme_id)


@router.put(
    "/themes/{theme_id}/preferences",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object"}}},
        }
    },
)
async def put_theme_preferences(ctx: Ctx, theme_id: str, request: Request) -> dict:
    _registered_theme(ctx, theme_id)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise ValueError("主题偏好设置必须使用 application/json")
    value = _validate_preferences(await _request_body(request, MAX_PREFERENCES_BYTES))

    def save() -> None:
        with ctx.engine.hold_operation():
            _registered_theme(ctx, theme_id)
            _save_preferences(ctx.data_dir, theme_id, value)

    await run_in_threadpool(save)
    return value


def _filename_and_kind(filename: str) -> tuple[str, str, str]:
    filename = PurePosixPath((filename or "").replace("\\", "/")).name
    filename = "".join(char for char in filename if ord(char) >= 32 and not 127 <= ord(char) < 160)
    filename = filename.strip(" .")
    if not filename or len(filename) > 255:
        raise ValueError("壁纸文件名无效")
    suffix = PurePosixPath(filename).suffix.lower().removeprefix(".")
    kind = next((group for group, formats in MEDIA_FORMATS.items() if suffix in formats), "")
    if not kind or not supports_background(f"assets/wallpaper.{suffix}", kind):
        raise ValueError("不支持的壁纸文件类型")
    return filename, kind, suffix


def _wallpaper_folder(data_dir: Path, theme_id: str, *, create: bool) -> Path:
    return PrivateStore(data_dir, "theme", theme_id).directory("wallpapers", create=create)


def _wallpaper_sources(data_dir: Path, theme_id: str) -> tuple[Path, ...]:
    return PrivateStore(data_dir, "theme", theme_id).sources("wallpapers")


def _wallpaper_id(value: str) -> str:
    if not WALLPAPER_ID.fullmatch(value):
        raise NotFound("壁纸不存在")
    return value


def _read_record(folder: Path, data_dir: Path, wallpaper_id: str) -> tuple[dict, Path, Path]:
    wallpaper_id = _wallpaper_id(wallpaper_id)
    root = _workspace(data_dir)
    metadata_path = folder / f"{wallpaper_id}.json"
    if not _regular_file(metadata_path, root, missing=True):
        raise NotFound("壁纸不存在")
    record = validate_wallpaper_record(
        read_json_file(metadata_path, limit=MAX_WALLPAPER_RECORD), wallpaper_id
    )
    file_path = folder / f"{wallpaper_id}.{record['suffix']}"
    if not _regular_file(file_path, root, missing=True):
        raise NotFound("壁纸不存在")
    validate_media_file(file_path, record["suffix"], limit=MAX_WALLPAPER_BYTES)
    return record, file_path, metadata_path


def _find_record(data_dir: Path, theme_id: str, wallpaper_id: str) -> tuple[dict, Path, Path]:
    wallpaper_id = _wallpaper_id(wallpaper_id)
    root = _workspace(data_dir)
    for folder in _wallpaper_sources(data_dir, theme_id):
        if _regular_file(folder / f"{wallpaper_id}.json", root, missing=True):
            return _read_record(folder, data_dir, wallpaper_id)
    raise NotFound("壁纸不存在")


def _wallpaper_item(record: dict, path: Path, theme_id: str) -> dict:
    animated = False
    if record["kind"] == "image":
        with path.open("rb") as stream:
            animated = image_may_animate(
                f"assets/wallpaper.{record['suffix']}", stream.read(MAX_IMAGE_ANIMATION_PROBE)
            )
    return {
        "id": record["id"],
        "filename": record["filename"],
        "kind": record["kind"],
        "animated": animated,
        "url": f"/api/themes/{theme_id}/wallpapers/{record['id']}/file",
    }


def _store_wallpaper(data_dir: Path, theme_id: str, upload: UploadFile) -> dict:
    filename, kind, suffix = _filename_and_kind(upload.filename or "")
    folder = _wallpaper_folder(data_dir, theme_id, create=True)
    root = _workspace(data_dir)
    wallpaper_id = f"wallpaper_{uuid.uuid4().hex}"
    file_path = folder / f"{wallpaper_id}.{suffix}"
    metadata_path = folder / f"{wallpaper_id}.json"
    descriptor, temporary_name = tempfile.mkstemp(prefix=".wallpaper-", dir=folder)
    temporary = Path(temporary_name)
    size = 0
    try:
        upload.file.seek(0)
        with os.fdopen(descriptor, "wb") as stream:
            while chunk := upload.file.read(64 * 1024):
                size += len(chunk)
                if size > MAX_WALLPAPER_BYTES:
                    raise ValueError("壁纸文件超过大小限制")
                stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
        _regular_file(temporary, root)
        validate_media_file(temporary, suffix, limit=MAX_WALLPAPER_BYTES)
        os.replace(temporary, file_path)
        record = {"id": wallpaper_id, "filename": filename, "kind": kind, "suffix": suffix}
        raw = json.dumps(record, ensure_ascii=False, sort_keys=True).encode("utf-8")
        _write_atomic(metadata_path, root, raw)
    except BaseException:
        temporary.unlink(missing_ok=True)
        file_path.unlink(missing_ok=True)
        raise
    return _wallpaper_item(record, file_path, theme_id)


def _list_wallpapers(data_dir: Path, theme_id: str) -> list[dict]:
    root = _workspace(data_dir)
    items = {}
    for folder in _wallpaper_sources(data_dir, theme_id):
        if not regular_path(folder, directory=True, root=root):
            continue
        for path in sorted(folder.iterdir()):
            _regular_file(path, root)
            match = re.fullmatch(r"(wallpaper_[a-f0-9]{32})\.json", path.name)
            if not match or match[1] in items:
                continue
            record, file_path, _metadata_path = _read_record(folder, data_dir, match[1])
            items[record["id"]] = _wallpaper_item(record, file_path, theme_id)
    return [items[identifier] for identifier in sorted(items)]


@router.get("/themes/{theme_id}/wallpapers")
def list_theme_wallpapers(ctx: Ctx, theme_id: str) -> dict:
    _registered_theme(ctx, theme_id)
    return {"items": _list_wallpapers(ctx.data_dir, theme_id)}


@router.post(
    "/themes/{theme_id}/wallpapers",
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "properties": {"file": {"type": "string", "format": "binary"}},
                    }
                }
            },
        }
    },
)
async def upload_theme_wallpaper(ctx: Ctx, theme_id: str, request: Request) -> dict:
    _registered_theme(ctx, theme_id)
    content_type = request.headers.get("content-type", "")
    if content_type.split(";", 1)[0].strip().lower() != "multipart/form-data" or any(
        char in content_type for char in "\r\n"
    ):
        raise ValueError("请以 multipart/form-data 上传壁纸")
    uploads = await multipart_uploads(
        request,
        max_files=1,
        max_file_bytes=MAX_WALLPAPER_BYTES,
        max_body_bytes=MAX_WALLPAPER_BYTES + MAX_MULTIPART_OVERHEAD,
    )
    try:
        if len(uploads) != 1 or uploads[0][0] != "file":
            raise ValueError("请以 file 字段上传一个壁纸文件")
        upload = uploads[0][1]
        if not isinstance(upload, UploadFile):
            raise ValueError("壁纸上传字段无效")

        def store() -> dict:
            with ctx.engine.hold_operation():
                _registered_theme(ctx, theme_id)
                return _store_wallpaper(ctx.data_dir, theme_id, upload)

        return await run_in_threadpool(store)
    finally:
        for _, upload in uploads:
            await upload.close()


@router.get("/themes/{theme_id}/wallpapers/{wallpaper_id}/file")
def serve_theme_wallpaper(ctx: Ctx, theme_id: str, wallpaper_id: str) -> FileResponse:
    _registered_theme(ctx, theme_id)
    record, path, _metadata = _find_record(ctx.data_dir, theme_id, wallpaper_id)
    return FileResponse(
        path,
        media_type=MIME_TYPES[record["suffix"]],
        headers={
            "Cache-Control": "private, no-cache, no-store",
            "Content-Disposition": f'inline; filename="{record["id"]}.{record["suffix"]}"',
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cross-Origin-Resource-Policy": "same-origin",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/themes/{theme_id}/wallpapers/{wallpaper_id}", status_code=204)
def delete_theme_wallpaper(ctx: Ctx, theme_id: str, wallpaper_id: str) -> None:
    with ctx.engine.hold_operation():
        _registered_theme(ctx, theme_id)
        wallpaper_id = _wallpaper_id(wallpaper_id)
        root = _workspace(ctx.data_dir)
        records = [
            _read_record(folder, ctx.data_dir, wallpaper_id)
            for folder in _wallpaper_sources(ctx.data_dir, theme_id)
            if _regular_file(folder / f"{wallpaper_id}.json", root, missing=True)
        ]
        if not records:
            raise NotFound("壁纸不存在")
        for _record, path, metadata_path in records:
            path.unlink()
            metadata_path.unlink()
