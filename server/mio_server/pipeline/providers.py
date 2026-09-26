"""Cloud image channels (出图渠道) beside the default chat-completions image route.

Every channel exposes the same ``generate_image(prompt, refs, models=None, timeout, retries)``
→ ``(bytes, Reply)`` as :class:`llm.Client`, so :class:`pipeline.cloud.CloudRenderer` and the
``cloud.render`` executor work unchanged.  Failures raise :class:`llm.LLMError` with the HTTP
status, which keeps the executor's "definitive 4xx vs uncertain" rule intact.

Kinds (registry point ``cloud_adapter``; extensions can add more):

* ``chat_image`` – the configured LLM proxy (chat completions with image output).
* ``openai_images`` – ``/images/generations``, or ``/images/edits`` when references are given.
* ``novelai`` – ``/ai/generate-image`` (V3 and V4/V4.5 prompt formats, reference images).

These adapters are ports of the legacy ones; they are covered by offline request/response tests
only, not verified against the live services.
"""

from __future__ import annotations

import base64
import io
import random
import re
import time
import zipfile

import httpx
from pydantic import Field

from .. import llm as L
from ..models import StrictModel

NOVELAI_BASE = "https://image.novelai.net"


class ImageChannel(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")
    label: str = ""
    kind: str = Field(
        default="openai_images",
        pattern=r"^[a-z0-9][a-z0-9_.-]{0,47}$",
        description="chat_image | openai_images | novelai | an extension's kind",
    )
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    negative: str = Field(default="", description="Appended as 'Avoid:' / NovelAI negative prompt")
    width: int = Field(default=832, ge=64, le=2048)
    height: int = Field(default=1216, ge=64, le=2048)
    size: str = Field(default="", description="openai_images size, e.g. 1024x1536; '' = default")
    quality: str = ""
    steps: int = Field(default=28, ge=1, le=50)
    scale: float = Field(default=5.0, ge=0, le=20)
    sampler: str = "k_euler_ancestral"
    ref_strength: float = Field(default=0.6, ge=0, le=1)


def _raise_for(resp: httpx.Response, what: str) -> None:
    if resp.status_code < 400:
        return
    detail = resp.text[:300].strip()
    retryable = resp.status_code in (408, 429) or resp.status_code >= 500
    raise L.LLMError(f"{what} HTTP {resp.status_code}：{detail}", resp.status_code, retryable)


class HttpChannel:
    """Shared retry loop; subclasses implement :meth:`_once`."""

    what = "出图"

    def __init__(self, channel: ImageChannel, transport: httpx.BaseTransport | None = None):
        self.channel = channel
        self.transport = transport

    def client(self, timeout: float) -> httpx.Client:
        headers = {"User-Agent": "mio-studio"}
        if self.channel.api_key:
            headers["Authorization"] = f"Bearer {self.channel.api_key}"
        return httpx.Client(timeout=timeout, headers=headers, transport=self.transport)

    def generate_image(self, prompt: str, refs=(), models=None, timeout=360.0, retries=3):
        refs, failures, started = list(refs), [], time.monotonic()
        for attempt in range(max(1, retries)):
            try:
                with self.client(timeout) as http:
                    data = self._once(http, prompt, refs)
                reply = L.Reply("", self.channel.model or self.channel.kind, 0.0)
                reply.seconds = round(time.monotonic() - started, 2)
                reply.attempts = failures
                return data, reply
            except httpx.ConnectError as exc:
                raise L.LLMError(f"{self.what}连接失败：{exc}") from None
            except httpx.TimeoutException:
                raise L.LLMError(f"{self.what}超时（{timeout:.0f}s）", None, True) from None
            except L.LLMError as exc:
                if not exc.retryable or attempt == retries - 1:
                    exc.args = ("；".join([*failures, str(exc)]),)
                    raise
                failures.append(str(exc))
                time.sleep(L.retry_wait(str(exc), attempt))
        raise L.LLMError(f"{self.what}失败")  # pragma: no cover

    def _once(self, http: httpx.Client, prompt: str, refs: list[bytes]) -> bytes:
        raise NotImplementedError


class OpenAIImages(HttpChannel):
    what = "OpenAI 图像接口"

    def _once(self, http, prompt, refs):
        c = self.channel
        base = (c.base_url or "https://api.openai.com/v1").rstrip("/")
        text = prompt + (f"\nAvoid: {c.negative}" if c.negative else "")
        fields = {"model": c.model or "gpt-image-1", "prompt": text, "n": 1}
        if c.size:
            fields["size"] = c.size
        if c.quality:
            fields["quality"] = c.quality
        if refs:
            files = [("image[]", (f"ref{i}.png", _png(r), "image/png")) for i, r in enumerate(refs)]
            form = {k: str(v) for k, v in fields.items()}
            resp = http.post(f"{base}/images/edits", data=form, files=files)
        else:
            resp = http.post(f"{base}/images/generations", json=fields)
        _raise_for(resp, self.what)
        try:
            item = resp.json()["data"][0]
        except (ValueError, KeyError, IndexError, TypeError):
            raise L.LLMError(f"{self.what}返回格式无法识别：{resp.text[:200]}", 200) from None
        if item.get("b64_json"):
            return base64.b64decode(item["b64_json"])
        if item.get("url"):
            got = http.get(item["url"])
            _raise_for(got, "下载图片")
            return got.content
        raise L.LLMError(f"{self.what}没有返回图片", 200)


class NovelAI(HttpChannel):
    what = "NovelAI"

    def is_v4(self) -> bool:
        return bool(re.search(r"diffusion-4", self.channel.model or ""))

    def _once(self, http, prompt, refs):
        c = self.channel
        base = (c.base_url or NOVELAI_BASE).rstrip("/")
        model = c.model or "nai-diffusion-4-5-full"
        prompt = re.sub(r"@image_\d+", "", prompt).strip()
        params = {
            "params_version": 3,
            "width": max(64, round(c.width / 64) * 64),
            "height": max(64, round(c.height / 64) * 64),
            "scale": c.scale,
            "sampler": c.sampler,
            "steps": c.steps,
            "seed": random.randint(0, 2**32 - 1),
            "n_samples": 1,
            "noise_schedule": "karras",
            "negative_prompt": c.negative,
            "ucPreset": 0,
        }
        if self.is_v4():
            params["v4_prompt"] = {
                "caption": {"base_caption": prompt, "char_captions": []},
                "use_coords": False,
                "use_order": True,
            }
            params["v4_negative_prompt"] = {
                "caption": {"base_caption": c.negative, "char_captions": []},
                "legacy_uc": False,
            }
        if refs:
            images = [self._reference(http, base, model, r) for r in refs]
            params["reference_image_multiple"] = images
            params["reference_strength_multiple"] = [c.ref_strength] * len(images)
            if not self.is_v4():
                params["reference_information_extracted_multiple"] = [1.0] * len(images)
        body = {"input": prompt, "model": model, "action": "generate", "parameters": params}
        resp = http.post(f"{base}/ai/generate-image", json=body)
        _raise_for(resp, self.what)
        return _first_image(resp.content)

    def _reference(self, http, base, model, data: bytes) -> str:
        encoded = base64.b64encode(_png(data)).decode()
        if not self.is_v4():
            return encoded
        # V4 takes pre-encoded "vibes" instead of raw images.
        body = {"image": encoded, "information_extracted": 1.0, "model": model}
        resp = http.post(f"{base}/ai/encode-vibe", json=body)
        _raise_for(resp, "NovelAI 参考图编码")
        return base64.b64encode(resp.content).decode()


def _png(data: bytes) -> bytes:
    from PIL import Image

    with Image.open(io.BytesIO(data)) as im:
        im.thumbnail((1536, 1536))
        buf = io.BytesIO()
        im.convert("RGBA" if im.mode in ("RGBA", "LA") else "RGB").save(buf, "PNG")
    return buf.getvalue()


def _first_image(payload: bytes) -> bytes:
    """NovelAI answers with a zip of PNGs (some proxies send the PNG directly)."""
    if payload[:4] == b"\x89PNG" or payload[:3] == b"\xff\xd8\xff":
        return payload
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            name = next(n for n in zf.namelist() if n.lower().endswith((".png", ".jpg", ".webp")))
            return zf.read(name)
    except (zipfile.BadZipFile, StopIteration):
        raise L.LLMError("NovelAI 返回内容不是图片", 200) from None


KINDS = {"openai_images": OpenAIImages, "novelai": NovelAI}


def build(channel: ImageChannel, llm_factory, transport=None, kinds: dict | None = None):
    """Image backend for a channel; ``chat_image`` reuses the configured LLM client.

    ``kinds`` maps kind → class ``(channel, transport)`` (the registry point ``cloud_adapter``).
    """
    if channel.kind == "chat_image":
        client = llm_factory()
        if channel.model:
            original = client.generate_image

            def generate_image(*args, models=None, **kw):
                return original(*args, models=(channel.model,), **kw)

            client.generate_image = generate_image
        return client
    cls = (kinds or KINDS).get(channel.kind)
    if cls is None:
        raise LookupError(f"未知的出图渠道类型：{channel.kind}（扩展未启用？）")
    return cls(channel, transport)
