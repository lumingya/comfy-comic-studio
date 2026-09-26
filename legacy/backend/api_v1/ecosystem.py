"""Extensions, themes, style workshop, user scripts, preparations and extension backends.

Thin bridge onto ``backend.ecosystem.api``: the same route implementations the studio UI
uses, behind the public token. Installing or enabling code still requires
``trusted: true`` in the body, exactly like the UI's confirmation dialog.
"""

import base64

from backend.api_v1.core import ROUTER, SENT, ApiError, Raw
from backend.api_v1.spec import BOOLEAN, STRING, array, obj, qp

ANY_BODY = {"type": "object"}
DOCUMENTED = [
    # (method, route, summary, body schema)
    ("GET", "status", "生态总览：扩展、主题、样式、脚本、平台清单、安全模式、Node/Git 可用性", None),
    ("GET", "platform", "平台清单：图像服务、导出器、导入器、钩子与事件", None),
    ("GET", "activity", "最近的事件、失败与通知（?since=时间戳）", None),
    ("GET", "watch", "链接目录（开发模式）的变更与修订号", None),
    ("GET", "themes/compiled", "当前主题栈与用户样式编译后的 CSS", None),
    ("GET", "styles", "样式工坊状态：片段、设计令牌、资源", None),
    ("GET", "styles/css", "用户自定义 CSS", None),
    ("GET", "scripts", "用户脚本列表（含源码）", None),
    ("GET", "preparations", "预处理（计算变量宏）列表", None),
    ("POST", "events/emit", "广播一个自定义事件（app.* 除外）", obj({"name": STRING, "payload": ANY_BODY, "source": STRING}, ["name"])),
    ("POST", "extensions/install", "安装扩展（git url / 本地 path / zip base64；需要 trusted: true 才能启用代码）",
     obj({"url": STRING, "branch": STRING, "path": STRING, "zip": {"type": "string", "contentEncoding": "base64"},
          "trusted": BOOLEAN, "enable": BOOLEAN})),
    ("POST", "extensions/enable", "启用或停用扩展（启用需 trusted: true）", obj({"id": STRING, "enabled": BOOLEAN, "trusted": BOOLEAN}, ["id"])),
    ("POST", "extensions/update", "更新扩展（git 安装）", obj({"id": STRING, "trusted": BOOLEAN}, ["id"])),
    ("POST", "extensions/uninstall", "卸载扩展（purge: none / cache / all）", obj({"id": STRING, "purge": {"enum": ["none", "cache", "all"]}}, ["id"])),
    ("POST", "extensions/purge", "清除扩展数据（level: cache / all）", obj({"id": STRING, "level": {"enum": ["cache", "all"]}}, ["id"])),
    ("POST", "extensions/link", "链接本地扩展目录（热重载开发）", obj({"path": STRING, "trusted": BOOLEAN, "enable": BOOLEAN}, ["path"])),
    ("POST", "extensions/reload", "重新加载扩展", obj({"id": STRING}, ["id"])),
    ("POST", "extensions/deps", "安装扩展的 Python 依赖（requirements）", obj({"id": STRING}, ["id"])),
    ("POST", "themes/install", "安装主题包（zip base64）", obj({"data": {"type": "string", "contentEncoding": "base64"}, "filename": STRING,
                                                        "trusted": BOOLEAN, "enable": BOOLEAN}, ["data", "filename"])),
    ("POST", "themes/link", "链接本地主题目录", obj({"path": STRING, "trusted": BOOLEAN, "enable": BOOLEAN}, ["path"])),
    ("POST", "themes/reload", "重新加载主题", obj({"id": STRING}, ["id"])),
    ("POST", "themes/select", "选择唯一主题（空 id 恢复默认）", obj({"id": STRING})),
    ("POST", "themes/enable", "在主题栈中启用或停用一个主题", obj({"id": STRING, "enabled": BOOLEAN}, ["id"])),
    ("POST", "themes/order", "调整主题叠加顺序", obj({"ids": array(STRING)}, ["ids"])),
    ("POST", "themes/settings", "修改主题的可调设置项", obj({"id": STRING, "values": ANY_BODY}, ["id"])),
    ("POST", "themes/uninstall", "卸载主题", obj({"id": STRING}, ["id"])),
    ("POST", "styles/snippet", "保存一个样式片段", obj({"snippet": ANY_BODY})),
    ("POST", "styles/snippets", "替换全部样式片段", obj({"snippets": array(ANY_BODY)}, ["snippets"])),
    ("POST", "styles/snippet/delete", "删除样式片段", obj({"id": STRING}, ["id"])),
    ("POST", "styles/tokens", "设置设计令牌（CSS 变量覆盖）", obj({"tokens": ANY_BODY}, ["tokens"])),
    ("POST", "styles/assets/upload", "上传样式资源（字体、图片；base64）", obj({"name": STRING, "data": {"type": "string", "contentEncoding": "base64"}}, ["name", "data"])),
    ("POST", "styles/assets/delete", "删除样式资源", obj({"name": STRING}, ["name"])),
    ("POST", "styles/export", "把当前样式导出为主题包（返回 zip 文件）", obj({"name": STRING, "assets": BOOLEAN})),
    ("POST", "scripts/save", "保存用户脚本", obj({"id": STRING, "name": STRING, "source": STRING, "enabled": BOOLEAN})),
    ("POST", "scripts/delete", "删除用户脚本", obj({"id": STRING}, ["id"])),
    ("POST", "scripts/order", "调整用户脚本顺序", obj({"ids": array(STRING)}, ["ids"])),
    ("POST", "scripts/toggle", "启用或停用用户脚本", obj({"id": STRING, "enabled": BOOLEAN}, ["id"])),
    ("POST", "preparations", "运行一个预处理（计算变量宏）", ANY_BODY),
    ("POST", "preparations/cancel", "取消正在运行的预处理", obj({"id": STRING}, ["id"])),
    ("POST", "cache/clear", "清除预处理缓存（需 trusted: true）", obj({"trusted": BOOLEAN})),
    ("POST", "reset", "一键恢复：停用全部扩展、主题与脚本（styles: true 同时停用样式片段）", obj({"styles": BOOLEAN})),
]


