"""Theme packages (v1 single CSS, v2 variants + tokens + icon sets).

A v2 ``mio.theme.json``::

    {"id":"paper-atelier","name":"纸间","version":"2.0.0","apiVersion":2,
     "css":"theme.css",                       # shared rules (both modes)
     "variants":{"dark":"dark.css","light":"light.css"},
     "tokens":{"shared":{"--radius":"3px"},"dark":{"--bg":"#111"},"light":{"--bg":"#f4eee2"}},
     "icons":"icons.json",                    # {"book":"<path d=.../>", ...}
     "colorScheme":"auto"}                     # auto | dark | light (force one mode)

Variant CSS is scoped under ``[data-theme=dark|light]`` at compile time, so a
theme author writes ordinary selectors and the host switches them with its own
mode toggle. Icons are sanitized to a small SVG subset and applied by the
front end through ``Mio.icons``.
"""

import base64
import json
import mimetypes
import re
import shutil
import tempfile
import threading
import uuid
from functools import wraps
from pathlib import Path

from backend.mio_library import LibraryError
from .storage import Storage, identifier, owned
from .packages import unpack, manifest, package_root

ICON_TAGS = ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "g")
ICON_ATTRS = ("d", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "points",
              "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-rule", "transform", "fill-opacity", "stroke-opacity")
ICON_NAME = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
TOKEN_NAME = re.compile(r"^--[a-z][a-z0-9-]{0,63}$")
TOKEN_VALUE = re.compile(r"^[A-Za-z0-9#%.,()\s\-_/'\"]{1,200}$")


def synchronized(fn):
    @wraps(fn)
    def call(self, *args, **kwargs):
        with self.lock:
            return fn(self, *args, **kwargs)
    return call


def sanitize_icon(name, markup):
    """Allow only static shape elements with geometric/paint attributes."""
    if not ICON_NAME.fullmatch(str(name)):
        raise LibraryError("Invalid icon name: " + str(name)[:40])
    if not isinstance(markup, str) or len(markup) > 8000:
        raise LibraryError("Icon markup too large: " + name)
    body = markup.strip()
    if body.startswith("<svg"):
        body = re.sub(r"^<svg\b[^>]*>", "", body, flags=re.I | re.S)
        body = re.sub(r"</svg>\s*$", "", body, flags=re.I | re.S)
    if re.search(r"<\s*(script|style|foreignObject|image|use|a|iframe|object|embed)\b", body, re.I):
        raise LibraryError("Icon contains forbidden elements: " + name)
    if re.search(r"(?:javascript:|url\(|@import|xlink:href|href\s*=|on[a-z]+\s*=)", body, re.I):
        raise LibraryError("Icon contains forbidden references: " + name)
    for tag in re.findall(r"<\s*/?\s*([A-Za-z][A-Za-z0-9-]*)", body):
        if tag.lower() not in ICON_TAGS:
            raise LibraryError("Icon element not allowed: <" + tag + "> in " + name)
    for attr in re.findall(r"\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=", body):
        if attr.lower() not in ICON_ATTRS:
            raise LibraryError("Icon attribute not allowed: " + attr + " in " + name)
    return body


def scope_css(css, selector):
    """Prefix every top-level rule with ``selector``; recurse into @media/@supports."""
    out = []
    i = 0
    n = len(css)
    while i < n:
        j = css.find("{", i)
        if j == -1:
            out.append(css[i:])
            break
        head = css[i:j].strip()
        depth = 1
        k = j + 1
        while k < n and depth:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
            k += 1
        body = css[j + 1:k - 1]
        if head.startswith("@"):
            name = head.split("(")[0].split()[0].lower()
            if name in ("@media", "@supports", "@container", "@layer"):
                out.append(head + "{" + scope_css(body, selector) + "}")
            else:  # @font-face, @keyframes, @property: never scoped
                out.append(head + "{" + body + "}")
        elif head:
            parts = []
            for sel in head.split(","):
                sel = sel.strip()
                if not sel:
                    continue
                if sel in (":root", "html") or sel.startswith((":root", "html")):
                    parts.append(re.sub(r"^(:root|html)", lambda m: m.group(1) + selector, sel))
                elif sel == "body" or sel.startswith("body"):
                    parts.append(selector + " " + sel)
                else:
                    parts.append(selector + " " + sel)
            out.append(",".join(parts) + "{" + body + "}")
        i = k
    return "".join(out)


