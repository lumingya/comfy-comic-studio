"""Platform service + same-origin management API.

``Ecosystem`` is the process-wide platform object: registries (providers,
exporters, importers), the event bus and hook pipelines, installed packages
(extensions, themes) and the macro engine. Installing or enabling executable
packages always requires an explicit trust confirmation from the UI.
"""

import base64
import copy
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import threading
import time
import urllib.parse
import zipfile
from collections import deque
from pathlib import Path

from backend.mio_library import LibraryError, atomic_write, image_type
from backend.providers.registry import PROVIDERS
from .events import EventBus, Hooks
from .registry import SimpleRegistry
from .storage import Storage, identifier
from .plugins import Plugins, TIERS
from .themes import Themes
from .styles import Styles
from .macros import Macros, signature

SERVICES = {}
LOCK = threading.RLock()
ALBUM_PATCH_KEYS = ("title", "synopsis", "tags", "steps", "liked")
STEP_PATCH_KEYS = ("caption", "prompt", "name", "image")
SETTINGS_PUBLIC = ("workspace", "comfy", "llm", "xml")
LIBRARY_KINDS = ("albums", "storyboards", "characters", "scenes", "collections", "layouts", "plans", "workflows", "rows", "conversations")
SDK_VERSION = 3


def safe_mode():
    return os.environ.get("MIO_SAFE_MODE") == "1"


