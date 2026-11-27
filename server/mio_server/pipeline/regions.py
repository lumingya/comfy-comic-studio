"""Immutable strip geometry with one decoded/scaled panel in memory at a time.

Built-in layout supports bounded regions. Third-party layouts keep their PIL mapping contract;
their fallback can retain all scaled images. Pixel memory is bounded by one source/panel, one
region and one lettering layer, not by the total strip height.
"""

from __future__ import annotations

import io
import math
from collections.abc import Mapping

from PIL import Image, ImageDraw, ImageFont

from ..models import PanelWidth
from . import backdrop as BD
from . import episode_strip as ES
from . import layout as LY
from . import lettering as LT
from . import strip as SP


def _noop():
    pass


def _shift(layer, x, y):
    return layer.model_copy(
        update={
            "box": tuple(v - d for v, d in zip(layer.box, (x, y, x, y), strict=True)),
            "tail_to": (layer.tail_to[0] - x, layer.tail_to[1] - y) if layer.tail_to else None,
        }
    )


class _PhaseFont(ImageFont.FreeTypeFont):
    """A per-draw phase view of an already loaded font, without copying or reopening it.

    Pillow checks FreeTypeFont's type to retain glyph-mask offsets. All other access is
    delegated to the original font; only getmask2's start fraction belongs to this view.
    No attribute or method of the shared font is temporarily replaced.
    """

    def __init__(self, font, phase):
        self._source = font
        self._phase = phase

    def __getattribute__(self, name):
        if name in ("_source", "_phase", "getmask2"):
            return object.__getattribute__(self, name)
        return getattr(object.__getattribute__(self, "_source"), name)

    def getmask2(self, *args, **kwargs):
        values = list(args)
        if len(values) > 8:
            values[8] = self._phase
        else:
            kwargs["start"] = self._phase
        return self._source.getmask2(*values, **kwargs)


class _RegionDraw(ImageDraw.ImageDraw):
    """Keep Pillow's fractional glyph origin on the global canvas at band seams.

    Pillow truncates positions toward zero and passes the signed fraction to FreeType.
    Translating a positive global origin to a negative local one otherwise changes that
    fraction, shifting antialiased glyph pixels even though geometry moved by an integer.
    """

    def __init__(self, image, origin):
        super().__init__(image)
        self.origin = origin

    def text(self, xy, text, fill=None, font=None, *args, **kwargs):
        if not isinstance(font, ImageFont.FreeTypeFont):
            return super().text(xy, text, fill, font, *args, **kwargs)
        if (isinstance(text, str) and "\n" in text) or (isinstance(text, bytes) and b"\n" in text):
            layout = getattr(ImageDraw, "ImageText", None)
            if layout is None:
                # Older Pillow lays out multiline text by recursively calling self.text.
                # Pass the original font/coordinates so each line gets its own phase view.
                return super().multiline_text(xy, text, fill, font, *args, **kwargs)
            names = (
                "anchor",
                "spacing",
                "align",
                "direction",
                "features",
                "language",
                "stroke_width",
                "stroke_fill",
                "embedded_color",
            )
            options = {**dict(zip(names, args)), **kwargs}
            block = layout.Text(
                text,
                font,
                self.mode,
                options.get("spacing", 4),
                options.get("direction"),
                options.get("features"),
                options.get("language"),
            )
            if options.get("embedded_color"):
                block.embed_color()
            if options.get("stroke_width"):
                block.stroke(options["stroke_width"], options.get("stroke_fill"))
            # Newer Pillow splits internally instead of recursing through self.text.
            # Reuse its native layout, then apply the phase independently to each line.
            for line in block._split(xy, options.get("anchor"), options.get("align", "left")):
                self.text(
                    (line.x, line.y), line.text, fill, font, **{**options, "anchor": line.anchor}
                )
            return
        gx, gy = xy[0] + self.origin[0], xy[1] + self.origin[1]
        phase = (math.modf(gx)[0], math.modf(gy)[0])
        local_font = _PhaseFont(font, phase)
        position = (int(gx) - self.origin[0], int(gy) - self.origin[1])
        return super().text(position, text, fill, local_font, *args, **kwargs)


class _PanelImages(Mapping):
    def __init__(self, ctx, assets, strip, checkpoint):
        self.ctx, self.assets, self.strip = ctx, assets, strip
        self.checkpoint = checkpoint
        self.key = self.image = None

    def __iter__(self):
        return iter(self.assets)

    def __len__(self):
        return len(self.assets)

    def __contains__(self, key):
        return key in self.assets

    def __getitem__(self, key):
        self.checkpoint()
        if key != self.key:
            self.close()
            x0, y0, x1, y1 = map(round, self.strip.panel_boxes[key])
            with Image.open(io.BytesIO(self.ctx.assets.read(self.assets[key]))) as original:
                with original.convert("RGB") as rgb:
                    with SP._crop(
                        rgb, (x1 - x0) / max(1, y1 - y0), self.strip.crops.get(key)
                    ) as crop:
                        self.image = crop.resize((x1 - x0, y1 - y0), Image.Resampling.LANCZOS)
            self.key = key
        return self.image

    def close(self):
        if self.image is not None:
            self.image.close()
        self.key = self.image = None


