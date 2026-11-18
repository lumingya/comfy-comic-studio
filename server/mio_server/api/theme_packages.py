"""Independent theme package import/export, shared by local and open APIs."""

import shutil
import tempfile
from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from ..storage import NotFound
from ..theme_media import MAX_STYLESHEET_BYTES, asset_parts, validate_stylesheet
from ..theme_packages import (
    MAX_FILES,
    MAX_PACKAGE,
    SCRIPT,
    STYLE,
    _folder_files,
    _read_folder,
    _regular_path,
    package_theme_to_file,
)
from ..themes import Theme
from .deps import Ctx
from .operations import Router as APIRouter
from .uploads import multipart_uploads

router = APIRouter(tags=["themes"])


def _theme(ctx, theme_id: str) -> Theme:
    contribution = next((item for item in ctx.registry.all("theme") if item.id == theme_id), None)
    if contribution is None:
        raise NotFound(f"主题不存在：{theme_id}")
    return contribution.value


@router.get("/themes/{theme_id}", response_model=Theme)
def get_theme(ctx: Ctx, theme_id: str) -> Theme:
    """Return an editable theme JSON document accepted by the existing import endpoint."""
    return _theme(ctx, theme_id)


@router.get(
    "/themes/{theme_id}/package",
    response_class=Response,
    responses={
        200: {"content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}}}
    },
)
def export_theme_package(ctx: Ctx, theme_id: str) -> Response:
    """Download an inert theme folder as a ZIP, ready to import on another installation."""
    contribution = next((item for item in ctx.registry.all("theme") if item.id == theme_id), None)
    if contribution is None:
        raise NotFound(f"主题不存在：{theme_id}")
    theme = contribution.value
    resources: dict[str, Path] = {}
    if (theme.background or theme.script_file or theme.style_file) and contribution.source in {
        "builtin",
        "theme-package",
    }:
        root = (
            ctx.theme_packages.bundled_root
            if contribution.source == "builtin"
            else ctx.theme_packages.root
        )
        try:
            folder = root / theme_id
            _read_folder(folder)
            resources = {
                name: path
                for name, path in _folder_files(folder)
                if name not in {"mio-theme.json", "theme.json", "README.md"}
            }
        except (OSError, ValueError) as exc:
            raise NotFound("主题资源不存在或无效") from exc
    elif contribution.source.startswith("ext:"):
        ext_id = contribution.source.removeprefix("ext:")
        loaded = (ctx.extensions.loaded if ctx.extensions else {}).get(ext_id)
        if loaded is None:
            raise NotFound("主题扩展未启用")
        asset_names: set[str] = set()
        if theme.style_file:
            from ..extensions.manifest import inside

            style_path = inside(loaded.api.folder, theme.style_file)
            _regular_path(style_path, directory=False)
            if style_path.stat().st_size > MAX_STYLESHEET_BYTES:
                raise NotFound("主题样式文件过大")
            stylesheet = style_path.read_text(encoding="utf-8")
            asset_root = loaded.api.folder / "assets"
            available = {
                path.relative_to(loaded.api.folder).as_posix()
                for path in asset_root.rglob("*")
                if path.is_file() and asset_parts(path.relative_to(loaded.api.folder).as_posix())
            }
            asset_names = validate_stylesheet(stylesheet, available)
            resources[theme.style_file] = style_path
        if theme.background:
            asset_names.add(theme.background.file)
        for name in (*asset_names, theme.script_file):
            if name:
                from ..extensions.manifest import inside

                path = inside(loaded.api.folder, name)
                _regular_path(path, directory=False)
                resources[name] = path
    temporary = tempfile.mkdtemp(prefix="mio-theme-export-")
    package_path = Path(temporary) / "theme.zip"
    try:
        package_id = package_theme_to_file(theme, resources, package_path)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return FileResponse(
        package_path,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{package_id}.zip"'},
        background=BackgroundTask(shutil.rmtree, temporary, ignore_errors=True),
    )


@router.post(
    "/themes/package",
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def import_theme_package(ctx: Ctx, request: Request) -> dict:
    """Install a data-only theme ZIP into the workspace theme folder."""
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_PACKAGE:
        raise ValueError("主题包超过 10 GiB")
    with tempfile.TemporaryDirectory(prefix="mio-theme-upload-") as temporary:
        archive = Path(temporary) / "theme.zip"
        size = 0
        with archive.open("xb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_PACKAGE:
                    raise ValueError("主题包超过 10 GiB")
                output.write(chunk)
        return await run_in_threadpool(ctx.theme_packages.install_package_path, archive)


@router.post(
    "/themes/folder",
    status_code=201,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["files"],
                        "properties": {
                            "files": {
                                "type": "array",
                                "items": {"type": "string", "format": "binary"},
                            }
                        },
                    }
                }
            },
        }
    },
)
async def import_theme_folder(ctx: Ctx, request: Request) -> dict:
    """Install a directly selected theme folder without routing it through extensions."""
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data;") or any(
        char in content_type for char in "\r\n"
    ):
        raise ValueError("请上传主题文件夹")
    uploads = await multipart_uploads(
        request,
        max_files=MAX_FILES,
        max_file_bytes=MAX_PACKAGE,
        max_body_bytes=MAX_PACKAGE + 2 * 1024 * 1024,
    )
    try:
        streams = []
        for field, upload in uploads:
            if field != "files" or not isinstance(upload, UploadFile):
                raise ValueError("请以 files 字段上传主题文件")
            streams.append((upload.filename or "", upload.file))
        return await run_in_threadpool(ctx.theme_packages.install_folder_streams, streams)
    finally:
        for _, upload in uploads:
            await upload.close()