class Ecosystem:
    def __init__(self, host):
        self.host = host
        self.events = EventBus()
        self.hooks = Hooks()
        self.providers = PROVIDERS
        self.exporters = SimpleRegistry("exporter")
        self.importers = SimpleRegistry("importer")
        self.notices = deque(maxlen=100)
        self.plugins = Plugins(host.BASE_DIR, host.DATA_DIR, platform=self)
        self.themes = Themes(host.DATA_DIR)
        self.styles = Styles(host.DATA_DIR)
        self.macros = Macros(host.DATA_DIR, self.invoke, self.configuration_signature, self.asset_exists)
        self._install_core_capabilities()
        if not safe_mode():
            self.plugins.boot()
        self.events.emit("app.ready", {"safeMode": safe_mode()})

    def manifest(self):
        hooks_dict = self.hooks.describe()
        events_dict = self.events.describe()
        return {
            "sdk": SDK_VERSION,
            "providers": self.providers.manifest(),
            "exporters": self.exporters.manifest(),
            "importers": self.importers.manifest(),
            "hooks": [{"name": k, "handlers": v} for k, v in hooks_dict.items()],
            "events": [{"name": k, "listeners": len(v)} for k, v in events_dict.items()],
        }

    def activity(self, since=0.0):
        return {
            "events": [e for e in self.events.recent if e["at"] > since],
            "failures": [f for f in list(self.events.failures) + list(self.hooks.failures) if f["at"] > since],
            "notices": [n for n in self.notices if n["at"] > since],
            "now": time.time(),
        }

    def notify(self, message, level="info", source="core"):
        notice = {"message": str(message)[:500], "level": level if level in ("info", "success", "warning", "error") else "info", "source": source, "at": time.time()}
        self.notices.append(notice)
        return notice

    # -------------------------------------------------------------- macros
    def configuration_signature(self):
        config = self.host.native_store().read(include_baseline=False)
        return signature({
            "comfy": config.get("comfyConfig"),
            "profiles": config.get("uiConfig", {}).get("comfyStudio", {}).get("settings", {}).get("imageGeneration"),
            "llm": config.get("llmConfig"),
            "workflows": config.get("comfyWorkflows"),
        })

    def asset_exists(self, value):
        if isinstance(value, dict) and value.get("kind") == "mio-image":
            try:
                return self.host.native_store().image_path(value["src"]).is_file()
            except Exception:
                return False
        return True

    def invoke(self, method, args):
        host = self.host
        prompt = args.get("prompt")
        options = args.get("options", {})
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 100000 or not isinstance(options, dict):
            raise LibraryError("SDK call requires prompt and options")
        config = host.native_store().read(include_baseline=False)
        if method == "llm.chat":
            return self._chat(prompt, options)
        if method != "image.generate":
            raise LibraryError("Unknown SDK API")
        generation = config.get("uiConfig", {}).get("comfyStudio", {}).get("settings", {}).get("imageGeneration", {})
        profile = next((p for p in generation.get("profiles", []) if p.get("id") == options.get("channelId", generation.get("active"))), None)
        if not profile:
            raise LibraryError("Select and save an image channel first")
        cfg = copy.deepcopy(profile)
        payload = {
            "config": cfg,
            "prompt": prompt,
            "negative": options.get("negative", ""),
            "frame": {k: options[k] for k in ("width", "height", "seed", "steps", "cfg") if k in options},
            "images": [v["src"] if isinstance(v, dict) else v for v in options.get("images", [])],
            "_requestTimeout": min(int(options.get("timeout", 120)), 180),
        }
        if self.providers.spec(cfg["provider"])["capabilities"].get("workflow"):
            comfy = config.get("comfyConfig", {})
            cfg["baseUrl"] = comfy.get("baseUrl", "")
            cfg["outputNodeId"] = comfy.get("outputNodeId", "")
            preset = next((x for x in config.get("comfyWorkflows", []) if x.get("id") == options.get("workflowId")), None)
            if options.get("workflowId") and not preset:
                raise LibraryError("Saved workflow not found")
            workflow = copy.deepcopy(options.get("workflow") or (preset or comfy).get("workflow", {}))
            if not workflow:
                raise LibraryError("Save an API workflow, or pass options.workflow")
            if not options.get("workflow"):
                from .workflow import compile_workflow

                workflow = compile_workflow(workflow, (preset or comfy).get("bindings", comfy.get("bindings", [])), prompt, options, payload["images"])
            payload["workflow"] = workflow
        result = host.generate_provider_image(payload)
        src = result["image"]
        if isinstance(src, dict):
            src = src.get("localUrl") or src.get("url")
        if not isinstance(src, str):
            raise LibraryError("Provider returned no image")
        raw, _ = host.native_store().image_bytes(src)
        mime, suffix = image_type(raw)
        name = hashlib.sha256(raw).hexdigest() + "." + suffix.lstrip(".")
        atomic_write(Path(host.DATA_DIR) / "assets" / "images" / name, raw)
        return {"kind": "mio-image", "src": "/images/assets/" + name, "name": options.get("name", "计算资产"), "mime": mime}

    def _chat(self, prompt, options):
        cfg = self.host.native_store().settings.resolve("llm")
        result = self.host.chat_proxy({
            "scope": "llm",
            "baseUrl": cfg.get("baseUrl", ""),
            "body": {
                "model": options.get("model", cfg.get("model")),
                "messages": options.get("messages") or [{"role": "user", "content": prompt}],
                **{k: options[k] for k in ("temperature", "max_tokens") if k in options},
            },
        })
        return result["choices"][0]["message"]["content"]

    # ------------------------------------------------------------ host API
    def host_call(self, extension_id, name, args):
        """Allow-listed operations an extension process may request. Everything
        goes through the store (validation, etags, path ownership)."""
        store = self.host.native_store()
        args = args if isinstance(args, dict) else {}
        if name == "albums.list":
            rows = store.records("albums")
            project = args.get("projectId")
            return [{k: r.get(k) for k in ("id", "title", "projectId", "status", "totalSteps", "generatedSteps", "updatedAt", "tags")}
                    for r in rows if not project or r.get("projectId") == project]
        if name == "albums.get":
            return store.entity("albums", str(args.get("id")))["document"]
        if name == "albums.page":
            document = store.entity("albums", str(args.get("id")))["document"]
            index = int(args.get("index", -1))
            return next((p for p in document.get("steps", []) if p.get("stepIndex") == index), None)
        if name == "albums.update":
            return self.update_album(str(args.get("id")), args.get("patch") or {}, source="ext:" + extension_id)
        if name == "library.kinds":
            return list(LIBRARY_KINDS)
        if name == "library.list":
            kind = str(args.get("kind"))
            if kind not in LIBRARY_KINDS:
                raise LibraryError("Unknown library kind: " + kind)
            return [{k: v for k, v in r.items() if k not in ("file",)} for r in store.records(kind)]
        if name == "library.get":
            return store.entity(str(args.get("kind")), str(args.get("id")))["document"]
        if name == "library.put":
            kind = str(args.get("kind"))
            if kind not in LIBRARY_KINDS:
                raise LibraryError("Unknown library kind: " + kind)
            document = args.get("document")
            if not isinstance(document, dict):
                raise LibraryError("document must be an object")
            create = bool(args.get("create")) or not document.get("id")
            expected = args.get("expected")
            if not create and not expected:
                expected = store.entity(kind, str(document["id"]))["etag"]
            stored = store.put(kind, document, expected=expected, create=create)
            self.events.emit("library.saved", {"kind": kind, "id": stored["id"], "source": "ext:" + extension_id}, source=extension_id)
            return stored
        if name == "library.delete":
            kind = str(args.get("kind"))
            if kind not in LIBRARY_KINDS:
                raise LibraryError("Unknown library kind: " + kind)
            id = str(args.get("id"))
            expected = args.get("expected") or store.entity(kind, id)["etag"]
            result = store.delete(kind, id, expected)
            self.events.emit("library.deleted", {"kind": kind, "id": id, "source": "ext:" + extension_id}, source=extension_id)
            return result
        if name == "images.generate":
            return self.invoke("image.generate", {"prompt": str(args.get("prompt", "")), "options": args.get("options") or {}})
        if name == "channels.list":
            config = store.read(include_baseline=False)
            generation = config.get("uiConfig", {}).get("comfyStudio", {}).get("settings", {}).get("imageGeneration", {})
            return {"active": generation.get("active"), "profiles": [_strip_secrets({k: v for k, v in p.items() if k not in ("keyId", "keyIds")}) for p in generation.get("profiles", [])]}
        if name == "workspace.path":
            return {"path": str(self.host.DATA_DIR)}
        if name == "extensions.list":
            return [{k: r.get(k) for k in ("id", "name", "version", "enabled", "apiVersion", "backend", "entry", "contributes")} for r in self.plugins.list()]
        if name == "extensions.call":
            target = str(args.get("id"))
            if not self.plugins.records().get(target, {}).get("enabled"):
                raise LibraryError("Target extension is not enabled: " + target, 403)
            return self.plugins.call(target, str(args.get("method", "POST")).upper(), str(args.get("path", "/")), args.get("body") or {})
        if name == "images.read":
            raw, mime = store.image_bytes(str(args.get("url")))
            return {"b64": base64.b64encode(raw).decode(), "mime": mime}
        if name == "images.path":
            return {"path": str(store.image_path(str(args.get("url"))))}
        if name == "images.store":
            raw = base64.b64decode(str(args.get("b64", "")), validate=True)
            if len(raw) > self.host.MAX_IMAGE_BYTES:
                raise LibraryError("Image exceeds 50 MiB", 413)
            return {"url": self.host.store_image_bytes(raw)}
        if name == "llm.chat":
            return self._chat(str(args.get("prompt", "")), args.get("options") or {})
        if name == "settings.get":
            key = str(args.get("name"))
            document = copy.deepcopy(store.settings.get(key).get("document") or {})
            return _strip_secrets(document)
        if name == "queue.list":
            production = getattr(self, "production", None)
            return production.list() if production else {"items": []}
        if name == "events.emit":
            event = str(args.get("name", ""))[:120]
            if not event or event.startswith("app."):
                raise LibraryError("Extensions may emit any event except the app.* lifecycle names")
            return self.events.emit(event, args.get("payload") or {}, source=extension_id)
        if name == "ui.notify":
            return self.notify(args.get("message", ""), args.get("level", "info"), source=extension_id)
        raise LibraryError("Unknown host API: " + str(name))

    def update_album(self, album_id, patch, *, source="core"):
        store = self.host.native_store()
        record = store.entity("albums", album_id)
        album = record["document"]
        if not isinstance(patch, dict):
            raise LibraryError("patch must be an object")
        for key, value in patch.items():
            if key not in ALBUM_PATCH_KEYS:
                raise LibraryError("Album field not writable by extensions: " + str(key))
            if key == "steps":
                if not isinstance(value, list):
                    raise LibraryError("steps patch must be a list")
                for item in value:
                    target = next((p for p in album.get("steps", []) if p.get("stepIndex") == item.get("stepIndex")), None)
                    if not target:
                        raise LibraryError("Unknown stepIndex in steps patch")
                    for k in STEP_PATCH_KEYS:
                        if k in item:
                            if k == "image" and not str(item[k]).startswith("/images/"):
                                raise LibraryError("Page images must be local /images/ URLs")
                            target[k] = item[k]
            elif key == "tags":
                album[key] = [str(t)[:60] for t in value][:40] if isinstance(value, list) else album.get("tags", [])
            elif key == "liked":
                album[key] = bool(value)
            else:
                album[key] = str(value)[:20000]
        album["updatedAt"] = int(time.time() * 1000)
        store.apply([{"kind": "albums", "id": album_id, "document": album, "expected": record["etag"]}], internal=True)
        self.events.emit("album.saved", {"id": album_id, "source": source}, source=source)
        return {"id": album_id, "updatedAt": album["updatedAt"]}

    # --------------------------------------------------------- export/import
    def album_bundle(self, album_id):
        """Album document plus resolved local file paths for every page image."""
        store = self.host.native_store()
        album = copy.deepcopy(store.entity("albums", album_id)["document"])
        files = {}
        for page in album.get("steps", []):
            url = page.get("image")
            if isinstance(url, str) and url.startswith("/images/"):
                try:
                    files[url] = str(store.image_path(url))
                except LibraryError:
                    pass
        return album, files

    def export(self, exporter_id, album_id, options=None):
        entry = self.exporters.get(exporter_id)
        options = options if isinstance(options, dict) else {}
        album, files = self.album_bundle(album_id)
        album = self.hooks.apply("export.before", album, {"exporter": exporter_id, "options": options, "albumId": album_id})
        payload = {**album, "files": files}
        self.events.emit("export.started", {"exporter": exporter_id, "albumId": album_id})
        started = time.monotonic()
        try:
            result = entry["run"](payload, {"options": options, "timeout": entry["spec"]["timeout"], "albumId": album_id})
        except Exception as exc:
            self.events.emit("export.finished", {"exporter": exporter_id, "albumId": album_id, "ok": False, "error": str(exc)[:300]})
            raise
        if not isinstance(result, dict) or not isinstance(result.get("bytes"), (bytes, bytearray)):
            raise LibraryError("Exporter returned no file")
        self.events.emit("export.finished", {"exporter": exporter_id, "albumId": album_id, "ok": True, "bytes": len(result["bytes"]), "ms": round((time.monotonic() - started) * 1000)})
        return result

    def import_document(self, importer_id, payload, options=None):
        entry = self.importers.get(importer_id)
        options = options if isinstance(options, dict) else {}
        document = entry["run"](payload, {"options": options})
        if not isinstance(document, dict) or document.get("kind") not in ("albums", "storyboards"):
            raise LibraryError("Importer must return {'kind': 'albums'|'storyboards', 'document': {...}}")
        document = self.hooks.apply("import.after", document, {"importer": importer_id})
        kind = document["kind"]
        body = copy.deepcopy(document.get("document") or {})
        assets = {}
        for name, b64 in (document.get("assets") or {}).items():
            raw = base64.b64decode(b64, validate=True)
            assets[name] = raw
        stored = self.host.native_store().put(kind, body, create=True, assets=assets or None)
        self.events.emit("import.finished", {"importer": importer_id, "kind": kind, "id": stored["id"]})
        if kind == "albums":
            self.events.emit("album.created", {"id": stored["id"], "source": "import:" + importer_id})
        return {"kind": kind, "id": stored["id"]}

    def _install_core_capabilities(self):
        self.exporters.register({"id": "pages-zip", "label": "页面 ZIP（含 album.json）", "extension": "zip", "mime": "application/zip", "scope": "album", "timeout": 120}, export_pages_zip, owner="core")
        self.importers.register({"id": "pages-zip", "label": "页面 ZIP（Mio 导出）", "accepts": [".zip"], "scope": "album", "timeout": 120}, import_pages_zip, owner="core")

    def close(self):
        if hasattr(self, "production"):
            self.production.close()
        self.plugins.close()
        for cancel in self.macros.running.values():
            cancel.set()


