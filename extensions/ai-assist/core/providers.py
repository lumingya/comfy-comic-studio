"""One-request chat adapters. Conversation storage and tool execution belong to the service.

Messages use Chat Completions roles/content. Opaque provider state must travel with assistant
messages so Gemini signatures and DeepSeek reasoning survive a tool round-trip. This module
never executes tools, follows redirects, fetches remote attachments, or retries a request.
"""

from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable, Mapping
from typing import Any

from mio_server.extensions.public import LLMError, Reply, extract_json, image_part

DEFAULT_BASES = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
}
MAX_RESPONSE = 8 * 1024 * 1024
MAX_IMAGE = 8 * 1024 * 1024
Cancel = Callable[[], bool] | None


def _check_cancel(cancel: Cancel, *, sent: bool) -> None:
    if cancel and cancel():
        raise LLMError("已停止", sent=sent)


def _config(channel: Mapping) -> tuple[str, str, str, float]:
    provider = str(channel.get("provider", "openai"))
    if provider not in DEFAULT_BASES:
        raise LLMError("不支持的 AI 渠道协议", sent=False)
    base = str(channel.get("base_url") or DEFAULT_BASES[provider]).strip().rstrip("/")
    try:
        parsed = urllib.parse.urlsplit(base)
        _ = parsed.port
    except ValueError:
        raise LLMError("API 地址无效", sent=False) from None
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or re.search(r"\s", base)
    ):
        raise LLMError("API 地址需为不含密钥、查询参数的 HTTP(S) 地址", sent=False)
    for suffix in ("/chat/completions", "/models"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break
    if provider == "gemini" and not urllib.parse.urlsplit(base).path:
        base += "/v1beta"
    if provider == "openai" and not urllib.parse.urlsplit(base).path:
        base += "/v1"
    key = str(channel.get("api_key") or "").strip()
    if any(ord(c) < 32 or ord(c) > 126 for c in key):
        raise LLMError("请重新填写渠道密钥", sent=False)
    try:
        timeout = float(channel.get("timeout", 120))
    except (TypeError, ValueError):
        raise LLMError("请求超时设置无效", sent=False) from None
    if not math.isfinite(timeout) or not 1 <= timeout <= 1800:
        raise LLMError("请求超时应在 1–1800 秒之间", sent=False)
    return provider, base, key, timeout


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _request(
    url: str, key: str, provider: str, timeout: float, body: dict | None, cancel: Cancel
) -> dict:
    _check_cancel(cancel, sent=False)
    headers = {"Accept": "application/json"}
    if key:
        headers["x-goog-api-key" if provider == "gemini" else "Authorization"] = (
            key if provider == "gemini" else f"Bearer {key}"
        )
    payload = None
    if body is not None:
        try:
            payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (TypeError, ValueError, UnicodeError):
            raise LLMError("消息或工具参数不是有效 JSON", sent=False) from None
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=payload, headers=headers)
    # No redirect can carry a key or chat body to an unconfigured host.
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=timeout) as response:
            chunks: list[bytes] = []
            size = 0
            deadline = time.monotonic() + timeout
            while True:
                _check_cancel(cancel, sent=True)
                if time.monotonic() > deadline:
                    raise LLMError("AI 请求超时，未自动重试", sent=True)
                chunk = response.read1(64 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_RESPONSE:
                    raise LLMError("AI 回复超过大小限制", sent=True)
                chunks.append(chunk)
            _check_cancel(cancel, sent=True)
    except urllib.error.HTTPError as exc:
        status = exc.code
        exc.close()
        reasons = {
            400: "请检查模型、消息或工具调用是否受支持",
            401: "请检查渠道密钥",
            403: "渠道拒绝访问，请检查密钥权限",
            404: "请检查 API 地址和模型名称",
            413: "消息或附件过大",
            429: "渠道请求受限，请稍后再试",
        }
        reason = (
            "API 地址发生跳转，请填写最终地址"
            if 300 <= status < 400
            else (reasons.get(status, "渠道暂时不可用"))
        )
        # Upstream error bodies may echo secrets, prompts and signed image URLs.
        raise LLMError(
            f"AI 请求失败（HTTP {status}）：{reason}", status=status, sent=True
        ) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise LLMError(
            "无法完成 AI 请求，请检查连接；请求结果未知，未自动重试", sent=None
        ) from None
    try:
        result = json.loads(b"".join(chunks).decode("utf-8-sig"))
    except (UnicodeError, ValueError):
        raise LLMError("AI 渠道返回了无法解析的 JSON", sent=True) from None
    if not isinstance(result, dict):
        raise LLMError("AI 渠道返回格式不正确", sent=True)
    if result.get("error"):
        raise LLMError("AI 渠道返回错误，未自动重试", sent=True)
    return result


def _identity(provider: str, base: str, model: str) -> str:
    return hashlib.sha256(f"{provider}\n{base}\n{model}".encode()).hexdigest()


def _image(url: str) -> tuple[str, str]:
    found = re.fullmatch(r"data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)", url)
    if not found or len(found[2]) > MAX_IMAGE * 4 // 3 + 4:
        raise LLMError("图片必须是已上传的 PNG、JPEG、WebP 或 GIF", sent=False)
    try:
        if len(base64.b64decode(found[2], validate=True)) > MAX_IMAGE:
            raise ValueError
    except (ValueError, binascii.Error):
        raise LLMError("图片数据无效或超过大小限制", sent=False) from None
    return found[1], found[2]


def _content(value: Any, *, gemini: bool = False) -> str | list[dict]:
    if value is None:
        return [] if gemini else ""
    if isinstance(value, str):
        return [{"text": value}] if gemini else value
    if not isinstance(value, list):
        raise LLMError("消息内容格式不正确", sent=False)
    parts = []
    for part in value:
        if not isinstance(part, dict):
            raise LLMError("消息内容格式不正确", sent=False)
        if part.get("type") == "text":
            text = str(part.get("text", ""))
            parts.append({"text": text} if gemini else {"type": "text", "text": text})
        elif part.get("type") == "image_url":
            source = part.get("image_url")
            url = source.get("url", "") if isinstance(source, dict) else ""
            mime, encoded = _image(url)
            parts.append(
                {"inlineData": {"mimeType": mime, "data": encoded}}
                if gemini
                else {"type": "image_url", "image_url": {"url": url}}
            )
        else:
            raise LLMError("此消息附件类型暂不支持", sent=False)
    return parts


def _arguments(value: Any, *, sent: bool) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value or "{}")
        except ValueError:
            raise LLMError("AI 返回的工具参数不是有效 JSON，未执行工具", sent=sent) from None
    if not isinstance(value, dict):
        raise LLMError("工具参数必须是 JSON 对象，未执行工具", sent=sent)
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError):
        raise LLMError("工具参数包含无效值，未执行工具", sent=sent) from None
    return value


