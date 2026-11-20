"""Reviewed ComfyUI profiles; no core patches, private context, network or model loading."""

import base64
import copy
import math
import re
from collections import defaultdict, deque

from mio_server.comfy.client import OutputImage

STACK_CLASS = "Power Lora Loader (rgthree)"
DETAILERS = {"FaceDetailer", "DetailerForEach"}
SAMPLERS = {"KSampler", "KSamplerAdvanced"}
MAX_IMAGES = 16
MAX_IMAGE_BYTES = 10 * 1024 * 1024


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def stack_rows(node):
    if node.get("class_type") != STACK_CLASS:
        return None
    rows = []
    for field, value in node["inputs"].items():
        if not re.fullmatch(r"lora_\d+", field, re.IGNORECASE):
            continue
        if (
            not isinstance(value, dict)
            or type(value.get("on")) is not bool
            or not isinstance(value.get("lora"), str)
            or not number(value.get("strength"))
            or value.get("strengthTwo") is not None
            and not number(value["strengthTwo"])
        ):
            raise ValueError("Invalid declared Power LoRA row")
        if value["lora"] in ("", "None"):
            if value["on"]:
                raise ValueError("Enabled Power LoRA row has no model name")
            continue
        rows.append((field, value))
    if len(rows) > 64:
        raise ValueError("Power LoRA profile supports at most 64 rows")
    return rows


class PowerStack:
    def inspect(self, node):
        rows = stack_rows(node)
        if not rows:
            return None
        return {
            "path": rows[0][0],
            "loras": [
                {
                    "name": value["lora"],
                    "strength": value["strength"],
                    "enabled": value["on"],
                    **(
                        {"clip": value["strengthTwo"]}
                        if value.get("strengthTwo") is not None
                        else {}
                    ),
                }
                for _, value in rows
            ],
            "can_append": False,
            "can_disable": True,
            "range": {"min": -5, "max": 5},
            "options": {"fields": [field for field, _ in rows]},
        }

    def write(self, node, slot, loras):
        rows = stack_rows(node)
        if not rows or slot["path"] != rows[0][0]:
            raise ValueError("Power LoRA node no longer matches the selected slot")
        if slot["options"].get("fields") != [field for field, _ in rows]:
            raise ValueError("Power LoRA row topology changed")
        selected = defaultdict(deque)
        for lora in loras:
            selected[lora["name"]].append(lora)
        changes = {}
        for field, original in rows:
            row = copy.deepcopy(original)
            candidates = selected[row["lora"]]
            if candidates:
                lora = candidates.popleft()
                row.update(on=lora.get("enabled", True), strength=lora["strength"])
                if lora.get("clip") is not None:
                    row["strengthTwo"] = lora["clip"]
                elif "strengthTwo" in row:
                    row["strengthTwo"] = None
            else:
                row["on"] = False
            changes[field] = row
        if any(selected.values()):
            raise ValueError("Add stack rows in ComfyUI before requesting another LoRA")
        return changes


def marker(node, name, default):
    title = str((node.get("_meta") or {}).get("title", ""))
    found = re.search(r"\[adapter-" + name + r":([a-z0-9_.-]+)\]", title)
    return found[1] if found else default


def reference_bindings(graph):
    """Recognize only a direct IMAGE edge from LoadImage; never replace the edge itself."""
    claimed = {}
    for node_id, node in graph.items():
        cls, inputs = node["class_type"], node["inputs"]
        if cls not in {"IPAdapterAdvanced", "ControlNetApplyAdvanced"}:
            continue
        is_control = cls == "ControlNetApplyAdvanced"
        qualifier = marker(node, "control" if is_control else "ref", "pose" if is_control else "1")
        weight = "strength" if is_control else "weight"
        if number(inputs.get(weight)):
            yield {
                "kind": "strength",
                "qualifier": qualifier if is_control else "reference",
                "node": node_id,
                "field": weight,
            }
        edge = inputs.get("image")
        if not (isinstance(edge, list) and len(edge) == 2 and edge[1] == 0):
            continue
        source = graph.get(str(edge[0]), {})
        if source.get("class_type") != "LoadImage" or not isinstance(
            source.get("inputs", {}).get("image"), str
        ):
            continue
        binding = {
            "kind": "control" if is_control else "ref",
            "qualifier": qualifier,
            "node": str(edge[0]),
            "field": "image",
        }
        previous = claimed.get(binding["node"])
        if previous is not None and previous != (binding["kind"], qualifier):
            raise ValueError(
                "Shared image loader has conflicting reference roles; map it explicitly"
            )
        claimed[binding["node"]] = (binding["kind"], qualifier)
        yield binding


