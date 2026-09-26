"""Storyboard marketplace: catalogue, remote fetch and installation into the library."""

import copy

from backend.api_v1.core import ROUTER, ApiError
from backend.api_v1.library import put_document
from backend.api_v1.spec import STRING, array, obj


def to_storyboard(data, title=None):
    """Accept the marketplace format ({title, desc, steps}) or a storyboard document ({frames})."""
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_body", "Marketplace data must be an object")
    source = data.get("frames") if isinstance(data.get("frames"), list) else data.get("steps")
    if not isinstance(source, list) or not source:
        raise ApiError(400, "invalid_body", "The storyboard has no frames/steps")
    frames = []
    for step in source[:512]:
        if not isinstance(step, dict):
            continue
        frame = {k: copy.deepcopy(v) for k, v in step.items() if k not in ("id",)}
        for key in ("name", "prompt", "caption", "negative"):
            if key in frame and not isinstance(frame[key], str):
                frame[key] = str(frame[key])
        frames.append(frame)
    return {"title": str(title or data.get("title") or "市场分镜")[:500],
            "outline": str(data.get("desc") or data.get("outline") or data.get("description") or ""),
            "frames": frames}


@ROUTER.get("/marketplace", summary="分镜市场目录（本地缓存或内置目录）", tags=["marketplace"],
            response=obj({"version": STRING, "storyboards": array({"type": "object"})}))
def catalog(ctx):
    return ctx.service("get_marketplace_catalog")()


@ROUTER.post("/marketplace/fetch", summary="抓取远程 JSON（http/https，≤5 MB），例如社区分享的分镜", tags=["marketplace"],
             errors=(502,), body=obj({"url": STRING}, ["url"]))
def fetch(ctx):
    url = (ctx.json().get("url") or "").strip()
    try:
        return ctx.service("fetch_remote_json")(url)
    except (ApiError, ValueError):
        raise
    except Exception as exc:
        if isinstance(exc, ctx.host.PayloadTooLargeError):
            raise
        raise ApiError(502, "upstream_error", "Could not fetch the URL: " + str(exc)[:200]) from None


@ROUTER.post("/marketplace/install", summary="把市场分镜安装到文件库（按目录 id、远程 url 或直接给 data）", tags=["marketplace"],
             status=201, errors=(502,),
             body=obj({"id": {"type": "string", "description": "Catalogue item ID"},
                       "url": {"type": "string", "description": "Remote JSON to fetch and install"},
                       "data": {"type": "object", "description": "{title, desc, steps:[{name,prompt,caption}]} or {title, frames}"},
                       "title": STRING, "projectId": STRING}))
def install(ctx):
    body = ctx.json()
    if body.get("data") is not None:
        data = body["data"]
    elif body.get("url"):
        data = fetch(ctx)
        if isinstance(data, dict) and isinstance(data.get("data"), dict):
            data = data["data"]
    elif body.get("id"):
        items = ctx.service("get_marketplace_catalog")().get("storyboards", [])
        item = next((i for i in items if isinstance(i, dict) and i.get("id") == body["id"]), None)
        if item is None:
            raise ApiError(404, "not_found", "No marketplace item with this ID")
        data = item.get("data")
    else:
        raise ApiError(400, "invalid_body", "Send id, url or data")
    document = to_storyboard(data, body.get("title"))
    if body.get("projectId"):
        document["projectId"] = body["projectId"]
    payload = put_document(ctx.host, "storyboards", document, create=True)
    payload.pop("created", None)
    return payload
