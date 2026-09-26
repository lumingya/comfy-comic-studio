from __future__ import annotations

from pydantic import BaseModel

from .models import Episode


class Slice(BaseModel):
    index: int
    y: int
    height: int


class StripExport(BaseModel):
    episode_id: str
    width: int
    height: int
    slices: list[Slice]
    panels: dict[str, tuple[float, float, float, float]]


def export_manifest(episode: Episode, slice_height: int = 1280, width: int = 800) -> StripExport:
    y = 0
    boxes = {}
    for panel in sorted(episode.panels, key=lambda p: p.order):
        try:
            w, h = [int(x) for x in panel.aspect_ratio.split(":", 1)]
        except Exception:
            w, h = 2, 3
        ph = max(320, round(width * h / max(w, 1)))
        boxes[panel.id] = (0.0, float(y), float(width), float(ph))
        y += ph + panel.gap_after
    total = max(y, 1)
    slices = [Slice(index=i + 1, y=i * slice_height, height=min(slice_height, total - i * slice_height))
              for i in range((total + slice_height - 1) // slice_height)]
    return StripExport(episode_id=episode.id, width=width, height=total, slices=slices, panels=boxes)
