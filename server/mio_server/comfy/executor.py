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
from .compile import fill_placeholders, validate_plan
from .state_run import StateSession


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
        session = StateSession(ctx, client) if ctx.state_lease else None
        try:
            result = self._execute(ctx, client, session)
            if session:
                session.save(result=result)
            return result
        finally:
            if session:
                session.cleanup()

    def _execute(self, ctx, client, session):
        stages = ctx.input["stages"]
        feeds = ctx.input.get("feeds") or [None] * len(stages)
        guard = ctx.input.get("guard") or []
        previous: str | None = None
        reports = []
        for n, stage in enumerate(stages):
            ctx.raise_if_cancelled()
            validate_plan(stage["graph"], stage.get("frontend_state") or {})
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
            if session:
                session.prepare(n, stage.get("frontend_state") or {})
            run = self._run(ctx, client, graph, stage["outputs"], stage_index=n, session=session)
            if session:
                session.ended(success=True)
            try:
                texts = self._validate_outputs(run.images, run.texts, stage, guard)
            except ExecError as exc:
                if session:
                    session.ended(failure={"kind": exc.kind, "message": str(exc)})
                raise
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
            if session:
                # Persist the already-generated result before any restoration request can fail.
                session.save(
                    result_pending=False,
                    stage_result=reports[-1],
                    result={
                        "images": images,
                        "stages": reports,
                        "instance": ctx.instance.id,
                        "meta": ctx.input.get("meta") or {},
                    }
                    if n == len(stages) - 1
                    else None,
                )
                session.restore()
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

    @staticmethod
    def _validate_outputs(images, all_texts, stage, guard):
        texts = {k: v for k, v in all_texts.items() if k in (stage.get("inspect") or [])}
        hits = sorted(
            {t for lines in texts.values() for line in lines for t in B.guard_text(line, guard)}
        )
        if hits:
            raise ExecError(
                f"运行后核对：最终提示词含有拦截词（{'、'.join(hits)}），图片已丢弃",
                kind="guard",
                sent=False,
            )
        if not images:
            raise ExecError(
                "ComfyUI 没有回报图片：检查输出节点或保存节点的预览开关",
                kind="no_image",
                sent=False,
            )
        return texts

    def _run(
        self,
        ctx: ItemContext,
        client,
        graph: dict,
        outputs: list[str],
        stage_index: int,
        session=None,
    ):
        queued: list[str] = []

        def on_queued(prompt_id: str) -> None:
            queued.append(prompt_id)
            if session:
                session.queued(prompt_id)
            ctx.checkpoint(f"{stage_index}:{prompt_id}")

        def abort() -> None:
            if queued:
                client.delete_queued(queued[-1])

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
        try:
            ctx.mark_sent()
            if session:
                session.submitting()
            return client.run(
                graph,
                outputs,
                on_event=on_event,
                timeout=self.timeout,
                on_queued=on_queued,
                cancelled=ctx.cancelled.is_set,
            )
        except ComfyError as exc:
            definitive = exc.kind in ("rejected", "execution_error") or (
                not queued and exc.kind == "unreachable"
            )
            if session and definitive:
                session.ended(failure={"kind": exc.kind, "message": str(exc)})
            if ctx.cancelled.is_set():
                raise ExecError("已停止", kind="canceled", sent=bool(queued)) from None
            # A history/download failure does not mean execution failed. Even without a
            # prompt id, an interrupted POST response may have hidden an accepted prompt.
            raise ExecError(
                str(exc),
                kind=exc.kind,
                sent=not definitive,
                detail=exc.detail,
            ) from None
        except OSError as exc:
            raise ExecError(
                f"与 ComfyUI 的连接中断：{exc}",
                kind="connection_lost",
                sent=True,
            ) from None
        finally:
            if abort in ctx.abort_hooks:
                ctx.abort_hooks.remove(abort)

    def _store(self, data: bytes, prompt_id: str, node: str) -> dict:
        asset = self.assets.put(data, source=f"comfy:{prompt_id}:{node}")
        return {"asset_id": asset.id, "node": node, "width": asset.width, "height": asset.height}

    # ---------------------------------------------------------------- recover
    def recover_state(self, ctx, record, *, confirm_stopped=False, discard_result=False):
        client = self.client_factory(record["base_url"])
        session = StateSession(ctx, client, record)
        try:
            evidence, entry = session.settle(confirm_stopped=confirm_stopped)
            if not evidence["settled"]:
                return {"restored": False, "status": evidence["status"]}
            if discard_result:
                session.save(
                    result_pending=False,
                    result=None,
                    failure={"kind": "result_discarded", "message": "已明确放弃取回此任务结果。"},
                )
            index = session.data.get("stage", -1)
            prompt = session.data.get("prompt_id")
            if session.data.get("result_pending"):
                if not entry:
                    state, entry = client.execution_state(prompt)
                    if state != "terminal_success":
                        return {"restored": False, "status": "result_unavailable"}
                stage = ctx.input["stages"][index]
                images, texts = client.collect(entry, stage["outputs"])
                try:
                    self._validate_outputs(images, texts, stage, ctx.input.get("guard") or [])
                except ExecError as exc:
                    # A deliberate rejection can release without a result; storage/network
                    # failures cannot. Keep that distinction durable across restart.
                    session.ended(failure={"kind": exc.kind, "message": str(exc)})
                else:
                    stored = [self._store(img.data, prompt, img.node) for img in images]
                    stage_result = {"prompt_id": prompt, "images": stored, "reconciled": True}
                    result = {
                        "images": stored,
                        "stages": [stage_result],
                        "instance": ctx.instance.id,
                        "meta": ctx.input.get("meta") or {},
                        "reconciled": True,
                    }
                    session.save(
                        result_pending=False,
                        stage_result=stage_result,
                        result=result if index == len(ctx.input["stages"]) - 1 else None,
                    )
            if session.data.get("phase") != "restored":
                session.restore()
            error = session.data.get("failure")
            if not error and session.data.get("stage_result") and not session.data.get("result"):
                error = {
                    "kind": "pipeline_interrupted",
                    "message": "中间阶段结果已保存；后续阶段未自动执行，请明确重试。",
                    "stage_result": session.data["stage_result"],
                }
            return {
                "restored": True,
                "status": "restored",
                "result": session.data.get("result"),
                "error": error,
            }
        except (ComfyError, ExecError, OSError) as exc:
            return {
                "restored": False,
                "status": getattr(exc, "kind", "restore_failed"),
                "error": str(exc),
            }

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
        self._validate_outputs(images, texts, last, ctx.input.get("guard") or [])
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
