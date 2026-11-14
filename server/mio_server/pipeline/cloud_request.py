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
        updated = channel.model_copy(
            update={
                **{k: v for k, v in request["options"].items() if k in OPTION_KEYS},
                "model": request["model"],
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
        return client.generate_image_request(request, refs, timeout=timeout, retries=retries)
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
