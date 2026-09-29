"""Node inputs a frame's render writes by JSON Pointer: preset bindings + frame overrides."""

from __future__ import annotations

from ..comfy.bindings import BindingError
from ..models import Series, coerce_binding
from . import variables as V


def node_overrides(series: Series, panel) -> dict:
    """JSON Pointer → value for this frame: the album's preset bindings (legacy 预设「LoRA / 节点
    输入绑定」, later presets win), then the frame's own node overrides on top.  A binding to an
    empty variable keeps the workflow's value."""
    own = dict(panel.overrides.node_overrides) if panel else {}
    if series.kind == "workshop" or not any(p.bindings for p in series.presets):
        return own
    table = V.table(series, panel) if panel else dict(series.variables)
    out: dict = {}
    for preset in series.presets:
        for b in preset.bindings:
            if not b.enabled:
                continue
            if b.source == "variable":
                raw = V.expand(str(table.get(b.value, "")), table)
                if not raw.strip():
                    continue
            else:
                raw = V.expand(b.value, table)
            try:
                out[b.pointer] = coerce_binding(raw, b.type)
            except ValueError as exc:
                raise BindingError(
                    f"预设「{preset.title}」的绑定 {b.node_id} · {b.path}：{exc}"
                ) from None
    return {**out, **own}
