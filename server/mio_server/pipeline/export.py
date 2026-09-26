"""Episode export: platform slice presets, ZIP of slices, long image, PDF and offline HTML reader."""

from __future__ import annotations

import base64
import html
import io
import json
import zipfile
from dataclasses import dataclass

from PIL import Image

from ..models import Strip
from .strip import cut_points


@dataclass(frozen=True)
class SlicePreset:
    id: str
    label: str
    width: int
    max_height: int
    fmt: str = "JPEG"
    quality: int = 90


PRESETS = {
    "webtoon": SlicePreset("webtoon", "WEBTOON Canvas (800×≤1280 JPEG)", 800, 1280),
    "tapas": SlicePreset("tapas", "Tapas (940 宽 JPEG)", 940, 1880),
    "kuaikan": SlicePreset("kuaikan", "国内平台 (750 宽 JPEG)", 750, 1500),
    "long": SlicePreset("long", "整张长图 (PNG)", 0, 0, "PNG"),
}


def preset(preset_id: str) -> SlicePreset:
    try:
        return PRESETS[preset_id]
    except KeyError:
        raise ValueError(f"unknown export preset: {preset_id}") from None


def _scaled(image: Image.Image, strip: Strip, width: int) -> tuple[Image.Image, float]:
    if not width or width == image.width:
        return image, 1.0
    k = width / image.width
    return image.resize((width, round(image.height * k)), Image.LANCZOS), k


def slice_image(image: Image.Image, strip: Strip, p: SlicePreset) -> list[Image.Image]:
    """Slices for a preset; cut rows avoid bubbles and prefer gutters (computed at strip scale)."""
    im, k = _scaled(image, strip, p.width)
    if not p.max_height or im.height <= p.max_height:
        return [im]
    cuts = [round(y * k) for y in cut_points(strip, int(p.max_height / k))]
    ys = [0] + [y for y in cuts if 0 < y < im.height] + [im.height]
    out = []
    for a, b in zip(ys, ys[1:]):
        # Rounding may push a slice a few pixels over the limit; hard-split the remainder.
        while b - a > p.max_height:
            out.append(im.crop((0, a, im.width, a + p.max_height)))
            a += p.max_height
        if b > a:
            out.append(im.crop((0, a, im.width, b)))
    return out


def encode(im: Image.Image, fmt: str, quality: int = 90) -> bytes:
    buf = io.BytesIO()
    if fmt.upper() in ("JPEG", "JPG"):
        im.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    elif fmt.upper() == "WEBP":
        im.save(buf, "WEBP", quality=quality)
    else:
        im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _ext(fmt: str) -> str:
    return {"JPEG": "jpg", "JPG": "jpg", "WEBP": "webp"}.get(fmt.upper(), "png")


def slices_zip(
    image: Image.Image, strip: Strip, preset_id: str, basename: str = "episode"
) -> bytes:
    p = preset(preset_id)
    parts = slice_image(image, strip, p)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        manifest = {"preset": p.id, "width": parts[0].width, "count": len(parts), "files": []}
        for i, part in enumerate(parts, 1):
            name = f"{basename}_{i:03d}.{_ext(p.fmt)}"
            z.writestr(name, encode(part, p.fmt, p.quality))
            manifest["files"].append({"name": name, "height": part.height})
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return buf.getvalue()


def long_image(image: Image.Image, fmt: str = "PNG", width: int = 0, quality: int = 92) -> bytes:
    im = (
        image
        if not width
        else image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    )
    return encode(im, fmt, quality)


def pdf(image: Image.Image, strip: Strip, page_height: int = 1280) -> bytes:
    pages = [
        s.convert("RGB")
        for s in slice_image(image, strip, SlicePreset("pdf", "PDF", 0, page_height))
    ]
    buf = io.BytesIO()
    pages[0].save(buf, "PDF", save_all=True, append_images=pages[1:], resolution=96)
    return buf.getvalue()


READER_CSS = """
*{box-sizing:border-box}body{margin:0;background:#1b1b1f;color:#e8e8ea;font:15px/1.6 system-ui,sans-serif}
header{position:sticky;top:0;padding:10px 16px;background:rgba(27,27,31,.92);backdrop-filter:blur(6px);
display:flex;gap:12px;align-items:center;z-index:2}h1{font-size:16px;margin:0;flex:1}
main{max-width:var(--w);margin:0 auto}main img{display:block;width:100%;height:auto}
progress{width:120px;height:6px}footer{text-align:center;padding:40px;color:#888}
""".strip()

READER_JS = """
const bar=document.querySelector('progress');
addEventListener('scroll',()=>{const h=document.documentElement;
bar.value=h.scrollTop/Math.max(1,h.scrollHeight-h.clientHeight)},{passive:true});
""".strip()


def html_reader(image: Image.Image, strip: Strip, title: str, subtitle: str = "") -> bytes:
    """Single self-contained HTML file (images as data URIs) that reads like a webtoon app."""
    parts = slice_image(image, strip, SlicePreset("html", "HTML", min(image.width, 1080), 1600))
    imgs = "\n".join(
        f'<img alt="" loading="lazy" src="data:image/jpeg;base64,{base64.b64encode(encode(p, "JPEG", 88)).decode()}">'
        for p in parts
    )
    t = html.escape(title)
    sub = f"<small>{html.escape(subtitle)}</small>" if subtitle else ""
    doc = (
        f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>{t}</title>'
        f'<style>{READER_CSS}</style></head><body style="--w:{parts[0].width}px">'
        f"<header><h1>{t}</h1>{sub}<progress max=1 value=0></progress></header>"
        f"<main>\n{imgs}\n</main><footer>— 完 —</footer><script>{READER_JS}</script></body></html>"
    )
    return doc.encode("utf-8")


FORMATS = ("slices", "long", "pdf", "html")


def export(
    image: Image.Image,
    strip: Strip,
    fmt: str,
    *,
    preset_id: str = "webtoon",
    title: str = "episode",
    subtitle: str = "",
) -> tuple[bytes, str, str]:
    """Return ``(bytes, mime, filename)`` for one export format."""
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in title)[:60] or "episode"
    if fmt == "slices":
        return (
            slices_zip(image, strip, preset_id, safe),
            "application/zip",
            f"{safe}_{preset_id}.zip",
        )
    if fmt == "long":
        return long_image(image), "image/png", f"{safe}.png"
    if fmt == "pdf":
        return pdf(image, strip), "application/pdf", f"{safe}.pdf"
    if fmt == "html":
        return html_reader(image, strip, title, subtitle), "text/html", f"{safe}.html"
    raise ValueError(f"unknown export format: {fmt}")
