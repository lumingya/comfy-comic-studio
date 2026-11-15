"""Read-only model discovery for unsaved settings, without invoking a generation adapter.

The public operation is also an extension seam: an operation wrapper may supply a catalog for
its own channel kind. A successful catalog lists candidates, not promised model capabilities.
"""

from __future__ import annotations

from typing import Literal

import httpx
from pydantic import Field

from .api_urls import normalize_base
from .comfy.diagnostics import MODEL_FILE, _allowed
from .llm import LLMError
from .models import StrictModel
from .settings import MASK, AppSettings

MAX_RESPONSE = 32 * 1024 * 1024
OPENAI_KINDS = {"openai", "openai_images", "chat_image"}
MODEL_INPUTS = {
    "ckpt_name": "checkpoints",
    "unet_name": "diffusion_models",
    "diffusion_model": "diffusion_models",
    "lora_name": "loras",
    "vae_name": "vae",
    "clip_name": "text_encoders",
    "clip_name1": "text_encoders",
    "clip_name2": "text_encoders",
    "clip_name3": "text_encoders",
    "control_net_name": "controlnet",
}
# Deliberately a reference list for the V3/V4 adapter, not a claimed live account catalog.
NOVELAI_MODELS = (
    ("nai-diffusion-4-5-full", "NovelAI Diffusion V4.5 Full"),
    ("nai-diffusion-4-5-curated", "NovelAI Diffusion V4.5 Curated"),
    ("nai-diffusion-4-full", "NovelAI Diffusion V4 Full"),
    ("nai-diffusion-4-curated-preview", "NovelAI Diffusion V4 Curated"),
    ("nai-diffusion-3", "NovelAI Diffusion V3"),
)


class ModelCatalogRequest(StrictModel):
    kind: str = Field(default="openai", pattern=r"^[a-z0-9][a-z0-9_.-]{0,47}$")
    base_url: str = Field(default="", max_length=2048)
    api_key: str = Field(default="", max_length=8192, repr=False)
    channel_id: str = Field(default="", max_length=32)


class CatalogModel(StrictModel):
    id: str
    name: str = ""
    group: str = ""


class ModelCatalog(StrictModel):
    models: list[CatalogModel] = Field(default_factory=list)
    source: Literal["remote", "bundled"] = "remote"
    notice: str = ""


def _connection(body: ModelCatalogRequest, settings: AppSettings) -> tuple[str, str]:
    shared = settings.llm
    stored = next((c for c in settings.image_channels if c.id == body.channel_id), None)
    kind = body.kind
    inherited = kind == "chat_image" and not body.base_url.strip()
    base = body.base_url.strip()
    if inherited:
        base = shared.base_url
    elif not base and kind == "openai_images":
        base = "https://api.openai.com/v1"
    base = normalize_base(base, openai=kind in OPENAI_KINDS)
    key = body.api_key.strip()
    if key == MASK:
        if kind == "openai":
            old_base, old_key = shared.base_url, shared.api_key
        elif stored is not None and stored.kind == kind:
            old_base, old_key = stored.base_url.strip(), stored.api_key
            if not old_base and kind == "chat_image":
                old_base = shared.base_url
            elif not old_base and kind == "openai_images":
                old_base = "https://api.openai.com/v1"
        else:
            raise ValueError("找不到原渠道的密钥，请重新填写或清除密钥后重试")
        if normalize_base(old_base, openai=kind in OPENAI_KINDS) != base:
            raise ValueError("API 地址已改变，请重新填写或清除密钥后获取模型")
        key = old_key
    elif MASK in key:
        raise ValueError("密钥包含保存占位符，请重新填写完整密钥")
    if inherited and not key:
        key = shared.api_key
    return base, key


