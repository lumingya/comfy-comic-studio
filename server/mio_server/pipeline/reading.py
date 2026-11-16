"""Bounded, per-workspace reading previews of saved framing and lettering.

Unlaid-out episodes show original images with separate captions. Saved compositions retain their
framing and lettering. One cold request prepares every panel. The cache lock coalesces concurrent
requests, and its key includes both complete documents so series variables also invalidate it.
Exports retain their original resolution; only these reading previews may be reduced to fit.
"""

from __future__ import annotations

import hashlib
import io
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass

from PIL import Image
from pydantic import BaseModel, Field

from ..album.build import caption
from ..storage import NotFound
from . import episode_strip as ES


class ReadingPreview(BaseModel):
    revision: str
    width: int
    height: int
    panel_boxes: dict[str, tuple[float, float, float, float]]
    captions: dict[str, str]
    display_captions: dict[str, str] = Field(
        default_factory=dict,
        description="Per-panel dialogue excluding complete lines already embedded in its image",
    )


@dataclass
class ReadingEntry:
    preview: ReadingPreview
    images: dict[str, bytes]
    size: int


class ReadingCache:
    def __init__(self, max_bytes=64 * 1024 * 1024, max_entries=4):
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.entries: OrderedDict[str, ReadingEntry] = OrderedDict()
        self.bytes = 0
        self.lock = threading.Lock()

    def clear(self):
        with self.lock:
            self.entries.clear()
            self.bytes = 0

    def get(self, ctx, episode_id: str, variant_id: str | None, width: int) -> ReadingEntry:
        with ctx.store.lock:
            ep = ctx.store.get_episode(episode_id)
            series = ctx.store.get_series(ep.series_id)
        payload = [ep.model_dump(mode="json"), series.model_dump(mode="json"), variant_id]
        revision = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        key = revision
        with self.lock:
            if key in self.entries:
                self.entries.move_to_end(key)
                return self.entries[key]
            # A filmstrip thumbnail and a full panel share the same composition. Resize from
            # cached bytes below, rather than rendering another full episode for each width.
            entry = self._build(ctx, series, ep, variant_id, 3200, revision)
            while self.entries and (
                len(self.entries) >= self.max_entries or self.bytes + entry.size > self.max_bytes
            ):
                _, old = self.entries.popitem(last=False)
                self.bytes -= old.size
            self.entries[key] = entry
            self.bytes += entry.size
            return entry

    def _build(self, ctx, series, ep, variant_id, width, revision):
        adopted = [p for p in ep.ordered_panels() if ep.adopted(p.id, variant_id)]
        if not adopted:
            return ReadingEntry(
                ReadingPreview(
                    revision=revision,
                    width=ep.strip.width,
                    height=ep.strip.height,
                    panel_boxes={},
                    captions={},
                ),
                {},
                0,
            )
        full = None
        originals = {}
        if ep.strip.panel_boxes or ep.strip.crops or ep.strip.lettering:
            _, _, strip, full = ES.render_snapshot(ctx, series, ep, variant_id, panel_images=True)
            boxes = {p.id: ES.panel_crop_box(strip, p.id) for p in adopted}
            page_width, page_height = strip.width, full.height
        else:
            # Opening an album must not implicitly crop or letter its images. Those choices
            # belong to an explicitly saved layout; plain reading puts dialogue below the art.
            # The strip compositor flattens to RGB. Plain reading preserves image transparency.
            try:
                for panel in adopted:
                    take = ep.adopted(panel.id, variant_id)
                    with Image.open(io.BytesIO(ctx.assets.read(take.asset_id))) as image:
                        alpha = "A" in image.getbands() or "transparency" in image.info
                        originals[panel.id] = image.convert("RGBA" if alpha else "RGB")
            except Exception:
                for image in originals.values():
                    image.close()
                raise
            boxes = {}
            page_width, page_height = 0, 0
            for panel in adopted:
                image = originals[panel.id]
                boxes[panel.id] = (0, page_height, image.width, page_height + image.height)
                page_width = max(page_width, image.width)
                page_height += image.height
        try:
            # Never drop an oversized entry and repeat the full render on every panel request.
            # Lower the common preview width until all encoded panels fit the bounded cache.
            while True:
                images = {}
                crops = (
                    ES.panel_crops(ep, strip, full, variant_id)
                    if full is not None
                    else ((pid, image.copy()) for pid, image in originals.items())
                )
                for panel_id, crop in crops:
                    try:
                        crop.thumbnail((width, max(1, round(crop.height * width / crop.width))))
                        out = io.BytesIO()
                        crop.save(out, "PNG")
                        images[panel_id] = out.getvalue()
                    finally:
                        crop.close()
                size = sum(map(len, images.values()))
                if size <= self.max_bytes:
                    break
                if width == 1:
                    raise ValueError("阅读预览超过缓存容量，请减少单话分幕数量")
                width = max(1, width // 2)
            return ReadingEntry(
                ReadingPreview(
                    revision=revision,
                    width=page_width,
                    height=page_height,
                    panel_boxes=boxes,
                    captions={p.id: caption(series, p) for p in adopted},
                    display_captions={
                        p.id: caption(series, p, strip if full is not None else None)
                        for p in adopted
                    },
                ),
                images,
                size,
            )
        finally:
            if full is not None:
                full.close()
            for image in originals.values():
                image.close()

    def image(self, ctx, episode_id, panel_id, variant_id, width):
        entry = self.get(ctx, episode_id, variant_id, width)
        image = entry.images.get(panel_id)
        if image is None:
            raise NotFound("该分格不存在或尚未采用图片")
        with Image.open(io.BytesIO(image)) as decoded:
            if decoded.width > width:
                decoded.thumbnail((width, max(1, round(decoded.height * width / decoded.width))))
                out = io.BytesIO()
                decoded.save(out, "PNG")
                return out.getvalue()
        return image