def _calls(values: Any, *, sent: bool) -> list[dict]:
    if values is None:
        return []
    if not isinstance(values, list) or len(values) > 64:
        raise LLMError("AI 返回的工具调用格式不正确", sent=sent)
    result = []
    ids: set[str] = set()
    for value in values:
        if not isinstance(value, dict):
            raise LLMError("AI 返回的工具调用格式不正确", sent=sent)
        fn = value.get("function", value)
        if not isinstance(fn, dict) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,128}", str(fn.get("name", ""))
        ):
            raise LLMError("AI 返回的工具名称无效", sent=sent)
        call_id = value.get("id") or f"call_{uuid.uuid4().hex}"
        if not isinstance(call_id, str) or len(call_id) > 256 or call_id in ids:
            raise LLMError("AI 返回了重复或无效的工具调用编号", sent=sent)
        ids.add(call_id)
        result.append(
            {
                "id": call_id,
                "name": fn["name"],
                "arguments": _arguments(fn.get("arguments", {}), sent=sent),
            }
        )
    return result


def _openai_messages(messages: list[dict], identity: str, provider: str) -> list[dict]:
    result = []
    for msg in messages:
        role = msg.get("role")
        if role not in {"system", "developer", "user", "assistant", "tool"}:
            raise LLMError("消息角色无效", sent=False)
        item = {"role": role, "content": _content(msg.get("content"))}
        if role == "assistant":
            calls = _calls(msg.get("tool_calls"), sent=False)
            if calls:
                item["tool_calls"] = [
                    {
                        "id": c["id"],
                        "type": "function",
                        "function": {
                            "name": c["name"],
                            "arguments": json.dumps(c["arguments"], ensure_ascii=False),
                        },
                    }
                    for c in calls
                ]
            state = msg.get("provider_state") or {}
            if provider == "deepseek" and state.get("identity") == identity:
                if isinstance(state.get("reasoning_content"), str):
                    item["reasoning_content"] = state["reasoning_content"]
        elif role == "tool":
            if not msg.get("tool_call_id"):
                raise LLMError("工具回复缺少调用编号", sent=False)
            item["tool_call_id"] = msg["tool_call_id"]
        result.append(item)
    return result


