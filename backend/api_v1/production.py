"""Production (assembly) queue: storyboard + presets + channel/workflow -> an album.

Action-style routes (``POST /production/<action>``) accept the same bodies as the
studio UI and support batches via ``ids``; task-scoped REST aliases are provided for
the common single-task operations.
"""

import hashlib
import json
import time

from backend.api_v1.core import ROUTER, ApiError, Raw, Reply, merge_patch
from backend.api_v1.spec import BOOLEAN, INTEGER, STRING, array, obj, qp, schema
from backend.production import api as production_api

TASK_ID = {"taskId": {"description": "Production task ID"}}
IDS = {"id": STRING, "ids": array(STRING)}
PRESET_REF = obj({"kind": {"enum": ["characters", "scenes"]}, "id": STRING}, ["kind", "id"])
ASSEMBLE = schema("AssembleRequest", obj({
    "storyId": {"type": "string", "description": "Storyboard ID (required unless preview is true)"},
    "presets": array(PRESET_REF, maxItems=20, description="Character / scene presets, later ones override earlier ones"),
    "channelId": {"type": "string", "description": "Saved image channel (see /channels)"},
    "workflowId": {"type": "string", "description": "ComfyUI workflow for workflow channels; default = active workflow"},
    "title": STRING, "requestId": {"type": "string", "description": "Idempotency token: repeating a requestId returns the same task (generated when omitted)"},
    "projectId": STRING, "seedEnabled": BOOLEAN,
    "seed": {"type": "integer", "minimum": 0, "maximum": 4294967295},
    "concurrency": {"type": ["integer", "null"], "minimum": 1, "maximum": 16},
    "overrides": {"type": "object", "description": "Task-level model / LoRA overrides validated against the workflow slots"},
    "preview": {"type": "boolean", "description": "One-frame preset test render instead of a storyboard"},
    "previewPrompt": STRING}, ["channelId"]))
TASK = schema("ProductionTask", obj({
    "id": STRING, "title": STRING, "status": STRING, "error": {}, "pages": array({"type": "object"}),
    "paused": BOOLEAN, "albumId": STRING, "createdAt": {"type": "number"}, "updatedAt": {"type": "number"}}))

ACTION_DOCS = {
    "assemble": ("装配一个生产任务（分镜 + 预设 + 渠道/工作流 → 画册）", ASSEMBLE),
    "assemble-batch": ("批量装配多个任务", obj({"items": array(ASSEMBLE, minItems=1)}, ["items"])),
    "start": ("开始任务（付费渠道需 trusted: true）", obj({
        "id": STRING, "trusted": BOOLEAN, "sequential": BOOLEAN, "indices": array(INTEGER),
        "forcePrepare": BOOLEAN, "confirmUncertain": BOOLEAN,
        "concurrency": {"type": ["integer", "null"], "minimum": 1, "maximum": 16}}, ["id"])),
    "start-many": ("并行开始多个任务", obj({"ids": array(STRING), "trusted": BOOLEAN, "confirmUncertain": BOOLEAN}, ["ids"])),
    "start-sequence": ("按顺序依次执行多个任务", obj({"ids": array(STRING), "trusted": BOOLEAN, "confirmUncertain": BOOLEAN}, ["ids"])),
    "pause": ("暂停任务（id 或 ids）", obj(IDS)),
    "resume": ("继续任务（id 或 ids）", obj(IDS)),
    "cancel": ("停止任务（id 或 ids）；在途请求的结果仍会保留", obj(IDS)),
    "remove": ("删除任务；deleteAlbums: true 时连同生成的画册一起删除", obj({**IDS, "deleteAlbums": BOOLEAN})),
    "clone": ("克隆任务（可调整模型 / LoRA / 种子等）", obj({
        "id": STRING, "title": STRING, "concurrency": {}, "adjustments": {"type": "object"}}, ["id"])),
    "reorder": ("调整队列顺序", obj({"order": array(STRING)}, ["order"])),
    "clear-finished": ("清除已完成的任务", obj({})),
    "concurrency": ("设置全局或单任务并发", obj({"value": {"type": ["integer", "null"]}, "id": STRING}, ["value"])),
    "live-sync": ("设置实时同步（任务运行中跟随分镜 / 预设 / 工作流修改）", obj({
        "story": BOOLEAN, "presets": BOOLEAN, "workflow": BOOLEAN})),
    "rename": ("重命名任务", obj({"id": STRING, "title": STRING}, ["id", "title"])),
    "update-frame": ("修改任务内某一幕的名称 / 提示词 / 负向 / 台词", obj({
        "id": STRING, "index": INTEGER, "name": STRING, "prompt": STRING, "negative": STRING, "caption": STRING},
        ["id", "index"])),
    "recover-publication": ("重新发布已生成但未写入画册的一页", obj({"id": STRING, "index": INTEGER}, ["id", "index"])),
    "analyze-slots": ("分析 ComfyUI 工作流的可调槽位（模型、LoRA、尺寸…）", obj({
        "workflow": {"type": "object"}, "objectInfo": {"type": "object"}, "manual": {}, "slots": {}}, ["workflow"])),
    "apply-slots": ("把槽位覆盖应用到 ComfyUI 工作流，返回新工作流", obj({
        "workflow": {"type": "object"}, "slots": {}, "overrides": {"type": "object"}, "objectInfo": {"type": "object"}}, ["workflow"])),
}


