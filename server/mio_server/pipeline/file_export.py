"""File-backed strip exporters. Encoded pages are consumed and released one at a time."""

from __future__ import annotations

import base64
import html
import json
import math
import struct
import tempfile
import zipfile
import zlib
from pathlib import Path

from PIL import Image

from . import export as X
from .strip import cut_points


def _noop(*args):
    pass


def plan_slices(strip, preset_id):
    p = X.preset(preset_id)
    width = p.width or strip.width
    scale = width / strip.width
    total = max(1, round(strip.height * scale))
    limit = p.max_height or 4096
    cuts = [round(y * scale) for y in cut_points(strip, max(1, int(limit / scale)))]
    ys = [0] + [y for y in cuts if 0 < y < total] + [total]
    ranges = []
    for a, b in zip(ys, ys[1:]):
        while b - a > limit:
            ranges.append((a, a + limit))
            a += limit
        if b > a:
            ranges.append((a, b))
    return width, total, ranges


def render_slice(snapshot, width, top, bottom):
    """Resize on the whole-image sampling grid, including the Lanczos support halo."""
    sw, sh = snapshot.strip.width, snapshot.strip.height
    total = max(1, round(sh * width / sw))
    if width == sw:
        return snapshot.render_region((0, top, sw, bottom))
    ratio = sh / total
    halo = math.ceil(3 * max(1, ratio)) + 1
    a, b = max(0, math.floor(top * ratio) - halo), min(sh, math.ceil(bottom * ratio) + halo)
    with snapshot.render_region((0, a, sw, b)) as source:
        return source.resize(
            (width, bottom - top),
            Image.Resampling.LANCZOS,
            box=(0, top * ratio - a, sw, bottom * ratio - a),
        )


def write_pdf(images, path, *, quality=90, dpi=96, lossless=True, checkpoint=_noop, progress=_noop):
    """Consume pages, closing each after writing a file-backed image stream.

    Only PDF object offsets and page IDs accumulate; no decoded image list is retained.
    The caller owns failure cleanup if ``path`` is an already-open stream.
    """
    owned = not hasattr(path, "write")
    stream = open(path, "wb") if owned else path
    images = iter(images)
    offsets, pages = {1: 0, 2: 0}, []

    def obj(number, data):
        offsets[number] = stream.tell()
        stream.write(f"{number} 0 obj\n".encode() + data + b"\nendobj\n")

    try:
        stream.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        for index, image in enumerate(images):
            try:
                checkpoint()
                page, content, picture = 3 + index * 3, 4 + index * 3, 5 + index * 3
                w, h = image.width * 72 / dpi, image.height * 72 / dpi
                with tempfile.TemporaryFile() as encoded:
                    if lossless:
                        encoder = zlib.compressobj()
                        for top in range(0, image.height, 64):
                            checkpoint()
                            with image.crop(
                                (0, top, image.width, min(image.height, top + 64))
                            ) as row:
                                with row.convert("RGB") as rgb:
                                    encoded.write(encoder.compress(rgb.tobytes()))
                        encoded.write(encoder.flush())
                    else:
                        with image.convert("RGB") as rgb:
                            rgb.save(encoded, "JPEG", quality=quality)
                    size = encoded.tell()
                    encoded.seek(0)
                    offsets[picture] = stream.tell()
                    filter_ = "FlateDecode" if lossless else "DCTDecode"
                    stream.write(
                        (
                            f"{picture} 0 obj\n<< /Type /XObject /Subtype /Image /Width {image.width} "
                            f"/Height {image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 "
                            f"/Filter /{filter_} /Length {size} >>\nstream\n"
                        ).encode()
                    )
                    while chunk := encoded.read(65536):
                        checkpoint()
                        stream.write(chunk)
                    stream.write(b"\nendstream\nendobj\n")
                operators = f"q {w:.6f} 0 0 {h:.6f} 0 0 cm /Im0 Do Q\n".encode()
                obj(
                    content,
                    f"<< /Length {len(operators)} >>\nstream\n".encode() + operators + b"endstream",
                )
                obj(
                    page,
                    (
                        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w:.6f} {h:.6f}] "
                        f"/Resources << /XObject << /Im0 {picture} 0 R >> >> "
                        f"/Contents {content} 0 R >>"
                    ).encode(),
                )
                pages.append(page)
                checkpoint()
                progress(index + 1)
            finally:
                image.close()
        if not pages:
            raise ValueError("没有可导出的画面")
        obj(
            2,
            (
                f"<< /Type /Pages /Count {len(pages)} /Kids ["
                + " ".join(f"{n} 0 R" for n in pages)
                + "] >>"
            ).encode(),
        )
        obj(1, b"<< /Type /Catalog /Pages 2 0 R >>")
        start = stream.tell()
        stream.write(f"xref\n0 {len(offsets) + 1}\n0000000000 65535 f \n".encode())
        for n in range(1, len(offsets) + 1):
            stream.write(f"{offsets[n]:010d} 00000 n \n".encode())
        stream.write(
            (
                f"trailer\n<< /Size {len(offsets) + 1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n"
            ).encode()
        )
    finally:
        if owned:
            stream.close()
        if hasattr(images, "close"):
            images.close()


