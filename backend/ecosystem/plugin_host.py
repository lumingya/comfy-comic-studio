"""Trusted Python extension process — SDK v3.

One process per enabled extension. Isolation contains crashes and hangs, not
malicious OS access: everything in ``plugin.py`` runs with the user's rights.

Wire protocol (one JSON object per line, both directions):

  host -> worker  {"seq", "op": route|hook|event|provider|exporter|importer|task|cancel|reply|stop, ...}
  worker -> host  {"seq", "ok": true, "result"} | {"seq", "ok": false, "error"}
  worker -> host  {"call": "<host api>", "args": {...}, "seq"}   (answered by op=reply)

Requests run on a small thread pool so a long provider call never blocks a
cheap hook, and ``op=cancel`` can flip the token a running provider polls.
"""

import base64
import importlib.util
import json
import mimetypes
import os
import queue
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

if os.environ.get("MIO_EXT_SITE"):
    # Per-extension pip --target directory (manifest "requirements"); it shadows nothing in the host.
    sys.path.insert(0, os.environ["MIO_EXT_SITE"])

from backend.ecosystem.storage import Storage, owned

wire = sys.stdout
sys.stdout = sys.stderr
WRITE = threading.Lock()
MAX_RESULT = 64 * 1024 * 1024
TIERS = ("config", "workspace", "cache", "tmp")


def send(value):
    line = json.dumps(value, ensure_ascii=False, allow_nan=False)
    if len(line) > MAX_RESULT:
        raise ValueError("Extension response too large; write a file under ctx.data.tmp and return its path instead")
    with WRITE:
        wire.write(line + "\n")
        wire.flush()


class Cancel:
    def __init__(self):
        self.event = threading.Event()

    def is_set(self):
        return self.event.is_set()

    def wait(self, seconds):
        return self.event.wait(seconds)

    __call__ = is_set


class HostLink:
    """Calls back into the host while a request is being served."""

    def __init__(self):
        self.lock = threading.Lock()
        self.seq = 0
        self.pending = {}

    def call(self, name, timeout=60, **args):
        with self.lock:
            self.seq += 1
            seq = self.seq
            box = queue.Queue(maxsize=1)
            self.pending[seq] = box
        try:
            send({"call": name, "args": args, "seq": seq})
            try:
                reply = box.get(timeout=timeout)
            except queue.Empty:
                raise TimeoutError("Host did not answer " + name) from None
        finally:
            with self.lock:
                self.pending.pop(seq, None)
        if "error" in reply:
            raise RuntimeError(str(reply["error"]))
        return reply.get("result")

    def resolve(self, message):
        with self.lock:
            box = self.pending.get(message.get("target"))
        if box:
            box.put(message)


class HostAPI:
    """Thin, discoverable facade over HostLink.call. See docs/ECOSYSTEM_GUIDE.md."""

    def __init__(self, link):
        self.call = link.call
        self.albums = SimpleNamespace(
            list=lambda project_id=None: self.call("albums.list", projectId=project_id),
            get=lambda id: self.call("albums.get", id=id),
            update=lambda id, patch: self.call("albums.update", id=id, patch=patch),
            page=lambda id, index: self.call("albums.page", id=id, index=index),
        )
        self.albums.create = lambda document: self.call("library.put", kind="albums", document=document, create=True)
        self.library = SimpleNamespace(
            list=lambda kind: self.call("library.list", kind=kind),
            get=lambda kind, id: self.call("library.get", kind=kind, id=id),
            put=lambda kind, document, expected=None, create=False: self.call("library.put", kind=kind, document=document, expected=expected, create=create),
            create=lambda kind, document: self.call("library.put", kind=kind, document=document, create=True),
            delete=lambda kind, id, expected=None: self.call("library.delete", kind=kind, id=id, expected=expected),
            kinds=lambda: self.call("library.kinds"),
        )
        self.images = SimpleNamespace(
            read=lambda url: base64.b64decode(self.call("images.read", url=url)["b64"]),
            store=lambda raw, name="": self.call("images.store", b64=base64.b64encode(raw).decode(), name=name)["url"],
            path=lambda url: self.call("images.path", url=url)["path"],
            generate=lambda prompt, **options: self.call("images.generate", timeout=int(options.get("timeout", 180)) + 30, prompt=prompt, options=options),
        )
        self.llm = SimpleNamespace(chat=lambda prompt, **options: self.call("llm.chat", timeout=190, prompt=prompt, options=options))
        self.settings = SimpleNamespace(get=lambda name: self.call("settings.get", name=name))
        self.channels = SimpleNamespace(list=lambda: self.call("channels.list"))
        self.workspace = SimpleNamespace(path=lambda: self.call("workspace.path")["path"])
        self.extensions = SimpleNamespace(list=lambda: self.call("extensions.list"), call=lambda id, method, path, body=None: self.call("extensions.call", timeout=120, id=id, method=method, path=path, body=body or {}))
        self.queue = SimpleNamespace(list=lambda: self.call("queue.list"))
        self.events = SimpleNamespace(emit=lambda name, payload=None: self.call("events.emit", name=name, payload=payload or {}))
        self.notify = lambda message, level="info": self.call("ui.notify", message=str(message), level=level)


