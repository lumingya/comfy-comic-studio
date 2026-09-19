"""User styles ("样式工坊"): CSS snippets, design-token overrides and style assets.

Everything here belongs to the person running the studio, so nothing is
sanitized beyond size limits and path ownership. The compiled CSS is injected
*after* every theme package and every extension style, which makes it the final
word on how the interface looks::

    <data>/styles/snippets.json   [{id, name, css, enabled, order, updatedAt}]
    <data>/styles/tokens.json     {"shared": {"--accent": "#..."}, "dark": {...}, "light": {...}}
    <data>/styles/assets/<file>   served at /style-assets/<file> (fonts, textures, cursors, ...)
"""

import io
import json
import re
import threading
import time
import uuid
import zipfile
from functools import wraps
from pathlib import Path

from backend.mio_library import LibraryError, atomic_write
from .storage import Storage, owned

MAX_SNIPPET = 4 * 1024 * 1024
MAX_SNIPPETS = 400
MAX_ASSET = 64 * 1024 * 1024
MAX_ASSETS_TOTAL = 1024 * 1024 * 1024
TOKEN_NAME = re.compile(r"^--[A-Za-z_][A-Za-z0-9_-]{0,79}$")
ASSET_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ ()\-\u4e00-\u9fff]{0,119}$")
SNIPPET_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
MODE_NAME = re.compile(r"^[a-z][a-z0-9-]{0,31}$")


def synchronized(fn):
    @wraps(fn)
    def call(self, *args, **kwargs):
        with self.lock:
            return fn(self, *args, **kwargs)
    return call


def mode_selector(mode):
    """CSS selector that scopes a token block to one host mode.

    ``shared`` targets both modes but still beats a theme's ``:root`` block,
    because it is emitted later with the same specificity pair."""
    if mode == "shared":
        return ":root,:root[data-theme]"
    if mode in ("dark", "light"):
        return ":root[data-theme=" + mode + "]"
    return ":root[data-theme-variant=" + mode + "]"


def tokens_css(tokens, important=False):
    blocks = []
    for mode, values in (tokens or {}).items():
        if not isinstance(values, dict) or not MODE_NAME.fullmatch(str(mode)):
            continue
        decls = []
        for name, value in values.items():
            if not TOKEN_NAME.fullmatch(str(name)):
                raise LibraryError("Invalid token name: " + str(name)[:60])
            text = str(value).strip()
            if not text or len(text) > 2000 or any(c in text for c in "{};"):
                raise LibraryError("Invalid token value for " + str(name))
            decls.append(str(name) + ":" + text + (" !important" if important else ""))
        if decls:
            blocks.append(mode_selector(mode) + "{" + ";".join(decls) + "}")
    return "\n".join(blocks)


