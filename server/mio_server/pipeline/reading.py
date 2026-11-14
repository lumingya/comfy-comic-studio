"""Bounded, per-workspace reading previews of saved framing and lettering.

One cold request composites the episode once for every panel. The cache lock coalesces concurrent
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
from pydantic import BaseModel

from ..album.build import caption
from ..storage import NotFound
from . import episode_strip as ES


class ReadingPreview(BaseModel):
    revision: str
    width: int
    height: int
    panel_boxes: dict[str, tuple[float, float, float, float]]
    captions: dict[str, str]


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
        _, _, strip, full = ES.render_snapshot(ctx, series, ep, variant_id)
        try:
            # Never drop an oversized entry and repeat the full render on every panel request.
            # Lower the common preview width until all encoded panels fit the bounded cache.
            while True:
                images = {}
                for panel_id, crop in ES.panel_crops(ep, strip, full, variant_id):
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
                    width=strip.width,
                    height=full.height,
                    panel_boxes={p.id: strip.panel_boxes[p.id] for p in adopted},
                    captions={p.id: caption(series, p) for p in adopted},
                ),
                images,
                size,
            )
        finally:
            full.close()

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
