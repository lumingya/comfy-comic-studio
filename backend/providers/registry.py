"""Process-wide provider registry with the three shipped channels pre-registered.

Built-in providers are ordinary registry entries: nothing in the dispatch
path knows the words "comfyui", "novelai" or "openai" any more. Extensions
register additional providers through ``ctx.provider(...)`` in their
``plugin.py``; the plugin manager wraps those in a callable and hands them to
the same registry.
"""

from backend.ecosystem.registry import ProviderRegistry

PROVIDERS = ProviderRegistry()

COMFYUI_SPEC = {
    "id": "comfyui",
    "label": "ComfyUI",
    "description": "本地或局域网 ComfyUI；通过工作流映射驱动节点图。",
    "panel": "comfyui",
    "fields": [
        {"key": "outputNodeId", "label": "输出节点", "type": "text"},
    ],
    "capabilities": {"workflow": True, "check": True, "credentials": "none"},
    "docs": "docs/guide/WORKFLOW.md",
}

NOVELAI_SPEC = {
    "id": "novelai",
    "label": "NovelAI",
    "description": "NovelAI generate-image；支持 V4 vibe 参考图。",
    "panel": "cloud",
    "fields": [
        {"key": "sampler", "label": "采样器", "type": "text", "default": "k_euler_ancestral"},
    ],
    "defaults": {"baseUrl": "https://image.novelai.net", "model": "nai-diffusion-4-5-full", "keyMode": "none"},
    "capabilities": {"credentials": "bearer", "braceWeights": True},
    "docs": "docs/IMAGE_PROVIDERS.md",
}

OPENAI_SPEC = {
    "id": "openai",
    "label": "OpenAI 兼容",
    "description": "Images API 或 Chat Completions 多模态出图；兼容大多数中转网关。",
    "panel": "cloud",
    "fields": [
        {"key": "protocol", "label": "接口协议", "type": "select", "default": "images",
         "options": [{"value": "images", "label": "Images API"}, {"value": "chat", "label": "Chat Completions"}]},
        {"key": "size", "label": "输出尺寸", "type": "text", "default": "1024x1024"},
        {"key": "quality", "label": "质量", "type": "text", "default": "auto"},
        {"key": "sendSize", "label": "发送尺寸", "type": "toggle", "default": False},
        {"key": "sendQuality", "label": "发送质量", "type": "toggle", "default": False},
        {"key": "sendAspectHint", "label": "把画幅比写进提示词", "type": "toggle", "default": True},
    ],
    "defaults": {"baseUrl": "https://api.openai.com/v1", "model": "gpt-image-1", "keyMode": "none"},
    "capabilities": {"models": True, "credentials": "bearer", "multimodal": True},
    "docs": "docs/IMAGE_PROVIDERS.md",
}


def _comfy_generate(payload, host):
    from . import comfyui

    return comfyui.generate(payload, host)


def _cloud_generate(payload, host):
    from . import cloud
    from .transport import cancellation_scope

    with cancellation_scope(payload) as cancellable:
        return cloud.generate(cancellable, host)


def _openai_models(payload, host):
    return host.list_provider_models(payload)


def _comfy_check(payload, host):
    from backend.mio_connection_check import check_comfy

    config = payload.get("config") or payload
    return check_comfy({k: v for k, v in config.items() if k != "provider"})


def install_builtins(registry=PROVIDERS):
    registry.register(COMFYUI_SPEC, _comfy_generate, owner="core", check=_comfy_check)
    registry.register(NOVELAI_SPEC, _cloud_generate, owner="core")
    registry.register(OPENAI_SPEC, _cloud_generate, owner="core", models=_openai_models)
    return registry


install_builtins()
