"""Platform kernel: ordered event bus and value-transforming hook pipelines.

Two primitives with deliberately different contracts:

* ``EventBus`` — fire-and-forget notifications (``album.published``,
  ``page.failed`` ...). A failing listener is recorded and skipped; it can
  never break the caller.
* ``Hooks`` — ordered filter pipelines (``render.before`` ...). Each handler
  receives the current value and may return a replacement. A failing
  handler is skipped unless it was registered as ``critical``, in which case
  the operation is aborted with a clear error. This is what lets an
  extension say "do not render without my prompt translation".

Handlers are plain callables; extension workers are wrapped by the plugin
manager so the kernel never knows about processes.
"""

import copy
import re
import threading
import time
import traceback
from collections import deque

from backend.mio_library import LibraryError

# Lifecycle names the core emits. SDK v3 lets extensions emit and listen to any
# well-formed name (``ext:<id>:…`` is still the recommended namespace); the core
# list is kept for documentation and for the platform manifest.
CORE_EVENTS = (
    "app.ready",
    "extension.enabled",
    "extension.disabled",
    "theme.changed",
    "album.created",
    "album.opened",
    "album.saved",
    "album.deleted",
    "album.published",
    "frame.selected",
    "frame.updated",
    "task.assembled",
    "task.started",
    "task.prepared",
    "task.finished",
    "page.started",
    "page.rendered",
    "page.published",
    "page.failed",
    "queue.started",
    "queue.paused",
    "queue.resumed",
    "queue.cancelled",
    "queue.fault",
    "export.started",
    "export.finished",
    "import.finished",
    "library.saved",
    "library.deleted",
    "styles.changed",
)

# Filter pipelines the core runs. Value shapes are documented in
# docs/ECOSYSTEM_GUIDE.md and enforced by the call sites.
CORE_HOOKS = (
    "assemble.before",   # snapshot dict before a book enters the queue
    "prepare.after",     # resolved variable values after phase 0
    "render.before",     # provider payload (prompt/negative/images/frame/config)
    "render.after",      # provider result (image url + artifacts)
    "page.retry",        # None -> {"retry": bool, "delay": s}; decide whether a failed page is re-run
    "publish.before",    # album page record before it is written
    "export.before",     # album document before an exporter runs
    "import.after",      # imported document before it is stored
)

HOOK_ERROR_STATUS = 502


NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,119}$")


def valid_name(name, known, owner="core"):
    if not isinstance(name, str) or not name:
        raise LibraryError("Event or hook name required")
    if name in known or NAME_PATTERN.fullmatch(name):
        return name
    raise LibraryError("Invalid event or hook name: " + str(name)[:60])


class Subscription:
    __slots__ = ("name", "handler", "owner", "priority", "critical", "timeout", "meta", "serial")

    def __init__(self, name, handler, owner, priority, critical, timeout, meta, serial):
        self.name = name
        self.handler = handler
        self.owner = owner
        self.priority = priority
        self.critical = critical
        self.timeout = timeout
        self.meta = meta
        self.serial = serial

    def describe(self):
        return {
            "name": self.name,
            "owner": self.owner,
            "priority": self.priority,
            "critical": self.critical,
            "timeout": self.timeout,
            **self.meta,
        }


class _Registry:
    def __init__(self, known):
        self.known = known
        self.lock = threading.RLock()
        self.items = {}
        self.serial = 0

    def on(self, name, handler, *, owner="core", priority=100, critical=False, timeout=20, **meta):
        valid_name(name, self.known)
        if not callable(handler):
            raise LibraryError("Handler must be callable")
        with self.lock:
            self.serial += 1
            item = Subscription(name, handler, owner, int(priority), bool(critical), timeout, meta, self.serial)
            self.items.setdefault(name, []).append(item)
            self.items[name].sort(key=lambda s: (s.priority, s.serial))
            return item

    def off(self, subscription=None, *, owner=None):
        with self.lock:
            for name, items in list(self.items.items()):
                self.items[name] = [
                    s for s in items
                    if not (s is subscription or (owner is not None and s.owner == owner))
                ]
                if not self.items[name]:
                    del self.items[name]

    def handlers(self, name):
        with self.lock:
            return list(self.items.get(name, ()))

    def describe(self):
        with self.lock:
            return {name: [s.describe() for s in items] for name, items in sorted(self.items.items())}


class EventBus(_Registry):
    """Notifications. Listener errors are logged into ``recent`` and swallowed."""

    def __init__(self, known=CORE_EVENTS, history=200):
        super().__init__(known)
        self.recent = deque(maxlen=history)
        self.failures = deque(maxlen=50)

    def emit(self, name, payload=None, *, source="core"):
        valid_name(name, self.known)
        record = {
            "name": name,
            "source": source,
            "at": time.time(),
            "listeners": 0,
            "errors": 0,
            "payload": copy.deepcopy(payload) if isinstance(payload, dict) else {},
        }
        for sub in self.handlers(name):
            record["listeners"] += 1
            try:
                sub.handler(dict(payload or {}), {"event": name, "source": source, "at": record["at"]})
            except Exception as exc:  # listener isolation is the contract
                record["errors"] += 1
                self.failures.append({"event": name, "owner": sub.owner, "error": str(exc)[:500], "at": time.time(),
                                      "trace": traceback.format_exc(limit=3)[-1200:]})
        self.recent.append(record)
        return record


class Hooks(_Registry):
    """Filter pipelines. ``apply`` returns the transformed value."""

    def __init__(self, known=CORE_HOOKS):
        super().__init__(known)
        self.failures = deque(maxlen=50)

    def apply(self, name, value, context=None, *, expect=dict):
        valid_name(name, self.known)
        context = dict(context or {})
        current = value
        for sub in self.handlers(name):
            started = time.monotonic()
            try:
                result = sub.handler(current, {**context, "hook": name, "owner": sub.owner})
            except Exception as exc:
                self.failures.append({"hook": name, "owner": sub.owner, "error": str(exc)[:500], "at": time.time()})
                if sub.critical:
                    raise LibraryError(
                        "扩展「" + str(sub.owner) + "」在 " + name + " 阶段失败并要求中止：" + str(exc)[:300],
                        HOOK_ERROR_STATUS,
                    ) from None
                continue
            finally:
                sub.meta["lastMs"] = round((time.monotonic() - started) * 1000, 1)
            if result is None:
                continue
            if expect is not None and not isinstance(result, expect):
                self.failures.append({"hook": name, "owner": sub.owner, "error": "handler returned " + type(result).__name__, "at": time.time()})
                if sub.critical:
                    raise LibraryError("扩展「" + str(sub.owner) + "」返回了无效的 " + name + " 结果", HOOK_ERROR_STATUS)
                continue
            current = result
        return current
