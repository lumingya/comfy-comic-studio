"""Studio Kit — reference backend for the Mio extension SDK v2.

One file shows every backend capability an extension can register:

  ctx.provider(...)   a new image channel ("echo-canvas", renders locally, no network)
  ctx.filter(...)     render.before / render.after / page.retry pipelines
  ctx.on(...)         album / page / queue event listeners
  ctx.exporter(...)   CBZ export with ComicInfo.xml
  ctx.importer(...)   "zip of images" -> album
  ctx.route(...)      JSON endpoints the front-end half (index.js) calls
  ctx.data.*          config / workspace / cache / tmp tiers
  ctx.host.*          albums, images, llm, notify — calls back into Mio

Nothing here needs third-party packages; Pillow is used only if present.
"""

import base64
import io
import json
import struct
import time
import zipfile
import zlib
from pathlib import Path

try:  # optional: nicer placeholder cards when Pillow is installed
    from PIL import Image, ImageDraw
except Exception:  # pragma: no cover - depends on the user's environment
    Image = ImageDraw = None


# ----------------------------------------------------------------- helpers
def png_bytes(width, height, seed, label=""):
    """Tiny dependency-free PNG: a two-tone gradient keyed by the seed."""
    if Image is not None:
        image = Image.new("RGB", (width, height), (30 + seed % 90, 60 + (seed // 3) % 120, 90 + (seed // 7) % 140))
        if min(width, height) >= 96:
            draw = ImageDraw.Draw(image)
            draw.rectangle((16, 16, width - 16, height - 16), outline=(255, 255, 255), width=4)
            draw.text((32, 32), label[:60], fill=(255, 255, 255))
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        return buffer.getvalue()
    raw = bytearray()
    base = (seed * 2654435761) & 0xFFFFFF
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw += bytes(((base >> 16 & 255) * (width - x) // width, (base >> 8 & 255) * y // height, base & 255))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))


def setup(ctx):
    log = ctx.data.workspace  # survives disable/enable; removed only by "purge all"

    def remember(kind, payload):
        entries = log.get("events", []) or []
        entries.append({"kind": kind, "at": time.time(), "payload": payload})
        log.set("events", entries[-200:])

    # ------------------------------------------------------------ provider
    @ctx.provider({
        "id": "echo-canvas",
        "label": "Echo Canvas（本地占位渲染）",
        "description": "不联网：按种子和尺寸生成占位图，用来验证流水线、钩子与导出。",
        "fields": [
            {"key": "palette", "label": "配色", "type": "select", "default": "dusk",
             "options": [{"value": "dusk", "label": "暮色"}, {"value": "mint", "label": "薄荷"}]},
            {"key": "delayMs", "label": "模拟耗时 (ms)", "type": "number", "default": 200, "min": 0, "max": 60000},
        ],
        "defaults": {"baseUrl": "local://echo-canvas", "model": "echo-v1"},
        "capabilities": {"images": True, "credentials": "none", "check": True},
        "docs": "docs/ECOSYSTEM_GUIDE.md",
    }, check=lambda request: {"ok": True, "message": "Echo Canvas 始终可用"})
    def echo_canvas(request, cancel):
        frame = request.get("frame") or {}
        width = int(frame.get("width") or 768)
        height = int(frame.get("height") or 1024)
        seed = int(frame.get("seed") or 0) or int(time.time()) % 100000
        if (request.get("config") or {}).get("palette") == "mint":
            seed += 4096
        delay = min(60, max(0, float((request.get("config") or {}).get("delayMs") or 0)) / 1000)
        if cancel.wait(delay):  # cooperative cancellation
            raise InterruptedError("cancelled by host")
        raw = png_bytes(min(width, 2048), min(height, 2048), seed, request.get("prompt", ""))
        # Large results are better handed over as files inside ctx.data.tmp:
        path = ctx.data.path("tmp", "render-%d.png" % seed)
        path.write_bytes(raw)
        return {"images": [{"path": "tmp/" + path.name}], "meta": {"seed": seed, "references": len(request.get("images", []))}}

    # --------------------------------------------------------------- hooks
    @ctx.filter("render.before", priority=50)
    def decorate_prompt(payload, context):
        settings = ctx.settings()
        suffix = str(settings.get("suffix") or "").strip()
        if suffix and suffix not in payload.get("prompt", ""):
            payload["prompt"] = (payload.get("prompt", "").rstrip(", ") + ", " + suffix).strip(", ")
        remember("render.before", {"task": context.get("task", {}).get("id"), "index": context.get("index"), "prompt": payload.get("prompt", "")[:200]})
        return payload

    @ctx.filter("render.after", priority=200, timeout=60)
    def stamp(result, context):
        """Post-processing: re-encode with a corner stamp when Pillow is available."""
        if not ctx.settings().get("stamp") or Image is None:
            return None  # None = leave the value untouched
        raw = ctx.host.images.read(result["image"])
        image = Image.open(io.BytesIO(raw)).convert("RGB")
        ImageDraw.Draw(image).rectangle((image.width - 96, image.height - 28, image.width - 8, image.height - 8), fill=(20, 20, 20))
        ImageDraw.Draw(image).text((image.width - 90, image.height - 24), "studio-kit", fill=(255, 255, 255))
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        result["image"] = ctx.host.images.store(buffer.getvalue())
        return result

    @ctx.filter("page.retry")
    def retry_transient(decision, context):
        error = str(context.get("error") or "")
        if context.get("attempt", 1) <= 1 and any(token in error.lower() for token in ("timeout", "429", "rate", "temporar")):
            return {"retry": True, "delay": 2}
        return None

    # -------------------------------------------------------------- events
    @ctx.on("page.published")
    def on_page(payload, meta):
        remember("page.published", {"albumId": payload.get("albumId"), "index": payload.get("index")})

    @ctx.on("album.published")
    def on_album(payload, meta):
        remember("album.published", payload)
        ctx.host.notify("《%s》已完成全部 %s 页，可在画册集导出 CBZ。" % (payload.get("title", ""), payload.get("pages", "?")), "success")

    @ctx.on("queue.fault")
    def on_fault(payload, meta):
        ctx.host.notify("生产队列存储故障：" + str(payload.get("error", ""))[:120], "error")

    # ------------------------------------------------------------ exporter
    @ctx.exporter({"id": "cbz", "label": "CBZ 漫画包（ComicInfo.xml）", "extension": "cbz", "mime": "application/vnd.comicbook+zip", "scope": "album", "timeout": 300})
    def export_cbz(album, context):
        target = ctx.data.path("tmp", "export-%d.cbz" % int(time.time() * 1000))
        pages = sorted(album.get("steps", []), key=lambda p: p.get("stepIndex", 0))
        with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED) as zf:
            for page in pages:
                path = album.get("files", {}).get(page.get("image"))
                if path:
                    zf.write(path, "%03d%s" % (int(page.get("stepIndex", 0)) + 1, Path(path).suffix.lower()))
            info = ("<?xml version='1.0' encoding='utf-8'?><ComicInfo><Title>%s</Title><Summary>%s</Summary><PageCount>%d</PageCount><Writer>Mio</Writer></ComicInfo>"
                    % (_xml(album.get("title", "")), _xml(album.get("synopsis", "")), len(pages)))
            zf.writestr("ComicInfo.xml", info)
        return {"filename": (album.get("title") or "album") + ".cbz", "mime": "application/vnd.comicbook+zip", "path": "tmp/" + target.name}

    # ------------------------------------------------------------ importer
    @ctx.importer({"id": "image-folder-zip", "label": "图片 ZIP → 画册（每张图一页）", "accepts": [".zip", ".cbz"], "scope": "album"})
    def import_images(payload, context):
        raw = base64.b64decode(payload.get("b64", ""))
        steps, assets = [], {}
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            names = sorted(n for n in zf.namelist() if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) and not n.startswith("__MACOSX"))
            for index, name in enumerate(names[:400]):
                data = zf.read(name)
                asset = "%03d%s" % (index + 1, Path(name).suffix.lower())
                assets[asset] = base64.b64encode(data).decode()
                steps.append({"stepIndex": index, "image": asset, "caption": Path(name).stem, "prompt": "", "name": "第 %d 页" % (index + 1)})
        now = int(time.time() * 1000)
        return {"kind": "albums", "assets": assets, "document": {
            "title": str(payload.get("filename") or "导入图集").rsplit(".", 1)[0][:120], "synopsis": "", "tags": ["导入", "studio-kit"],
            "projectId": (context.get("options") or {}).get("projectId") or "", "steps": steps, "totalSteps": len(steps), "generatedSteps": len(steps),
            "status": "complete" if steps else "partial", "createdAt": now, "updatedAt": now, "rowId": "unassigned", "templateId": "unassigned"}}

    # -------------------------------------------------------------- routes
    @ctx.route("/log", "GET")
    def read_log(query):
        return {"events": (log.get("events", []) or [])[-50:], "settings": ctx.settings()}

    @ctx.route("/log/clear")
    def clear_log(body):
        log.set("events", [])
        return {"ok": True}

    @ctx.route("/summarize")
    def summarize(body):
        """Ask the configured LLM for a one-line blurb of an album (needs an LLM channel)."""
        album = ctx.host.albums.get(str(body.get("albumId", "")))
        captions = " / ".join(str(p.get("caption") or "") for p in album.get("steps", []))[:4000]
        text = ctx.host.llm.chat("用一句话概括这本漫画：" + captions)
        ctx.host.albums.update(album["id"], {"synopsis": text[:2000]})
        return {"synopsis": text}


def _xml(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def on_unload(ctx):
    ctx.log("studio-kit unloaded")
