"""Turn a stored workflow + values into a ready-to-queue graph (pure functions).

Order of operations, each step keeping the user's structure intact (ROADMAP §2.1 "ComfyUI 不做减法"):

1. model / LoRA slot overrides (legacy ``workflow_slots`` plan),
2. bind values: ``[mio:*]`` tags → manual JSON Pointer mapping → heuristics,
3. keep only the chosen output variant and its ancestors,
4. JSON Pointer overrides (workflow config → variant → stage → panel),
5. content guard on every literal string (negative fields excluded).

Image inputs are written as ``{"$asset": <sha256>}`` placeholders; the executor uploads the files
to the chosen instance and substitutes the returned names just before queueing.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from pathlib import Path

from ..render_models import WorkflowConfig, WorkflowDoc
from . import bindings as B
from . import workflow_slots as slots

BUILTIN_DIR = Path(__file__).resolve().parent.parent / "workflows"
BUILTINS = {
    "builtin_t2i_sdxl": ("SDXL 文生图（内置）", "t2i_sdxl.json"),
    "builtin_i2i_tile": ("SDXL 图生图 + tile 统一画风（内置）", "i2i_tile.json"),
    "builtin_inpaint_sdxl": ("SDXL 局部重绘 / 外扩（内置）", "inpaint_sdxl.json"),
    "builtin_t2i_sdxl_regions": ("SDXL 文生图 + 双人分区（内置）", "t2i_sdxl_regions.json"),
    "builtin_t2i_sdxl_pose": (
        "SDXL 文生图 + 姿势 ControlNet + 双人分区（内置，需自备 OpenPose 模型）",
        "t2i_sdxl_pose.json",
    ),
}
IMAGE_KINDS = ("init", "mask", "ref", "control")


@dataclass
class Compiled:
    graph: dict
    outputs: list[str]
    inspect: list[str]
    uploads: dict[str, str] = field(default_factory=dict)  # "/node/inputs/field" → asset id
    bindings: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    checkpoint: str = ""

    def to_json(self) -> dict:
        return {
            "graph": self.graph,
            "outputs": self.outputs,
            "inspect": self.inspect,
            "uploads": self.uploads,
            "bindings": self.bindings,
            "warnings": self.warnings,
            "checkpoint": self.checkpoint,
        }


def builtin_workflows() -> list[WorkflowDoc]:
    docs = []
    for wid, (name, filename) in BUILTINS.items():
        graph = json.loads((BUILTIN_DIR / filename).read_text(encoding="utf-8"))
        docs.append(WorkflowDoc(id=wid, name=name, graph=graph, source="builtin"))
    return docs


def asset_value(asset_id: str) -> dict:
    return {"$asset": asset_id}


def _merge(*dicts) -> dict:
    out: dict = {}
    for d in dicts:
        out.update(d or {})
    return out


def find_placeholders(graph: dict) -> dict[str, str]:
    found = {}
    for node_id, node in graph.items():
        for key, value in (node.get("inputs") or {}).items():
            if isinstance(value, dict) and set(value) == {"$asset"}:
                found[f"/{node_id}/inputs/{key}"] = value["$asset"]
    return found


def fill_placeholders(graph: dict, names: dict[str, str]) -> dict:
    """``names``: asset id → uploaded file name on the instance."""
    out = copy.deepcopy(graph)
    for node in out.values():
        for key, value in list((node.get("inputs") or {}).items()):
            if isinstance(value, dict) and set(value) == {"$asset"}:
                node["inputs"][key] = names[value["$asset"]]
    return out


def primary_checkpoint(graph: dict, bound: list[B.Binding]) -> str:
    for b in bound:
        if b.kind == "checkpoint" and b.node in graph:
            value = graph[b.node]["inputs"].get(b.field or "ckpt_name")
            if isinstance(value, str):
                return value
    for node in graph.values():
        for key in ("ckpt_name", "unet_name"):
            if isinstance((node.get("inputs") or {}).get(key), str):
                return node["inputs"][key]
    return ""


def compile_workflow(
    doc: WorkflowDoc,
    values: dict,
    *,
    variant: str | None = None,
    overrides: dict | None = None,
    stage_values: dict | None = None,
    slot_overrides: dict | None = None,
    guard: list[str] | None = None,
) -> Compiled:
    config: WorkflowConfig = doc.config
    var_cfg = config.variants.get(variant or "", {}) if variant else {}
    graph = copy.deepcopy(doc.graph)
    warnings: list[str] = []
    if slot_overrides and (slot_overrides.get("model") or slot_overrides.get("loras")):
        applied = slots.apply(graph, doc.slots or {}, slot_overrides)
        graph = applied["workflow"]
        warnings.extend(applied["notices"])
    bound, problems = B.resolve(graph, config.mapping or None)
    warnings.extend(problems)
    merged = _merge(config.values, var_cfg.get("values"), stage_values, values)
    for kind in ("prompt", "region") + IMAGE_KINDS:
        wanted = [k for k in merged if k == kind or k.startswith(kind + ":")]
        for key in wanted:
            base, _, qual = key.partition(":")
            if merged[key] is None:
                continue
            if not any(b.kind == base and (not qual or b.qualifier in (None, qual)) for b in bound):
                if base in IMAGE_KINDS:
                    raise B.BindingError(f"工作流里没有 [mio:{key}] 输入节点，无法接收图片")
                warnings.append(f"工作流没有 {key} 的绑定，值被忽略")
    graph = B.apply_values(graph, bound, merged)
    graph, outputs = B.select_variant(graph, bound, variant)
    graph = B.apply_overrides(graph, _merge(config.overrides, var_cfg.get("overrides"), overrides))
    terms = list(config.guard) + list(guard or [])
    if terms:
        skip = [(b.node, b.field) for b in bound if b.kind == "negative" and b.field]
        hits = B.guard_terms(graph, terms, skip)
        if hits:
            shown = "、".join(sorted({t for _, _, t in hits}))
            raise B.BindingError(f"提交前拦截：工作流文本里含有拦截词（{shown}）")
    warnings.extend(B.lint_outputs(graph, outputs))
    inspect = sorted({b.node for b in bound if b.kind == "inspect" and b.node in graph})
    return Compiled(
        graph=graph,
        outputs=outputs,
        inspect=inspect,
        uploads=find_placeholders(graph),
        bindings=B.summary([b for b in bound if b.node in graph]),
        warnings=warnings,
        checkpoint=primary_checkpoint(graph, bound),
    )


def describe(doc: WorkflowDoc) -> dict:
    """Binding report for the UI: which Mio values land where, and which variants exist."""
    bound, problems = B.resolve(doc.graph, doc.config.mapping or None)
    variants = sorted({b.qualifier for b in bound if b.kind == "output" and b.qualifier})
    image_inputs = sorted(
        {
            b.kind + (f":{b.qualifier}" if b.qualifier else "")
            for b in bound
            if b.kind in IMAGE_KINDS
        }
    )
    regions = sorted({b.qualifier for b in bound if b.kind == "region" and b.qualifier})
    return {
        "bindings": B.summary(bound),
        "problems": problems,
        "variants": variants,
        "image_inputs": image_inputs,
        "regions": regions,
        "nodes": len(doc.graph),
        "checkpoint": primary_checkpoint(doc.graph, bound),
    }
