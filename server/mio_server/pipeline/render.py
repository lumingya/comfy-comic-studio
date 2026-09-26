"""Render service: panels → jobs → takes.

* ``render``   – draft tier: K candidates per panel through the profile's ``draft`` stage chain
                 (generate → refine / face / upscale …, each stage's image feeding the next).
* ``finalize`` – final tier on adopted takes only: the adopted image is ``[mio:init]`` of the
                 ``final`` chain (no reliance on ComfyUI cache reuse, see ROADMAP §6.4).
* ``edit``     – single-take inpaint / outpaint (local workflow) or instruction edit (workflow
                 or cloud ``max``).
* hybrid       – ``profile.cloud_shape``: cloud shapes the panel from references, then the local
                 ``final``/``draft[1:]`` chain unifies the style (「云端定形，本地定画风」).

Everything a job needs is compiled and frozen at submit time; results come back through
``apply_result`` which appends takes with :meth:`SQLiteStore.update_episode` (atomic, never
overwrites concurrent edits).
"""

from __future__ import annotations

import random
import threading
from contextlib import contextmanager

from ..comfy import bindings as B
from ..comfy.compile import asset_value, builtin_workflows, compile_workflow, describe
from ..comfy.workflow_slots import LibraryError
from ..jobs import COMFY, ItemSpec
from ..models import Episode, Series, Take, TakeEdit, TakeStatus
from ..render_models import RenderProfile, RenderStage, WorkflowDoc
from ..storage import NotFound
from . import variables as V
from .compiler import compile_panel
from .refs import reference_values, select_references
from .render_composition import KEY as COMPOSITION
from .render_composition import CompositionMixin
from .render_edits import PREVIOUS, EditsMixin, RenderError  # noqa: F401


def default_profile() -> RenderProfile:
    return RenderProfile(
        id="profile_default",
        name="默认 · SDXL 草稿 / tile 成品",
        draft=[RenderStage(id="draft_t2i", kind="generate", workflow_id="builtin_t2i_sdxl")],
        final=[
            RenderStage(
                id="final_tile",
                kind="refine",
                workflow_id="builtin_i2i_tile",
                values={"denoise": 0.35, "strength": 0.6},
            )
        ],
        edits={
            "inpaint": RenderStage(
                id="edit_inpaint",
                kind="inpaint",
                workflow_id="builtin_inpaint_sdxl",
                values={"denoise": 0.8},
            ),
            "outpaint": RenderStage(
                id="edit_outpaint",
                kind="outpaint",
                workflow_id="builtin_inpaint_sdxl",
                values={"denoise": 1.0},
            ),
        },
    )


def panel_values(series: Series, panel) -> dict:
    """Panel ``values`` plus ``var.<name>`` for every {变量} (legacy variable bindings)."""
    table = V.table(series, panel)
    names = set(series.variables) | {k[1:] for k in panel.overrides.values if k.startswith("$")}
    out = {f"var.{n}": V.expand(str(table[n]), table) for n in sorted(names)}
    out.update({k: v for k, v in panel.overrides.values.items() if not k.startswith("$")})
    return out


