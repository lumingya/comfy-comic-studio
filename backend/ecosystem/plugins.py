"""Extension packages: install, trust, run, and wire capabilities into the platform.

Code lives under ``<data>/packages/extensions/<id>``; per-extension data under
``<data>/extensions/<id>/{config,workspace,cache,tmp}``. A Python backend runs
in its own process (``plugin_host``); its declared capabilities (providers,
hooks, events, exporters, importers, routes) are registered into the platform
registries on enable and removed on disable — nothing else in the application
has to know an extension exists.
"""

import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from backend.mio_library import LibraryError, atomic_write
from .storage import Storage, identifier, owned
from .packages import unpack, manifest, package_root, clone, scan_revision

TIERS = ("config", "workspace", "cache", "tmp")
PURGE_LEVELS = ("none", "cache", "all")
ROUTE_TIMEOUT = 30
MAX_ROUTE_TIMEOUT = 3600
EXPORT_TIMEOUT = 180
STARTUP_TIMEOUT = 30
DEPS_TIMEOUT = 1200
MAX_FILE = 512 * 1024 * 1024
FILE_ROOT = "files"


class WorkerDead(LibraryError):
    pass


class Worker:
    """One extension process. Calls are multiplexed by sequence number."""

    def __init__(self, code, data, project, host_call, timeout=STARTUP_TIMEOUT, site=None, files=None):
        self.host_call = host_call
        env = dict(os.environ)
        env["MIO_EXT_SITE"] = str(site or "")
        env["MIO_EXT_DATA"] = str(data)
        env["MIO_EXT_FILES"] = str(files or "")
        env["PYTHONIOENCODING"] = "utf-8"
        self.lock = threading.Lock()
        self.write_lock = threading.Lock()
        self.seq = 0
        self.pending = {}
        self.dead = threading.Event()
        self.ready = queue.Queue(maxsize=1)
        self.capabilities = {}
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "backend.ecosystem.plugin_host", str(code), str(data)],
            cwd=project, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", bufsize=1, start_new_session=os.name == "posix", env=env,
        )
        self.reader = threading.Thread(target=self._read, daemon=True, name="mio-ext-reader")
        self.reader.start()
        try:
            first = self.ready.get(timeout=timeout)
        except queue.Empty:
            self.kill()
            raise LibraryError("Extension startup timed out", 408) from None
        if not first.get("ready"):
            self.kill()
            raise LibraryError("Extension startup failed: " + str(first.get("error", "invalid response"))[:500])
        self.capabilities = first.get("capabilities") or {}

    # ------------------------------------------------------------------ transport
    def _read(self):
        try:
            while self.proc.stdout:
                line = self.proc.stdout.readline(64 * 1024 * 1024 + 1)
                if not line:
                    break
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                if "ready" in message:
                    try:
                        self.ready.put_nowait(message)
                    except queue.Full:
                        pass
                elif "call" in message:
                    threading.Thread(target=self._serve_call, args=(message,), daemon=True).start()
                else:
                    with self.lock:
                        box = self.pending.get(message.get("seq"))
                    if box:
                        box.put(message)
        finally:
            self.dead.set()
            with self.lock:
                boxes = list(self.pending.values())
            for box in boxes:
                box.put({"ok": False, "error": "Extension process stopped", "dead": True})

    def _serve_call(self, message):
        reply = {"op": "reply", "target": message.get("seq")}
        try:
            reply["result"] = self.host_call(message.get("call"), message.get("args") or {})
        except Exception as exc:
            reply["error"] = str(exc)[:800]
        try:
            self._write(reply)
        except Exception:
            pass

    def _write(self, payload):
        raw = json.dumps(payload, ensure_ascii=False, allow_nan=False) + "\n"
        with self.write_lock:
            if self.dead.is_set() or self.proc.poll() is not None:
                raise WorkerDead("Extension process is not running", 503)
            self.proc.stdin.write(raw)
            self.proc.stdin.flush()

    def call(self, payload, timeout=ROUTE_TIMEOUT, cancel=None):
        with self.lock:
            self.seq += 1
            seq = self.seq
            box = queue.Queue()
            self.pending[seq] = box
        try:
            self._write({**payload, "seq": seq})
            deadline = time.monotonic() + timeout
            cancelled_at = None
            while True:
                try:
                    reply = box.get(timeout=0.1)
                    break
                except queue.Empty:
                    pass
                if cancel and cancelled_at is None and cancel():
                    cancelled_at = time.monotonic()
                    try:
                        self._write({"op": "cancel", "target": seq})
                    except Exception:
                        pass
                if cancelled_at is not None and time.monotonic() - cancelled_at > 3:
                    raise InterruptedError("Extension call cancelled")
                if time.monotonic() > deadline:
                    self.kill()
                    raise LibraryError("Extension timed out or stopped. Disabled; no automatic retry.", 408)
        finally:
            with self.lock:
                self.pending.pop(seq, None)
        if reply.get("dead"):
            raise WorkerDead("Extension process stopped", 502)
        if not reply.get("ok"):
            if cancelled_at is not None:
                raise InterruptedError("Extension call cancelled: " + str(reply.get("error", ""))[:200])
            raise LibraryError("Extension failed: " + str(reply.get("error", "unknown"))[:600], 502)
        return reply.get("result")

    def notify(self, payload):
        """Fire-and-forget (events). Reply is discarded by the reader."""
        with self.lock:
            self.seq += 1
            seq = self.seq
        try:
            self._write({**payload, "seq": seq})
        except Exception:
            pass

    # ------------------------------------------------------------------ lifecycle
    def kill(self):
        if self.proc.poll() is None:
            try:
                if os.name == "posix":
                    os.killpg(self.proc.pid, signal.SIGKILL)
                else:
                    self.proc.kill()
            except OSError:
                pass
        try:
            self.proc.wait(timeout=5)
        except Exception:
            pass
        self.dead.set()
        for stream in (self.proc.stdin, self.proc.stdout):
            try:
                stream.close()
            except Exception:
                pass

    def stop(self):
        try:
            self.call({"op": "stop"}, timeout=5)
        except Exception:
            pass
        finally:
            self.kill()


