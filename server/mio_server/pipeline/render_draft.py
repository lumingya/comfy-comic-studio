"""Plan draft candidates and route immutable render requests to the job engine.

Mixed into RenderService; shares its profile/workflow snapshots, seeded randomness,
stage compiler and cloud route. Candidate selection remains explicit in the result.
"""

from __future__ import annotations

from ..jobs import COMFY, ItemSpec
from ..models import Episode, Series, VariantSet
from ..queue import default_window
from ..render_models import RenderProfile
from . import variables as V
from .compiler import compile_panel
from .node_overrides import node_overrides
from .refs import reference_values, select_references
from .render_composition import KEY as COMPOSITION
from .render_edits import RenderError
from .story import apply_variant


def panel_values(series: Series, panel, variant: VariantSet | None = None) -> dict:
    """Panel ``values`` plus ``var.<name>`` for every {变量} (legacy variable bindings)."""
    table = V.table(
        series,
        panel,
        apply_variant(series.bible, variant),
        variant.style_id if variant else None,
        variant,
    )
    names = (
        set(series.variables)
        | set(variant.variables if variant else {})
        | {k[1:] for k in panel.overrides.values if k.startswith("$")}
    )
    out = {f"var.{n}": V.expand(str(table[n]), table) for n in sorted(names)}
    out.update({k: v for k, v in panel.overrides.values.items() if not k.startswith("$")})
    return out


class DraftPlanningMixin:
    def plan_panel(
        self,
        series: Series,
        episode: Episode,
        panel,
        profile: RenderProfile,
        *,
        candidates: int,
        variant=None,
        adopt_first: bool = False,
        adopt_replace: bool = False,
    ) -> list[ItemSpec]:
        specs = []
        refs = select_references(
            apply_variant(series.bible, variant),
            panel,
            style_id=variant.style_id if variant else None,
        )
        ref_values = reference_values(refs)
        extra = panel_values(series, panel, variant)
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
                base_width=profile.base_width,
                references=refs,
            )
            self.prompt_hook(pp, series, episode, panel)
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
            if series.generation:
                # Task sizes stay as imported unless the author explicitly overrides them.
                for name in ("width", "height"):
                    if (
                        getattr(series.generation, name) is None
                        and getattr(panel.overrides, name) is None
                        and name not in extra
                    ):
                        base.pop(name, None)
            later = {
                "prompt": pp.positive,
                "negative": pp.negative,
                "seed": pp.seed,
                **extra,
            }
            stages, feeds = self._chain(
                profile.draft,
                base,
                later,
                node_overrides(series, panel, variant),
                pp.loras,
                panel.overrides.slot_overrides,
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
            if (adopt_first or adopt_replace) and k == 0:
                meta["adopt_first"] = True
            if adopt_replace and k == 0:
                meta["adopt_replace"] = True
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
        adopt_first: bool = False,
        adopt_replace: bool = False,
    ) -> dict:
        episode = self.store.get_episode(episode_id)
        series = self.store.get_series(episode.series_id)
        profile = self.profile(profile_id, series)
        panels = [p for p in episode.ordered_panels() if panel_ids is None or p.id in panel_ids]
        if not panels:
            raise RenderError("没有要出图的格")
        variants = self._variants(series, variant_ids)
        selected = [
            (
                variant,
                panel,
                self.profile(
                    panel.overrides.profile_id
                    or (variant.profile_id if variant else None)
                    or profile.id
                ),
            )
            for variant in variants
            for panel in panels
        ]
        routes = {prof.cloud_shape for _, _, prof in selected}
        for _, _, prof in selected:
            self.require_bound_profile(prof)
        if len(routes) > 1:
            raise RenderError("同一批任务不能混用本地与云端出图配置，请分开提交")
        if routes == {True}:
            return self._render_hybrid(
                series,
                episode,
                profile,
                selected,
                idempotency_key,
                priority,
                qa,
                candidates=candidates,
                adopt_first=adopt_first,
                adopt_replace=adopt_replace,
            )
        specs = []
        for variant, panel, prof in selected:
            specs += self.plan_panel(
                series,
                episode,
                panel,
                prof,
                candidates=candidates
                or (series.generation.candidates if series.generation else prof.candidates),
                variant=variant,
                adopt_first=adopt_first,
                adopt_replace=adopt_replace,
            )
        title = f"{series.title} · {episode.title} · {len(panels)} 格草稿"
        return self.engine.submit(
            "comfy.render",
            specs,
            {"episode_id": episode.id, "profile_id": profile.id, "qa": qa, "purpose": "draft"},
            title=title,
            idempotency_key=idempotency_key,
            window=default_window(self.store, series) or self.auto_window(),
            priority=priority,
            owner=episode.id,
        )

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
