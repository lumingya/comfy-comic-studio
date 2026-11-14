"""Adopted images of an episode and its composited strip (shared by exports and the album)."""

from __future__ import annotations

import io

from PIL import Image

from ..models import Episode, Series
from . import strip as SP


def adopted_images(ctx, ep: Episode, variant_id: str | None) -> tuple[dict, dict]:
    images, faces = {}, {}
    for panel in ep.ordered_panels():
        take = ep.adopted(panel.id, variant_id)
        if take is None:
            continue
        with Image.open(io.BytesIO(ctx.assets.read(take.asset_id))) as im:
            images[panel.id] = im.convert("RGB")
        faces[panel.id] = [{"box": list(f.box), "character": f.character_id} for f in take.faces]
    return images, faces


def render_episode_strip(ctx, episode_id: str, variant_id: str | None = None):
    with ctx.store.lock:
        ep = ctx.store.get_episode(episode_id)
        series = ctx.store.get_series(ep.series_id)
    return render_snapshot(ctx, series, ep, variant_id)


def render_snapshot(ctx, series: Series, ep: Episode, variant_id: str | None = None):
    """Render one immutable pair of documents, shared by exports and cached reader previews."""
    images, faces = adopted_images(ctx, ep, variant_id)
    if not images:
        raise ValueError("还没有采用任何一格的图片")
    stale = not ep.strip.panel_boxes or bool(set(images) - set(ep.strip.panel_boxes))
    # Rendering must not silently reflow saved geometry after script/width edits. Only the
    # explicit layout action does that. Missing adopted panels can still be laid out below it.
    rendering = ep.model_copy(deep=True)
    rendering.strip.manual = bool(ep.strip.panel_boxes)
    strip, scaled = ctx.registry.get("layout", "strip.default")(
        series, rendering, images, faces, relayout_lettering=stale
    )
    strip.manual = ep.strip.manual
    strip.height = max(strip.height, ep.strip.height) if stale else SP.content_height(ep.strip)
    return series, ep, strip, SP.render(series, ep, strip, scaled)


def panel_crops(ep: Episode, strip, full, variant_id: str | None = None):
    """Yield composited panels; whitespace outside each box belongs to the full strip only."""
    for panel in ep.ordered_panels():
        box = strip.panel_boxes.get(panel.id)
        if box is not None and ep.adopted(panel.id, variant_id) is not None:
            yield panel.id, full.crop(tuple(round(v) for v in box))
