"""Extension registry (ROADMAP §2.4).

Built-in job executors, exporters, slice presets, prompt dialects, pipeline steps, themes, album
templates and SFX presets register here exactly like extensions do, so an extension's ceiling
equals the core's.  Extensions (``mio_server.extensions``) contribute with ``source="ext:<id>"``;
disabling one removes everything it registered.  Domain hooks live on ``registry.hooks``.

``ctx.internal`` (the escape hatch) is the :class:`AppContext` itself: explicitly unstable, but it
can reach every store and service.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Callable

from .hooks import HookBus

POINTS = {
    "job_executor": "统一任务引擎的执行器（按 job kind）",
    "exporter": "导出器：切片、长图、PDF、网页阅读……",
    "slice_preset": "平台切片预设",
    "prompt_dialect": "提示词方言编译器",
    "pipeline_step": "管线步骤：质检、上色、翻译、修脸……",
    "provider": "出图与 LLM 渠道",
    "workflow_template": "ComfyUI 工作流模板与绑定预设",
    "layout": "版式、分格样式、气泡样式、字体",
    "script_template": "剧本模板（LLM 提示词）",
    "panel": "界面面板：React 组件挂在指定插槽",
    "command": "命令、快捷键、设置页",
    "route": "后端路由与后台任务",
    "theme": "界面主题（配色令牌）",
    "album_template": "画册导出模板（次要输出）",
    "sfx_preset": "拟声字样式预设",
    "cloud_adapter": "云端出图适配器（按渠道类型）",
}


class RegistryError(KeyError):
    pass


@dataclass
class Contribution:
    point: str
    id: str
    value: Any
    source: str = "builtin"
    title: str = ""
    meta: dict = field(default_factory=dict)


class Registry:
    def __init__(self):
        self._lock = threading.RLock()
        self._items: dict[str, dict[str, Contribution]] = {p: {} for p in POINTS}
        self._listeners: dict[str, list[Callable[[dict], None]]] = {}
        self.hooks = HookBus()

    def register(
        self,
        point: str,
        id: str,
        value: Any,
        *,
        source: str = "builtin",
        title: str = "",
        replace: bool = False,
        **meta,
    ) -> Contribution:
        if point not in POINTS:
            raise RegistryError(f"unknown extension point: {point}")
        with self._lock:
            if id in self._items[point] and not replace:
                raise RegistryError(
                    f"{point}:{id} already registered by {self._items[point][id].source}"
                )
            item = Contribution(point, id, value, source, title, meta)
            self._items[point][id] = item
        self.emit("registry.changed", {"point": point, "id": id, "source": source})
        return item

    def contribute(self, point: str, id: str, **kw):
        def decorator(value):
            self.register(point, id, value, **kw)
            return value

        return decorator

    def unregister(self, point: str, id: str) -> None:
        with self._lock:
            self._items.get(point, {}).pop(id, None)

    def unregister_source(self, source: str) -> int:
        """Remove every contribution and hook handler of one source (an extension)."""
        with self._lock:
            removed = 0
            for items in self._items.values():
                for key in [k for k, c in items.items() if c.source == source]:
                    del items[key]
                    removed += 1
        removed += self.hooks.remove_source(source)
        if removed:
            self.emit("registry.changed", {"source": source, "removed": removed})
        return removed

    def get(self, point: str, id: str) -> Any:
        with self._lock:
            try:
                return self._items[point][id].value
            except KeyError:
                raise RegistryError(f"{point}:{id} is not registered") from None

    def all(self, point: str) -> list[Contribution]:
        with self._lock:
            return list(self._items.get(point, {}).values())

    def describe(self) -> dict:
        with self._lock:
            return {
                p: [
                    {
                        "id": c.id,
                        "source": c.source,
                        "title": c.title,
                        **{
                            k: v
                            for k, v in c.meta.items()
                            if isinstance(v, (str, int, float, bool))
                        },
                    }
                    for c in items.values()
                ]
                for p, items in self._items.items()
            }

    # events ------------------------------------------------------------
    def on(self, event: str, fn: Callable[[dict], None]) -> Callable[[], None]:
        with self._lock:
            self._listeners.setdefault(event, []).append(fn)
        return lambda: self._listeners.get(event, []).remove(fn)

    def emit(self, event: str, payload: dict) -> None:
        for fn in list(self._listeners.get(event, [])) + list(self._listeners.get("*", [])):
            try:
                fn({"event": event, **payload})
            except Exception:
                pass
