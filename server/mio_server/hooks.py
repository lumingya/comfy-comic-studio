"""Domain hooks (ROADMAP §2.4 / P5): the stable way for extensions to take part in the pipeline.

Two kinds, WordPress-style but typed by name:

* **filter** – ``bus.filter(name, value, **context)`` passes ``value`` through every handler in
  priority order; each returns the (possibly changed) value.  A handler that raises is logged and
  skipped, so one broken extension cannot stop a render.
* **action** – ``bus.action(name, payload)`` notifies handlers; return values are ignored.

Hook names are declared in :data:`HOOKS` so the UI and the SDK docs can list them, and so a typo in
an extension fails loudly at registration instead of silently never firing.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any, Callable, Literal

log = logging.getLogger("mio.hooks")

Kind = Literal["filter", "action"]

HOOKS: dict[str, tuple[Kind, str]] = {
    "prompt.compiled": (
        "filter",
        "每格提示词编译后、提交前：value = {positive, negative}；context: series, episode, panel, "
        "dialect",
    ),
    "render.workflow": (
        "filter",
        "ComfyUI 工作流图提交前：value = API 格式 graph（dict）；context: workflow_id, stage",
    ),
    "script.generated": (
        "filter",
        "一句话生成剧本后、入库前：value = Episode；context: series, sentence",
    ),
    "strip.lettering": (
        "filter",
        "自动嵌字后：value = 嵌字层列表（LetteringLayer）；context: series, episode",
    ),
    "take.created": ("action", "新候选入库：{episode_id, panel_id, take_id, stage, job_id}"),
    "take.status": ("action", "候选被采用 / 弃用 / 恢复：{episode_id, take_id, status}"),
    "episode.exported": ("action", "一话导出完成：{episode_id, fmt, bytes, filename}"),
    "job.event": ("action", "任务事件（状态变化、完成、失败）：统一任务引擎的事件原样转发"),
}


class HookError(ValueError):
    pass


@dataclass
class Handler:
    name: str
    fn: Callable
    priority: int
    source: str


class HookBus:
    def __init__(self):
        self._lock = threading.RLock()
        self._handlers: dict[str, list[Handler]] = {}

    def add(
        self, name: str, fn: Callable, *, priority: int = 100, source: str = "builtin"
    ) -> Callable[[], None]:
        """Register a handler; returns a function that removes it again."""
        if name not in HOOKS:
            raise HookError(f"未知的钩子：{name}（可用：{', '.join(sorted(HOOKS))}）")
        handler = Handler(name, fn, priority, source)
        with self._lock:
            items = self._handlers.setdefault(name, [])
            items.append(handler)
            items.sort(key=lambda h: h.priority)
        return lambda: self._remove(handler)

    def _remove(self, handler: Handler) -> None:
        with self._lock:
            items = self._handlers.get(handler.name, [])
            if handler in items:
                items.remove(handler)

    def remove_source(self, source: str) -> int:
        with self._lock:
            removed = 0
            for name, items in self._handlers.items():
                keep = [h for h in items if h.source != source]
                removed += len(items) - len(keep)
                self._handlers[name] = keep
            return removed

    def handlers(self, name: str) -> list[Handler]:
        with self._lock:
            return list(self._handlers.get(name, []))

    def filter(self, name: str, value: Any, **context) -> Any:
        for h in self.handlers(name):
            try:
                result = h.fn(value, **context)
            except Exception:
                log.exception("hook %s from %s failed; value kept", name, h.source)
                continue
            if result is not None:
                value = result
        return value

    def action(self, name: str, payload: dict) -> None:
        for h in self.handlers(name):
            try:
                h.fn(payload)
            except Exception:
                log.exception("hook %s from %s failed", name, h.source)

    def describe(self) -> list[dict]:
        return [
            {
                "name": name,
                "kind": kind,
                "description": desc,
                "handlers": [h.source for h in self.handlers(name)],
            }
            for name, (kind, desc) in HOOKS.items()
        ]
