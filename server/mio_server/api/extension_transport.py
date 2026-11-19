"""Extension transport: shared local and v2 routes."""

from __future__ import annotations

import os
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from fastapi import Request, status
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from ..extensions.manager import MAX_ENTRIES, MAX_ZIP
from .deps import Ctx
from .library import BINARY_BODY
from .operations import Router as APIRouter
from .uploads import multipart_uploads

router = APIRouter(tags=["extensions"])


class EnableRequest(BaseModel):
    digest: str


def _mgr(ctx):
    return ctx.extensions


# -------------------------------------------------------------- extensions
@router.get("/extensions")
def list_extensions(ctx: Ctx) -> dict:
    return {
        "items": [i.to_json() for i in _mgr(ctx).list()],
        "hooks": ctx.hooks.describe(),
        "safe_mode": os.environ.get("MIO_SAFE_MODE") == "1",
    }


@router.post("/extensions", status_code=status.HTTP_201_CREATED, openapi_extra=BINARY_BODY)
async def install_extension(ctx: Ctx, request: Request, replace: bool = False) -> dict:
    """Raw body = zipped extension folder.  Installed disabled; review, then enable."""
    size = 0
    with tempfile.TemporaryDirectory(prefix="mio-extension-upload-") as temporary:
        archive = Path(temporary) / "extension.zip"
        with archive.open("wb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_ZIP:
                    raise ValueError("扩展包超过 50 MB")
                output.write(chunk)
        if size == 0:
            raise ValueError("请求体为空")
        installed = await run_in_threadpool(_mgr(ctx).install_path, archive, replace)
        return installed.to_json()


@router.post("/extensions/{ext_id}/enable")
def enable_extension(ctx: Ctx, ext_id: str, body: EnableRequest) -> dict:
    """Enable exactly the reviewed content (``digest`` from the listing)."""
    return _mgr(ctx).enable(ext_id, body.digest).to_json()


@router.post("/extensions/folder", status_code=201)
async def install_extension_folder(ctx: Ctx, request: Request, replace: bool = False) -> dict:
    """Import a portable extension directory; files are reviewed before activation."""
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data;") or any(
        c in content_type for c in "\r\n"
    ):
        raise ValueError("请上传扩展文件夹")
    uploads = await multipart_uploads(
        request,
        max_files=MAX_ENTRIES,
        max_file_bytes=MAX_ZIP,
        max_body_bytes=MAX_ZIP + 1024 * 1024,
    )
    try:
        with tempfile.TemporaryDirectory(prefix="mio-extension-folder-") as temporary:
            archive = Path(temporary) / "extension.zip"
            total = count = 0
            names = set()
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
                for field, item in uploads:
                    if field != "files":
                        continue
                    if not isinstance(item, UploadFile):
                        raise ValueError("请上传扩展文件夹")
                    name = (item.filename or "").replace("\\", "/")
                    path = PurePosixPath(name)
                    if not name or path.is_absolute() or ".." in path.parts or ":" in name:
                        raise ValueError("文件夹包含不安全的路径")
                    if any(
                        part
                        in {
                            "node_modules",
                            ".git",
                            "__pycache__",
                            ".venv",
                            ".cache",
                            ".pytest_cache",
                            ".ruff_cache",
                        }
                        or part.startswith(".env")
                        for part in path.parts
                    ):
                        continue
                    if name in names:
                        raise ValueError("文件夹包含重复路径")
                    names.add(name)
                    count += 1
                    if count > MAX_ENTRIES:
                        raise ValueError("扩展文件夹过大")
                    with output.open(name, "w", force_zip64=True) as destination:
                        while chunk := await item.read(1024 * 1024):
                            total += len(chunk)
                            if total > MAX_ZIP:
                                raise ValueError("扩展文件夹过大")
                            destination.write(chunk)
            installed = await run_in_threadpool(_mgr(ctx).install_path, archive, replace)
            return installed.to_json()
    finally:
        for _, upload in uploads:
            await upload.close()


@router.post("/extensions/{ext_id}/disable")
def disable_extension(ctx: Ctx, ext_id: str) -> dict:
    return _mgr(ctx).disable(ext_id).to_json()


@router.delete("/extensions/{ext_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_extension(ctx: Ctx, ext_id: str, delete_data: bool = False) -> None:
    _mgr(ctx).remove(ext_id, delete_data=delete_data)
