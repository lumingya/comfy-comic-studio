"""Theme packages, SDK v3: a *stack* of themes, unrestricted CSS, live-linked folders.

A theme is trusted code that reshapes the studio. Nothing in its CSS is
filtered any more — ``@import``, remote fonts, escapes, ``image-set()``, any
asset type — the only guard rails are size limits and path ownership. Relative
``url()`` / ``@import`` references are rewritten to ``/theme-assets/<id>/<rev>/…``
so packages can ship SVG, video, WOFF2 or anything else without inlining.

``mio.theme.json`` (``apiVersion`` 1, 2 and 3 all load)::

    {"id":"paper-atelier","name":"纸间","version":"3.0.0","apiVersion":3,
     "css":["base.css","components.css"],          # string or list, shared rules
     "variants":{"dark":"dark.css","light":"light.css","sepia":"sepia.css"},
     "tokens":{"shared":{"--radius":"3px"},"dark":{"--bg":"#111"},"sepia":{"--bg":"#f1e6cf"}},
     "icons":"icons.json",                          # {"book":"<path d=.../>", ...}
     "script":"theme.js",                           # optional module: export default function(ctx)
     "settings":[{"key":"accent","label":"强调色","type":"color","var":"--accent","default":"#b8e9bd"},
                 {"key":"radius","label":"圆角","type":"range","var":"--radius","min":0,"max":24,"unit":"px","default":8}],
     "colorScheme":"auto"}                          # auto | dark | light

``dark`` / ``light`` variants follow the host mode toggle (``[data-theme=…]``);
any other variant name becomes a selectable *look* scoped under
``[data-theme-variant~=<name>]`` (the host lists every chosen look on <html>). Themes are layered: every enabled theme is
injected in stack order, then per-theme setting values, then the user's own
design tokens and CSS snippets (``styles.py``).
"""

import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from functools import wraps
from pathlib import Path

from backend.mio_library import LibraryError
from .storage import Storage, identifier, owned
from .packages import unpack, manifest, package_root, scan_revision
from .styles import tokens_css

ICON_TAGS = ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "g", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "text", "tspan", "symbol")
ICON_ATTRS = ("d", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "points",
              "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "opacity", "fill-rule", "clip-rule",
              "transform", "fill-opacity", "stroke-opacity", "id", "class", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "clip-path", "mask", "font-size", "font-family", "text-anchor", "dominant-baseline", "style", "vector-effect", "paint-order")
ICON_NAME = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
MAX_CSS = 16 * 1024 * 1024
URL_PATTERN = re.compile(r"""url\(\s*(['"]?)([^'")]+)\1\s*\)""", re.I)
IMPORT_PATTERN = re.compile(r"""@import\s+(['"])([^'"]+)\1""", re.I)


def synchronized(fn):
    @wraps(fn)
    def call(self, *args, **kwargs):
        with self.lock:
            return fn(self, *args, **kwargs)
    return call


def sanitize_icon(name, markup):
    """Icons are injected as inline SVG in every button: keep them static shapes."""
    if not ICON_NAME.fullmatch(str(name)):
        raise LibraryError("Invalid icon name: " + str(name)[:40])
    if not isinstance(markup, str) or len(markup) > 16000:
        raise LibraryError("Icon markup too large: " + name)
    body = markup.strip()
    if body.startswith("<svg"):
        body = re.sub(r"^<svg\b[^>]*>", "", body, flags=re.I | re.S)
        body = re.sub(r"</svg>\s*$", "", body, flags=re.I | re.S)
    if re.search(r"<\s*(script|foreignObject|image|use|a|iframe|object|embed|animate\w*|set)\b", body, re.I):
        raise LibraryError("Icon contains forbidden elements: " + name)
    if re.search(r"(?:javascript:|@import|xlink:href|href\s*=|on[a-z]+\s*=|expression\s*\()", body, re.I):
        raise LibraryError("Icon contains forbidden references: " + name)
    for tag in re.findall(r"<\s*/?\s*([A-Za-z][A-Za-z0-9-]*)", body):
        if tag.lower() not in ICON_TAGS:
            raise LibraryError("Icon element not allowed: <" + tag + "> in " + name)
    for attr in re.findall(r"\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=", body):
        if attr.lower() not in ICON_ATTRS:
            raise LibraryError("Icon attribute not allowed: " + attr + " in " + name)
    return body