class DataTiers:
    """Per-extension data layout: config / workspace / cache / tmp."""

    def __init__(self, root):
        self.root = Path(root)
        for tier in TIERS:
            (self.root / tier).mkdir(parents=True, exist_ok=True)
        self.config = Storage(self.root / "config")
        self.workspace = Storage(self.root / "workspace")
        self.cache = Storage(self.root / "cache")
        self.tmp = self.root / "tmp"

    def path(self, tier, relative):
        if tier not in TIERS:
            raise ValueError("Unknown data tier: " + str(tier))
        return owned(self.root / tier, relative)


class Task:
    """A background job inside the extension process. Poll it from the UI with ctx.tasks."""

    def __init__(self, name):
        self.id = uuid.uuid4().hex[:12]
        self.name = str(name or "task")[:80]
        self.status = "running"
        self.progress = 0.0
        self.message = ""
        self.result = None
        self.error = ""
        self.startedAt = time.time()
        self.endedAt = None
        self.cancel = Cancel()

    def report(self, progress=None, message=None):
        if progress is not None:
            self.progress = max(0.0, min(1.0, float(progress)))
        if message is not None:
            self.message = str(message)[:500]

    def cancelled(self):
        return self.cancel.is_set()

    def snapshot(self, include_result=True):
        data = {"id": self.id, "name": self.name, "status": self.status, "progress": self.progress, "message": self.message,
                "error": self.error, "startedAt": self.startedAt, "endedAt": self.endedAt}
        if include_result:
            data["result"] = self.result
        return data


class Tasks:
    def __init__(self):
        self.items = {}
        self.lock = threading.Lock()

    def spawn(self, fn, *args, name="", **kwargs):
        task = Task(name or getattr(fn, "__name__", "task"))

        def run():
            try:
                task.result = fn(task, *args, **kwargs)
                task.status = "cancelled" if task.cancelled() and task.result is None else "complete"
            except Exception as exc:
                task.status = "failed"
                task.error = str(exc)[:800]
            finally:
                task.endedAt = time.time()

        with self.lock:
            self.items[task.id] = task
            if len(self.items) > 500:
                for stale in sorted((t for t in self.items.values() if t.endedAt), key=lambda t: t.endedAt)[:100]:
                    self.items.pop(stale.id, None)
        threading.Thread(target=run, daemon=True, name="mio-ext-task").start()
        return task

    def get(self, id):
        return self.items.get(id)

    def list(self):
        return [t.snapshot(include_result=False) for t in sorted(self.items.values(), key=lambda t: t.startedAt, reverse=True)]

    def cancel(self, id):
        task = self.items.get(id)
        if task:
            task.cancel.event.set()
        return task.snapshot() if task else None


def response(body, mime="text/plain; charset=utf-8", status=200, headers=None, filename=None):
    """Return raw bytes/text from a route instead of JSON (HTML pages, files, SVG, CSV, ...)."""
    if isinstance(body, str):
        body = body.encode("utf-8")
    if not isinstance(body, (bytes, bytearray)):
        body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        mime = "application/json; charset=utf-8"
    return {"__mio_response__": True, "b64": base64.b64encode(bytes(body)).decode(), "mime": str(mime)[:120], "status": int(status),
            "headers": {str(k)[:80]: str(v)[:500] for k, v in (headers or {}).items()}, "filename": str(filename)[:200] if filename else ""}


