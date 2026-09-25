"""Albums: detail DTO and server-side export (HTML with a layout, ZIP, PDF)."""

from backend.api_v1.catalog import album_detail, read_config
from backend.api_v1.core import ROUTER, SENT, ApiError
from backend.api_v1.spec import BOOLEAN, INTEGER, NUMBER, STRING, array, obj, schema
from backend.mio_library import LibraryError

ALBUM_ID = {"albumId": {"description": "Album ID"}}
ALBUM_DETAIL = schema("AlbumDetail", obj({
    **{k: STRING for k in ("id", "projectId", "title", "characterName", "templateId", "templateTitle", "synopsis", "status")},
    "tags": array(STRING), "totalSteps": INTEGER, "generatedSteps": INTEGER, "liked": BOOLEAN,
    "createdAt": NUMBER, "updatedAt": NUMBER, "completedAt": NUMBER,
    "steps": array(obj({"stepIndex": INTEGER, "name": STRING, "caption": STRING, "prompt": STRING,
                        "image": STRING, "assetEndpoint": STRING}))}))
EXPORT = schema("AlbumExportRequest", obj({
    "albumIds": array(STRING, minItems=1), "format": {"enum": ["html", "zip", "pdf"], "default": "html"},
    "layoutId": {"type": "string", "description": "HTML only: export layout (see /library/layouts)"},
    "imageProfile": {"enum": ["auto", "archive", "clean", "publish"]}, "themeColor": STRING, "border": INTEGER,
    "signature": STRING, "showCaptions": BOOLEAN, "showPrompts": BOOLEAN,
    "validateOnly": {"type": "boolean", "description": "ZIP/PDF: only check that the export can be produced"}},
    ["albumIds"]))


@ROUTER.get("/albums/{albumId}", summary="画册详情：每一页的台词、提示词、图片与 assetEndpoint", tags=["albums"],
            params=ALBUM_ID, response=ALBUM_DETAIL)
def get_album(ctx):
    from backend import mio_foundation

    album_id = ctx.params["albumId"]
    mio_foundation.materialize_album(ctx.host, album_id)
    return album_detail(ctx.store, album_id)


@ROUTER.post("/albums/export", summary="导出画册为自包含 HTML（套用版式）、ZIP 或 PDF 文件", tags=["albums"],
             body=EXPORT, body_limit=256 * 1024,
             produces={"text/html": {"schema": {"type": "string"}},
                       "application/zip": {"schema": {"type": "string", "format": "binary"}},
                       "application/pdf": {"schema": {"type": "string", "format": "binary"}}})
def export_albums(ctx):
    body = ctx.json()
    if not isinstance(body.get("albumIds"), list) or not body["albumIds"]:
        raise ApiError(400, "invalid_field", "albumIds must be a non-empty array")
    fmt = body.get("format", "html")
    store, config = read_config(ctx.host)
    if fmt == "html":
        from backend import mio_layout_export

        mio_layout_export.stream_html_export(ctx.http, store, config, body)
    elif fmt in ("zip", "pdf"):
        from backend import mio_export

        mio_export.stream_export(ctx.http, store, body)
    else:
        raise LibraryError("format 只支持 html、zip 或 pdf")
    return SENT
