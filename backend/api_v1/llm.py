"""Text model and vision critic, sent from the server with the saved connections.

Clients never handle model keys: the scope selects which saved connection (and key)
the server uses, following the studio's own "shared connection" switches.
"""

import copy
import urllib.error
import urllib.parse

from backend.api_v1.common import read_path
from backend.api_v1.core import ROUTER, ApiError, asset_endpoint, emit
from backend.api_v1.spec import BOOLEAN, NUMBER, STRING, array, obj

SCOPES = ("llm", "xml", "critic")
PASSTHROUGH = ("temperature", "max_tokens", "top_p", "response_format", "tools", "tool_choice", "seed", "stop",
               "presence_penalty", "frequency_penalty", "n", "user")
CRITIQUE = obj({"score": NUMBER, "passed": BOOLEAN, "summary": STRING, "consistency": STRING, "anatomy": STRING,
                "scene": STRING, "suggestions": STRING})


def effective_scope(host, scope):
    """xml without `separate` and critic with `connection: shared` use the llm connection."""
    if scope not in SCOPES:
        raise ApiError(400, "invalid_scope", "scope must be llm, xml or critic")
    store = host.native_store()
    if scope == "xml" and not store.settings.get("xml")["document"].get("separate"):
        return "llm"
    if scope == "critic":
        critic = read_path(store.settings.get("workspace")["document"], "ui", "comfyStudio", "settings", "critic", default={})
        if isinstance(critic, dict) and critic.get("connection") == "shared":
            return "llm"
    return scope


def saved_connection(host, scope):
    """Backend-only: the resolved connection including its key. Never return it."""
    store = host.native_store()
    if scope == "critic":
        config = read_path(store.settings.resolve("workspace"), "ui", "comfyStudio", "settings", "critic", default={})
    else:
        config = store.settings.resolve(scope)
    if not isinstance(config, dict) or not str(config.get("baseUrl") or "").strip():
        raise ApiError(409, "llm_not_configured", "Save a model endpoint for this scope first (PUT /settings/…)")
    return config


def check_endpoint(base):
    from backend.mio_credentials import is_private_host

    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password \
            or parsed.query or parsed.fragment:
        raise ApiError(400, "invalid_endpoint", "Invalid model endpoint")
    if parsed.scheme == "http" and not is_private_host(parsed.hostname):
        raise ApiError(400, "invalid_endpoint", "Remote model endpoints require HTTPS")


def upstream(exc, key=""):
    if isinstance(exc, urllib.error.HTTPError):
        try:
            exc.close()
        except Exception:
            pass
        return ApiError(502, "upstream_error", "The model endpoint returned HTTP %d; no automatic retry" % exc.code,
                        details={"upstreamStatus": exc.code})
    message = str(exc)[:300]
    if key:
        message = message.replace(key, "[REDACTED]")
    return ApiError(502, "upstream_error", message or "The model endpoint did not answer; no automatic retry")


@ROUTER.post("/llm/chat", summary="用已保存的文本模型连接发送对话（OpenAI 兼容 chat/completions）", tags=["llm"],
             errors=(502,), body_limit=20 * 1024 * 1024,
             body=obj({"scope": {"enum": list(SCOPES), "default": "llm"},
                       "messages": array({"type": "object"}, minItems=1), "model": STRING,
                       **{k: {} for k in PASSTHROUGH}}, ["messages"]),
             response=obj({"content": STRING, "message": {"type": "object"}, "model": STRING, "usage": {"type": "object"},
                           "scope": STRING, "raw": {"type": "object"}}))
def chat(ctx):
    body = ctx.json()
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages or any(not isinstance(m, dict) for m in messages):
        raise ApiError(400, "invalid_field", "messages must be a non-empty array of message objects")
    scope = effective_scope(ctx.host, body.get("scope", "llm"))
    config = saved_connection(ctx.host, scope)
    request = {"model": body.get("model") or config.get("model") or "", "messages": copy.deepcopy(messages)}
    request.update({k: copy.deepcopy(body[k]) for k in PASSTHROUGH if k in body})
    base = str(config.get("baseUrl")).rstrip("/")
    try:
        response = ctx.host.chat_proxy({"scope": scope, "baseUrl": base, "body": request})
    except (ApiError, ValueError):
        raise
    except Exception as exc:
        raise upstream(exc, str(config.get("key") or "")) from None
    choice = (response.get("choices") or [{}])[0] if isinstance(response, dict) else {}
    message = choice.get("message") if isinstance(choice, dict) else {}
    content = message.get("content") if isinstance(message, dict) else None
    return {"scope": scope, "model": response.get("model", request["model"]) if isinstance(response, dict) else request["model"],
            "content": content if isinstance(content, str) else "", "message": message or {},
            "usage": response.get("usage", {}) if isinstance(response, dict) else {}, "raw": response}