def _strip_secrets(document):
    if isinstance(document, dict):
        return {k: ("***" if re.search(r"key|token|secret|password", k, re.I) and isinstance(v, str) else _strip_secrets(v)) for k, v in document.items()}
    if isinstance(document, list):
        return [_strip_secrets(v) for v in document]
    return document


# ---------------------------------------------------------------- core exporter/importer
def export_pages_zip(album, context):
    buffer = io.BytesIO()
    manifest = {k: album.get(k) for k in ("id", "title", "synopsis", "tags", "projectId", "totalSteps")}
    manifest["pages"] = []
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for page in sorted(album.get("steps", []), key=lambda p: p.get("stepIndex", 0)):
            path = album.get("files", {}).get(page.get("image"))
            entry = {"stepIndex": page.get("stepIndex"), "caption": page.get("caption", ""), "prompt": page.get("prompt", ""), "name": page.get("name", "")}
            if path and Path(path).is_file():
                name = "pages/%03d%s" % (int(page.get("stepIndex", 0)) + 1, Path(path).suffix.lower())
                zf.write(path, name)
                entry["file"] = name
            manifest["pages"].append(entry)
        zf.writestr("album.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    title = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", str(album.get("title") or "album"))[:60]
    return {"filename": title + ".zip", "mime": "application/zip", "bytes": buffer.getvalue()}


