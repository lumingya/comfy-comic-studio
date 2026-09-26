"""OpenAI-compatible client for the local reverse proxy: text, vision and image generation.

Image generation goes through ``/chat/completions`` as well: the proxy answers with markdown
``![...](url)`` and/or ``message.images[].image_url.url`` (short-lived presigned URLs), so the
bytes are downloaded immediately. Every call tries its model list in order (fallbacks).
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

DEFAULT_BASE = os.environ.get("MIO_LLM_BASE", "http://127.0.0.1:5104/v1")
TEXT_MODELS = ("gemini-3.7-flash", "gpt-5.2")
VISION_MODELS = ("qwen3-vl-235b-a22b-instruct", "gemini-3.7-flash")
IMAGE_SINGLE = ("gpt-image-2.5-flare", "gpt-image-2")  # text-only or one reference image
IMAGE_MULTI = ("max",)                                 # several reference images


class LLMError(RuntimeError):
    pass


@dataclass
class Reply:
    text: str
    model: str
    seconds: float
    images: list[str] = field(default_factory=list)
    attempts: list[str] = field(default_factory=list)  # failures before this reply


def image_part(data: bytes, max_side: int = 1024, quality: int = 88) -> dict:
    """Image content part as a JPEG data URI, downscaled to keep requests small."""
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=quality)
        data, mime = buf.getvalue(), "image/jpeg"
    except Exception:  # Pillow missing or unreadable data: send as-is
        mime = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}}


def content_text(message: dict) -> str:
    content = message.get("content") or ""
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return str(content)


def image_urls(message: dict) -> list[str]:
    urls = []
    for item in message.get("images") or []:
        if isinstance(item, dict):
            urls.append((item.get("image_url") or {}).get("url") or item.get("url"))
    urls += re.findall(r"!\[[^\]]*\]\((\S+?)\)", content_text(message))
    out = []
    for url in urls:
        if url and url not in out:
            out.append(url)
    return out


def extract_json(text: str):
    """Parse JSON from a reply: plain, fenced (```json ... ```), or embedded in prose."""
    s = (text or "").strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", s, re.S)
    if fenced:
        s = fenced.group(1).strip()
    try:
        return json.loads(s)
    except ValueError:
        pass
    decoder = json.JSONDecoder()
    for i, ch in enumerate(s):
        if ch in "{[":
            try:
                return decoder.raw_decode(s, i)[0]
            except ValueError:
                continue
    raise LLMError("回复里没有可解析的 JSON")


class Client:
    def __init__(self, base_url: str = DEFAULT_BASE, timeout: float = 240.0, retries: int = 1):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.retries = retries

    def _post(self, path: str, payload: dict, timeout: float | None) -> dict:
        req = urllib.request.Request(self.base_url + path, data=json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")[:300]
            raise LLMError(f"HTTP {exc.code}: {body}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise LLMError(f"连接失败：{getattr(exc, 'reason', exc)}") from None
        except ValueError:
            raise LLMError("返回的不是 JSON") from None

    def chat(self, messages: list, models=TEXT_MODELS, json_mode: bool = False,
             temperature: float | None = None, timeout: float | None = None, need_image: bool = False) -> Reply:
        failures = []
        for model in models:
            for _ in range(self.retries + 1):
                payload = {"model": model, "messages": messages, "stream": False}
                if json_mode:
                    payload["response_format"] = {"type": "json_object"}
                if temperature is not None:
                    payload["temperature"] = temperature
                started = time.monotonic()
                try:
                    data = self._post("/chat/completions", payload, timeout)
                    if data.get("error"):
                        raise LLMError(str(data["error"])[:300])
                    message = data["choices"][0]["message"]
                    reply = Reply(content_text(message), data.get("model") or model,
                                  time.monotonic() - started, image_urls(message), list(failures))
                    if need_image and not reply.images:
                        raise LLMError(f"没有返回图片：{reply.text[:160]}")
                    if not need_image and not reply.text.strip():
                        raise LLMError("空回复")
                    return reply
                except (LLMError, KeyError, IndexError, TypeError) as exc:
                    failures.append(f"{model}: {exc}")
        raise LLMError("全部模型失败：" + "；".join(failures))

    def chat_json(self, messages: list, models=TEXT_MODELS, validate=None, repairs: int = 1,
                  timeout: float | None = None):
        """JSON reply, validated; on problems the model gets them back ``repairs`` times."""
        history = list(messages)
        for round_ in range(repairs + 1):
            reply = self.chat(history, models, json_mode=True, timeout=timeout)
            try:
                data = extract_json(reply.text)
                problems = list(validate(data)) if validate else []
            except LLMError as exc:
                data, problems = None, [str(exc)]
            if not problems:
                return data, reply
            if round_ < repairs:
                history += [{"role": "assistant", "content": reply.text},
                            {"role": "user", "content": "上面的 JSON 有以下问题，请全部修正，只输出完整的 JSON：\n- "
                             + "\n- ".join(problems[:40])}]
        raise LLMError("JSON 校验未通过：" + "；".join(problems[:12]))

    def vision_json(self, prompt: str, images: list[bytes], models=VISION_MODELS, timeout: float | None = None):
        content = [{"type": "text", "text": prompt}] + [image_part(img, max_side=896) for img in images]
        reply = self.chat([{"role": "user", "content": content}], models, timeout=timeout)
        return extract_json(reply.text), reply

    def generate_image(self, prompt: str, refs: list[bytes] = (), models=None, timeout: float = 360.0):
        """Returns ``(image_bytes, reply)``. Several refs go to a multi-reference model."""
        refs = list(refs)
        models = models or ((IMAGE_MULTI + IMAGE_SINGLE) if len(refs) > 1 else IMAGE_SINGLE)
        failures = []
        for model in models:
            use = refs if model in IMAGE_MULTI else refs[:1]
            content = [{"type": "text", "text": prompt}] + [image_part(r, max_side=1024) for r in use]
            try:
                reply = self.chat([{"role": "user", "content": content if use else prompt}], (model,),
                                  timeout=timeout, need_image=True)
                reply.attempts = failures + reply.attempts
                return self.download(reply.images[0]), reply
            except LLMError as exc:
                failures.append(str(exc))
        raise LLMError("出图失败：" + "；".join(failures))

    @staticmethod
    def download(url: str) -> bytes:
        if url.startswith("data:"):
            return base64.b64decode(url.split(",", 1)[1])
        req = urllib.request.Request(url, headers={"User-Agent": "mio-next"})
        last = None
        for _ in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    return resp.read()
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last = exc
                time.sleep(2)
        raise LLMError(f"下载图片失败：{last}")
