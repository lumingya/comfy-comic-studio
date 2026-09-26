"""Workspace status, whole-workspace snapshot, shipped content and the active selections."""

import copy

from backend.api_v1.common import active_project_id, channel_state, mutate_settings, settings_doc
from backend.api_v1.core import ROUTER, ApiError
from backend.api_v1.spec import BOOLEAN, INTEGER, STRING, obj
from backend.mio_library import KINDS


def strip_refs(value):
    if isinstance(value, dict):
        return {k: strip_refs(v) for k, v in value.items() if k != "_secretRefs"}
    if isinstance(value, list):
        return [strip_refs(v) for v in value]
    return value


@ROUTER.get("/workspace", summary="工作区状态：版本、修订号、当前画册集 / 渠道 / 工作流、各类资源数量、文件问题",
            tags=["workspace"], response=obj({
                "appVersion": STRING, "apiVersion": STRING, "revision": INTEGER, "dataDir": STRING,
                "activeProjectId": STRING, "activeChannelId": STRING, "activeWorkflowId": STRING,
                "counts": {"type": "object"}, "problems": INTEGER, "safeMode": BOOLEAN, "index": {"type": "object"}}))
def status(ctx):
    from backend.api_v1.library import deleted_albums
    from backend.api_v1.spec import VERSION
    from backend.api_v1.system import app_version
    from backend.ecosystem.api import safe_mode

    store = ctx.store
    store.wait_index()
    hidden = deleted_albums(ctx.host)
    counts = {kind: len([r for r in store.records(kind) if kind != "albums" or r["id"] not in hidden]) for kind in KINDS}
    comfy, _ = settings_doc(ctx.host, "comfy")
    _, active_channel = channel_state(ctx.host)
    return {"appVersion": app_version(ctx.host), "apiVersion": VERSION, "revision": store.revision(),
            "dataDir": str(ctx.host.DATA_DIR), "activeProjectId": active_project_id(ctx.host),
            "activeChannelId": active_channel, "activeWorkflowId": comfy.get("activeWorkflowId") or "",
            "counts": counts, "problems": len(store.library.problems()), "safeMode": safe_mode(),
            "index": dict(store.library.scan_state)}


@ROUTER.get("/workspace/snapshot", summary="完整工作区快照（与界面启动时读取的结构相同；不含任何密钥；结构随版本变化）",
            tags=["workspace"])
def snapshot(ctx):
    return strip_refs(ctx.host.read_merged_config())


@ROUTER.get("/workspace/content", summary="随程序附带的内容：画册版式模板、阅读样式、示例素材目录", tags=["workspace"])
def content(ctx):
    from backend import mio_lifecycle
    from backend.mio_content import bootstrap

    value = bootstrap(ctx.service("content_store")())
    value["config"] = mio_lifecycle.filter_deleted(value["config"], ctx.host.DATA_DIR)
    return strip_refs(value)


@ROUTER.put("/workspace/active-collection", summary="切换当前画册集（新建资源默认归入当前画册集）", tags=["workspace"],
            body=obj({"id": STRING}, ["id"]), response=obj({"activeProjectId": STRING}))
def set_active_collection(ctx):
    collection = ctx.json().get("id")
    if not isinstance(collection, str) or collection not in {r["id"] for r in ctx.store.records("collections")}:
        raise ApiError(404, "unknown_collection", "No collection with this ID")

    def change(document):
        document.setdefault("ui", {}).setdefault("comfyStudio", {})["activeProjectId"] = collection
        return collection

    value, _ = mutate_settings(ctx.host, "workspace", change)
    return {"activeProjectId": value}


# ------------------------------------------------------------------ workflows

WORKFLOW = {"id": {"description": "Workflow ID (see /library/workflows)"}}


@ROUTER.post("/library/workflows/{id}/activate", summary="设为当前 ComfyUI 工作流", tags=["workflows"], params=WORKFLOW,
             response=obj({"activeWorkflowId": STRING}))
def activate_workflow(ctx):
    from backend.api_v1.library import read_entity

    workflow_id = ctx.params["id"]
    read_entity(ctx.host, "workflows", workflow_id)

    def change(document):
        document["activeWorkflowId"] = workflow_id
        return workflow_id

    value, _ = mutate_settings(ctx.host, "comfy", change)
    return {"activeWorkflowId": value}


@ROUTER.post("/library/workflows/{id}/analyze", summary="分析已保存工作流的可调槽位（模型、LoRA、尺寸、种子…）",
             tags=["workflows"], params=WORKFLOW, body_required=False,
             body=obj({"objectInfo": {"type": "object", "description": "ComfyUI /object_info (see GET /comfy/object-info)"},
                       "manual": {}}), body_limit=64 * 1024 * 1024)
def analyze_workflow(ctx):
    from backend.api_v1.library import read_entity
    from backend.production import api as production_api

    body = ctx.json(required=False)
    document = read_entity(ctx.host, "workflows", ctx.params["id"])["document"]
    graph = document.get("workflow")
    if not isinstance(graph, dict) or not graph:
        raise ApiError(409, "invalid_document", "This workflow has no ComfyUI API graph")
    return production_api.analyze_slots({"workflow": copy.deepcopy(graph), "objectInfo": body.get("objectInfo"),
                                         "manual": body.get("manual"), "slots": document.get("slots")})