class RenderService(CompositionMixin, EditsMixin):
    def __init__(self, store, assets, engine):
        self.store, self.assets, self.engine = store, assets, engine
        self._rng = random.Random()
        self._local = threading.local()

    # ------------------------------------------------------------- lookups
    @property
    def rng(self) -> random.Random:
        return getattr(self._local, "rng", None) or self._rng

    @contextmanager
    def seeded(self, idempotency_key: str | None):
        """Random seeds derive from the idempotency key, so a retried request (same key) builds
        the byte-identical snapshot instead of tripping the engine's payload-mismatch guard."""
        if not idempotency_key:
            yield
            return
        self._local.rng = random.Random(f"mio:{idempotency_key}")
        try:
            yield
        finally:
            self._local.rng = None

    def seed_builtins(self) -> None:
        for doc in builtin_workflows():
            self.store.put_doc(doc)
        try:
            self.store.get_doc("profile", "profile_default")
        except NotFound:
            self.store.put_doc(default_profile())

    def workflow(self, workflow_id: str) -> WorkflowDoc:
        return self.store.get_doc("workflow", workflow_id)

    def profile(self, profile_id: str | None, series: Series | None = None) -> RenderProfile:
        pid = profile_id or (series.default_profile_id if series else None) or "profile_default"
        return self.store.get_doc("profile", pid)

    # ------------------------------------------------------------- compile
    def _compile_stage(
        self,
        stage: RenderStage,
        values: dict,
        overrides: dict | None = None,
        loras: list[dict] | None = None,
        variant: str | None = None,
    ) -> tuple[dict, str | None, list[str]]:
        doc = self.workflow(stage.workflow_id)
        info = describe(doc)
        values, composition_warnings = self.resolve_composition(info, values)
        for key in [k for k in values if k.startswith("ref:")]:
            if key not in info["image_inputs"] and "ref" not in info["image_inputs"]:
                values.pop(key)  # workflow has no reference input: references are simply not used
        slot = (
            {
                "loras": [
                    {"name": l["name"], "strength": l.get("strength_model", 1.0)} for l in loras
                ]
            }
            if loras
            else None
        )
        warnings = list(composition_warnings)
        try:
            compiled = compile_workflow(
                doc,
                values,
                variant=stage.variant or variant,
                overrides={**stage.overrides, **(overrides or {})},
                stage_values=stage.values,
                slot_overrides=slot,
            )
        except LibraryError as exc:
            warnings.append(f"LoRA 未写入（{exc}），按工作流原样运行")
            compiled = compile_workflow(
                doc,
                values,
                variant=stage.variant or variant,
                overrides={**stage.overrides, **(overrides or {})},
                stage_values=stage.values,
            )
        except B.BindingError as exc:
            raise RenderError(f"{doc.name}：{exc}") from None
        data = compiled.to_json()
        data["warnings"] = warnings + data["warnings"]
        data["workflow_id"], data["stage_id"], data["kind"] = doc.id, stage.id, stage.kind
        feed = next((p for p, a in data["uploads"].items() if a == PREVIOUS), None)
        if feed:
            data["uploads"] = {p: a for p, a in data["uploads"].items() if a != PREVIOUS}
        return data, feed, data["warnings"]

    def _chain(
        self,
        stages: list[RenderStage],
        first_values: dict,
        later_values: dict,
        overrides: dict,
        loras: list[dict],
        start_with_previous: bool = False,
    ) -> tuple[list[dict], list[str | None]]:
        compiled, feeds = [], []
        active = [s for s in stages if s.enabled]
        if not active:
            raise RenderError("出图配置里没有启用的阶段")
        for n, stage in enumerate(active):
            chained = (n > 0 or start_with_previous) and stage.feed == "previous"
            values = dict(first_values if n == 0 else later_values)
            if chained and n > 0:
                values["init"] = asset_value(PREVIOUS)
            data, feed, _ = self._compile_stage(stage, values, overrides, loras)
            if chained and n > 0 and not feed:
                raise RenderError(
                    f"阶段 {stage.id} 要接收上一阶段的图片，但工作流没有 [mio:init] 输入"
                )
            compiled.append(data)
            feeds.append(feed if n > 0 else None)
        return compiled, feeds

    # --------------------------------------------------------------- draft
    def plan_panel(
        self,
        series: Series,
        episode: Episode,
        panel,
        profile: RenderProfile,
        *,
        candidates: int,
        variant=None,
    ) -> list[ItemSpec]:
        specs = []
        refs = select_references(series.bible, panel)
        ref_values = reference_values(refs)
        extra = panel_values(series, panel)
        prepared = None
        for k in range(candidates):
            pp = compile_panel(
                series,
                episode,
                panel,
                dialect=profile.dialect,
                variant=variant,
                quality=profile.quality_tags,
                negative=profile.negative_tags,
                rng=self.rng,
            )
            if prepared is None:
                prepared = self.prepare_composition(
                    series, episode, panel, pp.width, pp.height, profile.dialect, variant
                )
            base = {
                "prompt": pp.positive,
                "negative": pp.negative,
                "seed": pp.seed,
                "width": pp.width,
                "height": pp.height,
                **ref_values,
                COMPOSITION: prepared,
                **extra,
            }
            later = {
                "prompt": pp.positive,
                "negative": pp.negative,
                "seed": pp.seed,
                **extra,
            }
            stages, feeds = self._chain(
                profile.draft, base, later, panel.overrides.node_overrides, pp.loras
            )
            group = profile.model_group or stages[0].get("checkpoint") or ""
            meta = {
                "episode_id": episode.id,
                "panel_id": panel.id,
                "variant_id": variant.id if variant else None,
                "stage": "draft",
                "seed": pp.seed,
                "prompt": pp.positive,
                "negative": pp.negative,
                "width": pp.width,
                "height": pp.height,
                "profile_id": profile.id,
                "dialect": pp.dialect,
                "raw": pp.raw,
                "refs": [r.to_json() for r in refs],
                "candidate": k,
            }
            specs.append(
                ItemSpec(
                    input={"stages": stages, "feeds": feeds, "meta": meta},
                    resource=COMFY,
                    group=group,
                    instances=tuple(profile.instances),
                    label=f"第 {panel.order + 1} 格 · 候选 {k + 1}",
                )
            )
        return specs

    def _render(
        self,
        episode_id: str,
        panel_ids: list[str] | None = None,
        profile_id: str | None = None,
        candidates: int | None = None,
        variant_ids: list[str | None] | None = None,
        idempotency_key: str | None = None,
        priority: int = 0,
        qa: bool = False,
    ) -> dict:
        episode = self.store.get_episode(episode_id)
        series = self.store.get_series(episode.series_id)
        profile = self.profile(profile_id, series)
        if profile.cloud_shape:
            return self._render_hybrid(
                series, episode, profile, panel_ids, idempotency_key, priority, qa
            )
        panels = [p for p in episode.ordered_panels() if panel_ids is None or p.id in panel_ids]
        if not panels:
            raise RenderError("没有要出图的格")
        variants = self._variants(series, variant_ids)
        specs = []
        for variant in variants:
            for panel in panels:
                prof = self.profile(
                    panel.overrides.profile_id
                    or (variant.profile_id if variant else None)
                    or profile.id
                )
                specs += self.plan_panel(
                    series,
                    episode,
                    panel,
                    prof,
                    candidates=candidates or prof.candidates,
                    variant=variant,
                )
        title = f"{series.title} · {episode.title} · {len(panels)} 格草稿"
        return self.engine.submit(
            "comfy.render",
            specs,
            {"episode_id": episode.id, "profile_id": profile.id, "qa": qa, "purpose": "draft"},
            title=title,
            idempotency_key=idempotency_key,
            window=max(1, len(self.engine.pool.instances) or 1) * 2,
            priority=priority,
            owner=episode.id,
        )

    def render(self, episode_id: str, *args, idempotency_key: str | None = None, **kw) -> dict:
        with self.seeded(idempotency_key):
            return self._render(episode_id, *args, idempotency_key=idempotency_key, **kw)

    def finalize(self, episode_id: str, *args, idempotency_key: str | None = None, **kw) -> dict:
        with self.seeded(idempotency_key):
            return self._finalize(episode_id, *args, idempotency_key=idempotency_key, **kw)

    def _variants(self, series: Series, variant_ids):
        if not variant_ids:
            return [None]
        by_id = {v.id: v for v in series.variants}
        out = []
        for vid in variant_ids:
            if vid is None:
                out.append(None)
            elif vid in by_id:
                out.append(by_id[vid])
            else:
                raise RenderError(f"批量变体不存在：{vid}")
        return out

    # --------------------------------------------------------------- final
    def _finalize(
        self,
        episode_id: str,
        take_ids: list[str] | None = None,
        profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        episode = self.store.get_episode(episode_id)
        series = self.store.get_series(episode.series_id)
        takes = [
            t
            for t in episode.takes
            if (take_ids and t.id in take_ids)
            or (not take_ids and t.status == TakeStatus.adopted and t.stage == "draft")
        ]
        if not takes:
            raise RenderError("没有已采用的草稿图可以跑成品档")
        specs = []
        for take in takes:
            panel = episode.panel(take.panel_id)
            if panel is None:
                continue
            profile = self.profile(profile_id or panel.overrides.profile_id, series)
            if not profile.final:
                raise RenderError(f"出图配置 {profile.name} 没有成品档阶段")
            snap = take.parameter_snapshot
            values = {
                "prompt": snap.get("prompt", ""),
                "negative": snap.get("negative", ""),
                "seed": take.seed or 0,
                "init": asset_value(take.asset_id),
            }
            stages, feeds = self._chain(
                profile.final,
                values,
                {k: v for k, v in values.items() if k != "init"},
                panel.overrides.node_overrides,
                [],
            )
            meta = {
                "episode_id": episode.id,
                "panel_id": panel.id,
                "variant_id": take.variant_id,
                "stage": "final",
                "seed": take.seed,
                "prompt": snap.get("prompt", ""),
                "negative": snap.get("negative", ""),
                "profile_id": profile.id,
                "parent_take_id": take.id,
                "adopt": take.status == TakeStatus.adopted,
                "edit": {"kind": "final", "params": {}},
            }
            specs.append(
                ItemSpec(
                    input={"stages": stages, "feeds": feeds, "meta": meta},
                    resource=COMFY,
                    group=profile.model_group or stages[0].get("checkpoint") or "",
                    instances=tuple(profile.instances),
                    label=f"第 {panel.order + 1} 格 · 成品",
                )
            )
        return self.engine.submit(
            "comfy.render",
            specs,
            {"episode_id": episode.id, "purpose": "final"},
            title=f"{episode.title} · 成品档 {len(specs)} 格",
            idempotency_key=idempotency_key,
            owner=episode.id,
        )

    # -------------------------------------------------------------- results
    def apply_result(self, job: dict, item: dict, result: dict) -> list[str]:
        meta = result.get("meta") or item["input"].get("meta") or {}
        created: list[str] = []

        def mutate(ep: Episode) -> None:
            if ep.panel(meta["panel_id"]) is None:
                return  # panel deleted meanwhile: the job keeps the result, nothing to attach to
            parent = ep.take(meta["parent_take_id"]) if meta.get("parent_take_id") else None
            for img in result.get("images") or []:
                edits = list(parent.edits) if parent else []
                if meta.get("edit"):
                    edits.append(
                        TakeEdit(
                            kind=meta["edit"]["kind"],
                            from_take_id=parent.id if parent else "",
                            params=meta["edit"].get("params") or {},
                        )
                    )
                take = Take(
                    panel_id=meta["panel_id"],
                    asset_id=img["asset_id"],
                    stage=meta.get("stage", "draft"),
                    variant_id=meta.get("variant_id"),
                    job_id=job["id"],
                    parent_take_id=parent.id if parent else None,
                    width=img.get("width"),
                    height=img.get("height"),
                    seed=meta.get("seed"),
                    edits=edits,
                    parameter_snapshot={
                        k: meta.get(k)
                        for k in (
                            "prompt",
                            "negative",
                            "profile_id",
                            "dialect",
                            "raw",
                            "refs",
                            "width",
                            "height",
                            "candidate",
                        )
                        if k in meta
                    }
                    | {"instance": result.get("instance")},
                )
                if meta.get("adopt") and parent:
                    for t in ep.takes:
                        if (
                            t.panel_id == take.panel_id
                            and t.variant_id == take.variant_id
                            and t.status == TakeStatus.adopted
                        ):
                            t.status = TakeStatus.candidate
                    take.status = TakeStatus.adopted
                ep.takes.append(take)
                created.append(take.id)

        self.store.update_episode(meta["episode_id"], mutate)
        return created
