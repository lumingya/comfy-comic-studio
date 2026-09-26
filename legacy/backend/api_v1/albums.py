"""Albums: detail DTO and server-side export (HTML with a layout, ZIP, PDF)."""

from backend.api_v1.catalog import album_detail, read_config
from backend.api_v1.core import ROUTER, SENT, ApiError
from backend.api_v1.spec import BOOLEAN, INTEGER, NUMBER, STRING, array, obj, qp, schema
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


# ------------------------------------------------------------------ pluggable exporters / importers

def _ecosystem(ctx):
    from backend.ecosystem import api as ecosystem_api

    return ecosystem_api.service(ctx.host)


@ROUTER.get("/exporters", summary="可用的画册导出器（内置 pages-zip 与扩展注册的导出器）", tags=["albums"],
            response=array(obj({"id": STRING, "label": STRING, "extension": STRING, "mime": STRING, "owner": STRING})))
def list_exporters(ctx):
    return _ecosystem(ctx).exporters.manifest()


@ROUTER.get("/importers", summary="可用的画册导入器（内置 pages-zip 与扩展注册的导入器）", tags=["albums"],
            response=array(obj({"id": STRING, "label": STRING, "accepts": array(STRING), "owner": STRING})))
def list_importers(ctx):
    return _ecosystem(ctx).importers.manifest()


@ROUTER.post("/albums/{albumId}/export", summary="用指定导出器导出一本画册（默认 pages-zip：页面图片 + album.json）",
             tags=["albums"], params=ALBUM_ID,
             body=obj({"exporter": {"type": "string", "default": "pages-zip"}, "options": {"type": "object"}}),
             body_required=False, produces={"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}})
def export_album(ctx):
    from backend import mio_foundation
    from backend.api_v1.core import Raw
    from backend.api_v1.library import read_entity

    body = ctx.json(required=False)
    album_id = ctx.params["albumId"]
    read_entity(ctx.host, "albums", album_id)
    mio_foundation.materialize_album(ctx.host, album_id)
    result = _ecosystem(ctx).export(str(body.get("exporter") or "pages-zip"), album_id, body.get("options"))
    return Raw(bytes(result["bytes"]), mime=result.get("mime") or "application/octet-stream",
               filename=result.get("filename") or album_id + ".bin")


@ROUTER.post("/albums/import", summary="用指定导入器导入画册（二进制上传或 {importer, payload, options}）", tags=["albums"],
             status=201, binary_body=["application/zip", "application/octet-stream"], body_limit=700 * 1024 * 1024,
             query=[qp("importer", description="Binary uploads: importer ID (default pages-zip)"),
                    qp("projectId", description="Binary uploads: target collection"),
                    qp("filename", description="Binary uploads: original file name")],
             body=obj({"importer": {"type": "string", "default": "pages-zip"},
                       "payload": {"type": "object", "description": "Importer input, e.g. {b64, filename} for pages-zip"},
                       "options": {"type": "object", "description": "e.g. {projectId}"}}),
             response=obj({"kind": STRING, "id": STRING}))
def import_album(ctx):
    import base64

    if ctx.is_binary():
        raw = ctx.raw_body()
        importer = ctx.q("importer") or "pages-zip"
        payload = {"b64": base64.b64encode(raw).decode(), "filename": ctx.q("filename") or ""}
        options = {"projectId": ctx.q("projectId")} if ctx.q("projectId") else {}
    else:
        body = ctx.json()
        importer = str(body.get("importer") or "pages-zip")
        payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
        options = body.get("options") if isinstance(body.get("options"), dict) else {}
    return _ecosystem(ctx).import_document(importer, payload, options)
