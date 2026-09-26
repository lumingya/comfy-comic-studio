"""Small Pillow helpers shared by rendering, judging and layout."""

from __future__ import annotations

import io

from PIL import Image, ImageDraw, ImageFilter


def open_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def to_bytes(im: Image.Image, fmt: str = "PNG", quality: int = 92) -> bytes:
    buf = io.BytesIO()
    im.save(buf, fmt, **({"quality": quality} if fmt.upper() in ("JPEG", "WEBP") else {}))
    return buf.getvalue()


def crop_box(
    src: tuple[int, int], aspect: float, top_bias: float = 0.3
) -> tuple[int, int, int, int]:
    """Largest box of ``aspect`` (w/h) inside ``src``. Vertical crops keep more of the top,
    where heads usually are; horizontal crops stay centered."""
    w, h = src
    if w / h > aspect:  # too wide: trim the sides
        nw = round(h * aspect)
        x0 = (w - nw) // 2
        return x0, 0, x0 + nw, h
    nh = round(w / aspect)
    y0 = round((h - nh) * top_bias)
    return 0, y0, w, y0 + nh


def fit(data: bytes, size: tuple[int, int], top_bias: float = 0.3) -> bytes:
    """Crop to the target aspect ratio, then resize to ``size`` (PNG bytes)."""
    im = open_image(data)
    box = crop_box(im.size, size[0] / size[1], top_bias)
    return to_bytes(im.crop(box).resize(size, Image.LANCZOS))


def thumbnail(data: bytes, max_side: int = 512, quality: int = 80) -> bytes:
    im = open_image(data)
    im.thumbnail((max_side, max_side))
    return to_bytes(im, "JPEG", quality)


def lineup(images: list[bytes], height: int = 1024, gap: int = 48) -> bytes:
    """Character sheets side by side on white, same height (one reference image for models that
    accept only one)."""
    ims = [open_image(d) for d in images]
    ims = [im.resize((round(im.width * height / im.height), height), Image.LANCZOS) for im in ims]
    canvas = Image.new(
        "RGB", (sum(im.width for im in ims) + gap * (len(ims) + 1), height + 2 * gap), "white"
    )
    x = gap
    for im in ims:
        canvas.paste(im, (x, gap))
        x += im.width + gap
    return to_bytes(canvas)


# --------------------------------------------------------------------------- edits (P3)
def make_mask(size: tuple[int, int], boxes=(), polygons=(), feather: int = 12) -> bytes:
    """White = repaint.  ``boxes`` / ``polygons`` use 0-1 fractions of the image size."""
    w, h = size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    for x1, y1, x2, y2 in boxes:
        draw.rectangle([x1 * w, y1 * h, x2 * w, y2 * h], fill=255)
    for poly in polygons:
        if len(poly) >= 3:
            draw.polygon([(x * w, y * h) for x, y in poly], fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))
    return to_bytes(mask.convert("RGB"), "PNG")


def outpaint_pads(
    size: tuple[int, int], ratio: float, anchor: str = "center"
) -> tuple[int, int, int, int]:
    """Padding (left, top, right, bottom) that extends an image to ``ratio`` (w/h) without cropping.

    ``anchor``: which side the original sticks to (``center``/``top``/``bottom``/``left``/``right``).
    Pads are multiples of 8 so latent sizes stay valid.
    """
    w, h = size
    if abs(w / h - ratio) < 1e-3:
        return (0, 0, 0, 0)
    if w / h > ratio:  # too wide → grow height
        extra = int(round(w / ratio)) - h
        extra += (-extra) % 8
        top = 0 if anchor == "top" else extra if anchor == "bottom" else extra // 2
        top -= top % 8
        return (0, top, 0, extra - top)
    extra = int(round(h * ratio)) - w
    extra += (-extra) % 8
    left = 0 if anchor == "left" else extra if anchor == "right" else extra // 2
    left -= left % 8
    return (left, 0, extra - left, 0)


def outpaint(
    data: bytes, pads: tuple[int, int, int, int], overlap: int = 24, feather: int = 16
) -> tuple[bytes, bytes]:
    """Extend the canvas: new area pre-filled with stretched, blurred edge colour (a better start
    for diffusion than flat grey) and a mask covering the new area plus an ``overlap`` band."""
    im = open_image(data)
    left, top, right, bottom = pads
    w, h = im.size
    canvas = im.resize((w + left + right, h + top + bottom), Image.BICUBIC).filter(
        ImageFilter.GaussianBlur(24)
    )
    canvas.paste(im, (left, top))
    mask = Image.new("L", canvas.size, 255)
    inner = (
        left + (overlap if left else 0),
        top + (overlap if top else 0),
        left + w - (overlap if right else 0),
        top + h - (overlap if bottom else 0),
    )
    ImageDraw.Draw(mask).rectangle([inner[0], inner[1], inner[2] - 1, inner[3] - 1], fill=0)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))
    return to_bytes(canvas, "PNG"), to_bytes(mask.convert("RGB"), "PNG")


def size_of(data: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(data)) as im:
        return im.size
