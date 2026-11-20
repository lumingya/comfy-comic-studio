"""A complete saved canvas, partitioned into bounded, full-width reading bands.

Geometry stays in source pixels. Logical panel order is only a painting order, never a
cropping plan: every pixel in [0, width) x [0, height) belongs to exactly one band.
"""

from __future__ import annotations

import math

BAND_HEIGHT = 1600


def has_composition(episode):
    return bool(episode.strip.panel_boxes or episode.strip.lettering)


def band_regions(snapshot, limit=BAND_HEIGHT):
    """Prefer a gutter outside lettering (including tails); hard-split oversized content.

    Conservative compositor bounds include glyph overflow and rotated SFX. If no safe
    boundary exists in the latter half of a band, the hard limit wins; rendering uses
    global coordinates so the adjacent bands still join without a missing/duplicate row.
    """
    strip = snapshot.strip
    limit = max(1, int(limit))
    protected = sorted(
        (max(0, math.floor(b[1])), min(strip.height, math.ceil(b[3])))
        for b in snapshot.layer_bounds
        if b[3] > 0 and b[1] < strip.height
    )
    merged = []
    for a, b in protected:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    gutters = sorted({round(b[y]) for b in strip.panel_boxes.values() for y in (1, 3)})
    top = 0
    while top < strip.height:
        bottom = min(strip.height, top + limit)
        if bottom < strip.height:
            lower = top + max(1, limit // 2)
            for a, b in merged:
                if a < bottom < b:
                    if a >= lower:
                        bottom = a
                    break
            candidates = [
                y for y in gutters if lower <= y <= bottom and not any(a < y < b for a, b in merged)
            ]
            if candidates:
                bottom = max(candidates)
        yield (0, top, strip.width, bottom)
        top = bottom


def metadata(snapshot):
    return {"width": snapshot.strip.width, "height": snapshot.strip.height}