def with_request_ids(action, body):
    """Assembly is idempotent per requestId; generate one when the client does not care."""
    import uuid

    if action == "assemble" and not body.get("requestId"):
        body = {**body, "requestId": "api-" + uuid.uuid4().hex}
    if action == "assemble-batch" and isinstance(body.get("items"), list):
        body = {**body, "items": [{**item, "requestId": item.get("requestId") or "api-" + uuid.uuid4().hex}
                                  if isinstance(item, dict) else item for item in body["items"]]}
    return body


def _etag(value):
    return '"' + hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest() + '"'


@ROUTER.get("/production/tasks", summary="生产队列：全部任务、控制状态（支持 If-None-Match → 304）", tags=["production"])
def list_tasks(ctx):
    result = production_api.list_tasks(ctx.host)
    etag = _etag(result)
    if ctx.header("If-None-Match") == etag:
        return Raw(b"", status=304, headers={"ETag": etag})
    result["serverEpochMs"] = round(time.time() * 1000)
    return Reply(result, headers={"ETag": etag})


@ROUTER.post("/production/tasks", summary="装配一个生产任务（同 POST /production/assemble）", tags=["production"],
             body=ASSEMBLE, status=201, operation_id="createProductionTask")
def create_task(ctx):
    return production_api.run_action(ctx.host, "assemble", with_request_ids("assemble", ctx.json()))


@ROUTER.get("/production/tasks/{taskId}", summary="任务详情：状态、逐页状态、画册 ID", tags=["production"],
            params=TASK_ID, response=TASK)
def get_task(ctx):
    return production_api.read_task(ctx.host, ctx.params["taskId"])


@ROUTER.delete("/production/tasks/{taskId}", summary="删除任务（?deleteAlbums=true 连同画册）", tags=["production"],
               params=TASK_ID, query=[qp("deleteAlbums", "boolean", "Also delete the album the task produced")])
def delete_task(ctx):
    return production_api.run_action(ctx.host, "remove", {"id": ctx.params["taskId"], "deleteAlbums": ctx.q_bool("deleteAlbums")})


@ROUTER.get("/production/tasks/{taskId}/clone-source", summary="克隆任务时可调整的来源参数", tags=["production"], params=TASK_ID)
def clone_source(ctx):
    return production_api.read_task(ctx.host, ctx.params["taskId"] + "/clone-source")


@ROUTER.get("/production/tasks/{taskId}/frames/{index}", summary="任务内某一幕的来源与当前状态", tags=["production"],
            params={**TASK_ID, "index": {"schema": {"type": "integer", "minimum": 0}, "description": "Zero-based frame index"}})
def frame_source(ctx):
    return production_api.read_task(ctx.host, ctx.params["taskId"] + "/frames/" + ctx.params["index"])


@ROUTER.patch("/production/tasks/{taskId}/frames/{index}", summary="修改任务内某一幕（name / prompt / negative / caption）",
              tags=["production"], operation_id="patchProductionFrame",
              params={**TASK_ID, "index": {"schema": {"type": "integer", "minimum": 0}}},
              body=obj({"name": STRING, "prompt": STRING, "negative": STRING, "caption": STRING}))
def patch_frame(ctx):
    if not ctx.params["index"].isdigit():
        raise ApiError(400, "invalid_index", "index must be a non-negative integer")
    body = {k: v for k, v in ctx.json().items() if k in ("name", "prompt", "negative", "caption")}
    return production_api.run_action(ctx.host, "update-frame", {**body, "id": ctx.params["taskId"], "index": int(ctx.params["index"])})


def _task_action(action):
    def handler(ctx):
        body = merge_patch(ctx.json(required=False), {"id": ctx.params["taskId"]})
        return production_api.run_action(ctx.host, action, body)

    return handler


for _action in ("start", "pause", "resume", "cancel", "clone", "rename"):
    _summary, _body = ACTION_DOCS[_action]
    _task_body = {k: v for k, v in _body.items()}
    if "properties" in _task_body:
        _task_body = {**_task_body, "properties": {k: v for k, v in _task_body["properties"].items() if k not in ("id", "ids")},
                      "required": [r for r in _task_body.get("required", []) if r != "id"]}
        if not _task_body["required"]:
            _task_body.pop("required")
    ROUTER.post("/production/tasks/{taskId}/" + _action, summary=_summary + "（单任务）", tags=["production"],
                params=TASK_ID, body=_task_body, body_required=False,
                operation_id="productionTask" + _action.capitalize())(_task_action(_action))


def _action_route(action):
    def handler(ctx):
        return production_api.run_action(ctx.host, action, with_request_ids(action, ctx.json(required=False)))

    return handler


for _action, (_summary, _body) in ACTION_DOCS.items():
    ROUTER.post("/production/" + _action, summary=_summary, tags=["production"] + (["workflows"] if "slots" in _action else []),
                body=_body, body_required=_action not in ("clear-finished",),
                body_limit=production_api.BODY_LIMITS.get(_action, 2 * 1024 * 1024),
                operation_id="production" + "".join(w.capitalize() for w in _action.split("-")))(_action_route(_action))
