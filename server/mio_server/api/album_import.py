"""Raw, bounded uploads for offline HTML reading-projection imports."""

import tempfile
from pathlib import Path

from fastapi import Request
from starlette.concurrency import run_in_threadpool

from .. import album_interchange as A
from ..album_import import AlbumImportResult, import_album_html
from .deps import Ctx
from .library import BINARY_BODY
from .operations import Router as APIRouter

router = APIRouter(tags=["album"])


@router.post(
    "/imports/album-html",
    response_model=AlbumImportResult,
    status_code=201,
    openapi_extra=BINARY_BODY,
)
async def import_html_album(ctx: Ctx, request: Request):
    """Import embedded reading images/metadata; source ZIP is the complete editable format."""
    with tempfile.TemporaryDirectory(prefix="mio-album-upload-") as temporary:
        path, size = Path(temporary) / "album.html", 0
        with path.open("xb") as target:
            async for chunk in request.stream():
                size += len(chunk)
                if size > A.MAX_HTML_BYTES:
                    raise ValueError("album HTML exceeds 1 GiB")
                target.write(chunk)
        return await run_in_threadpool(import_album_html, ctx, path)
