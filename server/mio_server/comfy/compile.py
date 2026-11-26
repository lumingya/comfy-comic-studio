"""Turn a stored workflow + values into a ready-to-queue graph (pure functions).

Order of operations, each step keeping the user's structure intact (ROADMAP §2.1 "ComfyUI 不做减法"):

1. model / LoRA slot overrides (legacy ``workflow_slots`` plan),
2. resolve explicit bindings and keep the chosen output's actual dependency closure,
3. stabilize inferred bindings after all bound values and pointer overrides,
4. validate slot routes against that final effective graph,
5. content guard on every literal string (negative fields excluded).

Image inputs are written as ``{"$asset": <sha256>}`` placeholders; the executor uploads the files
to the chosen instance and substitutes the returned names just before queueing.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from pathlib import Path

from ..render_models import OutputAdapterConfig, WorkflowConfig, WorkflowDoc
from . import adapters
from . import bindings as B
from . import contracts as AC
from . import slot_adapters as SA
from . import workflow_slots as slots
from .client import ComfyError
from .workflow_slot_graph import Graph

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
PREVIOUS = "__previous__"


@dataclass
class Compiled:
    graph: dict
    outputs: list[str]
    inspect: list[str]
    uploads: dict[str, str] = field(default_factory=dict)  # "/node/inputs/field" → asset id
    bindings: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    checkpoint: str = ""
    frontend_state: dict = field(default_factory=dict)
    output_adapters: dict = field(default_factory=dict)
    resolved_bindings: list[B.Binding] = field(default_factory=list, repr=False)

    def to_json(self) -> dict:
        return {
            "graph": self.graph,
            "outputs": self.outputs,
            "inspect": self.inspect,
            "uploads": self.uploads,
            "bindings": self.bindings,
            "warnings": self.warnings,
            "checkpoint": self.checkpoint,
            "frontend_state": copy.deepcopy(self.frontend_state),
            "output_adapters": copy.deepcopy(self.output_adapters),
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


def validate_plan(graph: dict, plan: dict, registry=None) -> None:
    """Reject hook changes that no longer match the compiled frontend-state snapshot."""
    if not isinstance(plan, dict):
        raise B.BindingError("工作流参数面板快照必须是对象")
    expected = adapters.stateful_nodes(graph)
    expected.update({nid: graph.get(nid, {}).get("class_type") for nid in plan})
    if set(expected) != set(plan):
        raise B.BindingError("工作流参数面板节点与编译快照不一致，请重新编译工作流")
    for node_id, class_type in expected.items():
        item = plan[node_id]
        if not isinstance(item, dict) or item.get("class_type") != class_type:
            raise B.BindingError(f"节点 {node_id} 的参数面板类型与编译快照不一致")
        try:
            desired = adapters.desired_state(
                class_type,
                item.get("saved"),
                item.get("changes"),
                ref=item.get("adapter"),
                registry=registry,
            )
            if item.get("desired") != desired:
                raise ComfyError("参数面板目标值与编译快照不一致")
        except ComfyError as exc:
            raise B.BindingError(f"节点 {node_id}：{exc}") from exc


def _frontend_plan(doc: WorkflowDoc, graph: dict, variant: dict, registry=None) -> dict:
    state = variant.get("state", {})
    frontend = variant.get("frontend", {})
    if not isinstance(state, dict) or not isinstance(frontend, dict):
        raise B.BindingError("变体的 state 和 frontend 必须是按节点 ID 索引的对象")
    for source in (doc.config.state, doc.config.frontend, state, frontend):
        for node_id in source:
            original = doc.graph.get(node_id)
            if original is None or (
                original.get("class_type") not in adapters.ADAPTERS
                and node_id not in doc.config.state_adapters
            ):
                raise B.BindingError(f"配置指向不存在或类型不匹配的参数面板节点 {node_id}")
            if node_id in graph and graph[node_id].get("class_type") != original["class_type"]:
                raise B.BindingError(f"节点 {node_id} 的参数面板类型已改变")
    saved = _merge(doc.config.state, state)
    plan = {}
    nodes = adapters.stateful_nodes(graph)
    for nid in doc.config.state_adapters:
        if nid not in doc.graph:
            raise B.BindingError(f"状态适配器指向不存在的节点 {nid}")
        if nid in graph:
            nodes[nid] = graph[nid]["class_type"]
    for node_id, class_type in nodes.items():
        if doc.graph.get(node_id, {}).get("class_type") != class_type:
            raise B.BindingError(f"节点 {node_id} 的参数面板类型已改变")
        base_changes = doc.config.frontend.get(node_id, {})
        variant_changes = frontend.get(node_id, {})
        if not isinstance(base_changes, dict) or not isinstance(variant_changes, dict):
            raise B.BindingError(f"节点 {node_id} 的 frontend 必须是参数名称到值的对象")
        changes = _merge(base_changes, variant_changes)
        snapshot = copy.deepcopy(saved.get(node_id))
        try:
            ref = AC.select(
                registry,
                "comfy_state_adapter",
                doc.config.state_adapters.get(node_id, "parameter-control-panel"),
            )
            desired = adapters.desired_state(
                class_type, snapshot, changes, ref=ref, registry=registry
            )
        except ComfyError as exc:
            raise B.BindingError(f"节点 {node_id}：{exc}") from exc
        plan[node_id] = {
            "adapter": ref,
            "class_type": class_type,
            "saved": snapshot,
            "changes": copy.deepcopy(changes),
            "desired": desired,
        }
    validate_plan(graph, plan, registry)
    return plan


def validate_outputs(graph: dict, plans: dict, registry=None) -> None:
    """A render hook cannot silently change a frozen adapter's node or parsing plan."""
    for node_id, frozen in plans.items():
        node = graph.get(node_id)
        if not node or node.get("class_type") != frozen["class_type"]:
            raise B.BindingError(f"输出节点 {node_id} 与适配器快照不一致")
        adapter = AC.resolve(registry, frozen["adapter"])
        expected = AC.json_copy(
            adapter.freeze(copy.deepcopy(node), AC.json_copy(frozen["options"]))
        )
        if expected != frozen["plan"]:
            raise B.BindingError(f"输出节点 {node_id} 的解析计划与编译快照不一致")