def sampler_bindings(graph):
    for node_id, node in graph.items():
        cls, inputs = node["class_type"], node["inputs"]
        if cls in SAMPLERS | DETAILERS:
            stage = marker(node, "stage", "detail" if cls in DETAILERS else "base")
            for kind, field in {
                "seed": "noise_seed" if cls == "KSamplerAdvanced" else "seed",
                "steps": "steps",
                "cfg": "cfg",
                "denoise": "denoise",
                "sampler": "sampler_name",
                "scheduler": "scheduler",
            }.items():
                value = inputs.get(field)
                if number(value) or isinstance(value, str):
                    yield {
                        "kind": kind,
                        "qualifier": stage,
                        "node": node_id,
                        "field": field,
                    }
        if cls == "MioArtifactOutput":
            yield {"kind": "output", "node": node_id}


def safe_location(item):
    filename, folder = item.get("filename"), item.get("subfolder", "")
    kind = item.get("type", "output")
    if (
        not isinstance(filename, str)
        or not filename
        or re.search(r"[/\\:\x00-\x1f]", filename)
        or filename in {".", ".."}
        or not isinstance(folder, str)
        or re.search(r"[\\:\x00-\x1f]", folder)
        or folder
        and any(part in {"", ".", ".."} for part in folder.split("/"))
        or kind not in {"output", "temp", "input"}
    ):
        raise ValueError("Invalid history artifact location")
    return filename, folder, kind


class ArtifactOutput:
    def freeze(self, node, options):
        if node.get("class_type") != "MioArtifactOutput" or options:
            raise ValueError("This output protocol requires MioArtifactOutput with no options")
        return {"version": 1, "key": "artifacts", "max_images": MAX_IMAGES}

    def collect(self, output, plan, transport):
        if plan != {"version": 1, "key": "artifacts", "max_images": MAX_IMAGES}:
            raise ValueError("Unknown artifact parsing plan")
        items = output.get(plan["key"])
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_IMAGES:
            raise ValueError("Expected one to sixteen history artifacts")
        result = []
        for item in items:
            if not isinstance(item, dict) or bool(item.get("base64")) == bool(item.get("filename")):
                raise ValueError("Artifact requires exactly one byte or file source")
            if "base64" in item:
                value = item["base64"]
                if not isinstance(value, str) or len(value) > (MAX_IMAGE_BYTES + 2) // 3 * 4:
                    raise ValueError("Inline artifact exceeds the byte limit")
                try:
                    payload = base64.b64decode(value, validate=True)
                except ValueError:
                    raise ValueError("Artifact is not valid base64") from None
                if not payload or len(payload) > MAX_IMAGE_BYTES:
                    raise ValueError("Inline artifact exceeds the byte limit")
                result.append(OutputImage("", "artifact.png", "", "output", payload))
            else:
                filename, folder, kind = safe_location(item)
                result.append(OutputImage("", filename, folder, kind))
        return result


def activate(mio):
    mio.contribute("workflow_slot_adapter", "complex-power-stack", PowerStack(), contract=1)
    mio.contribute("workflow_binding", "complex-sampling", sampler_bindings, contract=1)
    mio.contribute("workflow_binding", "complex-references", reference_bindings, contract=1)
    mio.contribute("comfy_output_adapter", "complex-artifacts", ArtifactOutput(), contract=1)
