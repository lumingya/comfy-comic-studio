"""Disk-backed portable HTML ZIP and page-at-a-time PDF. No inline image budget.

Both writers accept an image ``profile`` (see backend/mio_export_images.py):
``archive`` copies the stored files byte for byte, ``clean`` removes embedded
workflow / prompt / EXIF metadata without touching pixels, and ``publish``
additionally re-encodes to compact high-quality WebP (JPEG inside PDF).
"""

import html
import io
from pathlib import Path
import shutil
import tempfile
import zipfile
import threading

_export_slot = threading.BoundedSemaphore(1)
from backend.mio_library import LibraryError
from backend.mio_export_images import (
    DEFAULT_PROFILE,
    PROFILE_LABELS,
    prepare as prepare_image,
    profile_summary,
    resolve_profile,
)


def sources(store, ids):
    if (
        not isinstance(ids, list)
        or not 1 <= len(ids) <= 100
        or any(not isinstance(id, str) for id in ids)
        or len(set(ids)) != len(ids)
    ):
        raise LibraryError("请选择 1–100 本不同画册")
    books = []
    count = 0
    for id in ids:
        if not isinstance(id, str):
            raise LibraryError("画册 ID 不合法")
        book = store.entity("albums", id)["document"]
        frames = []
        saved = {f.get("stepIndex", i): f for i, f in enumerate(book.get("steps", []))}
        total = book.get("totalSteps", len(saved))
        if type(total) is not int or not 0 <= total <= 512:
            raise LibraryError("画册分幕数量不合法")
        for index in range(total):
            frame = saved.get(
                index,
                {
                    "stepIndex": index,
                    "name": "第 " + str(index + 1) + " 幕",
                    "caption": "",
                },
            )
            frames.append(
                (
                    frame,
                    store.image_path(frame["image"]) if frame.get("image") else None,
                )
            )
        count += len(frames)
        if count > 5000:
            raise LibraryError("一次最多导出 5000 幕")
        books.append((book, frames))
    return books


def portable_zip(books, target, profile="archive"):
    prepared = []
    parts = [
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' file:; style-src \'unsafe-inline\'"><title>画册</title><style>body{margin:0 auto;max-width:1100px;background:#161819;color:#eee;font:18px/1.7 system-ui}header,figcaption{padding:24px}figure{margin:0 0 40px}img{display:block;width:100%;height:auto}h1{font-size:32px}p{white-space:pre-wrap}@media print{figure{break-after:page}body{background:white;color:black}}</style><body>'
    ]
    with zipfile.ZipFile(
        target, "w", compression=zipfile.ZIP_STORED, allowZip64=True
    ) as archive:
        for bi, (book, frames) in enumerate(books):
            parts.append(
                "<section data-cc-book><header><h1>"
                + html.escape(book.get("title", "画册"))
                + "</h1><p>"
                + html.escape(book.get("synopsis", ""))
                + "</p></header>"
            )
            for fi, (frame, path) in enumerate(frames):
                if path is None:
                    parts.append(
                        "<figure data-cc-frame><figcaption>"
                        + html.escape(frame.get("name", ""))
                        + " · 尚未生成图片</figcaption></figure>"
                    )
                    continue
                if profile == "archive":
                    # Byte-identical originals, streamed straight from disk.
                    name = f"images/{bi+1:03d}-{fi+1:04d}{path.suffix}"
                    archive.write(path, name)
                else:
                    image = prepare_image(path, profile)
                    prepared.append(image)
                    name = f"images/{bi+1:03d}-{fi+1:04d}{image.suffix}"
                    archive.writestr(name, image.data)
                parts.append(
                    '<figure data-cc-frame><img loading="lazy" src="'
                    + name
                    + '" alt="'
                    + html.escape(frame.get("name", ""), quote=True)
                    + '"><figcaption data-cc-caption>'
                    + html.escape(frame.get("caption", ""))
                    + "</figcaption></figure>"
                )
            parts.append("</section>")
        archive.writestr("index.html", "".join(parts) + "</body></html>")
        archive.writestr(
            "README.txt",
            "解压整个文件夹后打开 index.html。"
            + profile_summary(profile, prepared)
            + "此格式使用简洁阅读版式，不附带私密凭据和执行队列。",
        )


