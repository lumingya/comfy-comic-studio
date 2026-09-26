"""Adopted images of an episode and its composited strip (shared by exports and the album)."""

from __future__ import annotations

import io

from PIL import Image

from ..models import Episode
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
    ep = ctx.store.get_episode(episode_id)
    series = ctx.store.get_series(ep.series_id)
    images, faces = adopted_images(ctx, ep, variant_id)
    if not images:
        raise ValueError("还没有采用任何一格的图片")
    stale = not ep.strip.panel_boxes or bool(set(images) - set(ep.strip.panel_boxes))
    strip, scaled = SP.layout(series, ep, images, faces, relayout_lettering=stale)
    return series, ep, strip, SP.render(series, ep, strip, scaled)
