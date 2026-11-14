"""Explicit cloud-to-local refinement, compiled before the cloud request is submitted."""

from __future__ import annotations

import copy

from ..comfy.compile import asset_value, find_placeholders
from ..jobs import COMFY, ItemSpec
from ..jobs.operations import operation_serialized
from .render_edits import RenderError

CLOUD_SOURCE = "__cloud_source__"


def bind_cloud_source(plan: dict, asset_id: str) -> dict:
    """Bind only our image placeholder; never re-read a mutable workflow or profile."""
    frozen = copy.deepcopy(plan)
    if not frozen.get("stages"):
        raise RenderError("云端精修快照缺少阶段")
    found = False
    for stage in frozen["stages"]:
        for node in stage["graph"].values():
            for key, value in node["inputs"].items():
                if value == asset_value(CLOUD_SOURCE):
                    node["inputs"][key] = asset_value(asset_id)
                    found = True
        stage["uploads"] = {
            pointer: asset_id if value == CLOUD_SOURCE else value
            for pointer, value in stage["uploads"].items()
        }
    if not found:
        raise RenderError("云端精修快照缺少输入图片")
    return frozen


class CloudRefinementMixin:
    def plan_cloud_refinement(self, profile, meta: dict) -> dict:
        chain = [s for s in (profile.final or profile.draft[1:]) if s.enabled]
        if not chain:
            raise RenderError("云端精修配置里没有启用的本地阶段")
        if chain[0].feed != "previous":
            raise RenderError("云端精修的首个本地阶段必须接收云端图片")
        values = {k: meta[k] for k in ("prompt", "negative", "seed", "width", "height")}
        stages, feeds = self._chain(
            chain, {**values, "init": asset_value(CLOUD_SOURCE)}, values, {}, []
        )
        # Overrides or a render hook must not silently disconnect the cloud input.
        if CLOUD_SOURCE not in find_placeholders(stages[0]["graph"]).values():
            raise RenderError("云端精修工作流没有保留 [mio:init] 输入图片")
        return {
            "stages": stages,
            "feeds": feeds,
            "instances": list(profile.instances),
            "group": profile.model_group or stages[0].get("checkpoint") or "",
            "meta": {
                **{
                    k: meta[k]
                    for k in (
                        "episode_id",
                        "panel_id",
                        "variant_id",
                        "profile_id",
                        "prompt",
                        "negative",
                        "seed",
                        "width",
                        "height",
                        "dialect",
                        "raw",
                        "candidate",
                    )
                },
                "stage": "draft",
                "adopt_first": meta["refine_adopt_first"],
                "adopt_replace": meta["refine_adopt_replace"],
                # apply_result checks whether the parent is STILL adopted when refinement
                # completes; do not bake mutable selection state into an idempotent payload.
                "adopt": True,
                "edit": {"kind": "refine", "params": {"route": "hybrid"}},
            },
        }

    @operation_serialized
    def refine_shape(self, episode_id: str, take_id: str, plan: dict) -> dict | None:
        episode = self.store.get_episode(episode_id)
        take = episode.take(take_id)
        if take is None:
            return None
        frozen = bind_cloud_source(plan, take.asset_id)
        meta = {
            **frozen["meta"],
            "parent_take_id": take.id,
        }
        spec = ItemSpec(
            input={"stages": frozen["stages"], "feeds": frozen["feeds"], "meta": meta},
            resource=COMFY,
            group=frozen["group"],
            instances=tuple(frozen["instances"]),
            label="本地统一画风",
        )
        return self.engine.submit(
            "comfy.render",
            [spec],
            {"episode_id": episode.id, "purpose": "hybrid-refine"},
            title="本地统一画风",
            idempotency_key=f"refine:{take.id}",
            owner=episode.id,
        )
