"""Job-engine executor for ComfyUI prompts (kind ``comfy.render``).

Item input (frozen at submit time)::

    {"stages": [Compiled.to_json(), ...],   # run in order; stage n+1 may take stage n's image
     "feeds":  [[], ["/10/inputs/image"]],  # all targets for the previous stage's image
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
import copy
import time

from ..jobs import ExecError, ItemContext, JobConflict
from . import bindings as B
from .client import ComfyClient, ComfyError, parse_preview  # noqa: F401  (re-export for tests)
from .compile import (
    PREVIOUS,
    asset_value,
    fill_placeholders,
    find_placeholders,
    validate_outputs,
    validate_plan,
)
from .state_run import StateSession


class ComfyRenderExecutor:
    def __init__(
        self,
        assets,
        client_factory=ComfyClient,
        on_result=None,
        timeout: float = 900.0,
        *,
        registry=None,
    ):
        self.assets = assets
        self.artifact_store = assets
        self.client_factory = client_factory
        self.on_result = on_result
        self.timeout = timeout
        self.registry = registry

    def _configure(self, client, stage):
        client.output_adapters = stage.get("output_adapters") or {}
        client.adapter_registry = self.registry

    @property
    def replay_safe(self) -> bool:
        # The built-in callback commits a receipt with the work. Arbitrary extension
        # callbacks must not accidentally inherit that guarantee.
        from ..pipeline.render import RenderService

        return self.on_result is None or (
            getattr(self.on_result, "__func__", None) is RenderService.apply_result
        )

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
        feeds = ctx.input.get("feeds") or [[] for _ in stages]
        guard = ctx.input.get("guard") or []
        previous: str | None = None
        previous_images = []
        reports = []
        for n, stage in enumerate(stages):
            ctx.raise_if_cancelled()
            validate_plan(stage["graph"], stage.get("frontend_state") or {}, self.registry)
            validate_outputs(stage["graph"], stage.get("output_adapters") or {}, self.registry)
            self._configure(client, stage)
            if n and stage.get("feed_output"):
                choice = stage["feed_output"]
                selected = next(
                    (
                        im
                        for im in previous_images
                        if im["node"] == choice["node_id"] and im["index"] == choice["index"]
                    ),
                    None,
                )
                if selected is None:
                    raise ExecError(
                        f"上一阶段节点 {choice['node_id']} 没有第 {choice['index'] + 1} 张图片；后续阶段未提交",
                        kind="output_selection",
                        sent=False,
                        detail={"stages": reports},
                    )
                previous = selected["asset_id"]
            uploads = dict(stage.get("uploads") or {})
            graph = stage["graph"]
            if n and feeds[n] and previous:
                targets = feeds[n]
                if isinstance(targets, str):
                    # Already-frozen jobs recorded only the first target, but their graph
                    # still identifies every input that receives this same previous image.
                    targets = [targets] + [
                        p for p, a in find_placeholders(graph).items() if a == PREVIOUS
                    ]
                graph = copy.deepcopy(graph)
                for pointer in targets:
                    node_id, _, field = pointer.removeprefix("/").partition("/inputs/")
                    graph[node_id]["inputs"][field] = asset_value(previous)
                uploads.update(dict.fromkeys(targets, previous))
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
            images, artifacts = self._prepare_images(run.images, run.prompt_id)
            previous_images = images
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
            result = self._publish_prepared(
                ctx,
                {
                    "images": images,
                    "stages": reports,
                    "instance": ctx.instance.id,
                    "meta": ctx.input.get("meta") or {},
                },
                artifacts,
                n,
                n == len(stages) - 1,
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
        return result

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

    def _prepare_images(self, images, prompt_id):
        artifacts, entries = [], []
        for image in images:
            asset = self.assets.describe(image.data, source=f"comfy:{prompt_id}:{image.node}")
            artifacts.append((asset, image.data))
            entries.append(
                {
                    "asset_id": asset.id,
                    "node": image.node,
                    "index": image.index,
                    "width": asset.width,
                    "height": asset.height,
                }
            )
        return entries, artifacts

    @staticmethod
    def _publish_prepared(ctx, result, artifacts, stage, terminal):
        intent = ctx.engine.publication_intent(ctx.job_id, ctx.idx)
        if intent and intent["stage"] == stage:
            expected = intent["checkpoints"][-1]["artifacts"]
            if [asset.id for asset, _ in artifacts] != [asset["id"] for asset in expected]:
                raise ExecError(
                    "取回图片与已保存的结果清单不一致", kind="artifact_mismatch", sent=True
                )
            artifacts = [(asset, pair[1]) for asset, pair in zip(expected, artifacts)]
            result = intent["result"]
        return ctx.publish_result(result, artifacts, stage=stage, terminal=terminal)

    # ---------------------------------------------------------------- recover
    def _repair_publication(self, ctx, client, intent):
        missing = set()
        for asset in intent["artifacts"]:
            try:
                if self.assets.restore(asset):
                    continue
            except (OSError, ValueError):
                pass
            missing.add(asset["id"])
        for checkpoint in intent["checkpoints"]:
            if not any(asset["id"] in missing for asset in checkpoint["artifacts"]):
                continue
            index = checkpoint["stage"]
            reports = checkpoint["result"].get("stages") or []
            prompt = reports[-1].get("prompt_id") if reports else None
            if type(index) is not int or not 0 <= index < len(ctx.input["stages"]) or not prompt:
                raise JobConflict("the retained checkpoint has no frozen stage or prompt")
            try:
                entry = client.history(prompt)
            except ComfyError:
                return False
            if not entry or not entry.get("outputs"):
                return False
            stage = ctx.input["stages"][index]
            self._configure(client, stage)
            images, texts = client.collect(entry, stage["outputs"])
            self._validate_outputs(images, texts, stage, ctx.input.get("guard") or [])
            _, artifacts = self._prepare_images(images, prompt)
            ctx.engine.restore_checkpoint(ctx, intent["publication_sha"], index, artifacts)
            missing.difference_update(asset["id"] for asset in checkpoint["artifacts"])
        return not missing

    def recover_state(self, ctx, record, *, confirm_stopped=False, discard_result=False):
        client = self.client_factory(record["base_url"])
        session = StateSession(ctx, client, record)
        try:
            evidence, entry = session.settle(confirm_stopped=confirm_stopped)
            if not evidence["settled"]:
                return {"restored": False, "status": evidence["status"]}
            discard_result = discard_result or ctx.engine.get(ctx.job_id, items=False)["canceled"]
            if discard_result:
                session.data.update(
                    result_pending=False,
                    result=None,
                    failure={"kind": "result_discarded", "message": "已明确放弃取回此任务结果。"},
                )
                ctx.engine.discard_state_result(ctx, session.record["token"], session.data)
            else:
                intent = ctx.engine.publication_intent(ctx.job_id, ctx.idx)
                if intent and not self._repair_publication(ctx, client, intent):
                    return {"restored": False, "status": "result_unavailable"}
            index = session.data.get("stage", -1)
            prompt = session.data.get("prompt_id")
            local = None if discard_result else ctx.engine.local_result(ctx.job_id, ctx.idx)
            if (
                local
                and session.data.get("result_pending")
                and local.get("stage") == index
                and local["result"].get("stages")
                and local["result"]["stages"][-1].get("prompt_id") == prompt
            ):
                result = local["result"]
                session.save(
                    result_pending=False,
                    stage_result=result["stages"][-1],
                    result=result if local["terminal"] else None,
                )
            if session.data.get("result_pending"):
                if not entry:
                    state, entry = client.execution_state(prompt)
                    if state != "terminal_success":
                        return {"restored": False, "status": "result_unavailable"}
                stage = ctx.input["stages"][index]
                self._configure(client, stage)
                images, texts = client.collect(entry, stage["outputs"])
                try:
                    self._validate_outputs(images, texts, stage, ctx.input.get("guard") or [])
                except ExecError as exc:
                    # A deliberate rejection can release without a result; storage/network
                    # failures cannot. Keep that distinction durable across restart.
                    session.ended(failure={"kind": exc.kind, "message": str(exc)})
                else:
                    stored, artifacts = self._prepare_images(images, prompt)
                    stage_result = {"prompt_id": prompt, "images": stored, "reconciled": True}
                    result = {
                        "images": stored,
                        "stages": [stage_result],
                        "instance": ctx.instance.id,
                        "meta": ctx.input.get("meta") or {},
                        "reconciled": True,
                    }
                    result = self._publish_prepared(
                        ctx, result, artifacts, index, index == len(ctx.input["stages"]) - 1
                    )
                    stage_result = result["stages"][-1]
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
        except (ComfyError, ExecError, JobConflict, OSError, ValueError) as exc:
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
        intent = ctx.engine.publication_intent(ctx.job_id, ctx.idx)
        if intent:
            if not self._repair_publication(ctx, client, intent):
                return None
            if intent["terminal"]:
                return intent["result"]
        try:
            entry = client.history(prompt_id)
        except ComfyError:
            return None
        if not entry or not entry.get("outputs"):
            return None
        last = ctx.input["stages"][-1]
        self._configure(client, last)
        images, texts = client.collect(entry, last["outputs"])
        self._validate_outputs(images, texts, last, ctx.input.get("guard") or [])
        stored, artifacts = self._prepare_images(images, prompt_id)
        result = {
            "images": stored,
            "stages": [
                {"prompt_id": prompt_id, "images": stored, "reconciled": True, "at": time.time()}
            ],
            "meta": ctx.input.get("meta") or {},
            "reconciled": True,
        }
        return self._publish_prepared(ctx, result, artifacts, int(stage_index), True)

    def on_complete(self, job: dict, item: dict, result: dict) -> None:
        if self.on_result:
            self.on_result(job, item, result)
