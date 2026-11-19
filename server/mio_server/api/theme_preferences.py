"""Per-theme preferences and local wallpaper files."""

from __future__ import annotations

import json
import math
import os
import re
import stat
import tempfile
import uuid
from pathlib import Path, PurePosixPath

from fastapi import Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from ..storage import NotFound
from ..theme_media import MEDIA_FORMATS, supports_background, valid_media
from .deps import Ctx
from .operations import Router as APIRouter
from .uploads import multipart_uploads

router = APIRouter(tags=["themes"])

MAX_PREFERENCES_BYTES = 1024 * 1024
MAX_WALLPAPER_BYTES = 64 * 1024 * 1024
MAX_MULTIPART_OVERHEAD = 1024 * 1024
THEME_ID = re.compile(r"[a-z0-9][a-z0-9_-]{1,47}\Z")
WALLPAPER_ID = re.compile(r"wallpaper_[a-f0-9]{32}\Z")
RESERVED_IDS = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
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
    if not THEME_ID.fullmatch(theme_id) or theme_id in RESERVED_IDS:
        raise NotFound("主题不存在")
    if not any(item.id == theme_id for item in ctx.registry.all("theme")):
        raise NotFound(f"主题不存在：{theme_id}")


def _workspace(data_dir: Path) -> Path:
    root = Path(data_dir).absolute()
    try:
        metadata = root.lstat()
    except OSError as exc:
        raise ValueError("主题数据目录无效") from exc
    if not stat.S_ISDIR(metadata.st_mode) or root.resolve() != root:
        raise ValueError("主题数据目录必须是普通目录")
    return root


def _contained(root: Path, path: Path) -> None:
    try:
        contained = path.resolve().is_relative_to(root)
    except (OSError, RuntimeError) as exc:
        raise ValueError("主题数据路径无效") from exc
    if not contained:
        raise ValueError("主题数据路径越界")