def file_response(path, mime=None, filename=None, download=False):
    path = Path(path)
    raw = path.read_bytes()
    return response(raw, mime or mimetypes.guess_type(path.name)[0] or "application/octet-stream", filename=filename or (path.name if download else None))


class Context:
    def __init__(self, folder, data, manifest, link):
        self.id = manifest["id"]
        self.manifest = manifest
        self.plugin_dir = folder
        self.data_dir = data
        self.data = DataTiers(data)
        self.storage = self.data.workspace  # workspace tier is the default store
        self.host = HostAPI(link)
        self.routes = {}
        self.providers = {}
        self.listeners = []
        self.filters = []
        self.exporters = {}
        self.importers = {}
        self._local = threading.local()
        self.tasks = Tasks()
        self.response = response
        self.file = file_response
        self.sdk = 3

    # ------------------------------------------------------------------ helpers
    def log(self, *values):
        print("[" + self.id + "]", *values, file=sys.stderr, flush=True)

    def cancelled(self):
        token = getattr(self._local, "cancel", None)
        return bool(token and token.is_set())

    def settings(self):
        """Values of the manifest-declared settings form (config tier)."""
        stored = self.data.config.get("settings", {}) or {}
        defaults = {f["key"]: f.get("default") for f in self.manifest.get("settings", []) if isinstance(f, dict) and "key" in f}
        return {**defaults, **stored}

    # ---------------------------------------------------------------- decorators
    def route(self, path, method="POST", timeout=None):
        """Register a JSON route. ``timeout`` (seconds, up to 3600) raises the host budget for slow work;
        anything longer belongs in ``ctx.tasks.spawn``. Handlers may take (body) or (body, query)."""
        if not isinstance(path, str) or not path.startswith("/") or ".." in path:
            raise ValueError("Use a package-relative route")
        key = (method.upper(), path)

        def register(fn):
            if key in self.routes:
                raise ValueError("Duplicate extension route")
            self.routes[key] = {"fn": fn, "timeout": int(timeout) if timeout else None}
            return fn

        return register

    def query(self):
        """Query-string values of the request currently being served (GET routes)."""
        return getattr(self._local, "query", {}) or {}

    def provider(self, spec, *, models=None, check=None):
        if not isinstance(spec, dict) or not spec.get("id"):
            raise ValueError("Provider spec requires an id")

        def register(fn):
            if spec["id"] in self.providers:
                raise ValueError("Duplicate provider id")
            self.providers[spec["id"]] = {"spec": spec, "generate": fn, "models": models, "check": check}
            return fn

        return register

    def on(self, event, priority=100):
        def register(fn):
            self.listeners.append({"event": event, "priority": int(priority), "fn": fn})
            return fn

        return register

    def filter(self, hook, priority=100, critical=False, timeout=20):
        def register(fn):
            self.filters.append({"hook": hook, "priority": int(priority), "critical": bool(critical),
                                 "timeout": max(1, min(180, int(timeout))), "fn": fn})
            return fn

        return register

    def exporter(self, spec):
        def register(fn):
            self.exporters[spec["id"]] = {"spec": spec, "fn": fn}
            return fn

        return register

    def importer(self, spec):
        def register(fn):
            self.importers[spec["id"]] = {"spec": spec, "fn": fn}
            return fn

        return register

    # -------------------------------------------------------------- capabilities
    def capabilities(self):
        return {
            "sdk": 2,
            "routes": [{"method": m, "path": p, "timeout": v["timeout"]} for (m, p), v in self.routes.items()],
            "providers": [{"spec": v["spec"], "models": v["models"] is not None, "check": v["check"] is not None} for v in self.providers.values()],
            "events": [{"event": l["event"], "priority": l["priority"]} for l in self.listeners],
            "hooks": [{"hook": f["hook"], "priority": f["priority"], "critical": f["critical"], "timeout": f["timeout"]} for f in self.filters],
            "exporters": [v["spec"] for v in self.exporters.values()],
            "importers": [v["spec"] for v in self.importers.values()],
            "tasks": True,
        }


def load_plugin(folder, ctx):
    spec = importlib.util.spec_from_file_location("mio_ext_" + ctx.id.replace("-", "_"), folder / "plugin.py")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(folder))
    spec.loader.exec_module(module)
    if hasattr(module, "setup"):
        module.setup(ctx)
    if hasattr(module, "on_load"):
        module.on_load(ctx)
    return module