def service(ctx):
    from backend.ecosystem import api as ecosystem_api

    return ecosystem_api.service(ctx.host)


def request_body(ctx):
    if ctx.http.command in ("GET", "DELETE") and not ctx.header("Content-Length"):
        return {}
    if ctx.is_binary():
        return ctx.raw_body()
    return ctx.json(required=False)


def run(ctx, route):
    from backend.ecosystem import api as ecosystem_api

    svc = service(ctx)
    try:
        result = ecosystem_api._ecosystem_route(svc, ctx.http, route, ctx.http.command, request_body(ctx), ctx.query)
    except KeyError as exc:
        raise ApiError(400, "missing_field", "Missing field: %s" % exc.args[0] if exc.args else "Missing field") from None
    return SENT if result is ecosystem_api._SENT else result


def documented(route):
    return lambda ctx: run(ctx, route)


for _method, _route, _summary, _body in DOCUMENTED:
    ROUTER.add(_method, "/ecosystem/" + _route, summary=_summary, tags=["ecosystem"],
               body=_body, body_required=False, body_limit=64 * 1024 * 1024,
               query=[qp("since", "number", "Only records after this UNIX time")] if _route == "activity" else (),
               operation_id="ecosystem" + "".join(w.capitalize() for w in _route.replace("/", "-").split("-")) + ("" if _method == "POST" else "Read"))(documented(_route))


@ROUTER.get("/ecosystem/scripts/{scriptId}", summary="读取一个用户脚本（含源码）", tags=["ecosystem"],
            params={"scriptId": {"description": "User script ID"}})
def get_script(ctx):
    return run(ctx, "scripts/" + ctx.params["scriptId"])


@ROUTER.get("/ecosystem/preparations/{preparationId}", summary="读取一个预处理的状态与结果", tags=["ecosystem"],
            params={"preparationId": {"description": "Preparation ID"}})
def get_preparation(ctx):
    return run(ctx, "preparations/" + ctx.params["preparationId"])


@ROUTER.get("/ecosystem/themes/css/{themeId}", summary="编译一个主题的 CSS", tags=["ecosystem"],
            params={"themeId": {"description": "Theme ID"}})
