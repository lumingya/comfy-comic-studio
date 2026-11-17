"""Independent theme package import/export, shared by local and open APIs."""

from email import policy
from email.parser import BytesParser

from fastapi import Request
from fastapi.responses import Response

from ..storage import NotFound
from ..theme_packages import MAX_PACKAGE, package_theme
from ..themes import Theme
from .deps import Ctx
from .library import read_body
from .operations import Router as APIRouter

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
    package_id, payload = package_theme(_theme(ctx, theme_id))
    return Response(
        payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{package_id}.zip"'},
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
    data = await read_body(request, MAX_PACKAGE, "主题包超过 5 MB")
    return ctx.theme_packages.install_package(data)


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
    raw = await read_body(request, MAX_PACKAGE + 128 * 1024, "主题文件夹超过大小限制")
    envelope = BytesParser(policy=policy.default).parsebytes(
        ("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode("ascii") + raw
    )
    files = []
    total = 0
    for item in envelope.iter_parts():
        if item.get_param("name", header="content-disposition") != "files":
            continue
        name = item.get_filename() or ""
        data = item.get_payload(decode=True) or b""
        total += len(data)
        if total > MAX_PACKAGE:
            raise ValueError("主题文件夹超过 5 MB")
        files.append((name, data))
    return ctx.theme_packages.install_folder(files)