def _effective_bindings(
    graph, mapping, merged, pointers, variant, rules, syntax_targets, *, prune=True
):
    """Infer writable targets from the same selector state that will be submitted.

    Bindings can themselves change selectors, so infer again after each complete write.
    Each pass starts from the same base to avoid leaving writes in obsolete branches.
    Output selection uses actual links, retaining inactive switch inputs and ignoring
    overrides in other variants. Extension rules run once against the original graph.
    """
    tags, problems = B.tag_bindings(graph)
    maps = B.mapping_bindings(graph, mapping)
    have = {binding.kind for binding in tags + maps}
    extra, rule_problems = B.rule_bindings(graph, rules, have)
    explicit = tags + maps + extra
    if "output" not in have:
        explicit += B.heuristic_bindings(graph, {"output"})
    effective = B.apply_values(graph, explicit, merged)
    SA.preserve_bound_tags(graph, effective, syntax_targets)
    if prune:
        graph, outputs = B.select_variant(effective, explicit, variant)
    else:
        graph = effective
        outputs = sorted({binding.node for binding in explicit if binding.kind == "output"})
    effective = B.apply_overrides(graph, pointers)
    explicit = [binding for binding in explicit if binding.node in graph]
    have = {binding.kind for binding in explicit}
    missing = (
        set(B.CORE_KINDS) | {"batch", "steps", "cfg", "denoise", "sampler", "scheduler"}
    ) - have
    occupied = {(binding.node, binding.field): binding.kind for binding in explicit}
    syntax_targets = {target for target in syntax_targets if target[0] in graph}
    seen = set()
    previous = None
    for _ in range(64):
        inferred = tuple(
            binding
            for binding in B.heuristic_bindings(effective, missing, roots=outputs)
            if (binding.node, binding.field) not in occupied
            or occupied[binding.node, binding.field] == binding.kind
        )
        if inferred == previous:
            return effective, explicit + list(inferred), outputs, problems + rule_problems
        if inferred in seen:
            break
        seen.add(inferred)
        previous = inferred
        effective = B.apply_values(graph, explicit + list(inferred), merged)
        SA.preserve_bound_tags(graph, effective, syntax_targets)
        effective = B.apply_overrides(effective, pointers)
    raise B.BindingError(
        "参数写入后自动绑定的分支无法稳定，无法安全确定提示词或尺寸的写入目标。"
        "请将分支选择与生成参数拆为独立节点，或固定分支并显式映射参数后重试。"
    )


