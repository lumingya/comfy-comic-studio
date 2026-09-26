"""Job-engine executor for ComfyUI prompts (kind ``comfy.render``).

Item input (frozen at submit time)::

    {"stages": [Compiled.to_json(), ...],   # run in order; stage n+1 may take stage n's image
     "feeds":  [null, "/10/inputs/image"],   # where the previous stage's image goes (or null)
     "guard":  ["term", ...],                # checked again on [mio:inspect] read-backs
     "meta":   {...}}                        # returned untouched; the render service uses it

Failure classification (see :class:`~mio_server.jobs.ExecError`):

* upload / connection refused / ``/prompt`` validation error → never executed → ``failed``;
* ComfyUI reported an execution error or interruption → definitively no image → ``failed``;
* timeout or lost connection after queueing → outcome unknown → ``uncertain`` (reconcilable
  from ``/history`` by prompt id, never resubmitted automatically).
"""

from __future__ import annotations

import base64
import time

from ..jobs import ExecError, ItemContext
from . import bindings as B
from .client import ComfyClient, ComfyError, parse_preview  # noqa: F401  (re-export for tests)
from .compile import fill_placeholders


class ComfyRenderExecutor:
    def __init__(self, assets, client_factory=ComfyClient, on_result=None, timeout: float = 900.0):
        self.assets = assets
        self.client_factory = client_factory
        self.on_result = on_result
        self.timeout = timeout

    # ---------------------------------------------------------------- execute
    def execute(self, ctx: ItemContext) -> dict:
        if ctx.instance is None:
            raise ExecError("没有可用的 ComfyUI 实例", kind="no_instance", sent=False)
        client = self.client_factory(ctx.instance.base_url)
        stages = ctx.input["stages"]
        feeds = ctx.input.get("feeds") or [None] * len(stages)
        guard = ctx.input.get("guard") or []
        previous: str | None = None
        reports = []
        for n, stage in enumerate(stages):
            ctx.raise_if_cancelled()
            uploads = dict(stage.get("uploads") or {})
            graph = stage["graph"]
            if n and feeds[n] and previous:
                node_id, _, field = feeds[n].strip("/").partition("/inputs/")
                graph = {
                    **graph,
                    node_id: {
                        **graph[node_id],
                        "inputs": {**graph[node_id]["inputs"], field: {"$asset": previous}},
                    },
                }
                uploads[feeds[n]] = previous
            graph = self._upload(client, graph, uploads)
            run = self._run(ctx, client, graph, stage["outputs"], stage_index=n)
            texts = {k: v for k, v in run.texts.items() if k in (stage.get("inspect") or [])}
            hits = sorted(
                {t for lines in texts.values() for line in lines for t in B.guard_text(line, guard)}
            )
            if hits:
                raise ExecError(
                    f"运行后核对：最终提示词含有拦截词（{'、'.join(hits)}），图片已丢弃",
                    kind="guard",
                    sent=False,
                )
            if not run.images:
                raise ExecError(
                    "ComfyUI 没有回报图片：检查输出节点或保存节点的预览开关",
                    kind="no_image",
                    sent=False,
                )
            images = [self._store(img.data, run.prompt_id, img.node) for img in run.images]
            previous = images[0]["asset_id"]
            reports.append(
                {
                    "prompt_id": run.prompt_id,
                    "seconds": round(run.elapsed, 2),
                    "node_seconds": {k: round(v, 2) for k, v in run.node_seconds.items()},
                    "cached": run.cached,
                    "previews": run.previews,
                    "texts": texts,
                    "images": images,
                    "live": run.live,
                }
            )
        return {
            "images": reports[-1]["images"],
            "stages": reports,
            "instance": ctx.instance.id,
            "meta": ctx.input.get("meta") or {},
        }

    def _upload(self, client, graph: dict, uploads: dict[str, str]) -> dict:
        names = {}
        try:
            for asset_id in sorted(set(uploads.values())):
                names[asset_id] = client.upload_image(
                    self.assets.read(asset_id), f"mio_{asset_id[:24]}.png"
                )
        except ComfyError as exc:
            raise ExecError(f"上传参考图失败：{exc}", kind="upload_failed", sent=False) from None
        return fill_placeholders(graph, names)

    def _run(self, ctx: ItemContext, client, graph: dict, outputs: list[str], stage_index: int):
        queued: list[str] = []

        def on_queued(prompt_id: str) -> None:
            queued.append(prompt_id)
            ctx.checkpoint(f"{stage_index}:{prompt_id}")

        def abort() -> None:
            if queued:
                client.delete_queued(queued[-1])
            client.interrupt()

        def on_event(event: dict) -> None:
            if event.get("type") == "preview":
                data = event.get("data") or b""
                ctx.progress(
                    type="preview",
                    format=event.get("format"),
                    data=base64.b64encode(data).decode() if len(data) < 2_000_000 else "",
                )
            elif event.get("type") in ("progress", "executing", "queued", "warning"):
                ctx.progress(**{k: v for k, v in event.items() if k != "data"})

        ctx.on_abort(abort)
        ctx.mark_sent()
        try:
            return client.run(
                graph,
                outputs,
                on_event=on_event,
                timeout=self.timeout,
                on_queued=on_queued,
                cancelled=ctx.cancelled.is_set,
            )
        except ComfyError as exc:
            if ctx.cancelled.is_set():
                raise ExecError("已停止", kind="canceled", sent=bool(queued)) from None
            if not queued:
                # /prompt rejected (validation) or ComfyUI unreachable: nothing was executed.
                raise ExecError(
                    str(exc),
                    kind="rejected" if exc.detail else "unreachable",
                    sent=False,
                    detail=exc.detail,
                ) from None
            timed_out = "超时" in str(exc)
            raise ExecError(
                str(exc),
                kind="timeout" if timed_out else "execution_error",
                sent=True if timed_out else False,
                detail=exc.detail,
            ) from None
        except OSError as exc:
            raise ExecError(
                f"与 ComfyUI 的连接中断：{exc}",
                kind="connection_lost",
                sent=True if queued else False,
            ) from None

    def _store(self, data: bytes, prompt_id: str, node: str) -> dict:
        asset = self.assets.put(data, source=f"comfy:{prompt_id}:{node}")
        return {"asset_id": asset.id, "node": node, "width": asset.width, "height": asset.height}

    # ---------------------------------------------------------------- recover
    def reconcile(self, ctx: ItemContext) -> dict | None:
        """Read-only: fetch the recorded prompt's outputs from ``/history``; never resubmits."""
        if not ctx.upstream or ctx.instance is None:
            return None
        stage_index, _, prompt_id = ctx.upstream.rpartition(":")
        if not stage_index.isdigit() or int(stage_index) != len(ctx.input["stages"]) - 1:
            return None  # an earlier stage was running: the final image cannot exist yet
        client = self.client_factory(ctx.instance.base_url)
        try:
            entry = client.history(prompt_id)
        except ComfyError:
            return None
        if not entry or not entry.get("outputs"):
            return None
        last = ctx.input["stages"][-1]
        images, texts = client.collect(entry, last["outputs"])
        if not images:
            return None
        stored = [self._store(img.data, prompt_id, img.node) for img in images]
        return {
            "images": stored,
            "stages": [
                {"prompt_id": prompt_id, "images": stored, "reconciled": True, "at": time.time()}
            ],
            "meta": ctx.input.get("meta") or {},
            "reconciled": True,
        }

    def on_complete(self, job: dict, item: dict, result: dict) -> None:
        if self.on_result:
            self.on_result(job, item, result)
