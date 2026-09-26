"""Small Pillow helpers shared by rendering, judging and layout."""
from __future__ import annotations

import io

from PIL import Image


def open_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def to_bytes(im: Image.Image, fmt: str = "PNG", quality: int = 92) -> bytes:
    buf = io.BytesIO()
    im.save(buf, fmt, **({"quality": quality} if fmt.upper() in ("JPEG", "WEBP") else {}))
    return buf.getvalue()


def crop_box(src: tuple[int, int], aspect: float, top_bias: float = 0.3) -> tuple[int, int, int, int]:
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
    canvas = Image.new("RGB", (sum(im.width for im in ims) + gap * (len(ims) + 1), height + 2 * gap), "white")
    x = gap
    for im in ims:
        canvas.paste(im, (x, gap))
        x += im.width + gap
    return to_bytes(canvas)
