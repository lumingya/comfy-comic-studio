"""Missing custom nodes / model files, from ``/object_info`` (pure functions + one client call)."""

from __future__ import annotations

import math
import re

from . import bindings as B

MODEL_FILE = re.compile(r"\.(safetensors|ckpt|pt|pth|bin|gguf|sft|onnx)$", re.I)


def _allowed(spec) -> list | None:
    """``/object_info`` input spec → the list of allowed values for combo inputs."""
    if isinstance(spec, (list, tuple)) and spec:
        head = spec[0]
        if isinstance(head, list):
            return head
        if head == "COMBO" and len(spec) > 1 and isinstance(spec[1], dict):
            options = spec[1].get("options")
            return options if isinstance(options, list) else None
    return None


def diagnose(graph: dict, object_info: dict) -> dict:
    missing_nodes: dict[str, list[str]] = {}
    missing_models: list[dict] = []
    invalid_values: list[dict] = []
    missing_inputs: list[dict] = []
    invalid_links: list[dict] = []
    invalid_inputs: list[dict] = []
    for node_id, node in graph.items():
        cls = node.get("class_type", "")
        inputs = node.get("inputs") or {}
        for key, value in inputs.items():
            if not B.is_link(value):
                continue
            target, index = value
            source = graph.get(target)
            outputs = (object_info.get(source.get("class_type"), {}) if source else {}).get(
                "output"
            )
            if (
                source is None
                or index < 0
                or isinstance(index, bool)
                or (isinstance(outputs, (list, tuple)) and index >= len(outputs))
            ):
                invalid_links.append(
                    {"node": node_id, "input": key, "target": target, "index": index}
                )
        info = object_info.get(cls)
        if info is None:
            missing_nodes.setdefault(cls, []).append(node_id)
            continue
        specs = {}
        for section in ("required", "optional"):
            specs.update((info.get("input") or {}).get(section) or {})
        for key in (info.get("input") or {}).get("required") or {}:
            if key not in inputs:
                missing_inputs.append({"node": node_id, "class_type": cls, "input": key})
        for key, value in inputs.items():
            if B.is_link(value) or (isinstance(value, dict) and set(value) == {"$asset"}):
                continue
            spec = specs.get(key)
            reason = _invalid_literal(value, spec)
            if reason:
                invalid_inputs.append(
                    {"node": node_id, "class_type": cls, "input": key, "reason": reason}
                )
            allowed = _allowed(specs.get(key))
            if allowed is None or value in allowed:
                continue
            entry = {"node": node_id, "class_type": cls, "input": key, "value": value}
            if isinstance(value, str) and MODEL_FILE.search(value):
                missing_models.append(entry)
            else:
                invalid_values.append({**entry, "allowed": allowed[:20]})
    return {
        "ok": not any(
            (
                missing_nodes,
                missing_models,
                invalid_values,
                missing_inputs,
                invalid_links,
                invalid_inputs,
            )
        ),
        "missing_nodes": [{"class_type": k, "nodes": v} for k, v in sorted(missing_nodes.items())],
        "missing_models": missing_models,
        "invalid_values": invalid_values,
        "missing_inputs": missing_inputs,
        "invalid_links": invalid_links,
        "invalid_inputs": invalid_inputs,
        "scope": "Static graph and declared object_info constraints only; custom VALIDATE_INPUTS is not executed.",
    }


def _invalid_literal(value, spec) -> str | None:
    if not isinstance(spec, (list, tuple)) or not spec:
        return None
    kind = spec[0]
    if not isinstance(kind, str):
        return None
    options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
    if kind in ("INT", "FLOAT"):
        # ComfyUI coerces numeric strings; match it without executing node validators.
        try:
            number = int(value) if kind == "INT" else float(value)
        except (TypeError, ValueError, OverflowError):
            return f"expected {kind}"
        if isinstance(value, bool) or (isinstance(number, float) and not math.isfinite(number)):
            return f"expected finite {kind}"
        if kind == "INT" and isinstance(value, float) and value != number:
            return "expected INT"
        for bound, comparator in (("min", lambda a, b: a < b), ("max", lambda a, b: a > b)):
            limit = options.get(bound)
            if isinstance(limit, (int, float)) and comparator(number, limit):
                return f"{bound}={limit}"
    elif kind == "BOOLEAN" and not isinstance(value, bool):
        return "expected BOOLEAN"
    elif kind == "STRING" and not isinstance(value, str):
        return "expected STRING"
    return None


def model_catalog(object_info: dict) -> dict[str, list[str]]:
    """Installed checkpoints / LoRAs / VAEs / ControlNets as listed by the core loader nodes."""
    wanted = {
        "checkpoints": ("CheckpointLoaderSimple", "ckpt_name"),
        "loras": ("LoraLoader", "lora_name"),
        "vae": ("VAELoader", "vae_name"),
        "controlnet": ("ControlNetLoader", "control_net_name"),
        "upscale": ("UpscaleModelLoader", "model_name"),
        "diffusion_models": ("UNETLoader", "unet_name"),
    }
    out = {}
    for label, (cls, key) in wanted.items():
        spec = (((object_info.get(cls) or {}).get("input") or {}).get("required") or {}).get(key)
        out[label] = list(_allowed(spec) or [])
    return out
