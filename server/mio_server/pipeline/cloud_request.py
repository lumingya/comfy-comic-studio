"""Frozen, credential-free image requests and truthful provider parameter snapshots.

Adapters may implement ``generate_image_request(request, refs, timeout, retries)`` and
return their actual request in ``Reply.image_request``. Legacy adapters keep the existing
``generate_image`` signature; their unreported parameter capabilities remain unknown.
"""

from __future__ import annotations

import copy
import random
import re

from .. import llm as L

SECRET_OPTION_NAME = re.compile(
    r"(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|passwd|"
    r"credential|auth[_-]?(?:token|key|secret|header)|authorization|bearer)",
    re.I,
)

OPTION_KEYS = (
    "negative",
    "width",
    "height",
    "size",
    "quality",
    "steps",
    "scale",
    "sampler",
    "ref_strength",
)
DEFAULT_MODELS = {"openai_images": "gpt-image-1", "novelai": "nai-diffusion-4-5-full"}


def _without_secrets(value):
    if isinstance(value, dict):
        return {
            key: _without_secrets(item)
            for key, item in value.items()
            if not SECRET_OPTION_NAME.search(key)
        }
    if isinstance(value, list):
        return [_without_secrets(item) for item in value]
    return copy.deepcopy(value)


def _redact_request(value):
    """Sanitize adapter-reported request snapshots before they reach stored job results."""
    if isinstance(value, dict):
        return {
            key: "••••••" if SECRET_OPTION_NAME.search(key) else _redact_request(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_request(item) for item in value]
    return copy.deepcopy(value)


def _secret_options(value):
    if not isinstance(value, dict):
        return {}
    return {
        key: copy.deepcopy(item) for key, item in value.items() if SECRET_OPTION_NAME.search(key)
    }


def _merge_secrets(frozen, current):
    if isinstance(current, list):
        old = frozen if isinstance(frozen, list) else []
        return [
            _merge_secrets(old[index] if index < len(old) else {}, item)
            for index, item in enumerate(current)
        ]
    result = copy.deepcopy(frozen) if isinstance(frozen, dict) else {}
    for key, value in _secret_options(current).items():
        result[key] = value
    for key, value in current.items() if isinstance(current, dict) else []:
        if not SECRET_OPTION_NAME.search(key) and isinstance(value, dict):
            result[key] = _merge_secrets(result.get(key), value)
    return result


def channel_of(client):
    for name in ("channel", "_image_channel"):
        channel = getattr(client, name, None)
        if isinstance(getattr(channel, "kind", None), str):
            return channel
    return None


def freeze_request(client, requested: dict, *, channel_id: str = "", models=None, rng=None) -> dict:
    """Resolve defaults once, without storing credentials or a service URL."""
    channel = channel_of(client)
    kind = channel.kind if channel else "chat_image" if isinstance(client, L.Client) else "unknown"
    configured = models or getattr(client, "image_models", ())
    model = channel.model if channel else ""
    if models:
        model = models[0]
    if not model:
        model = DEFAULT_MODELS.get(kind, "")
    if not model and isinstance(configured, (tuple, list)) and configured:
        model = configured[0]
    if not model and kind == "chat_image":
        model = L.IMAGE_SINGLE[0]
    options = {k: getattr(channel, k) for k in OPTION_KEYS} if channel else {}
    if channel:
        # Extra settings are frozen for deterministic retries, but secret-like values are
        # supplied from current settings at bind time, just like the channel API key.
        options["extra_options"] = _without_secrets(channel.extra_options)
    # A retry or later execution must never draw a new NovelAI seed.
    if kind == "novelai":
        options["seed"] = requested.get("seed")
        if options["seed"] is None:
            options["seed"] = (rng or random).randrange(2**32)
    return {
        "channel_id": channel.id if channel else channel_id,
        "kind": kind,
        "model": model,
        "requested": {
            "prompt": "",
            "negative": "",
            "width": None,
            "height": None,
            "seed": None,
            "reference_mode": "off",
            "refs": [],
            **copy.deepcopy(requested),
        },
        "options": options,
    }


def bind_request(client, request: dict):
    """Use current credentials, but reject a changed kind and restore frozen options."""
    channel = channel_of(client)
    kind = channel.kind if channel else "chat_image" if isinstance(client, L.Client) else "unknown"
    if kind != request["kind"]:
        raise LookupError("云端渠道类型已改变，请重新提交出图任务")
    if channel and channel.id != request["channel_id"]:
        raise LookupError("云端渠道已改变，请重新提交出图任务")
    frozen = copy.copy(client)
    if channel:
        current_extra = channel.extra_options
        frozen_extra = _merge_secrets(request["options"].get("extra_options", {}), current_extra)
        updated = channel.model_copy(
            update={
                **{k: v for k, v in request["options"].items() if k in OPTION_KEYS},
                "model": request["model"],
                "extra_options": frozen_extra,
            }
        )
        if getattr(client, "channel", None) is channel:
            frozen.channel = updated
        else:
            frozen._image_channel = updated
    frozen.image_models = (request["model"],) if request["model"] else ()
    return frozen


def snapshot(request: dict) -> dict:
    """Compute the exact built-in wire parameters; unknown adapters make no claims."""
    wanted, options, kind = request["requested"], request["options"], request["kind"]
    refs = copy.deepcopy(wanted["refs"])
    effective = {
        "prompt": wanted["prompt"],
        "negative": "",
        "width": None,
        "height": None,
        "size": None,
        "seed": None,
        "refs": refs,
        "reference_mode": "images" if refs else "none",
        "options": {},
    }
    modes = {"negative": "unknown", "size": "unknown", "seed": "unknown"}
    adjustments = []
    if kind not in ("openai_images", "chat_image", "novelai"):
        effective["reference_mode"] = "unknown" if refs else "none"
        adjustments.append("adapter_capabilities_unknown")
        # The adapter owns this opaque JSON object. Keep ordinary options frozen while
        # excluding secrets from persisted jobs, results and diagnostic API responses.
        effective["options"] = _without_secrets(options.get("extra_options", {}))
    else:
        negative = ", ".join(x for x in (wanted["negative"], options.get("negative", "")) if x)
        effective["negative"] = negative
        modes.update(negative="native" if kind == "novelai" else "prompt", seed="unsupported")
        width, height = wanted["width"], wanted["height"]
        if kind == "novelai":
            modes.update(size="native", seed="native")
            for key, value in (("width", width), ("height", height)):
                value = value or options.get(key) or (832 if key == "width" else 1216)
                effective[key] = max(64, round(value / 64) * 64)
                if value != effective[key]:
                    adjustments.append(f"{key}_aligned_64")
            seed = options["seed"]
            effective["seed"] = seed % 2**32
            if effective["seed"] != seed:
                adjustments.append("seed_modulo_32bit")
            effective["size"] = f"{effective['width']}x{effective['height']}"
            effective["prompt"] = re.sub(r"@image_\d+", "", wanted["prompt"]).strip()
            if effective["prompt"] != wanted["prompt"]:
                adjustments.append("novelai_reference_tokens_removed")
            effective["reference_mode"] = "vibe" if refs else "none"
            effective["options"] = {k: options[k] for k in ("steps", "scale", "sampler")}
            effective["options"].update(
                params_version=3, n_samples=1, noise_schedule="karras", ucPreset=0
            )
            if refs:
                effective["options"]["reference_strength_multiple"] = [
                    options["ref_strength"]
                ] * len(refs)
                if not re.search(r"diffusion-4", request["model"]):
                    effective["options"]["reference_information_extracted_multiple"] = [1.0] * len(
                        refs
                    )
        else:
            if negative:
                effective["prompt"] += f"\nAvoid: {negative}"
            if kind == "openai_images":
                modes["size"] = "native"
                effective["options"]["n"] = 1
                size = f"{width}x{height}" if width and height else options.get("size") or None
                effective["size"] = size
                match = re.fullmatch(r"(\d+)x(\d+)", size or "")
                if match:
                    effective["width"], effective["height"] = map(int, match.groups())
                if options.get("quality"):
                    effective["options"]["quality"] = options["quality"]
            else:
                modes["size"] = "prompt"
                width, height = width or options.get("width"), height or options.get("height")
                if width and height:
                    effective["prompt"] += (
                        f"\nRequested image dimensions: {width} x {height} pixels."
                    )
    return {
        "channel_id": request["channel_id"],
        "kind": kind,
        "model": request["model"],
        "requested": copy.deepcopy(wanted),
        "effective": effective,
        "parameter_modes": modes,
        "adjustments": adjustments,
    }


def call(client, request: dict, refs, *, timeout=360.0, retries=0):
    """Opt in through an explicit method, never infer support from arbitrary **kwargs."""
    method = getattr(type(client), "generate_image_request", None)
    if callable(method):
        data, reply = client.generate_image_request(request, refs, timeout=timeout, retries=retries)
        if isinstance(reply.image_request, dict):
            reply.image_request = _redact_request(reply.image_request)
        return data, reply
    data, reply = client.generate_image(
        request["requested"]["prompt"],
        refs=refs,
        models=(request["model"],) if request["model"] else None,
        timeout=timeout,
        retries=retries,
    )
    # An old adapter can consume prompt/references, but only it knows which options apply.
    unknown = copy.deepcopy(request)
    unknown["kind"] = "unknown"
    actual = snapshot(unknown)
    actual["kind"], actual["model"] = request["kind"], reply.model
    reply.image_request = actual
    return data, reply