def _get_json(url: str, key: str, transport: httpx.BaseTransport | None = None):
    headers = {"Accept": "application/json", "User-Agent": "mio-studio"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        # Never follow an upstream redirect carrying a stored credential to another origin.
        with httpx.Client(timeout=30, transport=transport, follow_redirects=False) as client:
            with client.stream("GET", url, headers=headers) as response:
                code = response.status_code
                if code in (401, 403):
                    raise LLMError("模型目录访问被拒绝，请检查 API 密钥与账户权限", code)
                if code in (404, 405):
                    raise LLMError(
                        "服务未提供模型目录，请检查 API 地址；也可以继续手动填写模型 ID", code
                    )
                if 300 <= code < 400:
                    raise LLMError("模型目录地址发生跳转，请填写服务的最终 API 地址后重试", code)
                if code == 429:
                    raise LLMError("模型目录请求过于频繁，请稍后重试", code)
                if code >= 400:
                    raise LLMError(
                        f"获取模型失败（HTTP {code}），请稍后重试或手动填写模型 ID", code
                    )
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_RESPONSE:
                        raise LLMError("模型目录响应过大，请使用手动填写模型 ID")
                import json

                try:
                    return json.loads(raw)
                except (ValueError, UnicodeError):
                    raise LLMError("服务返回的不是有效模型目录，请检查 API 地址") from None
    except httpx.TimeoutException:
        raise LLMError("获取模型超时，请检查服务状态后重试") from None
    except (httpx.HTTPError, UnicodeError, ValueError):
        raise LLMError("无法连接模型目录，请检查 API 地址和网络连接") from None


def _model_id(value) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 1024:
        return ""
    value = value.strip()
    return "" if any(ord(c) < 32 for c in value) else value


def openai_catalog(data) -> ModelCatalog:
    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        raise LLMError("服务返回的不是 OpenAI 兼容模型目录；可以继续手动填写模型 ID")
    models = {}
    for row in data["data"]:
        if isinstance(row, dict) and (model_id := _model_id(row.get("id"))):
            models.setdefault(model_id, CatalogModel(id=model_id, name=_model_id(row.get("name"))))
    if data["data"] and not models:
        raise LLMError("模型目录中没有有效的模型 ID；可以继续手动填写")
    return ModelCatalog(models=list(models.values()))


def comfy_catalog(data) -> ModelCatalog:
    if not isinstance(data, dict) or not all(isinstance(info, dict) for info in data.values()):
        raise LLMError("服务返回的不是 ComfyUI 节点目录，请检查服务地址")
    models = {}
    for node, info in data.items():
        inputs = info.get("input")
        if not isinstance(inputs, dict):
            continue
        for section in ("required", "optional"):
            fields = inputs.get(section)
            if not isinstance(fields, dict):
                continue
            for field, spec in fields.items():
                for item in _allowed(spec) or []:
                    model_id = _model_id(item)
                    if not model_id or model_id.lower() in {"none", "disabled"}:
                        continue
                    group = MODEL_INPUTS.get(field)
                    if not group and not MODEL_FILE.search(model_id):
                        continue
                    group = group or f"{node}.{field}"
                    models.setdefault((group, model_id), CatalogModel(id=model_id, group=group))
    return ModelCatalog(
        models=sorted(models.values(), key=lambda model: (model.group, model.id.casefold())),
        notice="列出节点公开的模型选项；实际使用的模型由工作流决定。",
    )


def discover_models(
    body: ModelCatalogRequest,
    settings: AppSettings,
    *,
    transport: httpx.BaseTransport | None = None,
) -> ModelCatalog:
    if body.kind == "novelai":
        return ModelCatalog(
            models=[CatalogModel(id=model_id, name=name) for model_id, name in NOVELAI_MODELS],
            source="bundled",
            notice="内置参考目录，未查询服务或验证账户可用性；其他模型仍可手动填写。",
        )
    if body.kind not in OPENAI_KINDS | {"comfyui"}:
        raise ValueError("此渠道尚未提供模型目录，可继续手动填写模型 ID")
    base, key = _connection(body, settings)
    path = "/object_info" if body.kind == "comfyui" else "/models"
    data = _get_json(base + path, key, transport)
    return comfy_catalog(data) if body.kind == "comfyui" else openai_catalog(data)