class Styles:
    def __init__(self, data):
        self.root = Path(data) / "styles"
        self.assets = self.root / "assets"
        self.store = Storage(self.root)
        self.lock = threading.RLock()

    # ------------------------------------------------------------- snippets
    def snippets(self):
        items = self.store.get("snippets", []) or []
        return sorted([s for s in items if isinstance(s, dict)], key=lambda s: (s.get("order", 0), s.get("updatedAt", 0)))

    def _validate_snippet(self, item, existing=None):
        if not isinstance(item, dict):
            raise LibraryError("Snippet must be an object")
        id = str(item.get("id") or (existing or {}).get("id") or "")
        if not id:
            id = "snippet-" + uuid.uuid4().hex[:8]
        if not SNIPPET_ID.fullmatch(id):
            raise LibraryError("Snippet id must match [a-z0-9][a-z0-9_-]{0,63}")
        css = item.get("css", existing.get("css", "") if existing else "")
        if not isinstance(css, str):
            raise LibraryError("Snippet css must be text")
        if len(css.encode("utf-8")) > MAX_SNIPPET:
            raise LibraryError("Snippet exceeds 4 MiB")
        name = str(item.get("name") or (existing or {}).get("name") or "未命名样式")[:120]
        enabled = bool(item.get("enabled", (existing or {}).get("enabled", True)))
        order = item.get("order", (existing or {}).get("order", 0))
        try:
            order = int(order)
        except (TypeError, ValueError):
            order = 0
        return {"id": id, "name": name, "css": css, "enabled": enabled, "order": order,
                "note": str(item.get("note") or (existing or {}).get("note") or "")[:2000],
                "updatedAt": time.time()}

    @synchronized
    def save_snippet(self, item):
        items = self.snippets()
        existing = next((s for s in items if s.get("id") == item.get("id")), None) if isinstance(item, dict) else None
        record = self._validate_snippet(item, existing)
        if existing:
            items = [record if s.get("id") == record["id"] else s for s in items]
        else:
            if len(items) >= MAX_SNIPPETS:
                raise LibraryError("Snippet limit reached (400)")
            record["order"] = max([s.get("order", 0) for s in items] + [0]) + 1 if "order" not in item else record["order"]
            items.append(record)
        self.store.set("snippets", items)
        return record

    @synchronized
    def replace_snippets(self, items):
        """Full-list write (reordering, bulk enable). Unknown ids are created."""
        if not isinstance(items, list) or len(items) > MAX_SNIPPETS:
            raise LibraryError("snippets must be a list of at most 400 items")
        current = {s["id"]: s for s in self.snippets()}
        out = []
        for index, item in enumerate(items):
            record = self._validate_snippet(item, current.get(item.get("id")) if isinstance(item, dict) else None)
            record["order"] = index
            out.append(record)
        self.store.set("snippets", out)
        return out

    @synchronized
    def delete_snippet(self, id):
        items = [s for s in self.snippets() if s.get("id") != id]
        self.store.set("snippets", items)
        return items

    # --------------------------------------------------------------- tokens
    def tokens(self):
        value = self.store.get("tokens", {}) or {}
        return value if isinstance(value, dict) else {}

    @synchronized
    def set_tokens(self, tokens):
        if not isinstance(tokens, dict):
            raise LibraryError("tokens must be {mode: {--name: value}}")
        clean = {}
        for mode, values in tokens.items():
            if not MODE_NAME.fullmatch(str(mode)) or not isinstance(values, dict):
                raise LibraryError("Unknown token mode: " + str(mode)[:30])
            clean[mode] = {str(k): str(v) for k, v in values.items() if str(v).strip() != ""}
        tokens_css(clean)  # validates names and values
        self.store.set("tokens", clean)
        return clean

    # --------------------------------------------------------------- assets
    def list_assets(self):
        if not self.assets.is_dir():
            return []
        rows = []
        for p in sorted(self.assets.iterdir()):
            if p.is_file() and not p.name.startswith("."):
                rows.append({"name": p.name, "size": p.stat().st_size, "url": "/style-assets/" + p.name, "updatedAt": p.stat().st_mtime})
        return rows

    @synchronized
    def put_asset(self, name, raw):
        name = str(name or "")
        if "/" in name or "\\" in name or not ASSET_NAME.fullmatch(name) or name.startswith("."):
            raise LibraryError("Asset names may use letters, digits, CJK, dots, dashes and spaces")
        if not isinstance(raw, (bytes, bytearray)) or not raw:
            raise LibraryError("Asset is empty")
        if len(raw) > MAX_ASSET:
            raise LibraryError("Asset exceeds 64 MiB", 413)
        total = sum(a["size"] for a in self.list_assets() if a["name"] != name)
        if total + len(raw) > MAX_ASSETS_TOTAL:
            raise LibraryError("Style assets exceed 1 GiB", 413)
        self.assets.mkdir(parents=True, exist_ok=True)
        atomic_write(owned(self.assets, name), bytes(raw))
        return {"name": name, "size": len(raw), "url": "/style-assets/" + name}

    @synchronized
    def delete_asset(self, name):
        path = owned(self.assets, Path(str(name)).name)
        if path.is_file():
            path.unlink()
        return self.list_assets()

    def asset_path(self, name):
        path = owned(self.assets, Path(str(name)).name)
        if not path.is_file():
            raise LibraryError("Style asset not found", 404)
        return path

    # -------------------------------------------------------------- compile
    def compile_tokens(self):
        css = tokens_css(self.tokens())
        return "/* == 设计令牌覆盖 == */\n" + css if css else ""

    def compile_snippets(self):
        parts = []
        for snippet in self.snippets():
            if snippet.get("enabled", True) and snippet.get("css", "").strip():
                parts.append("/* == 快速样式：" + snippet.get("name", "").replace("*/", "") + " (" + snippet["id"] + ") == */\n" + snippet["css"])
        return "\n\n".join(parts)

    def compile(self):
        return "\n\n".join(p for p in (self.compile_tokens(), self.compile_snippets()) if p)

    def state(self):
        return {"snippets": self.snippets(), "tokens": self.tokens(), "assets": self.list_assets(), "css": self.compile()}

    # --------------------------------------------------------------- export
    def export_theme(self, name="我的主题", include_assets=True):
        """Bundle the current snippets + token overrides as an installable theme ZIP."""
        slug = re.sub(r"[^a-z0-9-]+", "-", str(name).lower()).strip("-")[:40] or "my-theme"
        if not re.match(r"^[a-z]", slug):
            slug = "t-" + slug
        css = []
        assets = []
        for snippet in self.snippets():
            if snippet.get("enabled", True) and snippet.get("css", "").strip():
                css.append("/* " + snippet.get("name", "") + " */\n" + snippet["css"])
        body = "\n\n".join(css)
        if include_assets:
            for asset in self.list_assets():
                if "/style-assets/" + asset["name"] in body:
                    assets.append(asset["name"])
                    body = body.replace("/style-assets/" + asset["name"], "assets/" + asset["name"])
        manifest = {"id": slug, "name": str(name)[:80], "version": "1.0.0", "apiVersion": 3, "css": "theme.css",
                    "tokens": self.tokens(), "description": "由样式工坊导出：快速样式 + 设计令牌覆盖。"}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("mio.theme.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            z.writestr("theme.css", body or "/* 空主题 */\n")
            for asset in assets:
                z.write(self.asset_path(asset), "assets/" + asset)
        return {"filename": slug + ".mio-theme.zip", "mime": "application/zip", "bytes": buffer.getvalue()}