def _directory(data_dir: Path, parts: tuple[str, ...], *, create: bool) -> Path:
    root = _workspace(data_dir)
    current = root
    for index, part in enumerate(parts):
        target = current / part
        _contained(root, target)
        try:
            metadata = target.lstat()
        except FileNotFoundError:
            if not create:
                return target.joinpath(*parts[index + 1 :])
            try:
                target.mkdir()
            except FileExistsError:
                pass
            metadata = target.lstat()
        if (
            stat.S_ISLNK(metadata.st_mode)
            or getattr(metadata, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
            or not stat.S_ISDIR(metadata.st_mode)
        ):
            raise ValueError("主题数据路径不能包含链接或特殊文件")
        _contained(root, target)
        current = target
    return current


def _regular_file(path: Path, root: Path, *, missing: bool = False) -> bool:
    _contained(root, path)
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        if missing:
            return False
        raise
    if (
        stat.S_ISLNK(metadata.st_mode)
        or getattr(metadata, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        or not stat.S_ISREG(metadata.st_mode)
    ):
        raise ValueError("主题数据文件不能是链接或特殊文件")
    _contained(root, path)
    return True


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("主题偏好设置包含重复 JSON 键")
        value[key] = item
    return value


def _constant(_value):
    raise ValueError("主题偏好设置包含无效数字")


def _finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("主题偏好设置包含无效数字")
    return number


def _validate_preferences(raw: bytes) -> dict:
    if len(raw) > MAX_PREFERENCES_BYTES:
        raise ValueError("主题偏好设置超过 1 MiB")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_pairs,
            parse_constant=_constant,
            parse_float=_finite_float,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ValueError("主题偏好设置必须是有效 UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError("主题偏好设置必须是 JSON 对象")
    return value


def _load_preferences(data_dir: Path, theme_id: str) -> dict:
    folder = _directory(data_dir, ("theme_data", theme_id), create=False)
    path = folder / "preferences.json"
    root = _workspace(data_dir)
    if not _regular_file(path, root, missing=True):
        return {}
    if path.stat().st_size > MAX_PREFERENCES_BYTES:
        raise ValueError("主题偏好设置超过 1 MiB")
    with path.open("rb") as stream:
        return _validate_preferences(stream.read(MAX_PREFERENCES_BYTES + 1))


def _write_atomic(path: Path, root: Path, raw: bytes) -> None:
    _regular_file(path, root, missing=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".theme-write-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        _regular_file(temporary, root)
        _regular_file(path, root, missing=True)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _save_preferences(data_dir: Path, theme_id: str, value: dict) -> None:
    try:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValueError("主题偏好设置必须是 JSON 对象") from exc
    value = _validate_preferences(raw)
    folder = _directory(data_dir, ("theme_data", theme_id), create=True)
    root = _workspace(data_dir)
    _write_atomic(folder / "preferences.json", root, raw)


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
    await run_in_threadpool(_save_preferences, ctx.data_dir, theme_id, value)
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
    return _directory(data_dir, ("themes", theme_id, "user_wallpapers"), create=create)


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
    if metadata_path.stat().st_size > 16 * 1024:
        raise ValueError("壁纸元数据过大")
    try:
        with metadata_path.open("rb") as stream:
            record = json.loads(stream.read(16 * 1024 + 1), object_pairs_hook=_pairs)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ValueError("壁纸元数据无效") from exc
    if (
        not isinstance(record, dict)
        or set(record) != {"id", "filename", "kind", "suffix"}
        or record["id"] != wallpaper_id
        or not isinstance(record["filename"], str)
        or not record["filename"]
        or len(record["filename"]) > 255
        or any(
            ord(char) < 32 or 127 <= ord(char) < 160 or char in "/\\" for char in record["filename"]
        )
        or not isinstance(record["suffix"], str)
        or record["suffix"] not in MIME_TYPES
        or PurePosixPath(record["filename"]).suffix.lower().removeprefix(".") != record["suffix"]
        or record["kind"]
        != next(
            (group for group, formats in MEDIA_FORMATS.items() if record["suffix"] in formats),
            None,
        )
    ):
        raise ValueError("壁纸元数据无效")
    file_path = folder / f"{wallpaper_id}.{record['suffix']}"
    if not _regular_file(file_path, root, missing=True):
        raise NotFound("壁纸不存在")
    return record, file_path, metadata_path


def _store_wallpaper(data_dir: Path, theme_id: str, upload: UploadFile) -> dict:
    filename, kind, suffix = _filename_and_kind(upload.filename or "")
    folder = _wallpaper_folder(data_dir, theme_id, create=True)
    root = _workspace(data_dir)
    wallpaper_id = f"wallpaper_{uuid.uuid4().hex}"
    file_path = folder / f"{wallpaper_id}.{suffix}"
    metadata_path = folder / f"{wallpaper_id}.json"
    descriptor, temporary_name = tempfile.mkstemp(prefix=".wallpaper-", dir=folder)
    temporary = Path(temporary_name)
    prefix = bytearray()
    size = 0
    try:
        upload.file.seek(0)
        with os.fdopen(descriptor, "wb") as stream:
            while chunk := upload.file.read(64 * 1024):
                size += len(chunk)
                if size > MAX_WALLPAPER_BYTES:
                    raise ValueError("壁纸文件超过大小限制")
                if len(prefix) < 32:
                    prefix.extend(chunk[: 32 - len(prefix)])
                stream.write(chunk)
            if not size or not valid_media(f"assets/wallpaper.{suffix}", bytes(prefix)):
                raise ValueError("壁纸文件签名与扩展名不匹配")
            stream.flush()
            os.fsync(stream.fileno())
        _regular_file(temporary, root)
        os.replace(temporary, file_path)
        record = {"id": wallpaper_id, "filename": filename, "kind": kind, "suffix": suffix}
        raw = json.dumps(record, ensure_ascii=False, sort_keys=True).encode("utf-8")
        _write_atomic(metadata_path, root, raw)
    except BaseException:
        temporary.unlink(missing_ok=True)
        file_path.unlink(missing_ok=True)
        raise
    return {
        "id": wallpaper_id,
        "filename": filename,
        "kind": kind,
        "url": f"/api/themes/{theme_id}/wallpapers/{wallpaper_id}/file",
    }


def _list_wallpapers(data_dir: Path, theme_id: str) -> list[dict]:
    folder = _wallpaper_folder(data_dir, theme_id, create=False)
    root = _workspace(data_dir)
    if not folder.exists():
        return []
    items = []
    for path in folder.iterdir():
        _regular_file(path, root)
        match = re.fullmatch(r"(wallpaper_[a-f0-9]{32})\.json", path.name)
        if not match:
            continue
        record, _file_path, _metadata_path = _read_record(folder, data_dir, match[1])
        items.append(
            {
                "id": record["id"],
                "filename": record["filename"],
                "kind": record["kind"],
                "url": f"/api/themes/{theme_id}/wallpapers/{record['id']}/file",
            }
        )
    return sorted(items, key=lambda item: item["id"])


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
        return await run_in_threadpool(_store_wallpaper, ctx.data_dir, theme_id, upload)
    finally:
        for _, upload in uploads:
            await upload.close()


@router.get("/themes/{theme_id}/wallpapers/{wallpaper_id}/file")
def serve_theme_wallpaper(ctx: Ctx, theme_id: str, wallpaper_id: str) -> FileResponse:
    _registered_theme(ctx, theme_id)
    folder = _wallpaper_folder(ctx.data_dir, theme_id, create=False)
    record, path, _metadata = _read_record(folder, ctx.data_dir, wallpaper_id)
    with path.open("rb") as stream:
        prefix = stream.read(32)
    if not valid_media(f"assets/wallpaper.{record['suffix']}", prefix):
        raise NotFound("壁纸文件无效")
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
    _registered_theme(ctx, theme_id)
    folder = _wallpaper_folder(ctx.data_dir, theme_id, create=False)
    _record, path, metadata_path = _read_record(folder, ctx.data_dir, wallpaper_id)
    path.unlink()
    metadata_path.unlink()
