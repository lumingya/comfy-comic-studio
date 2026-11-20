"""Job executor for cloud image requests through the local proxy (kind ``cloud.render``).

Modes: ``shape`` (hybrid step 1: compose the panel from character references) and ``edit``
(instruction edit of an existing take).  Cloud requests are paid / rate-limited, so the item is
marked *sent* before the call: a timeout becomes ``uncertain`` and is never retried implicitly.
Only definitive rejections (4xx other than 408/429) or connection refusals are plain failures.
"""

from __future__ import annotations

from .. import llm as L
from ..jobs import ExecError, ItemContext
from . import cloud_request as CR
from .cloud import CloudRenderer


class CloudExecutor:
    replay_safe = True

    def __init__(self, assets, llm_factory, render_service, backend=None):
        self.assets = assets
        self.artifact_store = assets
        self.llm_factory = llm_factory
        self.render = render_service
        self.backend = backend  # callable(channel_id) -> image client; None = the LLM client
        self.render.cloud_backend = self._backend

    def _backend(self, channel_id):
        return self.backend(channel_id) if self.backend else self.llm_factory()

    def execute(self, ctx: ItemContext) -> dict:
        inp = ctx.input
        request = inp.get("request")
        try:
            if request is not None:
                # An empty frozen channel is specifically the default chat client, not a
                # request to resolve whatever channel becomes the new default later.
                client = (
                    self._backend(request["channel_id"])
                    if request["channel_id"]
                    else self.llm_factory()
                )
                client = CR.bind_request(client, request)
            else:
                client = self._backend(inp.get("channel") or "")
        except LookupError as exc:
            raise ExecError(str(exc), kind="bad_input", sent=False) from None
        renderer = CloudRenderer(client)
        try:
            if inp["mode"] == "shape":
                sheets = {
                    cid: self.assets.read(aid) for cid, aid in (inp.get("sheets") or {}).items()
                }
                references = (
                    [self.assets.read(r["asset_id"]) for r in request["requested"]["refs"]]
                    if request
                    else None
                )
                ctx.mark_sent()
                data, meta = renderer.panel(
                    inp["story"],
                    inp["panel"],
                    sheets,
                    prompt=inp.get("prompt"),
                    request=request,
                    references=references,
                )
            elif inp["mode"] == "edit":
                refs = [self.assets.read(a) for a in inp.get("refs") or []]
                image = self.assets.read(inp["image"])
                ctx.mark_sent()
                data, meta = renderer.edit(image, inp["instruction"], refs, request=request)
            else:
                raise ExecError(f"unknown cloud mode {inp['mode']}", kind="bad_input", sent=False)
        except L.LLMError as exc:
            definitive = (
                exc.status is not None and 400 <= exc.status < 500 and exc.status not in (408, 429)
            )
            # Error text is not evidence of delivery (a read timeout can say "connection").
            # Adapters may prove an unsent connect failure or an already-generated download.
            sent = exc.sent if exc.sent is not None else not definitive
            # 429 after the client's own retries: the channel is throttling (legacy 服务限流).
            kind = "rate_limited" if exc.status == 429 else "cloud_error"
            raise ExecError(str(exc), kind=kind, sent=sent) from None
        asset = self.assets.describe(data, source=f"cloud:{meta.get('model')}")
        actual = meta.get("request")
        if not actual and request:
            unknown = {**request, "kind": "unknown"}
            actual = CR.snapshot(unknown)
            actual["kind"] = request["kind"]
        result = {
            "images": [{"asset_id": asset.id, "width": asset.width, "height": asset.height}],
            "cloud": actual,
            "meta": inp.get("meta") or {},
        }
        return ctx.publish_result(result, [(asset, data)])

    def on_complete(self, job: dict, item: dict, result: dict) -> None:
        created = self.render.apply_result(job, item, result)
        meta = result.get("meta") or {}
        refinement = item["input"].get("refinement")
        if item["input"]["mode"] == "shape" and refinement is not None and created:
            self.render.refine_shape(
                meta["episode_id"],
                created[0],
                refinement,
            )