def audit(ctx, image, prompt_text=None, model=None):
    scope = effective_scope(ctx.host, "critic")
    config = saved_connection(ctx.host, scope)
    base = str(config.get("baseUrl")).rstrip("/")
    check_endpoint(base)
    if not isinstance(image, str) or not image:
        raise ApiError(400, "invalid_field", "image must be a local /images/ URL or an image data URL")
    if image.startswith("/images/"):
        try:
            image = ctx.host.image_url_to_data_url(image)
        except (ValueError, OSError):
            raise ApiError(404, "asset_not_found", "Local asset not found") from None
    elif not image.startswith("data:image/"):
        raise ApiError(400, "invalid_field", "image must be a local /images/ URL or an image data URL")
    payload = {"baseUrl": base, "apiKey": str(config.get("key") or ""), "model": model or config.get("model") or "",
               "promptText": prompt_text or None, "imageDataUrl": image}
    try:
        return ctx.service("handle_vision_audit")(payload)
    except (ApiError, ValueError):
        raise
    except Exception as exc:
        raise upstream(exc, payload["apiKey"]) from None


@ROUTER.post("/vision/audit", summary="视觉审图：用已保存的审图模型评估一张图（分数、一致性、解剖、建议）", tags=["llm"],
             errors=(502,), body_limit=50 * 1024 * 1024 * 4 // 3 + 65536,
             body=obj({"image": {"type": "string", "description": "/images/... URL or data:image/... URL"},
                       "promptText": STRING, "model": STRING}, ["image"]), response=CRITIQUE)
def vision_audit(ctx):
    body = ctx.json(limit=ctx.host.MAX_IMAGE_BYTES * 4 // 3 + 65536)
    return audit(ctx, body.get("image"), body.get("promptText"), body.get("model"))


@ROUTER.post("/albums/{albumId}/steps/{index}/critique", summary="审查画册某一页并把审图结果保存到这一页", tags=["llm", "albums"],
             params={"albumId": {"description": "Album ID"}, "index": {"schema": {"type": "integer", "minimum": 0}}},
             body=obj({"promptText": STRING, "model": STRING, "save": {"type": "boolean", "default": True}}),
             body_required=False, errors=(502,), response=obj({"critique": CRITIQUE, "etag": STRING}))
def critique_step(ctx):
    from backend.api_v1.parts import mutate, step_index
    from backend.api_v1.library import read_entity

    body = ctx.json(required=False)
    index = step_index(ctx)
    record = read_entity(ctx.host, "albums", ctx.params["albumId"])
    step = next((s for s in record["document"].get("steps", []) if isinstance(s, dict) and s.get("stepIndex") == index), None)
    if step is None or not step.get("image"):
        raise ApiError(404, "step_not_found", "This page has no picture to review")
    prompt = body.get("promptText") or "请审查该漫画分镜的画质、一致性与肢体结构。分镜台词：%s；提示词：%s" % (
        step.get("caption", ""), step.get("prompt", ""))
    critique = audit(ctx, step["image"], prompt, body.get("model"))
    if body.get("save", True) is False:
        return {"critique": critique, "etag": record["etag"], "assetEndpoint": asset_endpoint(step["image"])}

    def change(document):
        target = next(s for s in document.get("steps", []) if isinstance(s, dict) and s.get("stepIndex") == index)
        target["critique"] = critique

    payload, _ = mutate(ctx, "albums", ctx.params["albumId"], change)
    emit(ctx.host, "album.saved", {"id": ctx.params["albumId"], "critique": index})
    return {"critique": critique, "etag": payload["etag"]}