def _validate_slot_routes(plan, changes, effective):
    """Do not silently apply a frozen LoRA request to an obsolete selected branch."""
    all_groups = "loras" in changes or bool(changes.get("unpin"))
    requested = {group["key"] for group in changes.get("groups", [])}
    routes = Graph(effective, None)
    for group in plan["lora"]["groups"]:
        if not all_groups and group["key"] not in requested:
            continue
        for site in group["sites"]:
            if site["nodeId"] not in effective:
                continue
            if site.get("active", group["active"]) != routes.active(site["nodeId"])[0]:
                raise B.BindingError(
                    "分支参数覆盖改变了所选 LoRA 的活动路径，无法安全冻结该 LoRA 覆盖。"
                    "请先在工作流中固定分支，重新导入并选择 LoRA 槽位；"
                    "或保留当前分支后再调整 LoRA。"
                )


def compile_workflow(
    doc: WorkflowDoc,
    values: dict,
    *,
    variant: str | None = None,
    overrides: dict | None = None,
    stage_values: dict | None = None,
    slot_overrides: dict | None = None,
    guard: list[str] | None = None,
    rules: B.BindingRules = (),
    registry=None,
) -> Compiled:
    config: WorkflowConfig = doc.config
    var_cfg = config.variants.get(variant or "", {}) if variant else {}
    graph = copy.deepcopy(doc.graph)
    warnings: list[str] = []
    syntax_targets: set[tuple[str, str]] = set()
    merged_slot_overrides = slots.merge_overrides(config.slot_overrides, slot_overrides)
    if merged_slot_overrides:
        installed = SA.installed(registry)
        plan = slots.ensure_plan(graph, doc.slots, adapters=installed)
        applied = slots.apply(graph, plan, merged_slot_overrides, adapters=installed)
        graph = applied["workflow"]
        warnings.extend(applied["notices"])
        syntax_targets = SA.syntax_targets(applied["plan"])
    merged = _merge(config.values, var_cfg.get("values"), stage_values, values)
    pointers = _merge(config.overrides, var_cfg.get("overrides"), overrides)
    graph, bound, outputs, problems = _effective_bindings(
        graph, config.mapping or None, merged, pointers, variant, rules, syntax_targets
    )
    if merged_slot_overrides:
        _validate_slot_routes(applied["plan"], merged_slot_overrides, graph)
    warnings.extend(problems)
    for kind in sorted(B.VALUE_KINDS):
        wanted = [k for k in merged if k == kind or k.startswith(kind + ":")]
        for key in wanted:
            base, _, qual = key.partition(":")
            if merged[key] is None:
                continue
            if not any(
                b.kind == base
                and (
                    not qual
                    or b.qualifier == qual
                    or (b.qualifier is None and (base != "ref" or qual == "1"))
                )
                for b in bound
            ):
                if base in IMAGE_KINDS:
                    raise B.BindingError(f"工作流里没有 [mio:{key}] 输入节点，无法接收图片")
                warnings.append(
                    f"工作流没有 {key} 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。"
                )
    frontend_state = _frontend_plan(doc, graph, var_cfg, registry)
    output_adapters = {}
    selected_adapters = {node_id: OutputAdapterConfig(id="history-images") for node_id in outputs}
    selected_adapters.update(doc.config.output_adapters)
    for node_id, adapter_config in selected_adapters.items():
        if node_id not in doc.graph:
            raise B.BindingError(f"输出适配器指向不存在的节点 {node_id}")
        if node_id not in graph:
            continue
        try:
            ref = AC.select(registry, "comfy_output_adapter", adapter_config.id)
            plan = AC.resolve(registry, ref).freeze(
                copy.deepcopy(graph[node_id]), AC.json_copy(adapter_config.options)
            )
            output_adapters[node_id] = {
                "adapter": ref,
                "plan": AC.json_copy(plan),
                "options": AC.json_copy(adapter_config.options),
                "class_type": graph[node_id]["class_type"],
            }
        except (KeyError, ValueError, ComfyError) as exc:
            raise B.BindingError(f"节点 {node_id} 输出适配器配置错误：{exc}") from exc
        if node_id not in outputs:
            outputs.append(node_id)
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
        frontend_state=frontend_state,
        output_adapters=output_adapters,
        resolved_bindings=[binding for binding in bound if binding.node in graph],
    )


def describe(doc: WorkflowDoc, *, rules: B.BindingRules = ()) -> dict:
    """Binding report for the UI: which Mio values land where, and which variants exist."""
    graph, bound, _, problems = _effective_bindings(
        doc.graph,
        doc.config.mapping or None,
        doc.config.values,
        doc.config.overrides,
        None,
        rules,
        set(),
        prune=False,
    )
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
        "checkpoint": primary_checkpoint(graph, bound),
    }