def scope_css(css, selector):
    """Prefix every top-level rule with ``selector``; recurse into conditional at-rules.

    Statement at-rules (``@import …;``, ``@charset``, ``@layer a, b;``) are kept verbatim,
    and ``@font-face`` / ``@keyframes`` / ``@property`` are never scoped."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = []
    i = 0
    n = len(css)
    while i < n:
        j = css.find("{", i)
        if j == -1:
            out.append(css[i:])
            break
        head = css[i:j]
        semicolon = head.rfind(";")
        if semicolon != -1:
            out.append(head[:semicolon + 1])
            head = head[semicolon + 1:]
        head = head.strip()
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
            if name in ("@media", "@supports", "@container", "@layer", "@scope", "@starting-style"):
                out.append(head + "{" + scope_css(body, selector) + "}")
            else:
                out.append(head + "{" + body + "}")
        elif head:
            parts = []
            for sel in head.split(","):
                sel = sel.strip()
                if not sel:
                    continue
                if sel in (":root", "html") or sel.startswith((":root", "html")):
                    parts.append(re.sub(r"^(:root|html)", lambda m: m.group(1) + selector, sel))
                else:
                    parts.append(selector + " " + sel)
            out.append(",".join(parts) + "{" + body + "}")
        else:
            out.append("{" + body + "}")
        i = k
    return "".join(out)


def rewrite_urls(css, base_url, css_file):
    """Point package-relative url()/@import references at the theme asset route."""
    folder = Path(css_file).parent.as_posix()

    def resolve(target):
        target = target.strip()
        if not target or target.startswith(("data:", "http:", "https:", "//", "/", "#", "blob:")) or ":" in target.split("/")[0]:
            return None
        clean = target.split("#")[0].split("?")[0]
        suffix = target[len(clean):]
        joined = os.path.normpath(os.path.join(folder, clean)).replace("\\", "/")
        if joined.startswith(".."):
            return None
        return base_url + "/" + "/".join(part for part in joined.split("/") if part not in ("", ".")) + suffix

    def url(match):
        resolved = resolve(match.group(2))
        return match.group(0) if resolved is None else 'url("' + resolved + '")'

    def imp(match):
        resolved = resolve(match.group(2))
        return match.group(0) if resolved is None else '@import "' + resolved + '"'

    return IMPORT_PATTERN.sub(imp, URL_PATTERN.sub(url, css))


class Themes:
    def __init__(self, data):
        self.data_root = Path(data)
        self.root = self.data_root / "packages" / "themes"
        self.state = Storage(self.data_root / "packages" / "registry")
        self.lock = threading.RLock()

    # ------------------------------------------------------------- records
    def records(self):
        return self.state.get("themes", {})

    def stack(self):
        items = self.records()
        return [id for id in (self.state.get("theme-stack", []) or []) if id in items]

    def code_dir(self, id):
        meta = self.records().get(identifier(id))
        if not meta:
            raise LibraryError("Theme not found", 404)
        if meta.get("source") == "link":
            path = Path(meta["path"])
            if not path.is_dir():
                raise LibraryError("Linked theme folder is missing: " + str(path), 404)
            return path
        return self.root / id

    def settings_values(self, id=None):
        values = self.state.get("theme-settings", {}) or {}
        return values if id is None else (values.get(id) or {})

    # ------------------------------------------------------------- compile
    def _read(self, root, relative):
        path = owned(root, relative)
        if not path.is_file():
            raise LibraryError("Theme file missing: " + relative)
        if path.stat().st_size > MAX_CSS:
            raise LibraryError("Theme CSS exceeds 16 MiB: " + relative)
        return path.read_text(encoding="utf-8-sig", errors="replace")

    @synchronized
    def compile(self, id):
        """Return {'css', 'icons', 'colorScheme', 'apiVersion', 'revision', 'script', 'settings', 'variants'}."""
        meta = self.records().get(identifier(id))
        if not meta:
            raise LibraryError("Theme not found", 404)
        root = self.code_dir(id)
        base = "/theme-assets/" + id + "/" + str(meta.get("revision", "0"))
        parts = []
        if meta.get("tokens"):
            parts.append(tokens_css(meta["tokens"]))
        for file in meta.get("css") or []:
            parts.append(rewrite_urls(self._read(root, file), base, file))
        for mode, file in (meta.get("variants") or {}).items():
            selector = "[data-theme=" + mode + "]" if mode in ("dark", "light") else "[data-theme-variant~=" + mode + "]"
            parts.append(scope_css(rewrite_urls(self._read(root, file), base, file), selector))
        icons = {}
        if meta.get("icons"):
            raw = json.loads(self._read(root, meta["icons"]))
            if not isinstance(raw, dict) or len(raw) > 1000:
                raise LibraryError("icons.json must map up to 1000 names to SVG markup")
            icons = {name: sanitize_icon(name, markup) for name, markup in raw.items()}
        return {
            "css": "\n".join(p for p in parts if p),
            "icons": icons,
            "colorScheme": meta.get("colorScheme", "auto"),
            "apiVersion": meta.get("apiVersion", 1),
            "revision": meta.get("revision", "0"),
            "script": (base + "/" + meta["script"]) if meta.get("script") else "",
            "settings": meta.get("settings") or [],
            "values": self.settings_values(id),
            "variants": [v for v in (meta.get("variants") or {}) if v not in ("dark", "light")],
        }

    def css(self, id):
        return self.compile(id)["css"]

    def compile_stack(self):
        """Every enabled theme in order (skips ones that fail, reporting the error)."""
        out = []
        for id in self.stack():
            try:
                out.append({"id": id, **self.compile(id)})
            except Exception as exc:  # a broken layer must not take the others down
                out.append({"id": id, "error": str(exc)[:500], "css": "", "icons": {}, "colorScheme": "auto", "script": "", "settings": [], "values": {}, "variants": []})
        return out

    def asset(self, id, revision, relative):
        meta = self.records().get(identifier(id))
        if not meta:
            raise LibraryError("Theme not found", 404)
        if str(revision) != str(meta.get("revision", "0")):
            raise LibraryError("Theme revision unavailable", 404)
        if ".git" in Path(relative).parts or Path(relative).name.startswith("."):
            raise LibraryError("Asset not public", 403)
        path = owned(self.code_dir(id), relative)
        if not path.is_file():
            raise LibraryError("Theme asset not found", 404)
        return path

    # -------------------------------------------------------------- manage
    def _register(self, meta, extra):
        items = self.records()
        if meta["id"] in items:
            raise LibraryError("Theme ID already installed", 409)
        items[meta["id"]] = {**meta, **extra, "installedAt": time.time()}
        self.state.set("themes", items)

    @synchronized
    def install(self, raw, filename, trusted=False, enable=False):
        if not trusted:
            raise LibraryError("Confirm trust: global CSS can hide or imitate application controls", 403)
        self.root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.root, prefix=".theme-") as tmp:
            stage = Path(tmp) / "code"
            stage.mkdir()
            if filename.lower().endswith(".css"):
                base = re.sub(r"[^a-z0-9-]+", "-", Path(filename).stem.lower()).strip("-")[:32] or "theme"
                if not re.match(r"^[a-z]", base):
                    base = "t-" + base
                id = base
                if id in self.records():
                    id = base[:20] + "-" + uuid.uuid4().hex[:6]
                meta = {"id": id, "name": Path(filename).name, "version": "1.0.0", "apiVersion": 3, "css": ["theme.css"], "colorScheme": "auto"}
                (stage / "theme.css").write_bytes(raw)
                (stage / "mio.theme.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
            else:
                unpack(raw, stage)
                stage = package_root(stage, "theme")
                meta = manifest(stage, "theme")
            target = owned(self.root, meta["id"])
            if target.exists() or meta["id"] in self.records():
                raise LibraryError("Theme ID already installed", 409)
            shutil.move(str(stage), target)
            self._register(meta, {"source": "css" if filename.lower().endswith(".css") else "zip", "revision": uuid.uuid4().hex[:12]})
            try:
                self.compile(meta["id"])
            except Exception:
                items = self.records()
                items.pop(meta["id"], None)
                self.state.set("themes", items)
                shutil.rmtree(target, ignore_errors=True)
                raise
            if enable:
                self.enable(meta["id"], True)
            return self.records()[meta["id"]]

    @synchronized
    def link(self, path, trusted=False, enable=True):
        """Register a theme that lives in a folder on this machine (live-reloaded on change)."""
        if not trusted:
            raise LibraryError("Confirm trust for linked theme folders", 403)
        folder = Path(str(path or "")).expanduser()
        if not folder.is_absolute() or not folder.is_dir():
            raise LibraryError("Provide an absolute path to an existing folder")
        folder = folder.resolve()
        meta = manifest(folder, "theme", strict=False)
        if meta["id"] in self.records():
            raise LibraryError("Theme ID already installed: " + meta["id"], 409)
        self._register(meta, {"source": "link", "path": str(folder), "revision": scan_revision(folder)})
        try:
            self.compile(meta["id"])
        except Exception:
            items = self.records()
            items.pop(meta["id"], None)
            self.state.set("themes", items)
            raise
        if enable:
            self.enable(meta["id"], True)
        return self.records()[meta["id"]]

    @synchronized
    def reload(self, id):
        """Re-read the manifest of a package (linked folders pick up new files, settings, variants)."""
        meta = self.records().get(identifier(id))
        if not meta:
            raise LibraryError("Theme not found", 404)
        root = self.code_dir(id)
        fresh = manifest(root, "theme", strict=meta.get("source") != "link")
        if fresh["id"] != id:
            raise LibraryError("Theme changed its ID; unlink and link it again")
        items = self.records()
        items[id] = {**meta, **fresh, "revision": scan_revision(root) if meta.get("source") == "link" else uuid.uuid4().hex[:12]}
        self.state.set("themes", items)
        self.compile(id)
        return items[id]

    def watch(self):
        """Poll linked folders; bump revisions when files changed. Returns {id: revision}."""
        changed = {}
        with self.lock:
            items = self.records()
            dirty = False
            for id, meta in items.items():
                if meta.get("source") != "link":
                    continue
                folder = Path(meta.get("path", ""))
                if not folder.is_dir():
                    continue
                revision = scan_revision(folder)
                if revision != meta.get("revision"):
                    try:
                        fresh = manifest(folder, "theme", strict=False)
                        if fresh["id"] == id:
                            meta.update(fresh)
                    except Exception:
                        pass
                    meta["revision"] = revision
                    changed[id] = revision
                    dirty = True
            if dirty:
                self.state.set("themes", items)
        return changed

    @synchronized
    def enable(self, id, on):
        identifier(id)
        if id not in self.records():
            raise LibraryError("Theme not found", 404)
        stack = [x for x in self.stack() if x != id]
        if on:
            self.compile(id)
            stack.append(id)
        self.state.set("theme-stack", stack)
        return stack

    @synchronized
    def order(self, ids):
        known = self.records()
        stack = [x for x in ids if isinstance(x, str) and x in known]
        seen = set()
        stack = [x for x in stack if not (x in seen or seen.add(x))]
        self.state.set("theme-stack", stack)
        return stack

    @synchronized
    def select(self, id):
        """Use exactly one theme (or none). Layering is done with enable()/order()."""
        if id:
            self.compile(id)
        self.state.set("theme-stack", [id] if id else [])
        return id

    @synchronized
    def set_settings(self, id, values):
        meta = self.records().get(identifier(id))
        if not meta:
            raise LibraryError("Theme not found", 404)
        if not isinstance(values, dict):
            raise LibraryError("values must be an object")
        allowed = {f["key"] for f in meta.get("settings") or []}
        allowed.add("__variant")
        clean = {}
        for key, value in values.items():
            if key not in allowed:
                raise LibraryError("Unknown theme setting: " + str(key)[:40])
            if isinstance(value, (str, int, float, bool)) or value is None:
                clean[key] = value if not isinstance(value, str) else value[:2000]
        stored = self.settings_values()
        stored[id] = clean
        self.state.set("theme-settings", stored)
        return clean

    @synchronized
    def uninstall(self, id):
        identifier(id)
        self.state.set("theme-stack", [x for x in self.stack() if x != id])
        items = self.records()
        meta = items.pop(id, None)
        self.state.set("themes", items)
        stored = self.settings_values()
        if id in stored:
            stored.pop(id)
            self.state.set("theme-settings", stored)
        if meta and meta.get("source") != "link" and (self.root / id).exists():
            shutil.rmtree(owned(self.root, id))

    @synchronized
    def list(self):
        stack = self.stack()
        items = []
        for id, meta in self.records().items():
            items.append({**meta, "enabled": id in stack, "values": self.settings_values(id)})
        return {"items": items, "stack": stack, "active": stack[-1] if stack else ""}

    def fingerprint(self):
        """Cheap change token the front end can compare between polls."""
        return hashlib.sha1(json.dumps([self.stack(), {k: v.get("revision") for k, v in self.records().items()}], sort_keys=True).encode()).hexdigest()[:12]
