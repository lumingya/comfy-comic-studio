"""Render an album template into one self-contained offline HTML file.

Only inert string processing: values are HTML-escaped (braces too, so a caption can never inject
template syntax), images are inlined as data URLs, and the page runs nothing but Mio's reader
(``runtime.js``) under a per-file nonce CSP.  A ``mio-album-data`` JSON block (schema
``mio.album-html.v1``, the legacy format) describes the books so the file stays machine-readable.
"""

from __future__ import annotations

import base64
import html
import json
import re
import secrets
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path

from .templates import LAYOUTS, AlbumTemplate

VAR_RE = re.compile(r"\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}")
ASSET_RE = re.compile(r"\{\{asset:([a-zA-Z][a-zA-Z0-9_-]{0,47})\}\}")
BOOKS_RE = re.compile(r"\{\{#books\}\}([\s\S]*?)\{\{/books\}\}")
FRAMES_RE = re.compile(r"\{\{#frames\}\}([\s\S]*?)\{\{/frames\}\}")
IMG_RE = re.compile(r"<img\b(?=[^>]*\bsrc\s*=\s*[\"']\{\{\s*image\s*\}\}[\"'])", re.IGNORECASE)
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

_MISSING_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024" viewBox="0 0 768 1024">'
    '<rect width="768" height="1024" fill="#ece9de"/><text x="384" y="520" font-family="sans-serif"'
    ' font-size="34" text-anchor="middle" fill="#8b8778">尚未生成图片</text></svg>'
)
MISSING = "data:image/svg+xml;base64," + base64.b64encode(_MISSING_SVG.encode()).decode()

BASE_STYLE = (
    "[hidden]{display:none!important}[data-cc-prompt]:empty{display:none!important}"
    ".cc-controls{display:flex;gap:14px;align-items:center;justify-content:center;margin:18px 0;"
    "font:14px system-ui}.cc-controls button{width:40px;height:40px;border-radius:50%;"
    "border:1px solid currentColor;background:transparent;color:inherit;font-size:20px;"
    "cursor:pointer}.cc-controls button:disabled{opacity:.3;cursor:default}"
    ".cc-blank{display:grid;place-items:center;opacity:.35}"
    "@media print{[data-cc-frame][hidden]{display:block!important}.cc-controls{display:none}}"
)


@dataclass
class Frame:
    image: str  # data URL; "" = not rendered yet
    name: str = ""
    caption: str = ""
    prompt: str = ""
    width: int | None = None
    height: int | None = None
    palette: list[str] = field(default_factory=list)


@dataclass
class Book:
    title: str
    frames: list[Frame]
    synopsis: str = ""
    character_name: str = ""
    story_title: str = ""


@dataclass
class AlbumOptions:
    show_captions: bool = True
    show_prompts: bool = False
    border: int = 0
    signature: str = ""
    theme_color: str = ""
    collection_title: str = ""


def escaped(value) -> str:
    if value is None:
        value = ""
    if isinstance(value, bool):
        value = "true" if value else "false"
    return html.escape(str(value), quote=True).replace("{", "&#123;").replace("}", "&#125;")


def fill(template: str, values: dict) -> str:
    return VAR_RE.sub(lambda m: escaped(values.get(m.group(1), "")), template)


@lru_cache(maxsize=1)
def runtime() -> str:
    return (Path(__file__).resolve().parent / "runtime.js").read_text(encoding="utf-8")