def _theme_file(ctx, theme_id: str, name: str) -> Path:
    theme = _theme(ctx, theme_id)
    declared = {
        value
        for value in (
            theme.script_file,
            theme.style_file,
            theme.background.file if theme.background else None,
        )
        if value
    }
    if name not in declared and asset_parts(name) is None:
        raise NotFound("主题资源不存在")
    contribution = next(item for item in ctx.registry.all("theme") if item.id == theme_id)
    if contribution.source == "builtin":
        folder = ctx.theme_packages.bundled_root / theme_id
    elif contribution.source == "theme-package":
        folder = ctx.theme_packages.root / theme_id
    elif contribution.source.startswith("ext:"):
        ext_id = contribution.source.removeprefix("ext:")
        loaded = (ctx.extensions.loaded if ctx.extensions else {}).get(ext_id)
        if loaded is None:
            raise NotFound("主题扩展未启用")
        from ..extensions.manifest import inside

        try:
            target = inside(loaded.api.folder, name)
            _regular_path(target, directory=False)
        except (OSError, ValueError) as exc:
            raise NotFound("主题资源不存在或路径无效") from exc
        return target
    else:
        raise NotFound("主题不包含外部资源")
    target = folder / name
    try:
        _regular_path(folder, directory=True)
        parent = target.parent
        while parent != folder:
            _regular_path(parent, directory=True)
            parent = parent.parent
        _regular_path(target, directory=False)
    except (OSError, ValueError) as exc:
        raise NotFound("主题资源不存在或路径无效") from exc
    return target


@router.get("/themes/{theme_id}/assets/{path:path}", include_in_schema=False)
def theme_asset(ctx: Ctx, theme_id: str, path: str) -> FileResponse:
    filename = _theme_file(ctx, theme_id, f"assets/{path}")
    return FileResponse(
        filename,
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
        },
    )


@router.get("/themes/{theme_id}/script", include_in_schema=False)
def theme_script(ctx: Ctx, theme_id: str) -> FileResponse:
    filename = _theme_file(ctx, theme_id, SCRIPT)
    return FileResponse(
        filename,
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "attachment",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.get("/themes/{theme_id}/style", include_in_schema=False)
def theme_style(ctx: Ctx, theme_id: str) -> FileResponse:
    filename = _theme_file(ctx, theme_id, STYLE)
    try:
        if filename.stat().st_size > MAX_STYLESHEET_BYTES:
            raise ValueError("theme.css exceeds 2 MB")
        source = filename.read_text(encoding="utf-8")
        assets = {
            path.relative_to(filename.parent).as_posix()
            for path in (filename.parent / "assets").rglob("*")
            if path.is_file() and asset_parts(path.relative_to(filename.parent).as_posix())
        }
        validate_stylesheet(source, assets)
    except (OSError, UnicodeError, ValueError) as exc:
        raise NotFound("主题样式无效") from exc
    return FileResponse(
        filename,
        media_type="text/css; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/themes/{theme_id}", status_code=204)
def delete_theme(ctx: Ctx, theme_id: str) -> None:
    contribution = next((item for item in ctx.registry.all("theme") if item.id == theme_id), None)
    if contribution is None:
        raise NotFound(f"主题不存在：{theme_id}")
    if contribution.source == "theme-package":
        ctx.theme_packages.remove(theme_id)
    elif contribution.source == "user":
        ctx.store.delete_doc("theme", theme_id)
        ctx.registry.unregister("theme", theme_id)
    else:
        raise ValueError("只能删除自己导入的主题")
