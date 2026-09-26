"""Job executor for cloud image requests through the local proxy (kind ``cloud.render``).

Modes: ``shape`` (hybrid step 1: compose the panel from character references) and ``edit``
(instruction edit of an existing take).  Cloud requests are paid / rate-limited, so the item is
marked *sent* before the call: a timeout becomes ``uncertain`` and is never retried implicitly.
Only definitive rejections (4xx other than 408/429) or connection refusals are plain failures.
"""

from __future__ import annotations

from .. import llm as L
from ..jobs import ExecError, ItemContext
from .cloud import CloudRenderer


class CloudExecutor:
    def __init__(self, assets, llm_factory, render_service):
        self.assets = assets
        self.llm_factory = llm_factory
        self.render = render_service

    def execute(self, ctx: ItemContext) -> dict:
        inp = ctx.input
        renderer = CloudRenderer(self.llm_factory())
        ctx.mark_sent()
        try:
            if inp["mode"] == "shape":
                sheets = {
                    cid: self.assets.read(aid) for cid, aid in (inp.get("sheets") or {}).items()
                }
                data, meta = renderer.panel(inp["story"], inp["panel"], sheets)
            elif inp["mode"] == "edit":
                refs = [self.assets.read(a) for a in inp.get("refs") or []]
                data, meta = renderer.edit(self.assets.read(inp["image"]), inp["instruction"], refs)
            else:
                raise ExecError(f"unknown cloud mode {inp['mode']}", kind="bad_input", sent=False)
        except L.LLMError as exc:
            definitive = (
                exc.status is not None and 400 <= exc.status < 500 and exc.status not in (408, 429)
            )
            refused = exc.status is None and "连" in str(exc)
            raise ExecError(
                str(exc), kind="cloud_error", sent=not (definitive or refused)
            ) from None
        asset = self.assets.put(data, source=f"cloud:{meta.get('model')}")
        return {
            "images": [{"asset_id": asset.id, "width": asset.width, "height": asset.height}],
            "cloud": {k: meta.get(k) for k in ("model", "mode", "refs", "seconds", "fallbacks")},
            "meta": inp.get("meta") or {},
        }

    def on_complete(self, job: dict, item: dict, result: dict) -> None:
        created = self.render.apply_result(job, item, result)
        meta = result.get("meta") or {}
        if item["input"]["mode"] == "shape" and meta.get("refine") and created:
            self.render.refine_shape(meta["episode_id"], created[0], meta["profile_id"])
