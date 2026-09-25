"""Local image assets: read (data URL), upload, catalog and cleanup."""

import urllib.parse

from backend import mio_foundation
from backend.api_v1.core import ROUTER, ApiError
from backend.api_v1.spec import STRING, array, obj, qp


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


@ROUTER.post("/assets/upload", summary="上传图片素材（data URL），返回可在文档中引用的 /images/ 地址", tags=["assets"],
             body=obj({"dataUrl": STRING, "name": STRING}, ["dataUrl"]), status=201,
             response=obj({"kind": STRING, "url": STRING, "name": STRING}), body_limit=50 * 1024 * 1024 * 4 // 3 + 65536)
def upload_asset(ctx):
    body = ctx.json(limit=ctx.host.MAX_IMAGE_BYTES * 4 // 3 + 65536)
    if not isinstance(body.get("dataUrl"), str) or not body["dataUrl"].startswith("data:"):
        raise ApiError(400, "invalid_field", "dataUrl must be an image data URL")
    return mio_foundation.upload_asset(ctx.host, body["dataUrl"], body.get("name", ""))


@ROUTER.get("/assets/catalog", summary="素材索引：来源、引用、缺失文件与可清理预览", tags=["assets"],
            query=[qp("verify", "boolean", "Recompute every content hash")])
def asset_catalog(ctx):
    return mio_foundation.asset_catalog(ctx.host, ctx.q_bool("verify"))


@ROUTER.post("/assets/cleanup", summary="把预览过的、24 小时以上未引用的素材移入回收站", tags=["assets"],
             body=obj({"token": STRING, "paths": array(STRING, minItems=1)}, ["token", "paths"]))
def cleanup_assets(ctx):
    return mio_foundation.cleanup(ctx.host, ctx.json())