def import_pages_zip(payload, context):
    raw = base64.b64decode(str(payload.get("b64", "")), validate=True)
    if len(raw) > 512 * 1024 * 1024:
        raise LibraryError("ZIP exceeds 512 MiB", 413)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        try:
            manifest = json.loads(zf.read("album.json"))
        except KeyError:
            raise LibraryError("album.json missing from ZIP") from None
        steps, assets = [], {}
        for page in manifest.get("pages", [])[:400]:
            record = {"stepIndex": int(page.get("stepIndex", len(steps))), "caption": str(page.get("caption", "")), "prompt": str(page.get("prompt", "")), "name": str(page.get("name", ""))}
            if page.get("file"):
                data = zf.read(page["file"])
                mime, suffix = image_type(data)
                name = hashlib.sha256(data).hexdigest() + suffix
                assets[name] = data
                record["image"] = name
            steps.append(record)
    now = int(time.time() * 1000)
    document = {
        "title": str(manifest.get("title") or payload.get("filename") or "导入画册")[:200],
        "synopsis": str(manifest.get("synopsis") or ""),
        "tags": [str(t)[:60] for t in (manifest.get("tags") or [])][:40] or ["导入"],
        "projectId": manifest.get("projectId") or context.get("options", {}).get("projectId") or "",
        "steps": steps,
        "totalSteps": max(len(steps), int(manifest.get("totalSteps") or 0)),
        "generatedSteps": len([s for s in steps if s.get("image")]),
        "status": "complete" if steps and all(s.get("image") for s in steps) else "partial",
        "createdAt": now,
        "updatedAt": now,
        "rowId": "unassigned",
        "templateId": "unassigned",
    }
    return {"kind": "albums", "document": document, "assets": {k: base64.b64encode(v).decode() for k, v in assets.items()}}