def serve(ctx, module, request, cancel):
    op = request.get("op", "route")
    ctx._local.cancel = cancel
    if op == "route":
        entry = ctx.routes.get((request["method"], request["path"]))
        if not entry:
            raise ValueError("Extension route not registered")
        ctx._local.query = request.get("query") or {}
        fn = entry["fn"]
        try:
            code = fn.__code__
            arity = code.co_argcount - (1 if getattr(fn, "__self__", None) is not None else 0)
        except AttributeError:
            arity = 1
        return fn(request.get("body", {}), ctx._local.query) if arity >= 2 else fn(request.get("body", {}))
    if op == "task":
        action = request.get("action")
        if action == "list":
            return ctx.tasks.list()
        if action == "get":
            task = ctx.tasks.get(request.get("id"))
            return task.snapshot() if task else None
        if action == "cancel":
            return ctx.tasks.cancel(request.get("id"))
        raise ValueError("Unknown task action")
    if op == "hook":
        hooks = [f for f in ctx.filters if f["hook"] == request["name"]]
        value = request.get("value")
        for entry in sorted(hooks, key=lambda f: f["priority"]):
            result = entry["fn"](value, request.get("context", {}))
            if result is not None:
                value = result
        return value
    if op == "event":
        for entry in ctx.listeners:
            if entry["event"] == request["name"]:
                try:
                    entry["fn"](request.get("payload", {}), request.get("meta", {}))
                except Exception as exc:
                    ctx.log("listener failed:", request["name"], exc)
        return None
    if op == "provider":
        entry = ctx.providers.get(request["id"])
        if not entry:
            raise ValueError("Provider not registered: " + str(request["id"]))
        action = request.get("action", "generate")
        if action == "generate":
            return entry["generate"](request.get("request", {}), cancel)
        if action == "models" and entry["models"]:
            return entry["models"](request.get("request", {}))
        if action == "check" and entry["check"]:
            return entry["check"](request.get("request", {}))
        raise ValueError("Provider does not support " + action)
    if op == "exporter":
        entry = ctx.exporters.get(request["id"])
        if not entry:
            raise ValueError("Exporter not registered")
        return entry["fn"](request.get("album", {}), {**request.get("context", {}), "cancel": cancel})
    if op == "importer":
        entry = ctx.importers.get(request["id"])
        if not entry:
            raise ValueError("Importer not registered")
        return entry["fn"](request.get("payload", {}), request.get("context", {}))
    raise ValueError("Unknown operation: " + str(op))


def main():
    folder = Path(sys.argv[1])
    data = Path(sys.argv[2])
    manifest = json.loads((folder / "mio.extension.json").read_text(encoding="utf-8-sig"))
    link = HostLink()
    ctx = Context(folder, data, manifest, link)
    module = load_plugin(folder, ctx)
    send({"ready": True, "capabilities": ctx.capabilities()})
    pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="mio-ext")
    cancels = {}
    lock = threading.Lock()

    def run(request):
        seq = request.get("seq")
        cancel = Cancel()
        with lock:
            cancels[seq] = cancel
        try:
            result = serve(ctx, module, request, cancel)
            send({"seq": seq, "ok": True, "result": result})
        except Exception as exc:
            ctx.log(traceback.format_exc(limit=4))
            try:
                send({"seq": seq, "ok": False, "error": str(exc)[:800]})
            except Exception as wire_error:
                send({"seq": seq, "ok": False, "error": str(wire_error)[:800]})
        finally:
            with lock:
                cancels.pop(seq, None)

    for line in sys.stdin:
        try:
            request = json.loads(line)
        except ValueError:
            continue
        op = request.get("op")
        if op == "stop":
            pool.shutdown(wait=False, cancel_futures=True)
            if hasattr(module, "on_unload"):
                try:
                    module.on_unload(ctx)
                except Exception as exc:
                    ctx.log("on_unload failed:", exc)
            send({"seq": request.get("seq"), "ok": True})
            break
        if op == "reply":
            link.resolve(request)
            continue
        if op == "cancel":
            with lock:
                token = cancels.get(request.get("target"))
            if token:
                token.event.set()
            continue
        pool.submit(run, request)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        send({"ready": False, "ok": False, "error": (str(error) or error.__class__.__name__)[:800]})
