"""Provider dispatch. Channels live in backend.providers.registry (built-ins) and
are extended at runtime by trusted extensions; see docs/ECOSYSTEM_GUIDE.md."""

import re
from . import cloud, comfyui, openai_images, openai_chat, novelai

PROTOCOLS = {
    "openai:images": "Images multipart/JSON",
    "openai:chat": "Chat multimodal",
    "novelai:images": "NovelAI generate-image",
    "comfyui:workflow": "ComfyUI API graph",
}
RESERVED = {
    "model",
    "prompt",
    "input",
    "messages",
    "image",
    "images",
    "image[]",
    "n",
    "stream",
    "action",
    "parameters",
    "source",
    "headers",
    "workflow",
    "apikey",
    "api_token",
    "token",
    "reference_image_multiple",
    "reference_information_extracted_multiple",
    "reference_strength_multiple",
    "v4_prompt",
    "v4_negative_prompt",
    "negative_prompt",
    "authorization",
    "api_key",
    "key",
}


def extras(config, body):
    extra = config.get("extraParams", {})
    if not isinstance(extra, dict) or len(extra) > 100:
        raise ValueError("extraParams must be an object of at most 100 fields")
    import json

    if len(json.dumps(extra)) > 65536:
        raise ValueError("extraParams exceeds 64 KiB")
    tunable = set(novelai.TUNABLE) if config.get("provider") == "novelai" else set()
    if any(
        not isinstance(k, str)
        or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,95}", k)
        or k.lower() in RESERVED
        or (k in body and k not in tunable)
        or k.startswith("_")
        for k in extra
    ):
        raise ValueError(
            "extraParams cannot replace bound prompts, images, credentials or standard parameters"
        )
    body.update(extra)
    return list(extra)


def generate(payload, host):
    """Dispatch through the open provider registry and record asset origins."""
    from .registry import PROVIDERS

    provider = (payload.get("config") or {}).get("provider")
    entry = PROVIDERS.get(provider)
    result = entry.generate(payload, host)
    if not isinstance(result, dict) or not isinstance(result.get("image"), str):
        raise ValueError("Provider returned no image")
    result.setdefault("artifacts", [{"kind": "image", "url": result["image"]}])
    result.setdefault("provider", provider)
    if hasattr(host, "mio_foundation"):
        for artifact in result["artifacts"]:
            host.mio_foundation.record_asset_origin(
                host,
                artifact["url"],
                {
                    "kind": "generation",
                    "provider": provider,
                    "model": str(payload.get("config", {}).get("model", "")),
                },
            )
    result["contractVersion"] = 1
    return result


BUILDERS = {
    ("openai", "images"): openai_images.build,
    ("openai", "chat"): openai_chat.build,
    ("novelai", "images"): novelai.build,
}


def build_request(context):
    config = context["config"]
    key = (config["provider"], config.get("protocol", "images"))
    if key not in BUILDERS:
        raise ValueError("Unsupported protocol; no automatic protocol fallback")
    return BUILDERS[key](context)