def write_png(snapshot, path, *, width=0, checkpoint=_noop, progress=_noop):
    width = width or snapshot.strip.width
    height = max(1, round(snapshot.strip.height * width / snapshot.strip.width))

    def chunk(stream, kind, data):
        stream.write(
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    with open(path, "wb") as stream:
        stream.write(b"\x89PNG\r\n\x1a\n")
        chunk(stream, b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        encoder = zlib.compressobj()
        for top in range(0, height, 512):
            checkpoint()
            with render_slice(snapshot, width, top, min(height, top + 512)) as image:
                raw = image.tobytes()
                stride = width * 3
                for row in range(image.height):
                    data = encoder.compress(b"\0" + raw[row * stride : (row + 1) * stride])
                    if data:
                        chunk(stream, b"IDAT", data)
            progress(min(height, top + 512), height)
        checkpoint()
        chunk(stream, b"IDAT", encoder.flush())
        chunk(stream, b"IEND", b"")


def write_export(
    snapshot,
    fmt,
    preset_id,
    path,
    *,
    title="episode",
    subtitle="",
    quality=None,
    checkpoint=_noop,
    progress=_noop,
):
    """Write one completed artifact; remove partial output on cancellation or failure.

    ``long`` PNG is streamed. JPEG has a fixed 32 megapixel canvas limit and the JPEG
    dimension limit; choose PNG or slices above it. Extension exporters retain their own
    contract and are selected by the caller, never silently replaced here.
    """
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in title)[:60] or "episode"
    path = Path(path)
    try:
        checkpoint()
        if fmt == "long":
            if quality:
                if max(snapshot.strip.width, snapshot.strip.height) > 65500 or (
                    snapshot.strip.width * snapshot.strip.height > 32_000_000
                ):
                    raise ValueError("长图超过 JPEG 容量，请选择 PNG 或切片导出")
                with snapshot.render_region(
                    (0, 0, snapshot.strip.width, snapshot.strip.height)
                ) as im:
                    im.save(path, "JPEG", quality=quality)
                checkpoint()
                progress(1, 1)
                return "image/jpeg", f"{safe}.jpg"
            write_png(snapshot, path, checkpoint=checkpoint, progress=progress)
            return "image/png", f"{safe}.png"
        if fmt == "pdf":
            p = X.SlicePreset("pdf", "PDF", 0, 1280)
        elif fmt == "html":
            p = X.SlicePreset("html", "HTML", min(snapshot.strip.width, 1080), 1600, "JPEG", 88)
        elif fmt == "slices":
            p = X.with_quality(preset_id, quality)
        else:
            raise ValueError(f"unknown export format: {fmt}")
        width, _, ranges = plan_slices(snapshot.strip, p)

        def images():
            for a, b in ranges:
                checkpoint()
                yield render_slice(snapshot, width, a, b)

        if fmt == "pdf":
            write_pdf(
                images(),
                path,
                checkpoint=checkpoint,
                progress=lambda done: progress(done, len(ranges)),
            )
            return "application/pdf", f"{safe}.pdf"
        if fmt == "slices":
            manifest = {"preset": p.id, "width": width, "count": len(ranges), "files": []}
            with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as archive:
                for i, image in enumerate(images(), 1):
                    with image:
                        name = f"{safe}_{i:03d}.{X._ext(p.fmt)}"
                        archive.writestr(name, X.encode(image, p.fmt, p.quality))
                        manifest["files"].append({"name": name, "height": image.height})
                    checkpoint()
                    progress(i, len(ranges))
                archive.writestr(
                    "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2)
                )
            return "application/zip", f"{safe}_{p.id}.zip"
        with path.open("w", encoding="utf-8", newline="") as stream:
            t = html.escape(title)
            sub = f"<small>{html.escape(subtitle)}</small>" if subtitle else ""
            stream.write(
                f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
                f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>{t}</title>'
                f'<style>{X.READER_CSS}</style></head><body style="--w:{width}px">'
                f"<header><h1>{t}</h1>{sub}<progress max=1 value=0></progress></header><main>\n"
            )
            for i, image in enumerate(images(), 1):
                with image:
                    data = base64.b64encode(X.encode(image, p.fmt, p.quality)).decode("ascii")
                stream.write(f'<img alt="" loading="lazy" src="data:image/jpeg;base64,{data}">\n')
                checkpoint()
                progress(i, len(ranges))
            stream.write(
                f"</main><footer>— 完 —</footer><script>{X.READER_JS}</script></body></html>"
            )
        return "text/html", f"{safe}.html"
    except BaseException:
        path.unlink(missing_ok=True)
        raise
