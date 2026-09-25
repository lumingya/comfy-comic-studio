"""Recycle bin and asset maintenance. Permanent deletion requires ``confirm: true``."""

from backend import mio_assets, mio_recycle
from backend.api_v1.core import ROUTER, ApiError, emit
from backend.api_v1.spec import BOOLEAN, INTEGER, NUMBER, STRING, array, obj, qp

CONFIRM = {"type": "boolean", "description": "Must be true: permanent deletion cannot be undone"}
ITEM = obj({"trashId": STRING, "kind": STRING, "id": STRING, "title": STRING, "original": STRING, "deletedAt": INTEGER,
            "bytes": INTEGER, "conflict": {"type": "string", "description": "'' when restorable; missing / path / id / invalid"}})


def confirmed(body):
    if body.get("confirm") is not True and body.get("trusted") is not True:
        raise ApiError(403, "confirmation_required", "Permanent deletion needs {\"confirm\": true}")


@ROUTER.get("/recycle", summary="回收站：可恢复的资源、素材批次和文件批次（新的在前）", tags=["recycle"],
            query=[qp("all", "boolean", "Include internal kinds (tasks, rows, conversations …)")],
            response=obj({"items": array(ITEM), "hidden": {"type": "object"}, "assets": array({"type": "object"}),
                          "files": array({"type": "object"}), "retentionDays": array(INTEGER)}))
def list_recycle(ctx):
    return mio_recycle.list_items(ctx.host.DATA_DIR, ctx.store.library, ctx.q_bool("all"))


@ROUTER.post("/recycle/restore", summary="恢复：trashId（资源、assets:批次、files:批次）或 {kind, id} 的最新一次删除",
             tags=["recycle"], body=obj({"trashId": STRING, "kind": STRING, "id": STRING}))
def restore(ctx):
    body = ctx.json()
    if not body.get("trashId") and not (body.get("kind") and body.get("id")):
        raise ApiError(400, "invalid_body", "Send trashId, or kind and id")
    result = mio_recycle.restore_target(ctx.host, body)
    restored = result.get("restored") if isinstance(result, dict) else None
    if isinstance(restored, dict) and restored.get("kind"):
        emit(ctx.host, "library.saved", {"kind": restored.get("kind"), "id": restored.get("id"), "restored": True})
    return result


@ROUTER.post("/recycle/purge", summary="永久删除回收站中的一项", tags=["recycle"],
             body=obj({"trashId": STRING, "confirm": CONFIRM}, ["trashId", "confirm"]))
def purge(ctx):
    body = ctx.json()
    confirmed(body)
    with ctx.host.CONFIG_LOCK:
        return mio_recycle.purge(ctx.host.DATA_DIR, body.get("trashId"))


@ROUTER.post("/recycle/empty", summary="清空回收站（不可撤销）", tags=["recycle"], body=obj({"confirm": CONFIRM}, ["confirm"]))
def empty(ctx):
    confirmed(ctx.json())
    with ctx.host.CONFIG_LOCK:
        return mio_recycle.empty(ctx.host.DATA_DIR)


@ROUTER.post("/recycle/auto-clean", summary="按保留天数清理（0 / 7 / 30 / 90；0 表示不清理）", tags=["recycle"],
             body=obj({"retentionDays": {"enum": list(mio_recycle.RETENTION_DAYS)}}, ["retentionDays"]))
def auto_clean(ctx):
    with ctx.host.CONFIG_LOCK:
        return mio_recycle.auto_purge(ctx.host.DATA_DIR, ctx.json().get("retentionDays", mio_recycle.DEFAULT_RETENTION))


# ------------------------------------------------------------------ asset maintenance

def grace(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 24 * 365:
        raise ApiError(400, "invalid_field", "graceHours must be a number between 0 and 8760")
    return float(value)


@ROUTER.get("/maintenance/assets", summary="素材池体检：未被引用的文件、缺失引用、可回收预览（含 token）", tags=["assets"],
            query=[qp("graceHours", "number", "Only files older than this are collectable (default 24)", minimum=0)])
def asset_inventory(ctx):
    return mio_assets.inventory(ctx.host.DATA_DIR, ctx.q_float("graceHours", mio_assets.GRACE_HOURS, 0, 24 * 365))


@ROUTER.post("/maintenance/assets/gc", summary="回收未引用素材：apply=false 预览，apply=true 按预览 token 移入回收站",
             tags=["assets"], body=obj({"apply": BOOLEAN, "token": STRING, "graceHours": NUMBER}))
def asset_gc(ctx):
    from backend.production import api as production_api

    body = ctx.json(required=False)
    hours = grace(body.get("graceHours", mio_assets.GRACE_HOURS))
    if body.get("apply") is True:
        busy = production_api.service(ctx.host).production.busy
        return mio_assets.collect(ctx.host.DATA_DIR, body.get("token"), hours, busy)
    return mio_assets.inventory(ctx.host.DATA_DIR, hours)


@ROUTER.post("/maintenance/assets/restore", summary="恢复一批回收的素材", tags=["assets"],
             body=obj({"batch": STRING}, ["batch"]))
def asset_restore(ctx):
    return mio_assets.restore(ctx.host.DATA_DIR, ctx.json().get("batch"))


@ROUTER.post("/maintenance/trash/purge", summary="永久删除超过指定天数的回收素材", tags=["assets", "recycle"],
             body=obj({"olderThanDays": {"type": "integer", "minimum": 0, "default": 30}, "confirm": CONFIRM}, ["confirm"]))
def trash_purge(ctx):
    body = ctx.json()
    confirmed(body)
    days = body.get("olderThanDays", 30)
    if type(days) is not int or days < 0:
        raise ApiError(400, "invalid_field", "olderThanDays must be a non-negative integer")
    return mio_assets.purge_trash(ctx.host.DATA_DIR, days)
