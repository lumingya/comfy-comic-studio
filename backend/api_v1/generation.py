"""Synchronous single-image generation for cloud channels (NovelAI / OpenAI-compatible).

Durable, resumable execution (including ComfyUI) goes through ``/jobs`` or the
production queue; this endpoint is a one-shot call with no automatic retry.
"""

import copy
import math
import threading

from backend.api_v1.common import channel_state
from backend.api_v1.core import ROUTER, ApiError, asset_endpoint
from backend.api_v1.spec import ref

GENERATION_SLOT = threading.BoundedSemaphore(1)
CONFIG_FIELDS = {"provider", "baseUrl", "model", "protocol", "size", "quality", "sampler", "id", "title",
                 "sendSize", "sendQuality", "sendAspectHint", "keyMode", "keyId", "keyIds", "extraParams"}



def generation_payload(body, config):
    """Validate a public generation request against the saved channels in ``config``."""
    allowed = {"channelId", "providerId", "config", "apiKey", "prompt", "negative", "frame", "source", "images"}
    if set(body) - allowed:
        raise ApiError(400, "unknown_field", "Unknown generation field: " + ", ".join(sorted(set(body) - allowed)))
    channel = body.get("channelId", body.get("providerId"))
    if "channelId" in body and "providerId" in body and body["channelId"] != body["providerId"]:
        raise ApiError(400, "invalid_provider", "channelId and providerId disagree")
    if (channel is not None) == ("config" in body):
        raise ApiError(400, "invalid_provider", "Supply exactly one of channelId or config")
    if channel is not None:
        profiles = config.get("uiConfig", {}).get("comfyStudio", {}).get("settings", {}).get("imageGeneration", {}).get("profiles", [])
        profile = next((p for p in profiles if isinstance(p, dict) and p.get("id") == channel), None)
        if not profile:
            raise ApiError(404, "channel_not_found", "Save the channel in the workspace first (POST /channels), or pass config")
    else:
        profile = body["config"]
    if not isinstance(profile, dict) or profile.get("provider") not in ("novelai", "openai"):
        raise ApiError(400, "unsupported_provider",
                       "Synchronous generation supports novelai and openai; ComfyUI runs through /jobs or /production")
    if "config" in body and set(profile) - CONFIG_FIELDS:
        raise ApiError(400, "unknown_field", "Unknown config field")
    profile = {k: copy.deepcopy(v) for k, v in profile.items() if k in CONFIG_FIELDS}
    for key, value in profile.items():
        if key == "keyIds":
            bad = not isinstance(value, list) or len(value) > 32 or any(not isinstance(x, str) or not x or len(x) > 150 for x in value)
        elif key == "extraParams":
            bad = not isinstance(value, dict)
        elif key in ("sendSize", "sendQuality", "sendAspectHint"):
            bad = not isinstance(value, bool)
        else:
            bad = not isinstance(value, str)
        if bad:
            raise ApiError(400, "invalid_config", "Config values must be strings; sendSize/sendQuality/sendAspectHint must be booleans")
    if profile.get("keyMode", "environment") not in ("none", "stored", "environment"):
        raise ApiError(400, "invalid_config", "Unsupported authentication mode")
    if profile.get("protocol", "images") not in ("images", "chat"):
        raise ApiError(400, "invalid_protocol", "protocol must be images or chat")
    prompt = body.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 100000:
        raise ApiError(400, "invalid_prompt", "prompt must contain 1..100000 characters")
    for key in ("negative", "apiKey", "source"):
        if key in body and not isinstance(body[key], str):
            raise ApiError(400, "invalid_field", key + " must be a string")
    images = body.get("images", [])
    if not isinstance(images, list) or len(images) > 32 or any(not isinstance(image, str) for image in images):
        raise ApiError(400, "invalid_images", "images must be an ordered array of at most 32 local /images/ references or image data URLs")
    frame = body.get("frame", {})
    if not isinstance(frame, dict) or set(frame) - {"width", "height", "steps", "cfg", "seed", "denoise"}:
        raise ApiError(400, "invalid_frame", "Unknown frame parameter")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in frame.values()):
        raise ApiError(400, "invalid_frame", "Frame parameters must be numbers")
    if "apiKey" in body and not body["apiKey"]:
        profile["keyMode"] = "none"
    return {"config": profile, "key": body.get("apiKey", ""), "prompt": prompt,
            "negative": body.get("negative", ""), "frame": frame, "source": body.get("source"), "images": images,
            "albumId": "external"}


def saved_channels_config(host):
    profiles, _ = channel_state(host)
    return {"uiConfig": {"comfyStudio": {"settings": {"imageGeneration": {"profiles": profiles}}}}}


@ROUTER.post("/images/generations", summary="同步生成一张图（NovelAI / OpenAI 兼容渠道），不自动重试",
             tags=["generation"], body=ref("GenerationRequest"), response=ref("GenerationResult"),
             body_limit=50 * 1024 * 1024 * 4 // 3 + 65536, errors=(429, 502),
             description="Pass a saved channelId (see /channels) or an ad-hoc config. Only one external "
                         "generation runs at a time; a concurrent call returns 429 instead of queueing.")
def generate(ctx):
    host = ctx.host
    body = ctx.json(limit=host.MAX_IMAGE_BYTES * 4 // 3 + 65536)
    payload = generation_payload(body, saved_channels_config(host))
    if not GENERATION_SLOT.acquire(blocking=False):
        raise ApiError(429, "generation_busy", "An external generation is already running; do not blindly retry paid requests")
    try:
        try:
            data = host.generate_provider_image(payload)
        except host.ProviderHTTPError as exc:
            raise ApiError(exc.status, "upstream_error", str(exc)) from None
        except ApiError:
            raise
        except ValueError as exc:
            # Never echo provider content, credentials or reference images.
            raise ApiError(400, "generation_rejected", "Generation rejected; check provider, model, key, balance and parameters") from exc
        except Exception as exc:
            raise ApiError(502, "upstream_failure", "Upstream failed or timed out; check provider billing before retrying") from exc
        data["assetEndpoint"] = asset_endpoint(data.get("image"))
        return data
    finally:
        GENERATION_SLOT.release()
