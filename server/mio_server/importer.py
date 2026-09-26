"""One-shot importer from the frozen v2 data files into v3 domain objects.

The importer is intentionally conservative: it keeps the old prompt text in panel overrides, maps
captions to narration, turns preset variables into a small Bible, and stores workflow JSON as
RenderProfile documents for later ComfyUI execution.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .models import Character, Dialogue, DialogueKind, Episode, Location, Panel, Series, Style

CAMERA_SHOTS = {
    "close-up": "close",
    "close up": "close",
    "medium shot": "medium",
    "full shot": "full",
    "wide shot": "wide",
    "low angle": "wide",
}


@dataclass
class RenderProfile:
    id: str
    title: str
    workflow: dict[str, Any]
    mapping: dict[str, Any] = field(default_factory=dict)
    bindings: list[dict[str, Any]] = field(default_factory=list)
    slots: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {"id": self.id, "title": self.title, "workflow": self.workflow,
                "mapping": self.mapping, "bindings": self.bindings, "slots": self.slots}


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _variables(preset: dict[str, Any]) -> dict[str, str]:
    return {entry.get("key", ""): str(entry.get("value", "")) for entry in preset.get("entries") or []}


def series_from_legacy(storyboard: dict[str, Any], preset: dict[str, Any] | None = None) -> Series:
    vars_ = _variables(preset or {})
    title = storyboard.get("title") or "导入作品"
    series = Series(title=title, subtitle=storyboard.get("outline", ""))
    character_name = vars_.get("character_display_name") or vars_.get("character")
    if character_name:
        tags = [t.strip() for t in ",".join([vars_.get("character", ""), vars_.get("outfit", "")]).split(",") if t.strip()]
        series.bible.characters.append(Character(name=character_name, age=20, description=vars_.get("character", character_name), tag_description=tags, appearance=tags[:]))
    if vars_.get("scene"):
        series.bible.locations.append(Location(name="导入场景", description=vars_["scene"], tags=[vars_["scene"]]))
    if vars_.get("style"):
        series.bible.styles.append(Style(name="导入画风", description=vars_["style"], tag_description=[vars_["style"]]))
    return series


def episode_from_legacy(storyboard: dict[str, Any], series_id: str, preset: dict[str, Any] | None = None) -> Episode:
    vars_ = _variables(preset or {})
    char_id = ""
    if vars_.get("character_display_name") or vars_.get("character"):
        char_id = "legacy_main_character"
    panels: list[Panel] = []
    for index, frame in enumerate(storyboard.get("frames") or []):
        caption = str(frame.get("caption") or "")
        dialogues = [Dialogue(text=caption, kind=DialogueKind.narration)] if caption else []
        camera = str(frame.get("camera") or "medium").lower()
        panel = Panel(
            id=str(frame.get("id") or f"legacy_panel_{index + 1:03d}"),
            order=index,
            shot=CAMERA_SHOTS.get(camera, camera.replace(" ", "_") or "medium"),
            description=str(frame.get("name") or frame.get("prompt") or ""),
            dialogues=dialogues,
            location_id="legacy_location" if vars_.get("scene") else None,
            aspect_ratio=f"{int(frame.get('width') or 768)}:{int(frame.get('height') or 1024)}",
        )
        prompt = str(frame.get("prompt") or "")
        if prompt:
            panel.overrides.raw_prompt = prompt
        if frame.get("negative"):
            panel.overrides.negative_prompt = str(frame["negative"])
        if isinstance(frame.get("seed"), int) and frame["seed"] >= 0:
            panel.overrides.seed = frame["seed"]
        if isinstance(frame.get("nodeOverrides"), dict):
            panel.overrides.node_overrides = frame["nodeOverrides"]
        panels.append(panel)
    return Episode(series_id=series_id, title=storyboard.get("title") or "导入话", order=0, panels=panels)


def workflow_profile_from_legacy(workflow_doc: dict[str, Any]) -> RenderProfile:
    return RenderProfile(
        id=str(workflow_doc.get("id") or "legacy_workflow"),
        title=str(workflow_doc.get("title") or "导入工作流"),
        workflow=workflow_doc.get("workflow") or {},
        mapping=workflow_doc.get("mapping") or {},
        bindings=workflow_doc.get("bindings") or [],
        slots=workflow_doc.get("slots") or {},
    )
