"""Local image assets: read (data URL), upload, catalog and cleanup."""

import urllib.parse

from backend import mio_foundation
from backend.api_v1.core import ROUTER, ApiError, Raw
from backend.api_v1.spec import STRING, array, obj, qp
from backend.mio_library import LibraryError, image_type


def local_path(path):
    """Accept only local ``/images/...`` URLs without traversal."""
    if not isinstance(path, str) or not path.startswith("/images/") or ".." in urllib.parse.unquote(path).replace("\\", "/").split("/"):
        raise ApiError(400, "invalid_asset", "Only local /images/ paths are accepted")
    return path


@ROUTER.get("/assets", summary="读取本地图片为 data URL", tags=["assets"],
            query=[qp("path", description="Local asset URL, e.g. /images/assets/2026/09/abc.png", required=True, pattern="^/images/")],
            response=obj({"dataUrl": STRING}, ["dataUrl"]))
def read_asset(ctx):
    path = local_path(ctx.q("path", ""))
    try:
        return {"dataUrl": ctx.host.image_url_to_data_url(path)}
    except (ValueError, FileNotFoundError, OSError):
        raise ApiError(404, "asset_not_found", "Local asset not found") from None


IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/octet-stream"]


@ROUTER.get("/assets/raw", summary="读取本地图片的原始字节（可选 thumb=宽x高 生成 WebP 缩略图）", tags=["assets"],
            query=[qp("path", description="Local asset URL (/images/...)", required=True, pattern="^/images/"),
                   qp("thumb", description="Thumbnail box such as 256x256 (16..1024)", pattern="^[0-9]{1,4}x[0-9]{1,4}$"),
                   qp("download", "boolean", "Send as an attachment")],
            produces={"image/*": {"schema": {"type": "string", "format": "binary"}}})
def raw_asset(ctx):
    path = local_path(ctx.q("path", ""))
    try:
        file = ctx.store.image_path(urllib.parse.unquote(path))
    except (LibraryError, OSError, ValueError):
        raise ApiError(404, "asset_not_found", "Local asset not found") from None
    if not file.is_file():
        raise ApiError(404, "asset_not_found", "Local asset not found")
    if ctx.q("thumb"):
        from backend.mio_media import MediaStore

        thumb = MediaStore(ctx.host.DATA_DIR).thumbnail(file, ctx.q("thumb"))
        mime = "image/svg+xml" if thumb.suffix == ".svg" else "image/webp"
        return Raw(path=str(thumb), mime=mime)
    with open(file, "rb") as handle:
        header = handle.read(64)
    mime = "image/svg+xml" if file.suffix.lower() == ".svg" else ctx.host.detect_image_mime_type(header) or "application/octet-stream"
    return Raw(path=str(file), mime=mime, filename=file.name if ctx.q_bool("download") else None)


@ROUTER.post("/assets/upload", summary="上传图片素材（JSON data URL 或直接发送图片字节），返回可在文档中引用的 /images/ 地址",
             tags=["assets"], body=obj({"dataUrl": STRING, "name": STRING}, ["dataUrl"]), status=201,
             binary_body=IMAGE_TYPES, query=[qp("name", description="Binary uploads: original file name")],
             response=obj({"kind": STRING, "url": STRING, "name": STRING}), body_limit=50 * 1024 * 1024 * 4 // 3 + 65536)
def upload_asset(ctx):
    host = ctx.host
    if ctx.is_binary():
        raw = ctx.raw_body(host.MAX_IMAGE_BYTES)
        try:
            image_type(raw)
        except LibraryError:
            raise ApiError(415, "unsupported_media_type", "Upload a PNG, JPEG, WebP or passive SVG image") from None
        url = host.store_image_bytes(raw, "external-assets")
        name = str(ctx.q("name") or "")[:250]
        mio_foundation.record_asset_origin(host, url, {"kind": "upload", "name": name})
        return {"kind": "image", "url": url, "name": name}
    body = ctx.json(limit=host.MAX_IMAGE_BYTES * 4 // 3 + 65536)
    if not isinstance(body.get("dataUrl"), str) or not body["dataUrl"].startswith("data:"):
        raise ApiError(400, "invalid_field", "dataUrl must be an image data URL")
    return mio_foundation.upload_asset(host, body["dataUrl"], body.get("name", ""))


@ROUTER.post("/assets/fetch", summary="抓取一张远程图片（http/https，≤50 MB）保存为本地素材", tags=["assets"], status=201,
             errors=(502,), body=obj({"url": STRING, "name": STRING}, ["url"]),
             response=obj({"kind": STRING, "url": STRING, "name": STRING, "source": STRING}))
def fetch_asset(ctx):
    body = ctx.json()
    source = body.get("url")
    if not isinstance(source, str) or not source.startswith(("http://", "https://")):
        raise ApiError(400, "invalid_field", "url must be an http(s) image URL")
    try:
        raw, _ = ctx.host.fetch_remote_image(source)
    except (ApiError, ValueError):
        raise
    except Exception as exc:
        if isinstance(exc, ctx.host.PayloadTooLargeError):
            raise
        raise ApiError(502, "upstream_error", "Could not download the image: " + str(exc)[:200]) from None
    try:
        image_type(raw)
    except LibraryError:
        raise ApiError(415, "unsupported_media_type", "The URL did not return a supported image") from None
    url = ctx.host.store_image_bytes(raw, "external-assets")
    name = str(body.get("name") or source.rsplit("/", 1)[-1])[:250]
    mio_foundation.record_asset_origin(ctx.host, url, {"kind": "remote", "url": source[:1000], "name": name})
    return {"kind": "image", "url": url, "name": name, "source": source}


@ROUTER.get("/assets/catalog", summary="素材索引：来源、引用、缺失文件与可清理预览", tags=["assets"],
            query=[qp("verify", "boolean", "Recompute every content hash")])
def asset_catalog(ctx):
    return mio_foundation.asset_catalog(ctx.host, ctx.q_bool("verify"))


@ROUTER.post("/assets/cleanup", summary="把预览过的、24 小时以上未引用的素材移入回收站", tags=["assets"],
             body=obj({"token": STRING, "paths": array(STRING, minItems=1)}, ["token", "paths"]))
def cleanup_assets(ctx):
    return mio_foundation.cleanup(ctx.host, ctx.json())
