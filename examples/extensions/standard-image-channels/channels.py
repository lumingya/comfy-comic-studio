"""Four wire protocols behind the documented cloud_adapter factory interface."""

from __future__ import annotations

import base64
import re
import threading
import time

from mio_server.llm import Reply

from . import images
from .transport import Scope, Transfer, error, number, retry_after

TRANSPORT_OPTIONS = {"min_interval", "max_result_bytes"}


class Channel:
    supports_reference = False
    option_names = frozenset()

    def __init__(self, channel, transport=None, *, scope=None):
        self.channel, self.transport = channel, transport
        self.scope = scope or Scope()
        self.cancelled = threading.Event()
        self.image_models = (channel.model,) if channel.model else ()

    def cancel(self):
        """Stop local waits/polls; never claim that the upstream cancelled paid work."""
        self.cancelled.set()

    close = cancel

    def generate_image(self, prompt, refs=(), models=None, timeout=360.0, retries=3):
        requested = {
            "prompt": prompt,
            "negative": "",
            "width": None,
            "height": None,
            "seed": None,
        }
        model = models[0] if models else self.channel.model
        return self._run(requested, refs, model, timeout)

    def generate_image_request(self, request, refs=(), timeout=360.0, retries=3):
        if request.get("kind") != self.channel.kind or request.get("channel_id") != self.channel.id:
            raise error("Frozen request does not match this channel", status=400)
        # The host instantiates this factory with frozen ordinary options and current credentials.
        return self._run(request["requested"], refs, request["model"], timeout)

    def _run(self, requested, refs, model, timeout):
        if not isinstance(model, str) or not model.strip():
            raise error("Choose an explicit image model before generation", status=400)
        if set(self.channel.extra_options) - (TRANSPORT_OPTIONS | self.option_names):
            raise error("Unsupported channel option; credentials belong in api_key", status=400)
        refs = list(refs)
        if len(refs) > 4 or (refs and not self.supports_reference):
            raise error("This channel does not support the requested references", status=400)
        started = time.monotonic()
        with Transfer(
            self.channel, self.transport, self.scope, self.cancelled, timeout
        ) as transfer:
            refs = [images.reference(data, transfer.limit) for data in refs]
            prompt = requested.get("prompt", "")
            if not isinstance(prompt, str) or not prompt.strip():
                raise error("A nonempty prompt is required", status=400)
            negative = ", ".join(
                value for value in (requested.get("negative", ""), self.channel.negative) if value
            )
            data, effective, modes = self.perform(
                transfer, requested, prompt, negative, refs, model
            )
            snapshot = {
                "channel_id": self.channel.id,
                "kind": self.channel.kind,
                "model": model,
                "requested": {
                    key: requested.get(key)
                    for key in (
                        "prompt",
                        "negative",
                        "width",
                        "height",
                        "seed",
                        "refs",
                        "reference_mode",
                    )
                },
                "effective": {
                    "refs": requested.get("refs", []),
                    "reference_mode": "images" if refs else "none",
                    **effective,
                },
                "parameter_modes": modes,
                "adjustments": [],
            }
        return data, Reply("", model, round(time.monotonic() - started, 2), image_request=snapshot)

    def dimensions(self, requested):
        width = requested.get("width") or self.channel.width
        height = requested.get("height") or self.channel.height
        if any(
            isinstance(value, bool) or not isinstance(value, int) or not 64 <= value <= 4096
            for value in (width, height)
        ):
            raise error("Invalid image dimensions", status=400)
        return width, height

    def post(self, transfer, path, **kwargs):
        return transfer.request("POST", transfer.endpoint(path), **kwargs)[2]