class RenderSnapshot:
    def __init__(self, series, episode, strip, images, checkpoint=_noop, *, bounded=True):
        self.series, self.episode, self.strip = series, episode, strip
        self.images, self.checkpoint, self.bounded = images, checkpoint, bounded
        self.style = LY.Style(width=strip.width)
        self.fonts = SP._fonts(self.style)
        self.panels = [
            p for p in episode.ordered_panels() if p.id in strip.panel_boxes and p.id in images
        ]
        self.layer_bounds = []
        self.layer_sprites = []
        for layer in strip.lettering:
            sprite = None
            x0, y0, x1, y1 = layer.box
            if layer.kind == "sfx":
                x0, y0, x1, y1 = LT.sfx_box(
                    layer.text,
                    self.style.bold_path or self.style.font_path,
                    layer.font_size or self.style.font_size + 16,
                    layer.style or LT.preset_style(),
                    ((x0 + x1) / 2, (y0 + y1) / 2),
                    layer.vertical,
                )
                sprite = (round(x0), round(y0), x1 - x0, y1 - y0)
            else:
                # Hand-sized bubbles can overflow. A conservative glyph bound also covers
                # vertical columns, thought tails and font bearings beyond the saved box.
                font_size = layer.font_size or max(self.style.font_size, self.style.caption_size)
                overflow = (len(layer.text) + 2) * (font_size + self.style.line_gap)
                x0, y0, x1, y1 = x0 - overflow, y0 - overflow, x1 + overflow, y1 + overflow
            if layer.tail_to:
                tx, ty = layer.tail_to
                x0, y0, x1, y1 = min(x0, tx), min(y0, ty), max(x1, tx), max(y1, ty)
            self.layer_bounds.append((x0 - 8, y0 - 8, x1 + 8, y1 + 8))
            self.layer_sprites.append(sprite)

    def close(self):
        if isinstance(self.images, _PanelImages):
            self.images.close()
        else:
            for image in self.images.values():
                image.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def render_region(self, box, *, lettering=True, _decorations=True):
        self.checkpoint()
        x0, y0, x1, y1 = map(round, box)
        if x1 <= x0 or y1 <= y0:
            raise ValueError("渲染区域必须有宽度和高度")
        bg = self.strip.background if BD.HEX_RE.match(self.strip.background or "") else "#ffffff"
        canvas = Image.new("RGB", (x1 - x0, y1 - y0), bg)
        try:
            BD.paint_track_region(
                canvas, bg, self.panels, self.strip.panel_boxes, (x0, y0), self.strip.height
            )
            draw = _RegionDraw(canvas, (x0, y0))
            for panel in self.panels:
                bx0, by0, bx1, by1 = map(round, self.strip.panel_boxes[panel.id])
                if bx1 < x0 or bx0 >= x1 or by1 < y0 or by0 >= y1:
                    continue
                self.checkpoint()
                im = self.images[panel.id]
                if panel.width_mode == PanelWidth.frameless:
                    with BD.frameless_mask(im.size) as mask:
                        canvas.paste(im, (bx0 - x0, by0 - y0), mask)
                else:
                    canvas.paste(im, (bx0 - x0, by0 - y0))
                if panel.width_mode == PanelWidth.inset:
                    draw.rectangle(
                        (bx0 - x0, by0 - y0, bx1 - x0, by1 - y0), outline="black", width=3
                    )
            if lettering:
                for layer, bounds, sprite in zip(
                    self.strip.lettering, self.layer_bounds, self.layer_sprites, strict=True
                ):
                    if bounds[2] < x0 or bounds[0] >= x1 or bounds[3] < y0 or bounds[1] >= y1:
                        continue
                    self.checkpoint()
                    shifted = _shift(layer, x0, y0)
                    if sprite is not None:
                        # round(.5) is parity-sensitive. Round the global sprite origin
                        # before translating, rather than rerounding an odd band's origin.
                        left, top, width, height = sprite
                        cx = left - x0 + width / 2
                        cy = top - y0 + height / 2
                        bx0, by0, bx1, by1 = shifted.box
                        dx, dy = cx - (bx0 + bx1) / 2, cy - (by0 + by1) / 2
                        shifted = shifted.model_copy(
                            update={"box": (bx0 + dx, by0 + dy, bx1 + dx, by1 + dy)}
                        )
                    LT.draw_layer(canvas, draw, shifted, self.fonts, self.style, origin=(x0, y0))

            # Colours are sampled at the global x=0, as in the full-strip renderer.
            def ink(y):
                if x0 <= 0 < x1 and y0 <= round(y) < y1:
                    return BD.ink_for(canvas.getpixel((-x0, round(y) - y0)))
                with self.render_region(
                    (0, round(y), 1, round(y) + 1), lettering=lettering, _decorations=False
                ) as row:
                    return BD.ink_for(row.getpixel((0, 0)))

            if (
                _decorations
                and not self.strip.rasterized
                and self.series.title
                and SP.TITLE_SPACE
                <= min((b[1] for b in self.strip.panel_boxes.values()), default=SP.TITLE_SPACE)
            ):
                ty = (SP.TITLE_SPACE - self.style.title_size) / 2 - 10
                if y0 <= ty + self.style.title_size * 2 and y1 > ty:
                    title = self.episode.title or self.series.title
                    tw = self.fonts["title"].getlength(title)
                    draw.text(
                        ((self.strip.width - tw) / 2 - x0, ty - y0),
                        title,
                        font=self.fonts["title"],
                        fill=ink(ty),
                    )
            ey = self.strip.height - SP.END_SPACE / 2 - self.style.font_size / 2
            if (
                _decorations
                and not self.strip.rasterized
                and y0 <= ey + self.style.font_size * 2
                and y1 > ey
            ):
                end = "— 完 —"
                ew = self.fonts["text"].getlength(end)
                dark = ink(ey) == "white"
                draw.text(
                    ((self.strip.width - ew) / 2 - x0, ey - y0),
                    end,
                    font=self.fonts["text"],
                    fill=(200, 200, 200) if dark else (90, 90, 90),
                )
            # Match PIL.crop for hand-positioned panels extending outside the strip canvas.
            if x0 < 0:
                draw.rectangle((0, 0, min(-x0, canvas.width) - 1, canvas.height), fill="black")
            if y0 < 0:
                draw.rectangle((0, 0, canvas.width, min(-y0, canvas.height) - 1), fill="black")
            if x1 > self.strip.width:
                draw.rectangle(
                    (max(0, self.strip.width - x0), 0, canvas.width, canvas.height), fill="black"
                )
            if y1 > self.strip.height:
                draw.rectangle(
                    (0, max(0, self.strip.height - y0), canvas.width, canvas.height), fill="black"
                )
            return canvas
        except BaseException:
            canvas.close()
            raise

    def render_panel(self, panel_id):
        box = tuple(map(round, self.strip.panel_boxes[panel_id]))
        x0, y0, x1, y1 = ES.panel_crop_box(self.strip, panel_id)
        bg = self.strip.background if BD.HEX_RE.match(self.strip.background or "") else "#ffffff"
        image = Image.new("RGB", (x1 - x0, y1 - y0), bg)
        try:
            with self.render_region(box, lettering=False) as artwork:
                image.paste(artwork, (box[0] - x0, box[1] - y0))
            draw = ImageDraw.Draw(image)
            for layer in ES.panel_lettering(self.strip, panel_id):
                LT.draw_layer(image, draw, _shift(layer, x0, y0), self.fonts, self.style)
            return image
        except BaseException:
            image.close()
            raise


