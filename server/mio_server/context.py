"""Application context: one object that owns every store, service and background thread.

``AppContext.create(data_dir)`` is what the API, the CLI and tests use; everything registers in
the internal :class:`~mio_server.registry.Registry` exactly as future extensions will
(ROADMAP §2.4, P1 = internal only).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import settings as SET
from .assets import AssetStore
from .comfy.client import ComfyClient
from .comfy.compile import BUILTINS
from .comfy.executor import ComfyRenderExecutor
from .jobs import JobEngine, ResourcePool
from .pipeline import export as X
from .pipeline.cloud_jobs import CloudExecutor
from .pipeline.qa import QAService
from .pipeline.render import RenderService
from .registry import Registry
from .render_models import ComfyInstance
from .storage import SQLiteStore
from .trash import Trash

log = logging.getLogger("mio")


def default_data_dir() -> Path:
    return Path(os.environ.get("MIO_V3_DATA", "data/runtime/v3"))


@dataclass
class AppContext:
    data_dir: Path
    store: SQLiteStore
    assets: AssetStore
    engine: JobEngine
    registry: Registry
    render: RenderService
    qa: QAService
    trash: Trash
    llm_factory: Callable
    comfy_client_factory: Callable = ComfyClient
    closers: list[Callable[[], None]] = field(default_factory=list)

    @classmethod
    def create(
        cls,
        data_dir: str | Path | None = None,
        *,
        autostart: bool = True,
        llm_factory: Callable | None = None,
        comfy_client_factory: Callable = ComfyClient,
        seed_instance: bool = True,
        memory: bool = False,
    ) -> "AppContext":
        data_dir = Path(data_dir or default_data_dir())
        data_dir.mkdir(parents=True, exist_ok=True)
        store = SQLiteStore(":memory:" if memory else data_dir / "mio.sqlite3")
        assets = AssetStore(data_dir / "assets", store)
        engine = JobEngine(
            ":memory:" if memory else data_dir / "jobs.sqlite3",
            pool=ResourcePool(),
            autostart=autostart,
        )
        llm = llm_factory or SET.llm_factory(store)
        render = RenderService(store, assets, engine)
        render.seed_builtins()
        qa = QAService(store, assets, engine, llm)
        ctx = cls(
            data_dir,
            store,
            assets,
            engine,
            Registry(),
            render,
            qa,
            Trash(store),
            llm,
            comfy_client_factory,
        )
        if seed_instance and not store.list_docs("instance"):
            store.put_doc(ComfyInstance(id="comfy_local"))
        ctx.refresh_instances()
        ctx._register_builtins()
        try:
            purged = ctx.trash.expire(ctx.settings().trash_days)
            if purged:
                log.info("trash: purged %d expired items", purged)
        except Exception:  # never block start-up on housekeeping
            log.exception("trash expiry failed")
        ctx.closers += [lambda: engine.close(wait=False), store.close]
        return ctx

    # ------------------------------------------------------------- helpers
    def settings(self) -> SET.AppSettings:
        return SET.load(self.store)

    def refresh_instances(self) -> None:
        self.engine.pool.set_instances(self.store.list_docs("instance"))

    def close(self) -> None:
        while self.closers:
            try:
                self.closers.pop()()
            except Exception:
                log.exception("close failed")

    def _register_builtins(self) -> None:
        reg = self.registry
        executors = {
            "comfy.render": ComfyRenderExecutor(
                self.assets, self.comfy_client_factory, on_result=self.render.apply_result
            ),
            "cloud.render": CloudExecutor(self.assets, self.llm_factory, self.render),
            "qa.check": self.qa,
        }
        for kind, executor in executors.items():
            self.engine.register(kind, executor)
            reg.register("job_executor", kind, executor, title=kind)
        for fmt in X.FORMATS:
            reg.register("exporter", fmt, X.export, title=fmt)
        for pid, preset in X.PRESETS.items():
            reg.register("slice_preset", pid, preset, title=preset.label)
        reg.register(
            "prompt_dialect", "tags", "danbooru", title="Danbooru 标签（SDXL / Illustrious）"
        )
        reg.register(
            "prompt_dialect", "natural", "natural", title="自然语言（Qwen-Image / Flux / 云端）"
        )
        for step, title in (
            ("qa", "VLM 质检与自动挑选"),
            ("inpaint", "局部重绘"),
            ("outpaint", "外扩"),
            ("edit", "指令编辑"),
            ("finalize", "成品档"),
        ):
            reg.register("pipeline_step", step, step, title=title)
        for wid, (name, _) in BUILTINS.items():
            reg.register("workflow_template", wid, wid, title=name)
        reg.register("layout", "strip.default", "strip", title="条漫默认版式")
        reg.register("script_template", "generate", "generate", title="一句话生成剧本")
        reg.register("script_template", "revise", "revise", title="按要求修改剧本（可审阅 diff）")
        reg.register("provider", "comfyui", "comfyui", title="ComfyUI（本地 / 局域网，多实例）")
        reg.register(
            "provider", "openai-compatible", "llm", title="OpenAI 兼容接口（文本 / 视觉 / 出图）"
        )