def _gemini_messages(messages: list[dict], identity: str) -> dict:
    contents: list[dict] = []
    system: list[dict] = []
    calls: dict[str, dict] = {}
    for msg in messages:
        role = msg.get("role")
        if role in {"system", "developer"}:
            parts = _content(msg.get("content"), gemini=True)
            if any("text" not in p for p in parts):
                raise LLMError("系统消息只支持文字", sent=False)
            system.extend(parts)
            continue
        if role == "tool":
            call = calls.get(msg.get("tool_call_id"))
            if not call:
                raise LLMError("工具回复没有匹配的调用", sent=False)
            raw = msg.get("content", "")
            try:
                payload = json.loads(raw) if isinstance(raw, str) else raw
            except ValueError:
                payload = raw
            response = {
                "name": call["name"],
                "response": payload if isinstance(payload, dict) else {"result": payload},
            }
            if call.get("remote_id"):
                response["id"] = call["remote_id"]
            parts = [{"functionResponse": response}]
            # Parallel function results belong to one user turn, in their original order.
            if (
                contents
                and contents[-1]["role"] == "user"
                and all("functionResponse" in p for p in contents[-1]["parts"])
            ):
                contents[-1]["parts"].extend(parts)
            else:
                contents.append({"role": "user", "parts": parts})
            continue
        if role not in {"assistant", "user"}:
            raise LLMError("消息角色无效", sent=False)
        state = msg.get("provider_state") or {}
        saved = state.get("parts") if state.get("identity") == identity else None
        parts = (
            copy.deepcopy(saved)
            if role == "assistant" and isinstance(saved, list)
            else _content(msg.get("content"), gemini=True)
        )
        if role == "assistant":
            local_calls = _calls(msg.get("tool_calls"), sent=False)
            remote_calls = [p["functionCall"] for p in parts if "functionCall" in p]
            for i, call in enumerate(local_calls):
                remote = remote_calls[i] if i < len(remote_calls) else None
                calls[call["id"]] = {
                    "name": call["name"],
                    "remote_id": remote.get("id") if remote else None,
                }
                if remote is None:
                    parts.append(
                        {"functionCall": {"name": call["name"], "args": call["arguments"]}}
                    )
        if parts:
            contents.append({"role": "model" if role == "assistant" else "user", "parts": parts})
    body: dict = {"contents": contents}
    if system:
        body["systemInstruction"] = {"parts": system}
    return body


def _text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(p.get("text", "")) for p in content if isinstance(p, dict) and not p.get("thought")
        )
    raise LLMError("AI 回复内容格式不正确", sent=True)


def chat(
    channel: Mapping, messages: list[dict], tools: list[dict], *, cancel: Cancel = None
) -> dict:
    """Return visible content, normalized tool calls and private continuation state."""
    provider, base, key, timeout = _config(channel)
    model = str(channel.get("model") or "").strip()
    if not model:
        raise LLMError("请先选择 AI 模型", sent=False)
    identity = _identity(provider, base, model)
    if provider == "gemini":
        body = _gemini_messages(messages, identity)
        if tools:
            declarations = []
            for tool in tools:
                fn = tool.get("function", tool)
                declarations.append(
                    {
                        "name": fn["name"],
                        "description": fn.get("description", ""),
                        "parametersJsonSchema": fn.get(
                            "parameters", {"type": "object", "properties": {}}
                        ),
                    }
                )
            body["tools"] = [{"functionDeclarations": declarations}]
        resource = urllib.parse.quote(model.removeprefix("models/"), safe="")
        reply = _request(
            f"{base}/models/{resource}:generateContent", key, provider, timeout, body, cancel
        )
        candidates = reply.get("candidates") or []
        if (
            not isinstance(candidates, list)
            or not candidates
            or not isinstance(candidates[0], dict)
        ):
            raise LLMError("Gemini 没有返回可用内容，请检查模型或内容限制", sent=True)
        candidate = candidates[0]
        if candidate.get("finishReason") not in {None, "STOP"}:
            raise LLMError("Gemini 回复未完整结束，未执行工具", sent=True)
        content = candidate.get("content")
        if not isinstance(content, dict):
            raise LLMError("Gemini 回复格式不正确", sent=True)
        parts = content.get("parts") or []
        if not isinstance(parts, list) or any(not isinstance(p, dict) for p in parts):
            raise LLMError("Gemini 回复格式不正确", sent=True)
        raw_calls = []
        for part in parts:
            if "functionCall" in part:
                fn = part["functionCall"]
                if not isinstance(fn, dict):
                    raise LLMError("Gemini 工具调用格式不正确", sent=True)
                raw_calls.append(
                    {"id": fn.get("id"), "name": fn.get("name"), "arguments": fn.get("args", {})}
                )
        result = {
            "content": _text(parts),
            "tool_calls": _calls(raw_calls, sent=True),
            "provider_state": {"identity": identity, "parts": parts},
        }
    else:
        body = {
            "model": model,
            "messages": _openai_messages(messages, identity, provider),
            "stream": False,
        }
        if tools:
            body["tools"] = tools
        reply = _request(f"{base}/chat/completions", key, provider, timeout, body, cancel)
        choices = reply.get("choices") or []
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise LLMError("AI 渠道没有返回回复", sent=True)
        choice = choices[0]
        if choice.get("finish_reason") not in {None, "stop", "tool_calls"}:
            raise LLMError("AI 回复未完整结束，未执行工具", sent=True)
        message = choice.get("message")
        if not isinstance(message, dict):
            raise LLMError("AI 回复格式不正确", sent=True)
        result = {
            "content": _text(message.get("content")),
            "tool_calls": _calls(message.get("tool_calls"), sent=True),
        }
        if provider == "deepseek" and isinstance(message.get("reasoning_content"), str):
            result["provider_state"] = {
                "identity": identity,
                "reasoning_content": message["reasoning_content"],
            }
    if not result["content"] and not result["tool_calls"]:
        raise LLMError("AI 返回了空回复", sent=True)
    _check_cancel(cancel, sent=True)
    return result