class Plugins:
    def __init__(self, project, data, platform=None):
        self.project = Path(project)
        self.data_root = Path(data)
        self.code = self.data_root / "packages" / "extensions"
        self.data = self.data_root / "extensions"
        self.registry = Storage(self.data_root / "packages" / "registry")
        self.platform = platform
        self.workers = {}
        self.lock = threading.RLock()
        self.errors = {}
        self.deps = {}

    # ------------------------------------------------------------------ paths
    def code_dir(self, id):
        """Installed packages live under packages/extensions; linked ones stay where they are."""
        record = self.records().get(id) or {}
        if record.get("source") == "link":
            return Path(record["path"])
        return self.code / id

    def site_dir(self, id):
        return self.data / id / "site-packages"

    # ------------------------------------------------------------------ records
    def records(self):
        return self.registry.get("extensions", {})

    def save(self, value):
        self.registry.set("extensions", value)

    def list(self):
        items = []
        for id, record in self.records().items():
            worker = self.workers.get(id)
            code = self.code_dir(id)
            items.append({
                **record,
                "error": self.errors.get(id, ""),
                "backend": (code / "plugin.py").exists(),
                "missing": not code.is_dir(),
                "capabilities": self._capability_summary(worker.capabilities) if worker else {},
                "data": self.usage(id),
                "deps": self.deps.get(id) or self._deps_state(id),
            })
        return items

    def usage(self, id):
        root = self.data / id
        result = {}
        for tier in TIERS:
            folder = root / tier
            size = 0
            if folder.is_dir():
                for p in folder.rglob("*"):
                    try:
                        if p.is_file():
                            size += p.stat().st_size
                    except OSError:
                        pass
            result[tier] = size
        return result

    def data_dir(self, id):
        root = owned(self.data, identifier(id))
        for tier in TIERS:
            (root / tier).mkdir(parents=True, exist_ok=True)
        return root

    # ------------------------------------------------------------------ install
    def install(self, *, raw=None, url=None, branch="", path=None, trusted=False, enable=True):
        if not trusted:
            raise LibraryError("Explicit trusted-code confirmation is required", 403)
        self.code.mkdir(parents=True, exist_ok=True)
        if path:
            return self.link(path, trusted=trusted, enable=enable)
        with tempfile.TemporaryDirectory(prefix=".install-", dir=self.code) as tmp:
            stage = Path(tmp) / "package"
            if url:
                clone(url, branch, stage)
            else:
                stage.mkdir()
                unpack(raw, stage)
                stage = package_root(stage, "extension")
            meta = manifest(stage, "extension")
            id = meta["id"]
            with self.lock:
                target = owned(self.code, id)
                if target.exists() or id in self.records():
                    raise LibraryError("Extension ID already installed", 409)
                shutil.move(str(stage), target)
                items = self.records()
                items[id] = meta | {"enabled": False, "source": url or "zip", "branch": branch, "revision": uuid.uuid4().hex, "installedAt": time.time()}
                try:
                    self.save(items)
                except Exception:
                    shutil.rmtree(target)
                    raise
            if enable:
                self.enable(id, True)
            return self.records()[id]

    def link(self, path, *, trusted=False, enable=True):
        """Develop in place: register a folder on this machine; edits are picked up by watch()."""
        if not trusted:
            raise LibraryError("Explicit trusted-code confirmation is required", 403)
        folder = Path(str(path or "")).expanduser()
        if not folder.is_absolute() or not folder.is_dir():
            raise LibraryError("Provide an absolute path to an existing extension folder")
        folder = folder.resolve()
        meta = manifest(folder, "extension", strict=False)
        id = meta["id"]
        with self.lock:
            items = self.records()
            if id in items or (self.code / id).exists():
                raise LibraryError("Extension ID already installed", 409)
            items[id] = meta | {"enabled": False, "source": "link", "path": str(folder), "branch": "", "revision": scan_revision(folder), "installedAt": time.time()}
            self.save(items)
        if enable:
            self.enable(id, True)
        return self.records()[id]

    def reload(self, id):
        """Restart the extension on its current files (new revision → the front end re-imports)."""
        identifier(id)
        with self.lock:
            record = self.records().get(id)
            if not record:
                raise LibraryError("Extension not found", 404)
            was_enabled = record.get("enabled")
            if was_enabled:
                self.enable(id, False)
            items = self.records()
            code = self.code_dir(id)
            items[id]["revision"] = scan_revision(code) if record.get("source") == "link" else uuid.uuid4().hex
            try:
                items[id].update(manifest(code, "extension", strict=record.get("source") != "link"))
            except Exception as exc:
                self.errors[id] = str(exc)[:500]
            self.save(items)
            if was_enabled:
                self.enable(id, True)
            return self.records()[id]

    def watch(self):
        """Poll linked extension folders and hot-reload the ones whose files changed."""
        changed = {}
        for id, record in list(self.records().items()):
            if record.get("source") != "link":
                continue
            folder = Path(record.get("path", ""))
            if not folder.is_dir():
                continue
            revision = scan_revision(folder)
            if revision != record.get("revision"):
                try:
                    self.reload(id)
                except Exception as exc:
                    self.errors[id] = str(exc)[:500]
                changed[id] = self.records().get(id, {}).get("revision", revision)
        return changed

    def enable(self, id, on):
        identifier(id)
        with self.lock:
            items = self.records()
            if id not in items:
                raise LibraryError("Extension not found", 404)
            if not on:
                self._unregister(id)
                worker = self.workers.pop(id, None)
                if worker:
                    worker.stop()
                items[id]["enabled"] = False
                self.errors.pop(id, None)
                self.save(items)
                self._clear_tmp(id)
                if self.platform:
                    self.platform.events.emit("extension.disabled", {"id": id})
                return
            try:
                code = self.code_dir(id)
                meta = manifest(code, "extension", strict=items[id].get("source") != "link")
                items[id].update({k: meta[k] for k in ("name", "version", "settings", "description", "entry", "styles", "requirements", "contributes", "backend") if k in meta})
                for key in ("styles", "requirements", "contributes"):
                    if key not in meta:
                        items[id].pop(key, None)
                data = self.data_dir(id)
                self._clear_tmp(id)
                if meta.get("requirements") and not self._deps_ready(id, meta):
                    self._install_deps_async(id)
                    items[id]["enabled"] = True
                    self.errors.pop(id, None)
                    self.save(items)
                    return
                if (code / "plugin.py").exists() and id not in self.workers:
                    site = self.site_dir(id) if meta.get("requirements") else None
                    self.workers[id] = Worker(code, data, self.project, self._host_call(id), site=site, files=self.files_dir(id))
                    self._register(id, self.workers[id])
                items[id]["enabled"] = True
                self.errors.pop(id, None)
            except Exception as exc:
                worker = self.workers.pop(id, None)
                if worker:
                    worker.kill()
                self._unregister(id)
                items[id]["enabled"] = False
                self.errors[id] = str(exc)[:500]
            self.save(items)
            if items[id]["enabled"] and self.platform:
                self.platform.events.emit("extension.enabled", {"id": id, "capabilities": self.workers.get(id).capabilities if id in self.workers else {}})

    def boot(self):
        for id, meta in self.records().items():
            if meta.get("enabled"):
                self.enable(id, True)

    # ------------------------------------------------------------ dependencies
    def _requirements_text(self, id, meta=None):
        meta = meta or self.records().get(id) or {}
        req = meta.get("requirements")
        if not req:
            return ""
        if isinstance(req, list):
            return "\n".join(req) + "\n"
        path = owned(self.code_dir(id), req)
        return path.read_text(encoding="utf-8-sig") if path.is_file() else ""

    def _deps_state(self, id):
        meta = self.records().get(id) or {}
        if not meta.get("requirements"):
            return {"status": "none"}
        return {"status": "ready" if self._deps_ready(id, meta) else "pending", "site": str(self.site_dir(id))}

    def _deps_ready(self, id, meta):
        text = self._requirements_text(id, meta)
        if not text.strip():
            return True
        marker = self.site_dir(id) / ".mio-requirements"
        return marker.is_file() and marker.read_text(encoding="utf-8") == hashlib.sha256(text.encode()).hexdigest()

    def _install_deps_async(self, id):
        current = self.deps.get(id)
        if current and current.get("status") == "installing":
            return
        self.deps[id] = {"status": "installing", "log": "", "startedAt": time.time()}
        threading.Thread(target=self._install_deps, args=(id,), daemon=True, name="mio-ext-deps").start()

    def _install_deps(self, id):
        try:
            text = self._requirements_text(id)
            site = self.site_dir(id)
            site.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as handle:
                handle.write(text)
                req_file = handle.name
            try:
                result = subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--upgrade", "--target", str(site), "-r", req_file],
                                        capture_output=True, text=True, timeout=DEPS_TIMEOUT, stdin=subprocess.DEVNULL)
            finally:
                try:
                    os.unlink(req_file)
                except OSError:
                    pass
            log = (result.stdout + "\n" + result.stderr)[-8000:]
            if result.returncode:
                self.deps[id] = {"status": "failed", "log": log, "endedAt": time.time()}
                self.errors[id] = "Dependency install failed; see deps log"
                return
            (site / ".mio-requirements").write_text(hashlib.sha256(text.encode()).hexdigest(), encoding="utf-8")
            self.deps[id] = {"status": "ready", "log": log, "endedAt": time.time(), "site": str(site)}
            if self.platform:
                self.platform.notify("扩展依赖已安装：" + id, "success", source=id)
            with self.lock:
                if self.records().get(id, {}).get("enabled") and id not in self.workers:
                    self.enable(id, True)
        except Exception as exc:
            self.deps[id] = {"status": "failed", "log": str(exc)[:2000], "endedAt": time.time()}
            self.errors[id] = "Dependency install failed: " + str(exc)[:200]

    def install_deps(self, id):
        identifier(id)
        if id not in self.records():
            raise LibraryError("Extension not found", 404)
        self._install_deps_async(id)
        return self.deps.get(id)

    def _clear_tmp(self, id):
        tmp = self.data / id / "tmp"
        if tmp.is_dir():
            for child in tmp.iterdir():
                try:
                    shutil.rmtree(child) if child.is_dir() else child.unlink()
                except OSError:
                    pass

    # -------------------------------------------------------------- capabilities
    def _host_call(self, id):
        def call(name, args):
            if not self.platform:
                raise LibraryError("Host API unavailable")
            return self.platform.host_call(id, name, args)
        return call

    def _register(self, id, worker):
        platform = self.platform
        if not platform:
            return
        caps = worker.capabilities or {}
        try:
            for item in caps.get("providers", []):
                spec = item["spec"]
                platform.providers.register(
                    spec,
                    self._provider_generate(id, spec["id"]),
                    owner=id,
                    models=self._provider_action(id, spec["id"], "models") if item.get("models") else None,
                    check=self._provider_action(id, spec["id"], "check") if item.get("check") else None,
                )
            for item in caps.get("hooks", []):
                platform.hooks.on(item["hook"], self._hook(id, item["hook"], item.get("timeout", 20)), owner=id,
                                  priority=item.get("priority", 100), critical=item.get("critical", False), timeout=item.get("timeout", 20))
            for item in caps.get("events", []):
                platform.events.on(item["event"], self._event(id), owner=id, priority=item.get("priority", 100))
            for spec in caps.get("exporters", []):
                platform.exporters.register(spec, self._exporter(id, spec["id"]), owner=id)
            for spec in caps.get("importers", []):
                platform.importers.register(spec, self._importer(id, spec["id"]), owner=id)
        except Exception:
            self._unregister(id)
            raise

    def _unregister(self, id):
        platform = self.platform
        if not platform:
            return
        platform.providers.unregister(owner=id)
        platform.hooks.off(owner=id)
        platform.events.off(owner=id)
        platform.exporters.unregister(owner=id)
        platform.importers.unregister(owner=id)

    def _worker(self, id):
        if not self.records().get(id, {}).get("enabled"):
            raise LibraryError("Extension disabled: " + id, 403)
        worker = self.workers.get(id)
        if not worker:
            raise LibraryError("No backend registered for extension " + id, 404)
        return worker

    def _guarded(self, id, payload, timeout, cancel=None):
        worker = self._worker(id)
        try:
            return worker.call(payload, timeout=timeout, cancel=cancel)
        except LibraryError as exc:
            if exc.status in (408, 502) and (worker.dead.is_set() or exc.status == 408):
                self.errors[id] = str(exc)
                self.enable(id, False)
            raise

    def _hook(self, id, name, timeout):
        def handler(value, context):
            return self._guarded(id, {"op": "hook", "name": name, "value": value, "context": context}, timeout)
        return handler

    def _event(self, id):
        def handler(payload, meta):
            worker = self.workers.get(id)
            if worker:
                worker.notify({"op": "event", "name": meta["event"], "payload": payload, "meta": meta})
        return handler

    def _exporter(self, id, local_id):
        def run(album, context):
            timeout = context.get("timeout", EXPORT_TIMEOUT)
            result = self._guarded(id, {"op": "exporter", "id": local_id, "album": album, "context": {k: v for k, v in context.items() if k != "timeout"}}, timeout)
            return self._materialize_file(id, result)
        return run

    def _importer(self, id, local_id):
        def run(payload, context):
            return self._guarded(id, {"op": "importer", "id": local_id, "payload": payload, "context": context}, EXPORT_TIMEOUT)
        return run

    def _materialize_file(self, id, result):
        """File-like results: {'filename','mime','b64'|'text'|'path'} (path inside the extension data dir)."""
        if not isinstance(result, dict):
            raise LibraryError("Exporter must return an object")
        filename = str(result.get("filename") or "export.bin")[:120].replace("/", "_").replace("\\", "_")
        mime = str(result.get("mime") or mimetypes.guess_type(filename)[0] or "application/octet-stream")[:100]
        if result.get("path"):
            path = owned(self.data / id, str(result["path"]))
            if not path.is_file():
                raise LibraryError("Exporter file missing")
            raw = path.read_bytes()
        elif result.get("b64"):
            raw = base64.b64decode(result["b64"], validate=True)
        elif isinstance(result.get("text"), str):
            raw = result["text"].encode("utf-8")
        else:
            raise LibraryError("Exporter returned neither b64, text nor path")
        if len(raw) > MAX_FILE:
            raise LibraryError("Export exceeds %d MiB" % (MAX_FILE // 1048576), 413)
        return {"filename": filename, "mime": mime, "bytes": raw, "headers": result.get("headers") if isinstance(result.get("headers"), dict) else {}}

    def raw_response(self, id, result):
        """Routes may answer with a raw body instead of JSON: __mio_response__ or {'$file':...}|{'$text':...}|{'$raw': b64}."""
        if not isinstance(result, dict):
            return None
        if result.get("__mio_response__"):
            return {
                "filename": result.get("filename"),
                "mime": result.get("mime") or "application/octet-stream",
                "bytes": base64.b64decode(result.get("b64", ""), validate=True),
                "status": int(result.get("status") or 200),
                "headers": result.get("headers") if isinstance(result.get("headers"), dict) else {},
            }
        if "$file" in result:
            return self._materialize_file(id, {"path": result["$file"], "filename": result.get("filename"), "mime": result.get("mime"), "headers": result.get("headers")})
        if "$text" in result:
            return self._materialize_file(id, {"text": str(result["$text"]), "filename": result.get("filename") or "response.txt", "mime": result.get("mime") or "text/plain; charset=utf-8", "headers": result.get("headers")})
        if "$raw" in result:
            return self._materialize_file(id, {"b64": result["$raw"], "filename": result.get("filename") or "response.bin", "mime": result.get("mime"), "headers": result.get("headers")})
        return None

    def _provider_action(self, id, provider_id, action):
        def run(payload, host):
            request = {"config": dict(payload.get("config") or {})}
            request["credential"] = self._credential(host, payload)
            return self._guarded(id, {"op": "provider", "id": provider_id, "action": action, "request": request}, 60)
        return run

    @staticmethod
    def _credential(host, payload):
        from backend import mio_credentials

        try:
            return mio_credentials.resolve(host.DATA_DIR, payload) or ""
        except Exception:
            return ""

    def _provider_generate(self, id, provider_id):
        def generate(payload, host):
            config = dict(payload.get("config") or {})
            spec = self.platform.providers.spec(provider_id)
            credential = self._credential(host, payload) if spec["capabilities"]["credentials"] == "bearer" else ""
            for key in ("keyId", "keyIds", "keyMode"):
                config.pop(key, None)
            images = []
            for value in payload.get("images", [])[:32]:
                data_url, raw = host.provider_image_input(value)
                local = value if isinstance(value, str) and value.startswith("/images/") else host.store_image_bytes(raw)
                images.append({"url": local, "path": str(host.native_store().image_path(local)), "mime": host.detect_image_mime_type(raw), "bytes": len(raw)})
            request = {
                "config": config,
                "credential": credential,
                "prompt": str(payload.get("prompt", "")),
                "negative": str(payload.get("negative", "")),
                "frame": dict(payload.get("frame") or {}),
                "images": images,
                "timeout": int(payload.get("_requestTimeout", 300)),
                "task": dict(payload.get("_task") or {}),
                "albumId": payload.get("albumId"),
            }
            if payload.get("_onRequest"):
                try:
                    payload["_onRequest"]({"provider": provider_id, "prompt": request["prompt"][:2000], "frame": request["frame"]})
                except Exception:
                    pass
            result = self._guarded(id, {"op": "provider", "id": provider_id, "action": "generate", "request": request},
                                   request["timeout"] + 15, cancel=payload.get("_isCanceled"))
            if payload.get("_onResponse"):
                try:
                    payload["_onResponse"](200)
                except Exception:
                    pass
            return self._provider_result(id, provider_id, result, host, payload)
        return generate

    def _provider_result(self, id, provider_id, result, host, payload):
        if isinstance(result, dict) and "images" in result:
            items = result["images"]
        elif isinstance(result, dict) and "image" in result:
            items = [result["image"]]
        else:
            raise LibraryError("Provider must return {'images': [...]} entries with b64, path or url")
        if not isinstance(items, list) or not 1 <= len(items) <= 32:
            raise LibraryError("Provider returned no image or too many outputs")
        artifacts = []
        total = 0
        for item in items:
            if isinstance(item, str):
                item = {"b64": item} if not item.startswith(("http://", "https://", "/images/")) else {"url": item}
            if not isinstance(item, dict):
                raise LibraryError("Provider image entry must be an object")
            if item.get("b64"):
                raw = base64.b64decode(item["b64"], validate=True)
            elif item.get("path"):
                raw = owned(self.data / id, str(item["path"])).read_bytes()
            elif str(item.get("url", "")).startswith("/images/"):
                raw = host.native_store().image_path(item["url"]).read_bytes()
            elif item.get("url"):
                raw, _ = host.fetch_remote_image(item["url"], timeout=min(120, int(payload.get("_requestTimeout", 300))))
            else:
                raise LibraryError("Provider image entry needs b64, path or url")
            mime = host.detect_image_mime_type(raw)
            if mime not in ("image/png", "image/jpeg", "image/webp"):
                raise LibraryError("Provider must return PNG, JPEG or WebP")
            total += len(raw)
            if total > host.MAX_IMAGE_BYTES:
                raise LibraryError("Combined generated images exceed 50 MiB", 413)
            url = host.store_image_bytes(raw)
            artifacts.append({"kind": "image", "url": url, "mime": mime, "bytes": len(raw)})
        return {
            "image": artifacts[0]["url"],
            "artifacts": artifacts,
            "provider": provider_id,
            "extension": id,
            "meta": result.get("meta") if isinstance(result, dict) else None,
            "offlineFallback": False,
        }

    # -------------------------------------------------------------------- routes
    def route_timeout(self, id, method, path):
        worker = self.workers.get(id)
        for route in (worker.capabilities.get("routes") if worker else None) or []:
            if route.get("method") == method and route.get("path") == path:
                try:
                    return max(1, min(MAX_ROUTE_TIMEOUT, int(route.get("timeout") or ROUTE_TIMEOUT)))
                except (TypeError, ValueError):
                    return ROUTE_TIMEOUT
        return ROUTE_TIMEOUT

    def call(self, id, method, path, body, query=None):
        return self._guarded(id, {"op": "route", "method": method, "path": path, "body": body, "query": query or {}}, self.route_timeout(id, method, path))

    def task(self, id, action, task_id=None):
        """Background tasks live inside the extension process; list/get/cancel through the wire."""
        return self._guarded(id, {"op": "task", "action": action, "id": task_id}, 10)

    def capabilities(self, id):
        worker = self.workers.get(id)
        return dict(worker.capabilities) if worker else {}

    @staticmethod
    def _capability_summary(caps):
        caps = caps or {}
        return {
            "providers": [(item.get("spec") or {}).get("id") for item in caps.get("providers", [])],
            "hooks": [item.get("hook") for item in caps.get("hooks", [])],
            "events": [item.get("event") for item in caps.get("events", [])],
            "exporters": [item.get("id") for item in caps.get("exporters", [])],
            "importers": [item.get("id") for item in caps.get("importers", [])],
            "routes": caps.get("routes", []),
            "tasks": bool(caps.get("tasks")),
        }

    # ------------------------------------------------------------------ files API
    def files_dir(self, id):
        folder = owned(self.data, identifier(id)) / FILE_ROOT
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def file_path(self, id, relative):
        return owned(self.files_dir(id), relative)

    def file_list(self, id, prefix=""):
        root = self.files_dir(id)
        base = owned(root, prefix) if prefix else root
        rows = []
        if base.is_dir():
            for path in sorted(base.rglob("*")):
                if path.is_file():
                    rel = path.relative_to(root).as_posix()
                    rows.append({
                        "path": rel,
                        "size": path.stat().st_size,
                        "updatedAt": path.stat().st_mtime,
                        "url": "/api/ecosystem/extensions/" + id + "/files/" + rel,
                    })
        return rows

    def file_write(self, id, relative, raw):
        if len(raw) > MAX_FILE:
            raise LibraryError("File exceeds %d MiB" % (MAX_FILE // 1048576), 413)
        path = self.file_path(id, relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, raw)
        return {"path": relative, "size": len(raw), "url": "/api/ecosystem/extensions/" + id + "/files/" + relative}

    def file_delete(self, id, relative):
        path = self.file_path(id, relative)
        if path.is_dir():
            shutil.rmtree(path)
        elif path.is_file():
            path.unlink()
        return self.file_list(id)

    # --------------------------------------------------------------- maintenance
    def update(self, id, trusted):
        if not trusted:
            raise LibraryError("Confirm trust in the new revision", 403)
        identifier(id)
        with self.lock:
            record = self.records().get(id)
            if not record:
                raise LibraryError("Extension not found", 404)
            if record["enabled"]:
                raise LibraryError("Disable extension before updating", 409)
            if record["source"] == "zip":
                raise LibraryError("ZIP extension: uninstall code only, then install new ZIP; data stays intact")
            if record["source"] == "link":
                return self.reload(id)
            with tempfile.TemporaryDirectory(dir=self.code, prefix=".update-") as tmp:
                staged = Path(tmp) / "code"
                clone(record["source"], record["branch"], staged)
                meta = manifest(staged, "extension")
                if meta["id"] != id:
                    raise LibraryError("Updated package changed its ID")
                backup = Path(tmp) / "previous"
                os.replace(self.code / id, backup)
                os.replace(staged, self.code / id)
                items = self.records()
                items[id] = record | meta | {"revision": uuid.uuid4().hex}
                try:
                    self.save(items)
                except Exception:
                    shutil.rmtree(self.code / id)
                    os.replace(backup, self.code / id)
                    raise

    def uninstall(self, id, purge="none"):
        """purge: none (keep all data) | cache (drop cache+tmp) | all (drop the extension's data dir)."""
        identifier(id)
        if purge is True or purge is False:
            purge = "all" if purge else "none"
        if purge not in PURGE_LEVELS:
            raise LibraryError("purge must be one of none, cache, all")
        with self.lock:
            record = self.records().get(id) or {}
            if id in self.records():
                self.enable(id, False)
            target = owned(self.code, id)
            if record.get("source") != "link" and target.exists():
                shutil.rmtree(target)
            self.purge(id, purge)
            self.deps.pop(id, None)
            items = self.records()
            items.pop(id, None)
            self.save(items)
            self.errors.pop(id, None)

    def purge(self, id, level):
        identifier(id)
        root = self.data / id
        if level == "all" and root.exists():
            shutil.rmtree(owned(self.data, id))
        elif level == "cache":
            for tier in ("cache", "tmp"):
                folder = root / tier
                if folder.exists():
                    shutil.rmtree(owned(root, tier))
        return self.usage(id)

    def asset(self, id, relative):
        if not self.records().get(identifier(id), {}).get("enabled"):
            raise LibraryError("Extension disabled", 403)
        revision, sep, relative = relative.partition("/")
        if not sep or revision != self.records()[id]["revision"]:
            raise LibraryError("Extension revision unavailable", 404)
        if ".git" in Path(relative).parts or Path(relative).suffix.lower() in (".py", ".pyc", ".pyo") or Path(relative).name.startswith("."):
            raise LibraryError("Asset not public", 403)
        path = owned(self.code_dir(id), relative)
        if not path.is_file():
            raise LibraryError("Asset not found", 404)
        return path

    def close(self):
        for id, worker in list(self.workers.items()):
            self._unregister(id)
            worker.stop()
        self.workers.clear()