class CompatibleImages(Channel):
    supports_reference = True
    option_names = frozenset({"response_format", "style"})

    def perform(self, transfer, requested, prompt, negative, refs, model):
        if negative:
            prompt += f"\nAvoid: {negative}"
        fields = {"model": model, "prompt": prompt, "n": 1}
        width, height = requested.get("width"), requested.get("height")
        size = f"{width}x{height}" if width and height else self.channel.size
        if size:
            if not re.fullmatch(r"\d{2,4}x\d{2,4}|auto", size):
                raise error("Invalid image size", status=400)
            if size != "auto" and any(not 64 <= int(value) <= 4096 for value in size.split("x")):
                raise error("Image size exceeds the supported bounds", status=400)
            fields["size"] = size
        if self.channel.quality:
            fields["quality"] = self.channel.quality
        options = self.channel.extra_options
        if "response_format" in options:
            if options["response_format"] not in ("b64_json", "url"):
                raise error("Unsupported image response format", status=400)
            fields["response_format"] = options["response_format"]
        if "style" in options:
            if not isinstance(options["style"], str) or len(options["style"]) > 64:
                raise error("Invalid image style", status=400)
            fields["style"] = options["style"]
        if refs:
            files = [
                ("image[]", (f"ref{index}.png", value, "image/png"))
                for index, value in enumerate(refs)
            ]
            body = self.post(
                transfer,
                "/images/edits",
                data={key: str(value) for key, value in fields.items()},
                files=files,
            )
        else:
            body = self.post(transfer, "/images/generations", json=fields)
        reply = images.document(body)
        items = reply.get("data")
        if not isinstance(items, list) or not items:
            raise error("Image service returned no image array", sent=True)
        effective = {
            "prompt": prompt,
            "negative": negative,
            "size": size or None,
            "seed": None,
            "options": {
                key: value for key, value in fields.items() if key not in ("model", "prompt")
            },
        }
        return (
            images.result(items[0], transfer),
            effective,
            {"negative": "prompt", "size": "native", "seed": "unsupported"},
        )


class CompatibleChat(Channel):
    supports_reference = True
    option_names = frozenset({"modalities"})

    def perform(self, transfer, requested, prompt, negative, refs, model):
        if negative:
            prompt += f"\nAvoid: {negative}"
        width, height = self.dimensions(requested)
        prompt += f"\nRequested image dimensions: {width} x {height} pixels."
        content = [{"type": "text", "text": prompt}]
        content.extend(
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:image/png;base64," + base64.b64encode(value).decode("ascii")
                },
            }
            for value in refs
        )
        body = {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "stream": False,
        }
        modalities = self.channel.extra_options.get("modalities")
        if modalities is not None:
            if (
                not isinstance(modalities, list)
                or not modalities
                or any(item not in ("text", "image") for item in modalities)
            ):
                raise error("Invalid chat output modalities", status=400)
            body["modalities"] = modalities
        reply = images.document(self.post(transfer, "/chat/completions", json=body))
        try:
            message = reply["choices"][0]["message"]
            found = (
                (message.get("images") or [])[0].get("image_url") if message.get("images") else None
            )
            if found is None and isinstance(message.get("content"), list):
                found = next(
                    (
                        item.get("image_url")
                        for item in message["content"]
                        if isinstance(item, dict) and item.get("type") == "image_url"
                    ),
                    None,
                )
            if isinstance(found, str):
                found = {"url": found}
            if found is None and isinstance(message.get("content"), str):
                match = re.search(r"!\[[^]]*\]\(([^)]+)\)", message["content"])
                found = {"url": match[1]} if match else None
        except (KeyError, TypeError, IndexError, AttributeError):
            raise error(
                "Chat image service returned an unsupported response shape", sent=True
            ) from None
        effective = {
            "prompt": prompt,
            "negative": negative,
            "width": None,
            "height": None,
            "seed": None,
            "options": {"modalities": modalities} if modalities else {},
        }
        return (
            images.result(found, transfer),
            effective,
            {"negative": "prompt", "size": "prompt", "seed": "unsupported"},
        )