# ------------------------------------------------------------------------- service
def service(host):
    key = (str(host.BASE_DIR), str(host.DATA_DIR))
    with LOCK:
        if key not in SERVICES:
            SERVICES[key] = Ecosystem(host)
        return SERVICES[key]


def _send_file(handler, result):
    raw = result["bytes"]
    handler.send_response(200)
    handler.send_header("Content-Type", result.get("mime") or "application/octet-stream")
    handler.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + urllib.parse.quote(result.get("filename") or "export.bin"))
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


ASSET_MIME = {".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
              ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".webp": "image/webp", ".avif": "image/avif",
              ".html": "text/html; charset=utf-8", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg"}


def _send_static(handler, p, cache=True):
    size = p.stat().st_size
    if size > 512 * 1024 * 1024:
        raise LibraryError("Asset too large")
    mime = ASSET_MIME.get(p.suffix.lower()) or mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    handler.send_response(200)
    handler.send_header("Content-Type", mime)
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Length", str(size))
    if cache:
        handler.send_header("Cache-Control", "private, max-age=31536000, immutable")
    handler.end_headers()
    with p.open("rb") as stream:
        shutil.copyfileobj(stream, handler.wfile)


def dispatch(handler, host, path):
    if not path.startswith(("/api/ecosystem/", "/api/extensions/", "/extension-assets/", "/theme-assets/", "/style-assets/")):
        return False
    try:
        svc = service(host)
        method = handler.command
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query)
        if path.startswith("/extension-assets/"):
            id, relative = path[len("/extension-assets/"):].split("/", 1)
            _send_static(handler, svc.plugins.asset(id, urllib.parse.unquote(relative)))
            return True
        if path.startswith("/theme-assets/"):
            id, revision, relative = path[len("/theme-assets/"):].split("/", 2)
            _send_static(handler, svc.themes.asset(id, revision, urllib.parse.unquote(relative)))
            return True
        if path.startswith("/style-assets/"):
            _send_static(handler, svc.styles.asset_path(urllib.parse.unquote(path[len("/style-assets/"):])), cache=False)
            return True
        body = handler.read_json_body(max_bytes=320 * 1024 * 1024) if method == "POST" else {}
        if path.startswith("/api/extensions/"):
            result = _extension_route(svc, host, path, method, body, query)
            if isinstance(result, dict) and result.get("__mio_response__"):
                _send_raw(handler, result)
                return True
        else:
            result = _ecosystem_route(svc, handler, path[len("/api/ecosystem/"):], method, body, query)
            if result is _SENT:
                return True
        handler.send_json(200, {"data": result})
    except LibraryError as e:
        handler.send_json(e.status, {"error": str(e)[:800]})
    except Exception as e:
        handler.send_json(400, {"error": str(e)[:500]})
    return True