class Themes:
    def __init__(self, data):
        self.data_root = Path(data)
        self.root = self.data_root / "packages" / "themes"
        self.state = Storage(self.data_root / "packages" / "registry")
        self.lock = threading.RLock()

    def records(self):
        return self.state.get("themes", {})

    # ------------------------------------------------------------------ compile
    def _clean_css(self, css):
        if len(css) > 2 * 1024 * 1024:
            raise LibraryError("CSS exceeds 2 MiB")
        clean = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        if "\\" in clean or re.search(r"@import\b|expression\s*\(", clean, re.I):
            raise LibraryError("Theme CSS cannot use escapes, @import or expression")
        if re.search(r"(?:https?:|ftp:|file:|image-set\s*\(|image\s*\(|src\s*\()", clean, re.I):
            raise LibraryError("Use package-local url() assets only")
        return clean

    def _inline_assets(self, root, css_file, clean, budget):
        def asset(match):
            url = match.group(1).strip().strip("\"'")
            if url.startswith("data:"):
                if not re.match(r"data:(image/(png|jpeg|webp)|font/(woff2?|ttf|otf));base64,", url):
                    raise LibraryError("Unsupported inline theme asset")
                return 'url("' + url + '")'
            if url.startswith("#"):
                return 'url("' + url + '")'
            if ":" in url or url.startswith("/"):
                raise LibraryError("Theme assets must be package-local")
            path = owned(root, str(Path(css_file).parent / url))
            if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ttf", ".otf"):
                raise LibraryError("Unsupported theme asset type")
            if not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
                raise LibraryError("Missing or oversized theme asset")
            mime = {".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf"}.get(path.suffix.lower(), mimetypes.guess_type(path)[0])
            budget[0] += path.stat().st_size * 4 // 3 + 100
            if budget[0] > 24 * 1024 * 1024:
                raise LibraryError("Expanded theme exceeds 24 MiB")
            return 'url("data:' + mime + ";base64," + base64.b64encode(path.read_bytes()).decode() + '")'
        return re.sub(r"url\(\s*([^)]*)\)", asset, clean, flags=re.I)

    def _tokens_css(self, tokens):
        blocks = []
        for mode, values in tokens.items():
            decls = []
            for name, value in values.items():
                if not TOKEN_NAME.fullmatch(str(name)) or not TOKEN_VALUE.fullmatch(str(value)) or re.search(r"url\(|expression", str(value), re.I):
                    raise LibraryError("Invalid theme token: " + str(name)[:60])
                decls.append(str(name) + ":" + str(value))
            if decls:
                selector = ":root" if mode == "shared" else ":root[data-theme=" + mode + "]"
                blocks.append(selector + "{" + ";".join(decls) + "}")
        return "\n".join(blocks)

    @synchronized
    def compile(self, id):
        """Return {'css': str, 'icons': {name: markup}, 'colorScheme': str, 'apiVersion': int}."""
        meta = self.records().get(identifier(id))
        if not meta:
            raise LibraryError("Theme not found", 404)
        root = self.root / id
        budget = [0]
        parts = []
        if meta.get("apiVersion") == 2 and meta.get("tokens"):
            parts.append(self._tokens_css(meta["tokens"]))
        shared = self._clean_css(owned(root, meta["css"]).read_text(encoding="utf-8-sig"))
        parts.append(self._inline_assets(root, meta["css"], shared, budget))
        for mode, file in (meta.get("variants") or {}).items():
            variant = self._clean_css(owned(root, file).read_text(encoding="utf-8-sig"))
            parts.append(scope_css(self._inline_assets(root, file, variant, budget), "[data-theme=" + mode + "]"))
        css = "\n".join(parts)
        if len(css) > 24 * 1024 * 1024:
            raise LibraryError("Expanded theme exceeds 24 MiB")
        icons = {}
        if meta.get("icons"):
            raw = json.loads(owned(root, meta["icons"]).read_text(encoding="utf-8-sig"))
            if not isinstance(raw, dict) or len(raw) > 400:
                raise LibraryError("icons.json must map up to 400 names to SVG markup")
            icons = {name: sanitize_icon(name, markup) for name, markup in raw.items()}
        return {"css": css, "icons": icons, "colorScheme": meta.get("colorScheme", "auto"), "apiVersion": meta.get("apiVersion", 1)}

    def css(self, id):
        return self.compile(id)["css"]

    # ------------------------------------------------------------------ manage
    @synchronized
    def install(self, raw, filename, trusted=False):
        if not trusted:
            raise LibraryError("Confirm trust: global CSS can hide or imitate application controls", 403)
        self.root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.root, prefix=".theme-") as tmp:
            stage = Path(tmp) / "code"
            stage.mkdir()
            if filename.lower().endswith(".css"):
                meta = {"id": "theme-" + uuid.uuid4().hex[:10], "name": Path(filename).name, "version": "1.0.0", "apiVersion": 1, "css": "theme.css"}
                (stage / "theme.css").write_bytes(raw)
                (stage / "mio.theme.json").write_text(json.dumps(meta))
            else:
                unpack(raw, stage)
                stage = package_root(stage, "theme")
                meta = manifest(stage, "theme")
            if len(self.records()) >= 32:
                raise LibraryError("Theme limit reached (32)")
            target = owned(self.root, meta["id"])
            if target.exists():
                raise LibraryError("Theme ID already installed", 409)
            shutil.move(str(stage), target)
            items = self.records()
            items[meta["id"]] = meta
            self.state.set("themes", items)
            try:
                self.compile(meta["id"])
            except Exception:
                items.pop(meta["id"])
                self.state.set("themes", items)
                shutil.rmtree(target)
                raise
            return meta

    @synchronized
    def select(self, id):
        if id:
            self.compile(id)
        self.state.set("active-theme", id)
        return id

    @synchronized
    def uninstall(self, id):
        identifier(id)
        if self.state.get("active-theme", "") == id:
            self.select("")
        items = self.records()
        items.pop(id, None)
        self.state.set("themes", items)
        if (self.root / id).exists():
            shutil.rmtree(owned(self.root, id))

    @synchronized
    def list(self):
        return {"items": list(self.records().values()), "active": self.state.get("active-theme", "")}
