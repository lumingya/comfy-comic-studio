"""Server-side HTML album export with a Mio layout (导出模板).

Python port of ``js/ui-templates.js::compileTemplateDocument`` and
``js/album-metadata.js::attachAlbumMetadata`` so that external clients
(chat bots, automation) can obtain the same self-contained offline album the
browser produces: all images inline as data URLs, layout CSS/runtime injected,
plus the ``mio-album-data`` metadata block that lets Mio re-import the file.

Only inert string processing happens here; nothing is executed or fetched.
"""

import base64
import html
import json
import re
import secrets
import time
from datetime import datetime
from pathlib import Path

from backend.mio_library import LibraryError
from backend.mio_paths import shipped_data_dir
from backend.mio_export import sources as album_sources, content_disposition
from backend.mio_export_images import DEFAULT_PROFILE, prepare as prepare_image, resolve_profile

BASE_DIR = Path(__file__).resolve().parent.parent
LAYOUT_NAMES = {"webtoon": "Webtoon 长卷", "manga": "Manga 双页", "artbook": "Artbook 艺术册", "flip": "3D 交互画册"}
VARIABLE_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}")
ASSET_RE = re.compile(r"\{\{asset:([a-zA-Z][a-zA-Z0-9_-]{0,47})\}\}")
BOOK_RE = re.compile(r"\{\{#books\}\}([\s\S]*?)\{\{/books\}\}")
FRAME_RE = re.compile(r"\{\{#frames\}\}([\s\S]*?)\{\{/frames\}\}")
IMG_TAG_RE = re.compile(r"<img\b(?=[^>]*\bsrc\s*=\s*[\"']\{\{\s*image\s*\}\}[\"'])", re.IGNORECASE)
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MISSING_IMAGE = (
    "data:image/svg+xml;base64,"
    + base64.b64encode(
        (
            '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">'
            '<rect width="768" height="1024" fill="#ece9de"/>'
            '<text x="384" y="520" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#8b8778">尚未生成图片</text></svg>'
        ).encode("utf-8")
    ).decode("ascii")
)
BASE_STYLE = (
    "[hidden]{display:none!important}[data-cc-prompt]:empty{display:none!important}"
    "@media(max-width:640px){[data-layout=flip] .cc-pages{grid-template-columns:1fr!important}"
    "[data-layout=flip] .cc-image{height:auto!important;max-height:65svh;object-fit:contain}"
    "[data-layout=flip] .cc-caption{min-height:0!important}}"
    "@media print{.edition-cover[hidden],.edition-opening[hidden],.edition-chapter[hidden],.cc-cover[hidden],.edition-end[hidden]{display:block!important}"
    "[data-cc-frame][hidden]{display:block!important}.cc-controls{display:none!important}}"
)

_runtime_cache = {}


def escaped(value):
    """Same escaping as the browser: HTML entities plus braces (no re-templating)."""
    if value is None:
        value = ""
    if isinstance(value, bool):
        value = "true" if value else "false"
    text = html.escape(str(value), quote=True)
    return text.replace("{", "&#123;").replace("}", "&#125;")


def fill(template, values):
    return VARIABLE_RE.sub(lambda m: escaped(values.get(m.group(1), "")), template)


def book_runtime():
    """The reader/flip runtime is a plain function in js/ui-templates.js; reuse it verbatim."""
    path = BASE_DIR / "js" / "ui-templates.js"
    try:
        stamp = path.stat().st_mtime_ns
    except OSError:
        return ""
    cached = _runtime_cache.get("runtime")
    if cached and cached[0] == stamp:
        return cached[1]
    source = path.read_text(encoding="utf-8", errors="replace")
    start = source.find("function compiledBookRuntime")
    body = ""
    if start >= 0:
        depth, started = 0, False
        for index in range(start, len(source)):
            char = source[index]
            if char == "{":
                depth += 1
                started = True
            elif char == "}":
                depth -= 1
                if started and depth == 0:
                    body = source[start : index + 1]
                    break
    _runtime_cache["runtime"] = (stamp, body)
    return body


