"""Theme documents and standalone extension downloads, shared by local and open APIs."""

from fastapi.responses import Response

from ..storage import NotFound
from ..theme_packages import package_theme
from ..themes import Theme
from .deps import Ctx
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
    """Download an inert extension folder as a ZIP, ready to import on another installation."""
    package_id, payload = package_theme(_theme(ctx, theme_id))
    return Response(
        payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{package_id}.zip"'},
    )
