"""Missing custom nodes / model files, from ``/object_info`` (pure functions + one client call)."""

from __future__ import annotations

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
    for node_id, node in graph.items():
        cls = node.get("class_type", "")
        info = object_info.get(cls)
        if info is None:
            missing_nodes.setdefault(cls, []).append(node_id)
            continue
        specs = {}
        for section in ("required", "optional"):
            specs.update((info.get("input") or {}).get(section) or {})
        for key, value in (node.get("inputs") or {}).items():
            if B.is_link(value) or not isinstance(value, str):
                continue
            allowed = _allowed(specs.get(key))
            if allowed is None or value in allowed:
                continue
            entry = {"node": node_id, "class_type": cls, "input": key, "value": value}
            if MODEL_FILE.search(value):
                missing_models.append(entry)
            elif allowed:
                invalid_values.append({**entry, "allowed": allowed[:20]})
    return {
        "ok": not missing_nodes and not missing_models,
        "missing_nodes": [{"class_type": k, "nodes": v} for k, v in sorted(missing_nodes.items())],
        "missing_models": missing_models,
        "invalid_values": invalid_values,
    }


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