class NovelStyle(Channel):
    option_names = frozenset({"seed"})

    def perform(self, transfer, requested, prompt, negative, refs, model):
        width, height = self.dimensions(requested)
        if width % 64 or height % 64:
            raise error("Novel-style dimensions must be multiples of 64", status=400)
        seed = requested.get("seed")
        if seed is None:
            seed = number(self.channel.extra_options, "seed", 0, 0, 2**32 - 1, integer=True)
        if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**32:
            raise error("Invalid image seed", status=400)
        options = {
            "params_version": 3,
            "width": width,
            "height": height,
            "seed": seed,
            "n_samples": 1,
            "steps": self.channel.steps,
            "scale": self.channel.scale,
            "sampler": self.channel.sampler,
            "noise_schedule": "karras",
            "negative_prompt": negative,
            "ucPreset": 0,
        }
        if "diffusion-4" in model:
            options["v4_prompt"] = {
                "caption": {"base_caption": prompt, "char_captions": []},
                "use_coords": False,
                "use_order": True,
            }
            options["v4_negative_prompt"] = {
                "caption": {"base_caption": negative, "char_captions": []},
                "legacy_uc": False,
            }
        body = self.post(
            transfer,
            "/ai/generate-image",
            json={
                "input": prompt,
                "model": model,
                "action": "generate",
                "parameters": options,
            },
        )
        effective = {
            "prompt": prompt,
            "negative": negative,
            "width": width,
            "height": height,
            "seed": seed,
            "options": options,
        }
        return (
            images.zipped_image(body, transfer),
            effective,
            {"negative": "native", "size": "native", "seed": "native"},
        )


class AsyncImages(Channel):
    option_names = frozenset({"seed", "submit_path", "poll_path", "max_polls", "poll_interval"})

    def perform(self, transfer, requested, prompt, negative, refs, model):
        options = self.channel.extra_options
        attempts = number(options, "max_polls", 60, 1, 200, integer=True)
        interval = number(options, "poll_interval", 1.0, 0.01, 30)
        submit = options.get("submit_path", "/jobs")
        pattern = options.get("poll_path", "/jobs/{id}")
        if (
            not isinstance(pattern, str)
            or pattern.count("{id}") != 1
            or "{" in pattern.replace("{id}", "")
            or "}" in pattern.replace("{id}", "")
        ):
            raise error("Polling path requires exactly one task ID placeholder", status=400)
        transfer.endpoint(pattern.replace("{id}", "check"))
        width, height = self.dimensions(requested)
        fields = {
            "model": model,
            "prompt": prompt,
            "negative_prompt": negative,
            "width": width,
            "height": height,
            "n": 1,
        }
        seed = requested.get("seed")
        if seed is None and "seed" in options:
            seed = number(options, "seed", 0, 0, 2**32 - 1, integer=True)
        if seed is not None:
            if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**32:
                raise error("Invalid image seed", status=400)
            fields["seed"] = seed
        reply = images.document(self.post(transfer, submit, json=fields))
        task_id = reply.get("id")
        if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", task_id):
            raise error(
                "Async service accepted a request without a safe task identifier",
                sent=True,
            )
        self.last_remote_id = (
            task_id  # Memory only; never copy provider IDs into errors or snapshots.
        )
        for attempt in range(attempts + 1):
            transfer.check()
            status = reply.get("status")
            if status in ("completed", "succeeded"):
                data = images.result(reply.get("image") or reply.get("result"), transfer)
                effective = {
                    "prompt": prompt,
                    "negative": negative,
                    "width": width,
                    "height": height,
                    "seed": seed,
                    "options": {"n": 1},
                }
                return (
                    data,
                    effective,
                    {"negative": "native", "size": "native", "seed": "native"},
                )
            if status in ("failed", "cancelled"):
                raise error("Remote image task ended without a downloadable result", sent=True)
            if status not in ("pending", "queued", "running", "processing"):
                raise error("Async service returned an unknown task state", sent=True)
            if attempt == attempts:
                break
            transfer.wait(interval)
            code, headers, body = transfer.request(
                "GET", transfer.endpoint(pattern.replace("{id}", task_id))
            )
            if not 200 <= code < 300:
                transfer.wait(retry_after(headers.get("Retry-After")))
                continue
            reply = images.document(body)
        raise error(
            "Async polling limit reached; check the already submitted task upstream",
            sent=True,
        )