def reader_sizing():
    path = shipped_data_dir(BASE_DIR) / "catalog" / "reader-sizing.json"
    try:
        stamp = path.stat().st_mtime_ns
    except OSError:
        return {}
    cached = _runtime_cache.get("sizing")
    if cached and cached[0] == stamp:
        return cached[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    _runtime_cache["sizing"] = (stamp, data)
    return data


def layouts(config):
    items = config.get("uiConfig", {}).get("comfyStudio", {}).get("exportTemplates", [])
    return [t for t in items if isinstance(t, dict) and isinstance(t.get("html"), str) and isinstance(t.get("layout"), str)]


def find_layout(config, layout_id):
    items = layouts(config)
    if not items:
        raise LibraryError("Mio 中没有可用的导出模板", 404)
    if layout_id:
        for item in items:
            if item.get("id") == layout_id:
                return item
        raise LibraryError("导出模板不存在：" + str(layout_id)[:80], 404)
    return items[0]


def validate_layout(t):
    if t.get("formatVersion") != 1 or not isinstance(t.get("title"), str) or t.get("layout") not in LAYOUT_NAMES:
        raise LibraryError("不是合法的 Mio 画册导出模板（formatVersion: 1）")
    options = t.get("options")
    if not isinstance(options, dict):
        raise LibraryError("模板缺少外观选项")
    for key in ("accent", "background", "paper", "text"):
        if not HEX_COLOR_RE.match(str(options.get(key, ""))):
            raise LibraryError("模板颜色必须为六位十六进制色值")
    raw = t["html"]
    for loop in ("books", "frames"):
        if raw.count("{{#" + loop + "}}") != 1 or raw.count("{{/" + loop + "}}") != 1:
            raise LibraryError("模板需要且只能有一组 {{#" + loop + "}} 循环")
    bs, be, fs, fe = raw.find("{{#books}}"), raw.find("{{/books}}"), raw.find("{{#frames}}"), raw.find("{{/frames}}")
    if not (bs < fs < fe < be):
        raise LibraryError("frames 循环必须嵌套在 books 循环内")
    if "{{image}}" not in raw[fs:fe]:
        raise LibraryError("分镜循环中缺少 {{image}}")


def data_url(prepared):
    return "data:" + prepared.mime + ";base64," + base64.b64encode(prepared.data).decode("ascii")


def prepare_books(store, album_ids, profile):
    """Album documents with every frame image inlined (or a placeholder)."""
    books = []
    stats = {"frames": 0, "missing": 0, "bytes": 0}
    for book, frames in album_sources(store, album_ids):
        steps = []
        for frame, path in frames:
            step = {
                "stepIndex": frame.get("stepIndex", len(steps)),
                "name": frame.get("name", ""),
                "caption": frame.get("caption", ""),
                "prompt": frame.get("prompt", ""),
                "width": frame.get("width"),
                "height": frame.get("height"),
                "palette": frame.get("palette") if isinstance(frame.get("palette"), list) else [],
                "pending": path is None,
            }
            if path is None:
                step["image"] = MISSING_IMAGE
                stats["missing"] += 1
            else:
                prepared = prepare_image(path, profile)
                step["image"] = data_url(prepared)
                stats["bytes"] += len(prepared.data)
            steps.append(step)
        stats["frames"] += len(steps)
        books.append({**{k: v for k, v in book.items() if not str(k).startswith("_")}, "steps": steps})
    return books, stats


def compile_document(layout, books, options):
    validate_layout(layout)
    if not books or any(not b.get("steps") for b in books):
        raise LibraryError("没有可导出的分镜，请先生成画面")
    opts = {"showCaptions": True, "showPrompts": False, "border": 0, "signature": "", "themeColor": ""}
    opts.update({k: v for k, v in (options or {}).items() if v is not None})
    t_options = layout["options"]
    theme = str(opts.get("themeColor") or t_options["accent"])
    if not HEX_COLOR_RE.match(theme):
        raise LibraryError("导出主题色不合法")
    try:
        border = max(0, min(8, int(opts.get("border") or 0)))
    except (TypeError, ValueError):
        border = 0
    single = books[0]["title"] if len(books) == 1 else "我的画册合集"
    globals_ = {
        "collectionTitle": single,
        "title": single,
        "signature": str(opts.get("signature") or ""),
        "date": datetime.now().strftime("%Y/%m/%d").replace("/0", "/"),
        "themeColor": theme,
        "background": t_options["background"],
        "paperColor": t_options["paper"],
        "textColor": t_options["text"],
        "contentWidth": t_options.get("width", 900),
        "panelGap": t_options.get("gap", 24),
        "imageRadius": t_options.get("radius", 8),
        "bodyFont": "Georgia, serif" if t_options.get("font") == "serif" else "system-ui, sans-serif",
        "frameBorder": border,
        "layout": layout["layout"],
        "layoutName": LAYOUT_NAMES[layout["layout"]],
        "bookCount": len(books),
    }
    assets = {}  # data url -> asset key (shared across books)
    tagged = set()
    template = layout["html"]
    presentation_assets = layout.get("assets") if isinstance(layout.get("assets"), dict) else {}
    template = ASSET_RE.sub(lambda m: escaped(presentation_assets.get(m.group(1), "")) if isinstance(presentation_assets.get(m.group(1)), str) else "", template)

    def asset_key(data):
        key = assets.get(data)
        if key is None:
            key = "asset_" + str(len(assets))
            assets[data] = key
        return key

    def render_book(match):
        block = match.group(1)
        parts = []
        for book in books:
            steps = sorted(book["steps"], key=lambda s: s.get("stepIndex", 0))
            values = {
                **globals_,
                "title": book.get("title", ""),
                "synopsis": book.get("synopsis", ""),
                "characterName": book.get("characterName", ""),
                "templateTitle": book.get("templateTitle", ""),
                "storyTitle": book.get("storyTitle", ""),
                "panelCount": len(steps),
                "coverImage": steps[0]["image"] if steps else "",
            }

            def render_frames(fmatch):
                frame_block = IMG_TAG_RE.sub('<img data-mio-asset="{{assetKey}}"', fmatch.group(1))
                has_tag = "{{assetKey}}" in frame_block
                out = []
                for index, step in enumerate(steps):
                    key = asset_key(step["image"])
                    if has_tag:
                        tagged.add(key)
                    frame_values = {
                        **values,
                        **{k: v for k, v in step.items() if k not in ("palette", "pending")},
                        "assetKey": key,
                        "number": str(index + 1).zfill(2),
                        "caption": step.get("caption", "") if opts.get("showCaptions", True) else "",
                        "prompt": step.get("prompt", "") if opts.get("showPrompts") else "",
                        "palette1": (step.get("palette") or [None])[0] or t_options["accent"],
                        "palette2": (step.get("palette") or [None, None])[1] or t_options["background"],
                        "palette3": (step.get("palette") or [None, None, None])[2] or t_options["paper"],
                    }
                    out.append(fill(frame_block, frame_values))
                return "".join(out)

            body = FRAME_RE.sub(render_frames, block, count=1)
            parts.append(fill(body, values))
        return "".join(parts)

    document = BOOK_RE.sub(render_book, template, count=1)
    document = fill(document, globals_)
    nonce = "cc" + secrets.token_hex(12)
    csp = (
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; '
        "font-src data:; script-src 'nonce-" + nonce + "'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';\">"
    )
    head_extra = ""
    sizing = reader_sizing().get(layout.get("id"))
    if isinstance(sizing, str) and sizing.strip():
        head_extra += "<style>" + sizing + "</style>"
    head_extra += "<style>" + BASE_STYLE + ("[data-cc-caption]{display:none!important}" if not opts.get("showCaptions", True) else "") + "</style>"
    document = re.sub(r"(<head\b[^>]*>)", lambda m: m.group(1) + csp, document, count=1, flags=re.IGNORECASE)
    document = re.sub(r"</head>", head_extra + "</head>", document, count=1, flags=re.IGNORECASE)
    document = re.sub(
        r"<body\b([^>]*)>",
        lambda m: "<body" + m.group(1) + ' data-layout="' + html.escape(layout["layout"], quote=True) + '">',
        document,
        count=1,
        flags=re.IGNORECASE,
    )
    tail = ""
    runtime = book_runtime()
    if runtime:
        tail += '<script nonce="' + nonce + '">(' + runtime + ")();</script>"
    custom = layout.get("runtimeScript")
    if layout.get("scriptEnabled") is True and isinstance(custom, str) and custom.strip() and "</script" not in custom.lower():
        tail += '<script nonce="' + nonce + '">' + custom + "</script>"
    tail += metadata_block(books, assets, tagged, opts)
    document = re.sub(r"</body>", lambda m: tail + "</body>", document, count=1, flags=re.IGNORECASE)
    if not document.lstrip().lower().startswith("<!doctype"):
        document = "<!DOCTYPE html>\n" + document
    return document


def metadata_block(books, assets, tagged, opts):
    """``mio-album-data`` JSON (schema mio.album-html.v1) so Mio can re-import the file."""
    payload = {"schema": "mio.album-html.v1", "books": []}
    for book in books:
        steps = []
        for step in sorted(book["steps"], key=lambda s: s.get("stepIndex", 0)):
            entry = {k: step.get(k) for k in ("stepIndex", "name", "caption", "width", "height") if step.get(k) is not None}
            if opts.get("showPrompts"):
                entry["prompt"] = step.get("prompt", "")
            if opts.get("showCaptions", True) is False:
                entry["caption"] = ""
            entry["image"] = "" if step.get("pending") else {"$mioImage": assets[step["image"]]}
            steps.append(entry)
        album = {k: book.get(k) for k in ("title", "characterName", "synopsis", "tags", "totalSteps") if book.get(k) is not None}
        album["totalSteps"] = len(steps)
        album["steps"] = steps
        payload["books"].append({"album": album, "storyboard": None, "variables": None})
    holder = "".join(
        '<img data-mio-asset="' + key + '" src="' + data + '">'
        for data, key in assets.items()
        if key not in tagged and not data.startswith("data:image/svg+xml")
    )
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    text = text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    out = ""
    if holder:
        out += '<template id="mio-shared-assets">' + holder + "</template>"
    return out + '<script id="mio-album-data" type="application/json">' + text + "</script>"


def export_filename(books, layout):
    from backend.mio_library import safe_name

    title = safe_name(books[0].get("title") or "画册") if len(books) == 1 else "画册合集_" + str(len(books)) + "本"
    return title + "_" + safe_name(str(layout.get("id") or layout.get("layout") or "html")) + "_" + str(int(time.time() * 1000)) + ".html"


def stream_html_export(handler, store, config, body):
    """POST body: albumIds, layoutId?, imageProfile?, themeColor?, border?, signature?, showCaptions?, showPrompts?"""
    layout = find_layout(config, body.get("layoutId"))
    profile = resolve_profile(body.get("imageProfile"), DEFAULT_PROFILE)
    if profile == "auto":
        profile = "clean"
    books, stats = prepare_books(store, body.get("albumIds"), profile)
    document = compile_document(
        layout,
        books,
        {
            "themeColor": body.get("themeColor"),
            "border": body.get("border"),
            "signature": body.get("signature") if isinstance(body.get("signature"), str) else config.get("signature", ""),
            "showCaptions": body.get("showCaptions", True) is not False,
            "showPrompts": body.get("showPrompts") is True,
        },
    )
    encoded = document.encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(encoded)))
    handler.send_header("Content-Disposition", content_disposition(export_filename(books, layout)))
    handler.send_header("X-Mio-Export-Frames", str(stats["frames"]))
    handler.send_header("X-Mio-Export-Missing", str(stats["missing"]))
    handler.end_headers()
    handler.wfile.write(encoded)