def discover_models(channel: Mapping, *, cancel: Cancel = None) -> list[dict]:
    """Fetch the catalog without a billable chat request; pagination never follows remote URLs."""
    provider, base, key, timeout = _config(channel)
    items: dict[str, dict] = {}
    cursor = ""
    visited: set[str] = set()
    for _ in range(50):
        params = {"pageSize": "1000"} if provider == "gemini" else {}
        if cursor:
            params["pageToken" if provider == "gemini" else "after"] = cursor
        query = "?" + urllib.parse.urlencode(params) if params else ""
        reply = _request(f"{base}/models{query}", key, provider, timeout, None, cancel)
        values = reply.get("models" if provider == "gemini" else "data")
        if not isinstance(values, list):
            raise LLMError("渠道未返回模型目录，可手动填写模型 ID", sent=True)
        for item in values:
            if not isinstance(item, dict):
                continue
            if provider == "gemini":
                methods = item.get("supportedGenerationMethods", ["generateContent"])
                if not isinstance(methods, list) or "generateContent" not in methods:
                    continue
                model_id = str(item.get("name") or "").removeprefix("models/")
            else:
                model_id = str(item.get("id") or "")
            if model_id:
                items[model_id] = {
                    "id": model_id,
                    "name": str(item.get("displayName") or item.get("name") or model_id),
                }
        if len(items) > 10000:
            raise LLMError("渠道模型目录过大，请手动填写模型 ID", sent=True)
        cursor = (
            str(reply.get("nextPageToken") or "")
            if provider == "gemini"
            else (
                str(
                    reply.get("last_id")
                    or (values[-1].get("id") if values and isinstance(values[-1], dict) else "")
                )
                if reply.get("has_more")
                else ""
            )
        )
        if not cursor:
            return sorted(items.values(), key=lambda x: x["id"].casefold())
        if cursor in visited:
            raise LLMError("渠道模型目录分页重复，请手动填写模型 ID", sent=True)
        visited.add(cursor)
    raise LLMError("渠道模型目录分页过多，请手动填写模型 ID", sent=True)


class Client:
    """Bridge structured script/vision helpers to the extension's selected channel."""

    def __init__(self, channel: Mapping):
        self.channel = dict(channel)

    def chat_json(self, messages, models=None, validate=None, repairs=0, timeout=None):
        channel = {**self.channel, **({"timeout": timeout} if timeout is not None else {})}
        started = time.monotonic()
        response = chat(channel, messages, [])
        data = extract_json(response["content"])
        if validate and list(validate(data)):
            raise LLMError("AI JSON 回复未通过格式校验，未自动重试", sent=True)
        return data, Reply(response["content"], channel["model"], time.monotonic() - started)

    def vision_json(self, prompt, images, models=None, timeout=None):
        parts = [{"type": "text", "text": prompt}] + [
            image_part(image, max_side=896) for image in images
        ]
        return self.chat_json([{"role": "user", "content": parts}], timeout=timeout)
