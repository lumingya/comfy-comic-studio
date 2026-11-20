"""Compile and freeze staged ComfyUI workflows and per-panel slot overrides.

Mixed into RenderService; uses its workflow lookup, composition preparation, hooks,
binding rules and engine registry. Compilation is independent of job submission.
"""

from __future__ import annotations

import hashlib

from ..comfy import bindings as B
from ..comfy import slot_adapters as SA
from ..comfy import workflow_slots as slots
from ..comfy.compile import PREVIOUS, asset_value, compile_workflow, describe
from ..comfy.workflow_slots import LibraryError
from ..render_models import RenderStage
from .render_edits import RenderError


class RenderCompilationMixin:
    def _compile_stage(
        self,
        stage: RenderStage,
        values: dict,
        overrides: dict | None = None,
        loras: list[dict] | None = None,
        slot_overrides: dict | None = None,
        variant: str | None = None,
    ) -> tuple[dict, list[str], list[str]]:
        doc = self.workflow(stage.workflow_id)
        rules = tuple(self.binding_rules())
        info = describe(doc, rules=rules)
        values, composition_warnings = self.resolve_composition(info, values)
        for key in [k for k in values if k.startswith("ref:")]:
            if key not in info["image_inputs"] and not (
                key == "ref:1" and "ref" in info["image_inputs"]
            ):
                values.pop(key)  # workflow has no reference input: references are simply not used
        slot = (
            {
                "loras": [
                    {
                        "name": l["name"],
                        "strength": l.get("strength_model", 1.0),
                        "clip": l.get("strength_clip", l.get("strength_model", 1.0)),
                        "enabled": l.get("enabled", True),
                        **(
                            {"key": "reference:" + hashlib.sha256(l["key"].encode()).hexdigest()}
                            if l.get("key")
                            else {}
                        ),
                    }
                    for l in loras
                ]
            }
            if loras
            else None
        )
        slot = slots.merge_overrides(slot, stage.slot_overrides, slot_overrides)
        warnings = list(composition_warnings)
        try:
            compiled = compile_workflow(
                doc,
                values,
                variant=stage.variant or variant,
                overrides={**stage.overrides, **(overrides or {})},
                stage_values=stage.values,
                slot_overrides=slot,
                rules=rules,
                registry=self.engine.registry,
            )
        except LibraryError as exc:
            if doc.config.slot_overrides or stage.slot_overrides or slot_overrides:
                raise RenderError(f"{doc.name}：{exc}") from None
            warnings.append(f"LoRA 未写入（{exc}），按工作流原样运行")
            compiled = compile_workflow(
                doc,
                values,
                variant=stage.variant or variant,
                overrides={**stage.overrides, **(overrides or {})},
                stage_values=stage.values,
                rules=rules,
                registry=self.engine.registry,
            )
        except B.BindingError as exc:
            raise RenderError(f"{doc.name}：{exc}") from None
        data = compiled.to_json()
        data["graph"] = self.hooks.filter(
            "render.workflow", data["graph"], workflow_id=doc.id, stage=stage.kind
        )
        from ..comfy.compile import validate_outputs, validate_plan

        try:
            validate_plan(data["graph"], data["frontend_state"], self.engine.registry)
            validate_outputs(data["graph"], data["output_adapters"], self.engine.registry)
        except B.BindingError as exc:
            raise RenderError(f"{doc.name}：{exc}") from None
        data["warnings"] = warnings + data["warnings"]
        data["workflow_id"], data["stage_id"], data["kind"] = doc.id, stage.id, stage.kind
        feed = [p for p, a in data["uploads"].items() if a == PREVIOUS]
        if feed:
            data["uploads"] = {p: a for p, a in data["uploads"].items() if a != PREVIOUS}
        return data, feed, data["warnings"]

    def _chain(
        self,
        stages: list[RenderStage],
        first_values: dict,
        later_values: dict,
        overrides: dict,
        loras: list[dict],
        slot_overrides: dict | None = None,
        start_with_previous: bool = False,
        *,
        require_panel_groups: bool = True,
    ) -> tuple[list[dict], list[list[str]]]:
        compiled, feeds = [], []
        active = [s for s in stages if s.enabled]
        if not active:
            raise RenderError("出图配置里没有启用的阶段")
        panel_slots = self._panel_slots_by_stage(active, slot_overrides, require_panel_groups)
        for n, stage in enumerate(active):
            if stage.feed_output and (n == 0 or stage.feed != "previous"):
                raise RenderError("输出选择只适用于接收上一阶段图片的后续阶段")
            chained = (n > 0 or start_with_previous) and stage.feed == "previous"
            values = dict(first_values if n == 0 else later_values)
            if chained and n > 0:
                values["init"] = asset_value(PREVIOUS)
            data, feed, _ = self._compile_stage(
                stage, values, overrides, loras, slot_overrides=panel_slots[n]
            )
            if stage.feed_output:
                if stage.feed_output.node_id not in compiled[-1]["outputs"]:
                    raise RenderError(f"上一阶段没有输出节点 {stage.feed_output.node_id}")
                data["feed_output"] = stage.feed_output.model_dump()
            if chained and n > 0 and not feed:
                raise RenderError(
                    f"阶段 {stage.id} 要接收上一阶段的图片，但工作流没有 [mio:init] 输入"
                )
            compiled.append(data)
            feeds.append(feed if n > 0 else [])
        return compiled, feeds

    def _panel_slots_by_stage(self, stages, overrides, require_panel_groups):
        if not overrides:
            return [None] * len(stages)
        common = slots.normalize_overrides(overrides)
        groups = common.pop("groups", [])
        workflow_id = overrides.get("workflow_id")
        if workflow_id is not None and (not isinstance(workflow_id, str) or not workflow_id):
            raise RenderError("分幕 LoRA 覆盖的工作流 ID 无效")
        if not groups:
            return [common] * len(stages)
        available = SA.installed(self.engine.registry)
        by_workflow = {}
        matched = set()
        for stage in stages:
            if stage.workflow_id in by_workflow:
                continue
            if workflow_id is not None and workflow_id != stage.workflow_id:
                by_workflow[stage.workflow_id] = common
                continue
            doc = self.workflow(stage.workflow_id)
            plan = slots.ensure_plan(doc.graph, doc.slots, adapters=available)
            known = {group["key"] for group in plan["lora"]["groups"]}
            selected = [group for group in groups if group["key"] in known]
            matched.update(group["key"] for group in selected)
            by_workflow[stage.workflow_id] = {
                **common,
                **({"groups": selected} if selected else {}),
            }
        relevant = workflow_id is None or any(stage.workflow_id == workflow_id for stage in stages)
        if (require_panel_groups or workflow_id is not None) and relevant:
            if {group["key"] for group in groups} - matched:
                raise RenderError("分幕 LoRA 槽位不在所选工作流中")
        return [by_workflow[stage.workflow_id] for stage in stages]