def theme_css(ctx):
    return run(ctx, "themes/css/" + ctx.params["themeId"])


def _files(ctx):
    tail = ctx.params.get("path", "")
    return run(ctx, "extensions/" + ctx.params["extensionId"] + "/files" + ("/" + tail if tail else ""))


for _method in ("GET", "PUT", "POST", "DELETE"):
    ROUTER.add(_method, "/ecosystem/extensions/{extensionId}/files/{path:path}",
               summary={"GET": "读取扩展目录中的文件（目录则列出）", "PUT": "写入扩展目录中的文件（二进制或 {b64}/{text}）",
                        "POST": "写入扩展目录中的文件（同 PUT）", "DELETE": "删除扩展目录中的文件"}[_method],
               tags=["ecosystem"], body_limit=64 * 1024 * 1024, binary_body=["application/octet-stream"] if _method in ("PUT", "POST") else None,
               params={"extensionId": {"description": "Extension ID"}, "path": {"description": "Relative file path"}},
               operation_id="ecosystemExtensionFiles" + _method.capitalize())(_files)
ROUTER.get("/ecosystem/extensions/{extensionId}/files", summary="列出扩展目录的文件", tags=["ecosystem"],
           params={"extensionId": {"description": "Extension ID"}}, operation_id="ecosystemExtensionFilesRoot")(_files)


def _fallback(ctx):
    return run(ctx, ctx.params["route"])


for _method in ("GET", "POST", "PUT", "DELETE"):
    ROUTER.add(_method, "/ecosystem/{route:path}", summary="其余生态路由的通用桥接（与界面 /api/ecosystem/* 相同）",
               tags=["ecosystem"], body_limit=64 * 1024 * 1024, params={"route": {"description": "Route below /api/ecosystem/"}},
               operation_id="ecosystemBridge" + _method.capitalize())(_fallback)


# ------------------------------------------------------------------ extension backends

@ROUTER.get("/extensions", summary="已安装的扩展（ID、版本、是否启用、后端能力）", tags=["ecosystem"])
def list_extensions(ctx):
    return service(ctx).plugins.list()


def extension_call(ctx):
    from backend.ecosystem import api as ecosystem_api

    svc = service(ctx)
    extension_id = ctx.params["extensionId"]
    path = "/api/extensions/" + extension_id + "/" + ctx.params["tail"]
    try:
        result = ecosystem_api._extension_route(svc, ctx.host, path, ctx.http.command, request_body(ctx), ctx.query)
    except KeyError as exc:
        raise ApiError(400, "missing_field", "Missing field: %s" % exc.args[0] if exc.args else "Missing field") from None
    raw = svc.plugins.raw_response(extension_id, result)
    if raw:
        return Raw(raw["bytes"], mime=raw["mime"], filename=raw.get("filename"), status=int(raw.get("status", 200)),
                   headers={k: v for k, v in (raw.get("headers") or {}).items()
                            if k.lower() not in ("content-length", "content-type", "transfer-encoding", "set-cookie")})
    if isinstance(result, dict) and result.get("__mio_response__"):
        body = base64.b64decode(result.get("b64", ""), validate=True)
        return Raw(body, mime=result.get("mime") or "application/octet-stream", filename=result.get("filename"),
                   status=int(result.get("status") or 200),
                   headers={k: v for k, v in (result.get("headers") or {}).items()
                            if k.lower() not in ("content-length", "content-type", "transfer-encoding", "set-cookie")})
    return result


for _method in ("GET", "POST", "PUT", "PATCH", "DELETE"):
    ROUTER.add(_method, "/extensions/{extensionId}/{tail:path}",
               summary="调用扩展后端（扩展自定义路由，以及 storage / settings / capabilities / tasks）", tags=["ecosystem"],
               body_limit=64 * 1024 * 1024, binary_body=["application/octet-stream"] if _method in ("POST", "PUT", "PATCH") else None,
               params={"extensionId": {"description": "Enabled extension ID"},
                       "tail": {"description": "Route inside the extension, e.g. storage, settings, tasks, or a custom path"}},
               operation_id="extensionCall" + _method.capitalize())(extension_call)