def render_album(tpl: AlbumTemplate, books: list[Book], opts: AlbumOptions | None = None) -> str:
    opts = opts or AlbumOptions()
    if not books or not any(b.frames for b in books):
        raise ValueError("没有可导出的格，请先采用图片")
    o = tpl.options
    theme = opts.theme_color or o.accent
    if not HEX.match(theme):
        raise ValueError("主题色必须是六位十六进制色值")
    title = opts.collection_title or (books[0].title if len(books) == 1 else "画册合集")
    today = date.today()
    globals_ = {
        "collectionTitle": title,
        "title": title,
        "signature": opts.signature,
        "date": f"{today.year}/{today.month}/{today.day}",
        "themeColor": theme,
        "background": o.background,
        "paperColor": o.paper,
        "textColor": o.text,
        "contentWidth": o.width,
        "panelGap": o.gap,
        "imageRadius": o.radius,
        "bodyFont": "Georgia, 'Noto Serif SC', serif"
        if o.font == "serif"
        else "system-ui, sans-serif",
        "frameBorder": max(0, min(8, int(opts.border or 0))),
        "layout": tpl.layout,
        "layoutName": LAYOUTS[tpl.layout],
        "bookCount": len(books),
    }
    assets: dict[str, str] = {}  # data URL → key, shared by identical images
    tagged: set[str] = set()

    def key_for(data: str) -> str:
        return assets.setdefault(data, f"asset_{len(assets)}")

    def render_books(match: re.Match) -> str:
        block, parts = match.group(1), []
        for book in books:
            frames = [f for f in book.frames]
            values = {
                **globals_,
                "title": book.title,
                "synopsis": book.synopsis,
                "characterName": book.character_name,
                "storyTitle": book.story_title,
                "panelCount": len(frames),
                "coverImage": next((f.image for f in frames if f.image), MISSING),
            }

            def render_frames(fm: re.Match) -> str:
                frame_block = IMG_RE.sub('<img data-mio-asset="{{assetKey}}"', fm.group(1))
                has_tag = "{{assetKey}}" in frame_block
                out = []
                for i, f in enumerate(frames):
                    image = f.image or MISSING
                    key = key_for(image)
                    if has_tag:
                        tagged.add(key)
                    pal = (f.palette + [o.accent, o.background, o.paper])[:3]
                    out.append(
                        fill(
                            frame_block,
                            {
                                **values,
                                "image": image,
                                "assetKey": key,
                                "name": f.name,
                                "number": str(i + 1).zfill(2),
                                "caption": f.caption if opts.show_captions else "",
                                "prompt": f.prompt if opts.show_prompts else "",
                                "imageNote": "" if f.image else "尚未生成",
                                "width": f.width or "",
                                "height": f.height or "",
                                "palette1": pal[0],
                                "palette2": pal[1],
                                "palette3": pal[2],
                            },
                        )
                    )
                return "".join(out)

            parts.append(fill(FRAMES_RE.sub(render_frames, block, count=1), values))
        return "".join(parts)

    doc = ASSET_RE.sub(lambda m: escaped(tpl.assets.get(m.group(1), "")), tpl.html)
    doc = BOOKS_RE.sub(render_books, doc, count=1)
    doc = fill(doc, globals_)
    return _finish(doc, tpl, books, assets, tagged, opts)


def _finish(doc, tpl, books, assets, tagged, opts) -> str:
    nonce = secrets.token_hex(12)
    csp = (
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; '
        f"style-src 'unsafe-inline'; font-src data:; script-src 'nonce-{nonce}'; "
        "connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; "
        "form-action 'none';\">"
    )
    extra = BASE_STYLE + ("" if opts.show_captions else "[data-cc-caption]{display:none!important}")
    doc = re.sub(r"(<head\b[^>]*>)", lambda m: m.group(1) + csp, doc, count=1, flags=re.I)
    doc = re.sub(r"</head>", lambda m: f"<style>{extra}</style></head>", doc, count=1, flags=re.I)
    doc = re.sub(
        r"<body\b([^>]*)>",
        lambda m: f'<body{m.group(1)} data-layout="{tpl.layout}">',
        doc,
        count=1,
        flags=re.I,
    )
    tail = f'<script nonce="{nonce}">{runtime()}</script>' + _metadata(books, assets, tagged, opts)
    doc = re.sub(r"</body>", lambda m: tail + "</body>", doc, count=1, flags=re.I)
    if not doc.lstrip().lower().startswith("<!doctype"):
        doc = "<!DOCTYPE html>\n" + doc
    return doc


def _metadata(books, assets, tagged, opts) -> str:
    payload = {"schema": "mio.album-html.v1", "books": []}
    for book in books:
        steps = []
        for i, f in enumerate(book.frames):
            entry = {"stepIndex": i, "name": f.name}
            entry["caption"] = f.caption if opts.show_captions else ""
            if opts.show_prompts:
                entry["prompt"] = f.prompt
            if f.width and f.height:
                entry["width"], entry["height"] = f.width, f.height
            entry["image"] = {"$mioImage": assets[f.image]} if f.image else ""
            steps.append(entry)
        album = {"title": book.title, "synopsis": book.synopsis, "totalSteps": len(steps)}
        payload["books"].append({"album": {**album, "steps": steps}, "storyboard": None})
    holder = "".join(
        f'<img data-mio-asset="{key}" src="{data}">'
        for data, key in assets.items()
        if key not in tagged and not data.startswith("data:image/svg+xml")
    )
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    text = text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    out = f'<template id="mio-shared-assets">{holder}</template>' if holder else ""
    return out + f'<script id="mio-album-data" type="application/json">{text}</script>'
