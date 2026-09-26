"""Reference images per panel (ROADMAP §2.2 "按出场角色自动挂载，也可手动").

``auto``: for every character on stage pick the best reference from the bible:
  back view for back shots, side view for side angles, a matching expression for close-ups,
  a matching outfit whenever possible, then front view / sheet / anything.
``manual``: the panel's own list, in order.  ``off``: none.
Locations and the style reference fill the remaining slots.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from ..comfy.compile import asset_value
from ..models import AssetRef, Bible, Panel

ROLE_BY_ANGLE = {"back": "back", "side": "side"}
CLOSE_SHOTS = {"extreme_close", "close"}


@dataclass
class RefChoice:
    slot: int
    asset_id: str
    role: str
    owner: str  # character / location / style id, or "manual"
    reason: str

    def to_json(self) -> dict:
        return asdict(self)


def _score(ref: AssetRef, want_role: str, outfit: str, expression: str, close: bool) -> tuple:
    return (
        ref.role == want_role,
        bool(ref.outfit) and ref.outfit == outfit,
        close and bool(ref.expression) and ref.expression == expression,
        ref.role in ("front", "sheet"),
        ref.role not in ("style", "expression") or close,
    )


def pick_character_ref(
    refs: list[AssetRef], panel: Panel, outfit: str, expression: str
) -> tuple[AssetRef, str] | None:
    if not refs:
        return None
    close = panel.shot in CLOSE_SHOTS
    want = ROLE_BY_ANGLE.get(
        panel.angle, "expression" if close and expression != "neutral" else "front"
    )
    best = max(refs, key=lambda r: _score(r, want, outfit, expression, close))
    reasons = []
    if best.role == want:
        reasons.append(f"角度/景别匹配 {want}")
    if best.outfit and best.outfit == outfit:
        reasons.append(f"服装 {outfit}")
    if close and best.expression and best.expression == expression:
        reasons.append(f"表情 {expression}")
    return best, "、".join(reasons) or "兜底：第一张可用参考"


def select_references(
    bible: Bible, panel: Panel, max_refs: int = 4, include_scene: bool = True
) -> list[RefChoice]:
    if panel.reference_mode == "off":
        return []
    if panel.reference_mode == "manual":
        return [
            RefChoice(i + 1, r.asset_id, r.role, "manual", "手动指定")
            for i, r in enumerate(panel.references[:max_refs])
        ]
    chosen: list[RefChoice] = []
    for pc in panel.characters:
        ch = bible.character(pc.character_id)
        if not ch or len(chosen) >= max_refs:
            continue
        pick = pick_character_ref(ch.references, panel, pc.outfit, pc.expression)
        if pick:
            ref, why = pick
            chosen.append(RefChoice(len(chosen) + 1, ref.asset_id, ref.role, ch.id, why))
    loc = bible.location(panel.location_id)
    if include_scene and loc and loc.references and len(chosen) < max_refs:
        chosen.append(
            RefChoice(len(chosen) + 1, loc.references[0].asset_id, "reference", loc.id, "场景参考")
        )
    return chosen


def reference_values(choices: list[RefChoice]) -> dict:
    """``{"ref:1": {"$asset": ...}, ...}`` for workflows with ``[mio:ref:N]`` inputs."""
    return {f"ref:{c.slot}": asset_value(c.asset_id) for c in choices}
