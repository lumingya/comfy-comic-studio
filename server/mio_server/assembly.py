"""Pure workshop snapshot construction and local prompt inspection."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from .generation import profile_for
from .models import Episode, Panel, Series
from .pipeline import cloud_request as CR
from .pipeline import compiler
from .pipeline import variables as V
from .storage import NotFound


class AssemblyVariable(BaseModel):
    key: str
    field: str
    value: str | None
    source: Literal["builtin", "workshop", "preset", "request", "panel", "missing"]
    source_id: str | None = None
    source_title: str | None = None
    status: Literal["resolved", "empty", "missing", "cycle", "depth_limit"]
    chain: list[str]


class AssemblyPanelPreview(BaseModel):
    panel_id: str
    title: str
    order: int
    profile_id: str
    dialect: Literal["tags", "natural"]
    positive: str
    negative: str
    dialogues: list[str]
    variables: list[AssemblyVariable]


class AssemblyPreview(BaseModel):
    title: str
    storyboard_id: str
    profile_id: str
    preset_ids: list[str]
    panels: list[AssemblyPanelPreview]


@dataclass
class AssemblySnapshot:
    series: Series
    episode: Episode
    sources: dict[str, dict]


def build_snapshot(
    workshop: Series,
    board: Episode,
    preset_ids: list[str],
    title: str,
    profile_id: str | None = None,
    variables: dict[str, str] | None = None,
) -> AssemblySnapshot:
    """Build fresh domain objects without persisting or mutating any source object."""
    if board.series_id != workshop.id:
        raise NotFound(f"storyboard not found: {board.id}")
    by_id = {preset.id: preset for preset in workshop.presets}
    for pid in preset_ids:
        if pid not in by_id:
            raise NotFound(f"preset not found: {pid}")
    if not board.panels:
        raise ValueError("分镜还没有分幕，请先添加至少一幕再装配")
    values = dict(workshop.variables)
    sources = {
        key: {"source": "workshop", "source_id": workshop.id, "source_title": workshop.title}
        for key in values
    }
    for pid in preset_ids:
        preset = by_id[pid]
        values.update(preset.variables())
        sources.update(
            {
                key: {"source": "preset", "source_id": pid, "source_title": preset.title}
                for key in preset.variables()
            }
        )
    values.update(variables or {})
    sources.update({key: {"source": "request"} for key in variables or {}})
    album = Series(
        title=title.strip() or board.title,
        kind="album",
        presets=[by_id[pid].model_copy(deep=True) for pid in preset_ids],
        bible=workshop.bible.model_copy(deep=True),
        variants=[variant.model_copy(deep=True) for variant in workshop.variants],
        variables=values,
        default_profile_id=profile_id or workshop.default_profile_id,
        generation_defaults=workshop.generation_defaults.model_copy(deep=True)
        if workshop.generation_defaults
        else None,
    )
    episode = Episode(
        series_id=album.id,
        title=board.title,
        order=0,
        synopsis=board.synopsis,
        base_prompt=board.base_prompt,
        panels=[panel.model_copy(deep=True) for panel in board.ordered_panels()],
        strip=board.strip.model_copy(deep=True),
    )
    return AssemblySnapshot(album, episode, sources)


def _fields(panel: Panel) -> dict[str, str]:
    ov = panel.overrides
    if ov.raw_prompt is not None:
        fields = {"overrides.raw_prompt": ov.raw_prompt}
        if ov.raw_negative is not None:
            fields["overrides.raw_negative"] = ov.raw_negative
    else:
        fields = {
            "overrides.append_prompt": ov.append_prompt,
            "overrides.negative_prompt": ov.negative_prompt,
        }
    fields.update({f"dialogues.{i}.text": d.text for i, d in enumerate(panel.dialogues)})
    return fields


def inspect_snapshot(store, snapshot: AssemblySnapshot, storyboard_id: str) -> AssemblyPreview:
    series, episode = snapshot.series, snapshot.episode
    default_profile = series.default_profile_id or "profile_default"
    panels = []
    for panel in episode.ordered_panels():
        profile = profile_for(store, series, panel.overrides.profile_id)
        compiled = compiler.preview(series, episode, panel, profile=profile)[profile.dialect]
        channel = (
            series.generation.channels.get(profile.cloud_channel) if series.generation else None
        )
        if profile.cloud_shape and channel:
            requested = {
                "prompt": compiled["positive"],
                "negative": compiled["negative"],
                "width": compiled["width"],
                "height": compiled["height"],
                "seed": compiled["seed"],
                "refs": [],
                "reference_mode": panel.reference_mode,
            }
            if series.generation:
                for name in ("width", "height"):
                    if (
                        getattr(series.generation, name) is None
                        and getattr(panel.overrides, name) is None
                    ):
                        requested[name] = None
            effective = CR.snapshot(
                {
                    "channel_id": profile.cloud_channel,
                    "kind": channel["kind"],
                    "model": channel["model"],
                    "options": {**channel["options"], "seed": compiled["seed"]},
                    "requested": requested,
                }
            )["effective"]
            compiled["positive"], compiled["negative"] = effective["prompt"], effective["negative"]
        values = V.table(series, panel)
        sources = {key: {"source": "builtin"} for key in values}
        sources.update(snapshot.sources)
        sources.update(
            {
                key[1:]: {"source": "panel", "source_id": panel.id}
                for key in panel.overrides.values
                if key.startswith("$")
            }
        )
        variables = [
            AssemblyVariable(**row, field=field, **sources.get(row["key"], {"source": "missing"}))
            for field, text in _fields(panel).items()
            for row in V.trace(text, values)
        ]
        panels.append(
            AssemblyPanelPreview(
                panel_id=panel.id,
                title=panel.description or f"第{panel.order + 1}幕",
                order=panel.order,
                profile_id=profile.id,
                dialect=profile.dialect,
                positive=compiled["positive"],
                negative=compiled["negative"],
                dialogues=[V.display(dialogue.text, values) for dialogue in panel.dialogues],
                variables=variables,
            )
        )
    return AssemblyPreview(
        title=series.title,
        storyboard_id=storyboard_id,
        profile_id=series.generation.profile.get("id", default_profile)
        if series.generation
        else default_profile,
        preset_ids=[preset.id for preset in series.presets],
        panels=panels,
    )