_SENT = object()


def _send_raw(handler, result):
    raw = base64.b64decode(result.get("b64", ""), validate=True)
    if len(raw) > 256 * 1024 * 1024:
        raise LibraryError("Extension response exceeds 256 MiB", 413)
    handler.send_response(int(result.get("status") or 200))
    handler.send_header("Content-Type", result.get("mime") or "application/octet-stream")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Content-Length", str(len(raw)))
    if result.get("filename"):
        handler.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + urllib.parse.quote(result["filename"]))
    for key, value in (result.get("headers") or {}).items():
        if key.lower() not in ("content-length", "content-type", "transfer-encoding", "set-cookie"):
            handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(raw)


def _extension_route(svc, host, path, method, body, query):
    id, sep, tail = path[len("/api/extensions/"):].partition("/")
    identifier(id)
    if not svc.plugins.records().get(id, {}).get("enabled"):
        raise LibraryError("Extension disabled", 403)
    if tail == "storage":
        tier = (query.get("tier") or [body.get("tier") or "workspace"])[0]
        if tier not in TIERS or tier == "tmp":
            raise LibraryError("tier must be config, workspace or cache")
        storage = Storage(svc.plugins.data_dir(id) / tier)
        if method == "GET":
            return storage.get(query.get("key", [""])[0])
        if body.get("delete"):
            storage.delete(body["key"])
            return None
        return storage.set(body["key"], body.get("value"))
    if tail == "settings":
        storage = Storage(svc.plugins.data_dir(id) / "config")
        if method == "GET":
            return {"schema": svc.plugins.records()[id].get("settings", []), "values": storage.get("settings", {}) or {}}
        schema = {f["key"]: f for f in svc.plugins.records()[id].get("settings", [])}
        values = body.get("values") if isinstance(body.get("values"), dict) else {}
        unknown = [k for k in values if k not in schema]
        if unknown:
            raise LibraryError("Unknown setting: " + ", ".join(unknown)[:200])
        storage.set("settings", values)
        return {"schema": list(schema.values()), "values": values}
    if tail == "capabilities":
        return svc.plugins.capabilities(id)
    if tail == "tasks":
        if method == "GET":
            task_id = query.get("id", [""])[0]
            return svc.plugins.task(id, "get" if task_id else "list", task_id or None)
        return svc.plugins.task(id, "cancel" if body.get("cancel") else "get", body.get("id"))
    flat = {k: v[0] if len(v) == 1 else v for k, v in query.items()}
    return svc.plugins.call(id, method, "/" + tail, body if method == "POST" else flat, flat)


