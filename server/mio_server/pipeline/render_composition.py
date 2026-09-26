"""ControlNet and regional-prompt values for the render service (mixin).

``prepare_composition`` turns a panel's ``controls`` and ``regional`` flag into a
``$composition`` bundle once per panel; ``resolve_composition`` fits it to each stage's
workflow: only the inputs the workflow declares are filled, missing control images get a blank
image at strength 0 (so a pose workflow still runs for a panel without a pose), and unused
region slots repeat the full prompt over the whole canvas (a neutral no-op).
"""

from __future__ import annotations

from ..models import Episode, Series
from . import composition as CP
from .render_edits import RenderError

KEY = "$composition"


class CompositionMixin:
    assets: object

    def prepare_composition(
        self,
        series: Series,
        episode: Episode,
        panel,
        width: int,
        height: int,
        dialect: str = "tags",
        variant=None,
    ) -> dict:
        controls, warnings = {}, []
        for c in panel.controls:
            asset_id = None
            if c.source == "auto":
                image = CP.pose_image(panel, width, height) if c.kind == "pose" else None
                if image is None:
                    warnings.append(
                        f"{c.kind} 控制图无法自动生成（仅姿势可自动生成，且需要人物、非大特写），已忽略"
                    )
                    continue
                asset_id = self.assets.put(CP.png_bytes(image), source="pose:auto").id
            elif c.source == "asset":
                if not c.asset_id or not self.assets.exists(c.asset_id):
                    raise RenderError(f"第 {panel.order + 1} 格的 {c.kind} 控制图不存在")
                asset_id = c.asset_id
            else:
                take = episode.take(c.take_id or "")
                if take is None:
                    raise RenderError(f"第 {panel.order + 1} 格的 {c.kind} 控制图引用的出图不存在")
                asset_id = take.asset_id
            controls[c.kind] = {"asset": asset_id, "strength": c.strength}
        regions = []
        if panel.regional and len(panel.characters) >= 2:
            for i, region in enumerate(CP.regions(panel)):
                regions.append(
                    {
                        "n": i + 1,
                        "character_id": region["character_id"],
                        "prompt": CP.region_prompt(series, panel, i, dialect, variant),
                        "area": CP.area_value(region["box"]),
                    }
                )
        elif panel.regional:
            warnings.append("分区多角色需要至少两个角色，已按普通提示词出图")
        return {
            "controls": controls,
            "regions": regions,
            "warnings": warnings,
            "size": [width, height],
        }

    def resolve_composition(self, info: dict, values: dict) -> tuple[dict, list[str]]:
        """Values for one workflow (``info`` = ``describe(doc)``) and the warnings to report."""
        values = dict(values)
        prepared = values.pop(KEY, None) or {}
        warnings = list(prepared.get("warnings") or [])
        inputs = {k.split(":", 1)[1] for k in info["image_inputs"] if k.startswith("control:")}
        controls = prepared.get("controls") or {}
        for kind in sorted(inputs):
            key = f"control:{kind}"
            if values.get(key) is not None:
                continue
            if kind in controls:
                values[key] = {"$asset": controls[kind]["asset"]}
                values.setdefault(f"strength:{kind}", controls[kind]["strength"])
            else:
                w, h = values.get("width") or 512, values.get("height") or 512
                blank = self.assets.put(CP.blank_png(int(w), int(h)), source="control:blank")
                values[key] = {"$asset": blank.id}
                values[f"strength:{kind}"] = 0.0
                if prepared:
                    warnings.append(f"工作流需要 {kind} 控制图，本格未设置：用空图并把强度设为 0")
        for kind in sorted(set(controls) - inputs):
            warnings.append(f"本格设置了 {kind} 控制图，但工作流没有 [mio:control:{kind}] 输入")
        slots = sorted(int(q) for q in info.get("regions", []) if str(q).isdigit())
        regions = {r["n"]: r for r in prepared.get("regions") or []}
        full = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
        for n in slots:
            region = regions.get(n)
            values.setdefault(f"region:{n}", region["prompt"] if region else values.get("prompt"))
            values.setdefault(f"area:{n}", region["area"] if region else full)
        if regions and not slots:
            warnings.append("本格开启了分区多角色，但工作流没有 [mio:region:N] 输入")
        elif len(regions) > len(slots) and slots:
            warnings.append(f"本格有 {len(regions)} 个角色分区，工作流只有 {len(slots)} 个")
        return values, warnings
