"""Adopted images of an episode and its composited strip (shared by exports and the album)."""

from __future__ import annotations

import io
import math

from PIL import Image, ImageDraw

from ..models import Episode, Series
from . import backdrop as BD
from . import layout as LY
from . import lettering as LT
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


def render_snapshot(
    ctx, series: Series, ep: Episode, variant_id: str | None = None, *, panel_images: bool = False
):
    """Render one immutable pair of documents, shared by exports and cached reader previews."""
    images, faces = adopted_images(ctx, ep, variant_id)
    if not images:
        raise ValueError("还没有采用任何一格的图片")
    stale = not ep.strip.panel_boxes or bool(set(images) - set(ep.strip.panel_boxes))
    # Rendering must not silently reflow saved geometry after script/width edits. Only the
    # explicit layout action does that. Missing adopted panels can still be laid out below it.
    rendering = ep.model_copy(deep=True)
    rendering.strip.manual = bool(ep.strip.panel_boxes)
    strip, scaled = ctx.registry.invoke(
        "layout", "strip.default", series, rendering, images, faces, relayout_lettering=stale
    )
    strip.manual = ep.strip.manual
    strip.height = max(strip.height, ep.strip.height) if stale else SP.content_height(ep.strip)
    # Standalone panels add only their own lettering after extracting the unchanged artwork.
    # A fully lettered strip would already contain fragments belonging to neighboring panels.
    painted = strip.model_copy(update={"lettering": []}) if panel_images else strip
    return series, ep, strip, SP.render(series, ep, painted, scaled)


def panel_lettering(strip, panel_id):
    """A bridge belongs to its originating panel; unassigned layers follow their centre."""
    box = strip.panel_boxes[panel_id]
    for layer in strip.lettering:
        if layer.panel_id == panel_id or (
            layer.panel_id is None
            and box[0] <= (layer.box[0] + layer.box[2]) / 2 < box[2]
            and box[1] <= (layer.box[1] + layer.box[3]) / 2 < box[3]
        ):
            yield layer


def panel_crop_box(strip, panel_id):
    """Expand the standalone canvas for owned lettering, without resizing the panel artwork."""
    x0, y0, x1, y1 = (round(value) for value in strip.panel_boxes[panel_id])
    for layer in panel_lettering(strip, panel_id):
        bounds = layer.box
        if layer.kind == "sfx":
            style = LY.Style(width=strip.width)
            bounds = LT.sfx_box(
                layer.text,
                style.bold_path or style.font_path,
                layer.font_size or style.font_size + 16,
                layer.style or LT.preset_style(),
                ((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2),
                layer.vertical,
            )
        x0, y0 = min(x0, math.floor(bounds[0])), min(y0, math.floor(bounds[1]))
        x1, y1 = max(x1, math.ceil(bounds[2]) + 1), max(y1, math.ceil(bounds[3]) + 1)
        if layer.tail_to:
            x, y = layer.tail_to
            x0, y0 = min(x0, math.floor(x)), min(y0, math.floor(y))
            x1, y1 = max(x1, math.ceil(x) + 1), max(y1, math.ceil(y) + 1)
    return x0, y0, x1, y1


def panel_crops(ep: Episode, strip, full, variant_id: str | None = None):
    """Render complete owned lettering over artwork from an unlettered strip snapshot.

    Extended areas use the strip background, never neighboring artwork, titles or fragments.
    Full-strip rendering keeps its original continuous composition.
    """
    style = LY.Style(width=strip.width)
    fonts = SP._fonts(style)
    background = strip.background if BD.HEX_RE.match(strip.background or "") else "#ffffff"
    for panel in ep.ordered_panels():
        box = strip.panel_boxes.get(panel.id)
        if box is not None and ep.adopted(panel.id, variant_id) is not None:
            box = tuple(round(value) for value in box)
            x0, y0, x1, y1 = panel_crop_box(strip, panel.id)
            image = Image.new("RGB", (x1 - x0, y1 - y0), background)
            with full.crop(box) as artwork:
                image.paste(artwork, (box[0] - x0, box[1] - y0))
            draw = ImageDraw.Draw(image)
            for layer in panel_lettering(strip, panel.id):
                shifted = layer.model_copy(
                    update={
                        "box": tuple(
                            value - offset
                            for value, offset in zip(layer.box, (x0, y0, x0, y0), strict=True)
                        ),
                        "tail_to": (layer.tail_to[0] - x0, layer.tail_to[1] - y0)
                        if layer.tail_to
                        else None,
                    }
                )
                LT.draw_layer(image, draw, shifted, fonts, style)
            yield panel.id, image
