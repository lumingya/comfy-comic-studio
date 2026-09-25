"""Update center: status, check, apply, rollback and restart.

Applying, rolling back and restarting change the running program, so the public API
requires ``confirm: true`` for them.
"""

from backend import mio_update
from backend.api_v1.core import ROUTER, ApiError, Reply
from backend.api_v1.spec import BOOLEAN, STRING, obj

CONFIRM = {"type": "boolean", "description": "Must be true"}


def confirmed(body):
    if body.get("confirm") is not True:
        raise ApiError(403, "confirmation_required", "This operation changes the running program; send {\"confirm\": true}")


def service(ctx):
    return mio_update.service(ctx.host)


@ROUTER.get("/update/status", summary="当前版本、更新通道、正在进行的更新与可回滚版本", tags=["update"])
def status(ctx):
    return service(ctx).status()


@ROUTER.post("/update/check", summary="检查新版本（prerelease 可选）", tags=["update"], errors=(502,),
             body=obj({"prerelease": BOOLEAN}), body_required=False)
def check(ctx):
    prerelease = ctx.json(required=False).get("prerelease")
    return service(ctx).check(None if prerelease is None else bool(prerelease))


@ROUTER.post("/update/apply", summary="下载并应用指定版本（后台进行，返回 202）", tags=["update"], status=202,
             body=obj({"version": STRING, "confirm": CONFIRM}, ["version", "confirm"]))
def apply(ctx):
    body = ctx.json()
    confirmed(body)
    if not isinstance(body.get("version"), str) or not body["version"].strip():
        raise ApiError(400, "invalid_field", "version is required")
    return service(ctx).start(body["version"].strip())


@ROUTER.post("/update/rollback", summary="回滚到上一个版本", tags=["update"], body=obj({"confirm": CONFIRM}, ["confirm"]))
def rollback(ctx):
    confirmed(ctx.json())
    return service(ctx).rollback()


@ROUTER.post("/update/restart", summary="重启服务（应用更新后使用）", tags=["update"], body=obj({"confirm": CONFIRM}, ["confirm"]))
def restart(ctx):
    confirmed(ctx.json())
    svc = service(ctx)
    svc.request_restart()
    return Reply({"restarting": True, "current": mio_update.current_version(svc.base_dir)})
