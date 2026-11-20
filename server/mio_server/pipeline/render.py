"""Render service: panels → jobs → takes.

* ``render``   – draft tier: K candidates per panel through the profile's ``draft`` stage chain
                 (generate → refine / face / upscale …, each stage's image feeding the next).
* ``finalize`` – final tier on adopted takes only: the adopted image is ``[mio:init]`` of the
                 ``final`` chain (no reliance on ComfyUI cache reuse, see ROADMAP §6.4).
* ``edit``     – single-take inpaint / outpaint (local workflow) or instruction edit (workflow
                 or cloud ``max``).
* cloud        – ``profile.cloud_shape``: cloud generates the candidate; only an explicit
                 ``cloud_refine`` opt-in schedules the frozen local refinement chain.

Everything a job needs is compiled and frozen at submit time; results come back through
``apply_result`` which appends takes with :meth:`SQLiteStore.update_episode` (atomic, never
overwrites concurrent edits).
"""

from __future__ import annotations

import random
import threading
from contextlib import contextmanager

from ..comfy.compile import asset_value, builtin_workflows
from ..generation import profile_for
from ..hooks import HookBus
from ..jobs import COMFY, ItemSpec
from ..models import Series, TakeStatus
from ..render_models import RenderProfile, RenderStage, WorkflowDoc
from ..storage import NotFound
from .node_overrides import node_overrides
from .render_cloud import CloudRefinementMixin
from .render_compile import RenderCompilationMixin
from .render_composition import CompositionMixin
from .render_draft import DraftPlanningMixin
from .render_draft import panel_values as panel_values
from .render_edits import EditsMixin, RenderError
from .render_results import ResultDeliveryMixin


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


class RenderService(
    RenderCompilationMixin,
    DraftPlanningMixin,
    ResultDeliveryMixin,
    CompositionMixin,
    CloudRefinementMixin,
    EditsMixin,
):
    def __init__(self, store, assets, engine):
        self.store, self.assets, self.engine = store, assets, engine
        self.hooks = HookBus()  # replaced by the registry's bus in AppContext
        self.cloud_backend = lambda channel_id: None  # wired by CloudExecutor
        self.binding_rules = lambda: ()  # wired to the live registry by AppContext
        self._rng = random.Random()
        self._local = threading.local()

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
        frozen = getattr(self._local, "generation", None)
        if frozen and workflow_id in frozen.workflows:
            return WorkflowDoc.model_validate(frozen.workflows[workflow_id])
        return self.store.get_doc("workflow", workflow_id)

    def profile(self, profile_id: str | None, series: Series | None = None) -> RenderProfile:
        if series is not None:
            return profile_for(self.store, series, profile_id)
        frozen = getattr(self._local, "generation", None)
        if frozen:
            data = frozen.profile if profile_id is None else frozen.profiles.get(profile_id)
            if data:
                return RenderProfile.model_validate(data)
        pid = profile_id or (series.default_profile_id if series else None) or "profile_default"
        return self.store.get_doc("profile", pid)

    @contextmanager
    def task_snapshot(self, episode_id: str):
        previous = getattr(self._local, "generation", None)
        episode = self.store.get_episode(episode_id)
        self._local.generation = self.store.get_series(episode.series_id).generation
        try:
            yield
        finally:
            self._local.generation = previous

    @staticmethod
    def require_bound_profile(profile: RenderProfile) -> None:
        if profile.binding_required:
            raise RenderError(f"出图配置「{profile.name}」尚未绑定服务，请先选择实例或云端渠道")

    def auto_window(self) -> int:
        """Panels a render job runs at once when nobody chose: two per ComfyUI instance."""
        return max(1, len(self.engine.pool.instances) or 1) * 2

    def render(self, episode_id: str, *args, idempotency_key: str | None = None, **kw) -> dict:
        with (
            self.engine.hold_operation(),
            self.seeded(idempotency_key),
            self.task_snapshot(episode_id),
        ):
            return self._render(episode_id, *args, idempotency_key=idempotency_key, **kw)

    def finalize(self, episode_id: str, *args, idempotency_key: str | None = None, **kw) -> dict:
        with (
            self.engine.hold_operation(),
            self.seeded(idempotency_key),
            self.task_snapshot(episode_id),
        ):
            return self._finalize(episode_id, *args, idempotency_key=idempotency_key, **kw)

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
            self.require_bound_profile(profile)
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
                node_overrides(series, panel),
                [],
                panel.overrides.slot_overrides,
                require_panel_groups=False,
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

    def prompt_hook(self, pp, series, episode, panel) -> None:
        """Run the ``prompt.compiled`` filter; extensions may rewrite positive / negative."""
        value = {"positive": pp.positive, "negative": pp.negative}
        out = self.hooks.filter(
            "prompt.compiled",
            value,
            series=series,
            episode=episode,
            panel=panel,
            dialect=pp.dialect,
        )
        if isinstance(out, dict):
            pp.positive = str(out.get("positive", pp.positive))
            pp.negative = str(out.get("negative", pp.negative))
