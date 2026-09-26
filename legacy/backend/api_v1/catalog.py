"""Compact read-only views for bots: pick a workflow / storyboard / preset / layout / channel by number.

Full documents and every write operation live under ``/library``; these views stay
small and stable on purpose.
"""

from backend.api_v1.core import ROUTER, ApiError, asset_endpoint
from backend.api_v1.spec import INTEGER, NUMBER, STRING, array, obj, page_of, qp, schema


RESOURCE_KINDS = ("workflows", "characters", "scenes", "presets", "layouts", "channels", "collections")


def read_config(host):
    store = host.native_store()
    with host.CONFIG_LOCK:
        return store, store.read(album_summaries=True)


def _preset_view(item, category=None):
    entries = []
    for entry in item.get("entries", []) if isinstance(item.get("entries"), list) else []:
        if not isinstance(entry, dict):
            continue
        value = entry.get("value")
        if isinstance(value, str) and value.startswith("data:"):
            value = "[image]"
        entries.append({"key": entry.get("key"), "type": entry.get("type", "text"),
                        "value": value if isinstance(value, (str, int, float, bool)) or value is None else str(value)})
    return {"id": item.get("id"), "title": item.get("title", ""), "projectId": item.get("projectId"),
            "category": category or ("scenes" if item.get("category") == "scenes" else "characters"),
            "entries": entries, "updatedAt": item.get("updatedAt")}


def workflows(config):
    items = []
    for wf in config.get("comfyWorkflows", []) or []:
        if not isinstance(wf, dict):
            continue
        graph = wf.get("workflow") if isinstance(wf.get("workflow"), dict) else {}
        classes = sorted({str(n.get("class_type")) for n in graph.values() if isinstance(n, dict) and n.get("class_type")})
        items.append({"id": wf.get("id"), "title": wf.get("title", ""), "outputNodeId": wf.get("outputNodeId", ""),
                      "nodeCount": len(graph), "bindingCount": len(wf.get("bindings") or []),
                      "classTypes": classes[:40], "updatedAt": wf.get("updatedAt")})
    return items


def storyboards(config):
    items = []
    for sb in config.get("templates", []) or []:
        if not isinstance(sb, dict):
            continue
        frames = sb.get("frames") if isinstance(sb.get("frames"), list) else []
        items.append({"id": sb.get("id"), "title": sb.get("title", ""), "projectId": sb.get("projectId"),
                      "outline": sb.get("outline") or sb.get("description") or "", "frameCount": len(frames),
                      "frames": [{k: f.get(k) for k in ("id", "name", "camera", "prompt", "caption", "width", "height") if k in f}
                                 for f in frames if isinstance(f, dict)],
                      "updatedAt": sb.get("updatedAt")})
    return items


def presets(config, category=None):
    items = []
    for item in config.get("uiConfig", {}).get("comfyStudio", {}).get("creation", {}).get("variableSets", []) or []:
        if not isinstance(item, dict):
            continue
        cat = "scenes" if item.get("category") == "scenes" else "characters"
        if category and cat != category:
            continue
        items.append(_preset_view(item, cat))
    return items


def layouts(config):
    items = []
    for t in config.get("uiConfig", {}).get("comfyStudio", {}).get("exportTemplates", []) or []:
        if not isinstance(t, dict) or not isinstance(t.get("layout"), str):
            continue
        items.append({"id": t.get("id"), "title": t.get("title", ""), "description": t.get("description", ""),
                      "layout": t.get("layout"), "author": t.get("author", ""), "version": t.get("version", ""),
                      "builtin": bool(t.get("builtin")),
                      "options": t.get("options") if isinstance(t.get("options"), dict) else {},
                      "updatedAt": t.get("updatedAt")})
    return items


def channels(config):
    profiles = config.get("uiConfig", {}).get("comfyStudio", {}).get("settings", {}).get("imageGeneration", {}).get("profiles", []) or []
    return [{**{k: p.get(k) for k in ("id", "title", "provider", "model", "protocol", "keyMode", "size", "quality", "sampler") if k in p},
             "usesWorkflow": p.get("provider") == "comfyui"} for p in profiles if isinstance(p, dict)]


def collections(config):
    return [{"id": c.get("id"), "title": c.get("title", ""), "description": c.get("description", "")}
            for c in config.get("uiConfig", {}).get("comfyStudio", {}).get("projects", []) or [] if isinstance(c, dict)]


def catalog(config):
    return {"workflows": workflows(config), "storyboards": storyboards(config), "presets": presets(config),
            "layouts": layouts(config), "channels": channels(config), "collections": collections(config),
            "comfyBaseUrl": (config.get("comfyConfig") or {}).get("baseUrl", ""), "revision": config.get("updatedAt")}


FRAME_FIELDS = ("id", "name", "prompt", "negative", "caption", "camera", "width", "height", "steps", "cfg", "seed", "denoise")
ALBUM_FIELDS = ("id", "title", "projectId", "status", "totalSteps", "generatedSteps", "liked", "tags", "createdAt", "updatedAt", "completedAt")


