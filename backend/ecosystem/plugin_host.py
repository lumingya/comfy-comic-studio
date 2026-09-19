"""Trusted Python extension process — SDK v2.

One process per enabled extension. Isolation contains crashes and hangs, not
malicious OS access: everything in ``plugin.py`` runs with the user's rights.

Wire protocol (one JSON object per line, both directions):

  host -> worker  {"seq", "op": route|hook|event|provider|exporter|importer|cancel|reply|stop, ...}
  worker -> host  {"seq", "ok": true, "result"} | {"seq", "ok": false, "error"}
  worker -> host  {"call": "<host api>", "args": {...}, "seq"}   (answered by op=reply)

Requests run on a small thread pool so a long provider call never blocks a
cheap hook, and ``op=cancel`` can flip the token a running provider polls.
"""

import importlib.util
import json
import queue
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

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
        self.library = SimpleNamespace(
            list=lambda kind: self.call("library.list", kind=kind),
            get=lambda kind, id: self.call("library.get", kind=kind, id=id),
        )
        self.images = SimpleNamespace(
            read=lambda url: __import__("base64").b64decode(self.call("images.read", url=url)["b64"]),
            store=lambda raw, name="": self.call("images.store", b64=__import__("base64").b64encode(raw).decode(), name=name)["url"],
            path=lambda url: self.call("images.path", url=url)["path"],
        )
        self.llm = SimpleNamespace(chat=lambda prompt, **options: self.call("llm.chat", timeout=190, prompt=prompt, options=options))
        self.settings = SimpleNamespace(get=lambda name: self.call("settings.get", name=name))
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
    def route(self, path, method="POST"):
        if not isinstance(path, str) or not path.startswith("/") or ".." in path:
            raise ValueError("Use a package-relative route")
        key = (method.upper(), path)

        def register(fn):
            if key in self.routes:
                raise ValueError("Duplicate extension route")
            self.routes[key] = fn
            return fn

        return register

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
            "routes": [{"method": m, "path": p} for m, p in self.routes],
            "providers": [{"spec": v["spec"], "models": v["models"] is not None, "check": v["check"] is not None} for v in self.providers.values()],
            "events": [{"event": l["event"], "priority": l["priority"]} for l in self.listeners],
            "hooks": [{"hook": f["hook"], "priority": f["priority"], "critical": f["critical"], "timeout": f["timeout"]} for f in self.filters],
            "exporters": [v["spec"] for v in self.exporters.values()],
            "importers": [v["spec"] for v in self.importers.values()],
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
        fn = ctx.routes.get((request["method"], request["path"]))
        if not fn:
            raise ValueError("Extension route not registered")
        return fn(request.get("body", {}))
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