def _ecosystem_route(svc, handler, route, method, body, query):
    host = svc.host
    if method == "GET" and route == "status":
        return {
            "extensions": svc.plugins.list(),
            "themes": svc.themes.list(),
            "styles": {"snippets": len(svc.styles.snippets()), "tokens": sum(len(v) for v in svc.styles.tokens().values() if isinstance(v, dict))},
            "node": bool(shutil.which("node")),
            "git": bool(shutil.which("git")),
            "safeMode": safe_mode(),
            "sdkVersion": SDK_VERSION,
            "platform": svc.manifest(),
            "dataDir": str(host.DATA_DIR),
            "watching": any(r.get("source") == "link" for r in svc.plugins.records().values()) or any(r.get("source") == "link" for r in svc.themes.records().values()),
        }
    if method == "GET" and route == "platform":
        return svc.manifest()
    if method == "GET" and route == "activity":
        return svc.activity(float(query.get("since", ["0"])[0] or 0))
    if method == "GET" and route == "watch":
        return {"themes": svc.themes.watch(), "extensions": svc.plugins.watch(),
                "revisions": {"themes": {k: v.get("revision") for k, v in svc.themes.records().items()}, "extensions": {k: v.get("revision") for k, v in svc.plugins.records().items()}}}
    if method == "GET" and route.startswith("themes/css/"):
        return svc.themes.compile(route.split("/")[-1])
    if method == "GET" and route == "themes/compiled":
        return {"stack": svc.themes.compile_stack(), "user": svc.styles.compile(), "tokens": svc.styles.compile_tokens(), "snippets": svc.styles.compile_snippets(), "fingerprint": svc.themes.fingerprint()}
    if method == "GET" and route == "styles":
        return svc.styles.state()
    if method == "GET" and route == "styles/css":
        return {"css": svc.styles.compile()}
    if method == "GET" and route == "preparations":
        return svc.macros.list()
    if method == "GET" and route.startswith("preparations/"):
        return svc.macros.get(route.split("/")[-1])
    if method != "POST":
        raise LibraryError("Unknown ecosystem route", 404)
    if route == "cache/clear":
        return svc.macros.clear_cache(body.get("trusted"))
    if route == "preparations":
        return svc.macros.start(body)
    if route == "preparations/cancel":
        return svc.macros.cancel(body["id"])
    if route == "events/emit":
        name = str(body.get("name", ""))[:120]
        if not name or name.startswith("app."):
            raise LibraryError("The UI may relay any event except app.* lifecycle names")
        return svc.events.emit(name, body.get("payload") or {}, source=str(body.get("source") or "ui")[:80])
    if route == "export":
        result = svc.export(str(body.get("exporter", "")), str(body.get("albumId", "")), body.get("options"))
        _send_file(handler, result)
        return _SENT
    if route == "import":
        return svc.import_document(str(body.get("importer", "")), body.get("payload") or {}, body.get("options"))
    if route == "albums/update":
        return svc.update_album(str(body.get("id", "")), body.get("patch") or {}, source="ui")
    if route == "extensions/install":
        if safe_mode():
            raise LibraryError("Installation disabled in backend safe mode", 403)
        return svc.plugins.install(url=body.get("url"), branch=body.get("branch", ""), path=body.get("path"),
                                   raw=base64.b64decode(body["zip"], validate=True) if body.get("zip") else None,
                                   trusted=body.get("trusted") is True, enable=body.get("enable", True) is not False)
    if route == "extensions/enable":
        if body.get("enabled") and body.get("trusted") is not True:
            raise LibraryError("Confirm trusted code execution", 403)
        if body.get("enabled") and safe_mode():
            raise LibraryError("Backend safe mode disables extensions", 403)
        svc.plugins.enable(body["id"], bool(body.get("enabled")))
        return svc.plugins.list()
    if route == "extensions/update":
        svc.plugins.update(body["id"], body.get("trusted") is True)
        return svc.plugins.list()
    if route == "extensions/uninstall":
        purge = body.get("purge", "all" if body.get("deleteData") is True else "none")
        svc.plugins.uninstall(body["id"], purge)
        return svc.plugins.list()
    if route == "extensions/purge":
        return svc.plugins.purge(body["id"], body.get("level", "cache"))
    if route == "themes/install":
        return svc.themes.install(base64.b64decode(body["data"], validate=True), body["filename"], body.get("trusted") is True, enable=body.get("enable") is True)
    if route == "themes/link":
        return svc.themes.link(body.get("path", ""), body.get("trusted") is True, enable=body.get("enable", True) is not False)
    if route == "themes/reload":
        return svc.themes.reload(body["id"])
    if route == "themes/select":
        result = svc.themes.select(body.get("id", ""))
        svc.events.emit("theme.changed", {"id": result, "stack": svc.themes.stack()})
        return result
    if route == "themes/enable":
        stack = svc.themes.enable(body["id"], bool(body.get("enabled", True)))
        svc.events.emit("theme.changed", {"id": stack[-1] if stack else "", "stack": stack})
        return stack
    if route == "themes/order":
        stack = svc.themes.order(body.get("ids") or [])
        svc.events.emit("theme.changed", {"id": stack[-1] if stack else "", "stack": stack})
        return stack
    if route == "themes/settings":
        return svc.themes.set_settings(body["id"], body.get("values") or {})
    if route == "themes/uninstall":
        svc.themes.uninstall(body["id"])
        return svc.themes.list()
    if route == "styles/snippet":
        return svc.styles.save_snippet(body.get("snippet") or body)
    if route == "styles/snippets":
        return svc.styles.replace_snippets(body.get("snippets") or [])
    if route == "styles/snippet/delete":
        return svc.styles.delete_snippet(str(body.get("id", "")))
    if route == "styles/tokens":
        return svc.styles.set_tokens(body.get("tokens") or {})
    if route == "styles/assets/upload":
        return svc.styles.put_asset(body.get("name", ""), base64.b64decode(body.get("data", ""), validate=True))
    if route == "styles/assets/delete":
        return svc.styles.delete_asset(body.get("name", ""))
    if route == "styles/export":
        _send_file(handler, svc.styles.export_theme(body.get("name") or "我的主题", body.get("assets", True) is not False))
        return _SENT
    if route == "extensions/link":
        if safe_mode():
            raise LibraryError("Installation disabled in backend safe mode", 403)
        return svc.plugins.link(body.get("path", ""), trusted=body.get("trusted") is True, enable=body.get("enable", True) is not False)
    if route == "extensions/reload":
        return svc.plugins.reload(body["id"])
    if route == "extensions/deps":
        return svc.plugins.install_deps(body["id"])
    if route == "reset":
        svc.themes.select("")
        for id in list(svc.plugins.records()):
            svc.plugins.enable(id, False)
        if body.get("styles"):
            svc.styles.replace_snippets([{**s, "enabled": False} for s in svc.styles.snippets()])
        return {"reset": True}
    raise LibraryError("Unknown ecosystem route", 404)