def prepare_snapshot(ctx, series, ep, variant_id=None, *, checkpoint=_noop):
    checkpoint()
    series, ep = series.model_copy(deep=True), ep.model_copy(deep=True)
    assets, faces = {}, {}
    for panel in ep.ordered_panels():
        checkpoint()
        take = ep.adopted(panel.id, variant_id)
        if take:
            assets[panel.id] = take.asset_id
            faces[panel.id] = [
                {"box": list(f.box), "character": f.character_id} for f in take.faces
            ]
    if not assets and ep.strip.lettering:
        strip = ep.strip.model_copy(deep=True)
        strip.height = SP.content_height(strip)
        return RenderSnapshot(series, ep, strip, {}, checkpoint)
    if not assets:
        raise ValueError("还没有采用任何一格的图片")
    stale = not ep.strip.panel_boxes or bool(set(assets) - set(ep.strip.panel_boxes))
    rendering = ep.model_copy(deep=True)
    rendering.strip.manual = bool(ep.strip.panel_boxes)
    layout = ctx.registry.contribution("layout", "strip.default")
    if layout.value is not SP.layout:
        originals, faces = ES.adopted_images(ctx, ep, variant_id)
        images = {}
        try:
            strip, images = layout.invoke(
                layout.value, series, rendering, originals, faces, relayout_lettering=stale
            )
        finally:
            # Layouts may return original images, so transfer those to the snapshot.
            for image in originals.values():
                if not any(image is value for value in images.values()):
                    image.close()
        bounded = False
    else:
        strip = rendering.strip
        boxes, height = SP.panel_geometry(rendering, strip, set(assets), title=bool(series.title))
        strip.panel_boxes = {pid: tuple(float(v) for v in box) for pid, box in boxes.items()}
        strip.height = height
        images = _PanelImages(ctx, assets, strip, checkpoint)
        try:
            if stale and not ep.strip.lettering:
                strip.lettering = SP.auto_lettering(
                    series, rendering, strip, boxes, images, faces, LY.Style(width=strip.width)
                )
            strip.height = SP.content_height(strip)
        except BaseException:
            images.close()
            raise
        bounded = True
    strip.manual = ep.strip.manual
    strip.height = max(strip.height, ep.strip.height) if stale else SP.content_height(ep.strip)
    return RenderSnapshot(series, ep, strip, images, checkpoint, bounded=bounded)