def pdf(books, target, profile="archive"):
    from PIL import Image, ImageOps

    frames = [item for _, items in books for item in items]
    if not frames:
        raise LibraryError("没有可导出的图片")
    if any(source is None for _, source in frames):
        raise LibraryError(
            "仍有未生成的分幕：请先补齐图片，或选择包含缺页说明的 ZIP 资源包。"
        )
    offsets = [0]
    with target.open("wb") as out:

        def write(value):
            out.write(value.encode("ascii"))

        def obj(number, value):
            offsets.append(out.tell())
            write(f"{number} 0 obj\n{value}\nendobj\n")

        write("%PDF-1.4\n%Mio\n")
        obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
        obj(
            2,
            "<< /Type /Pages /Count "
            + str(len(frames))
            + " /Kids ["
            + " ".join(f"{3+i*3} 0 R" for i in range(len(frames)))
            + "] >>",
        )
        for index, (_, source) in enumerate(frames):
            # clean / publish never embed the stored file directly: metadata is
            # scrubbed (and publish re-encoded) in memory before the page is written.
            page_bytes = prepare_image(source, profile, pdf=True).data
            with Image.open(io.BytesIO(page_bytes)) as im:
                if im.width * im.height > 100_000_000:
                    raise LibraryError("PDF 单页像素数超过安全上限")
                with tempfile.TemporaryFile() as image:
                    if (
                        im.format == "JPEG"
                        and im.mode in ("RGB", "L")
                        and im.getexif().get(274, 1) == 1
                    ):
                        image.write(page_bytes)
                        width, height = im.size
                        space = "DeviceGray" if im.mode == "L" else "DeviceRGB"
                    else:
                        page = ImageOps.exif_transpose(im).convert("RGBA")
                        background = Image.new("RGB", page.size, "white")
                        background.paste(page, mask=page.getchannel("A"))
                        background.save(image, "JPEG", quality=95)
                        width, height = page.size
                        space = "DeviceRGB"
                    length = image.tell()
                    image.seek(0)
                    n = 3 + index * 3
                    pw = 595
                    ph = round(pw * height / width, 3)
                    obj(
                        n,
                        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw} {ph}] /Resources << /XObject << /Im {n+1} 0 R >> >> /Contents {n+2} 0 R >>",
                    )
                    offsets.append(out.tell())
                    write(
                        f"{n+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /{space} /BitsPerComponent 8 /Filter /DCTDecode /Length {length} >>\nstream\n"
                    )
                    shutil.copyfileobj(image, out, 256 * 1024)
                    write("\nendstream\nendobj\n")
                    content = f"q {pw} 0 0 {ph} 0 0 cm /Im Do Q\n"
                    obj(
                        n + 2,
                        f"<< /Length {len(content)} >>\nstream\n{content}endstream",
                    )
        offset = out.tell()
        write(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n")
        for value in offsets[1:]:
            write(f"{value:010d} 00000 n \n")
        write(
            f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{offset}\n%%EOF\n"
        )


def export_filename(books, mode, profile="archive"):
    """<画册名 | 画册合集>[_轻量发布|_无损清洗]_<HTML-style 时间戳>.<zip|pdf>, matching the HTML export naming."""
    import time
    from backend.mio_library import safe_name

    if len(books) == 1:
        title = safe_name(books[0][0].get("title") or "画册")
    else:
        title = "画册合集_" + str(len(books)) + "本"
    if profile != "archive":
        title += "_" + PROFILE_LABELS[profile]
    return title + "_" + str(int(time.time() * 1000)) + "." + mode


def content_disposition(filename):
    """ASCII fallback plus RFC 5987 UTF-8 name so browsers keep the Chinese title."""
    from urllib.parse import quote

    import re

    fallback = re.sub(r"_+", "_", "".join(ch if 32 < ord(ch) < 127 and ch not in '"\\;' else "_" for ch in filename)).strip("_")
    stem, suffix = Path(fallback).stem, Path(fallback).suffix
    if not re.search(r"[A-Za-z]", stem):
        fallback = "album_" + stem.strip("_") + suffix if stem.strip("_") else "album" + suffix
    return 'attachment; filename="' + fallback + "\"; filename*=UTF-8''" + quote(filename, safe="")


def stream_export(handler, store, body):
    if not _export_slot.acquire(blocking=False):
        raise LibraryError("正在准备或传输另一份导出，请完成后再试。", 409)
    try:
        return _stream_export(handler, store, body)
    finally:
        _export_slot.release()


def _stream_export(handler, store, body):
    mode = body.get("format")
    if mode not in ("zip", "pdf"):
        raise LibraryError("只支持 ZIP 或 PDF")
    profile = resolve_profile(body.get("imageProfile"), DEFAULT_PROFILE)
    books = sources(store, body.get("albumIds"))
    if mode == "pdf" and any(
        path is None or path.suffix.lower() == ".svg"
        for _, frames in books
        for _, path in frames
    ):
        raise LibraryError(
            "PDF 需要完整的位图分幕；缺页或 SVG 请使用 ZIP 资源包，或先补齐、转为位图。"
        )
    if body.get("validateOnly") is True:
        handler.send_json(200, {"ready": True, "imageProfile": profile})
        return
    with tempfile.TemporaryDirectory(prefix="mio-export-") as folder:
        target = Path(folder) / ("album." + mode)
        from PIL import Image

        try:
            (portable_zip if mode == "zip" else pdf)(books, target, profile)
        except Image.DecompressionBombError as exc:
            raise LibraryError("图片像素数超过安全上限") from exc
        try:
            handler.send_response(200)
            handler.send_header(
                "Content-Type",
                "application/zip" if mode == "zip" else "application/pdf",
            )
            handler.send_header("Content-Length", str(target.stat().st_size))
            handler.send_header("Content-Disposition", content_disposition(export_filename(books, mode, profile)))
            handler.end_headers()
            with target.open("rb") as source:
                shutil.copyfileobj(source, handler.wfile, 256 * 1024)
        except OSError:
            # Headers have been sent; never append JSON to a partial archive.
            handler.close_connection = True


def read_export_body(handler):
    """Native form downloads avoid buffering an entire ZIP in browser JavaScript."""
    import json
    from urllib.parse import parse_qs

    if (
        handler.headers.get("Content-Type", "").split(";")[0]
        != "application/x-www-form-urlencoded"
    ):
        return handler.read_json_body()
    size = int(handler.headers.get("Content-Length", "0"))
    if not 0 < size <= 16384:
        raise LibraryError("导出请求大小不合法")
    fields = parse_qs(handler.rfile.read(size).decode("utf-8"), max_num_fields=6)
    return {
        "format": fields.get("format", [""])[0],
        "albumIds": json.loads(fields.get("albumIds", ["[]"])[0]),
        "imageProfile": fields.get("imageProfile", [DEFAULT_PROFILE])[0],
    }