def storyboard_dto(item):
    obj_ = {key: item[key] for key in ("id", "title", "description", "outline", "projectId", "updatedAt") if key in item}
    # Execution snapshots (_execution, nodeOverrides, workflow) never cross this boundary.
    obj_["frames"] = [{key: f[key] for key in FRAME_FIELDS if key in f} for f in item.get("frames", []) if isinstance(f, dict)]
    return obj_


def album_summary_dto(item):
    obj_ = {key: item[key] for key in ALBUM_FIELDS if key in item}
    cover = item.get("_cover") or item.get("cover")
    if isinstance(cover, str) and cover.startswith("/images/"):
        obj_["cover"] = cover
    if isinstance(item.get("_missingIndices"), list):
        obj_["missingIndices"] = item["_missingIndices"]
    return obj_


def _listing(ctx, source, mapper):
    limit, offset = ctx.page(50, 100)
    query = (ctx.q("q") or "").strip().lower()
    project = ctx.q("projectId")
    items = [item for item in source if isinstance(item, dict)]
    if project:
        items = [item for item in items if item.get("projectId") == project]
    if query:
        items = [item for item in items if query in str(item.get("title", "")).lower() or query in str(item.get("id", "")).lower()]
    return {"items": [mapper(item) for item in items[offset:offset + limit]], "total": len(items), "limit": limit, "offset": offset}


PAGE_QUERY = [qp("limit", "integer", "1..100, default 50", minimum=1, maximum=100),
              qp("offset", "integer", "default 0", minimum=0),
              qp("projectId", description="Only items of this collection"),
              qp("q", description="Case-insensitive title/ID filter")]

STORYBOARD = schema("StoryboardView", obj({
    "id": STRING, "title": STRING, "projectId": STRING, "description": STRING, "outline": STRING,
    "frames": array(obj({**{k: STRING for k in ("id", "name", "prompt", "negative", "caption", "camera")},
                         **{k: NUMBER for k in ("width", "height", "steps", "cfg", "seed", "denoise")}}))}))
ALBUM = schema("AlbumSummary", obj({
    "id": STRING, "title": STRING, "projectId": STRING, "status": STRING, "totalSteps": INTEGER,
    "generatedSteps": INTEGER, "cover": STRING, "missingIndices": array(INTEGER), "updatedAt": NUMBER}))


@ROUTER.get("/storyboards", summary="分镜列表（含分幕的公开字段，不含执行快照）", tags=["catalog"],
            query=PAGE_QUERY, response=page_of(STORYBOARD))
def list_storyboards(ctx):
    _, config = read_config(ctx.host)
    return _listing(ctx, config.get("templates", []), storyboard_dto)


@ROUTER.get("/albums", summary="画册列表（状态、进度、封面）", tags=["catalog", "albums"],
            query=PAGE_QUERY, response=page_of(ALBUM))
def list_albums(ctx):
    _, config = read_config(ctx.host)
    return _listing(ctx, config.get("savedGalleries", []), album_summary_dto)


@ROUTER.get("/catalog", summary="一次返回工作流、分镜、预设、版式、渠道和画册集的精简目录", tags=["catalog"])
def get_catalog(ctx):
    _, config = read_config(ctx.host)
    return catalog(config)


def _resource_view(kind):
    def handler(ctx):
        _, config = read_config(ctx.host)
        if kind == "workflows":
            items = workflows(config)
        elif kind in ("characters", "scenes"):
            items = presets(config, kind)
        elif kind == "presets":
            items = presets(config)
        elif kind == "layouts":
            items = layouts(config)
        elif kind == "channels":
            items = channels(config)
        else:
            items = collections(config)
        return {"items": items, "total": len(items), "revision": config.get("updatedAt")}

    return handler


_SUMMARIES = {"workflows": "已保存的 ComfyUI 工作流（不含节点图）", "characters": "角色预设（精简）",
              "scenes": "场景预设（精简）", "presets": "角色与场景预设（带 category）",
              "layouts": "画册导出版式（不含 HTML）", "channels": "图像渠道（不含密钥与地址）",
              "collections": "画册集（项目）"}
for _kind in RESOURCE_KINDS:
    ROUTER.get("/resources/" + _kind, summary=_SUMMARIES[_kind], tags=["catalog"],
               operation_id="getResources" + _kind.capitalize())(_resource_view(_kind))


def album_detail(store, album_id):
    document = store.entity("albums", album_id)["document"]
    steps = []
    for step in document.get("steps", []) if isinstance(document.get("steps"), list) else []:
        if not isinstance(step, dict):
            continue
        image = step.get("image") if isinstance(step.get("image"), str) else ""
        steps.append({**{k: step.get(k) for k in ("stepIndex", "name", "caption", "prompt", "width", "height", "seed") if k in step},
                      "image": image, "assetEndpoint": asset_endpoint(image)})
    return {**{k: document.get(k) for k in ("id", "projectId", "title", "characterName", "templateId", "templateTitle",
                                             "synopsis", "tags", "totalSteps", "generatedSteps", "status", "liked",
                                             "createdAt", "updatedAt", "completedAt") if k in document},
            "steps": steps}


def unknown(message="Unknown resource"):
    return ApiError(404, "not_found", message)
