"""Single-take edits (inpaint / outpaint / instruction edit) and the hybrid cloud route.

Mixed into :class:`~mio_server.pipeline.render.RenderService`; relies on its ``store``,
``assets``, ``engine``, ``rng``, ``profile()``, ``_compile_stage()`` and ``_chain()``.
"""

from __future__ import annotations

from .. import imaging
from ..comfy.compile import asset_value
from ..jobs import COMFY, LOCAL, ItemSpec
from ..models import Episode, Take, parse_ratio
from .compiler import compile_panel
from .refs import select_references

PREVIOUS = "__previous__"


class RenderError(ValueError):
    pass


class EditsMixin:
    # ---------------------------------------------------------------- edit
    def edit(self, episode_id: str, *args, idempotency_key: str | None = None, **kw) -> dict:
        with self.seeded(idempotency_key):
            return self._edit(episode_id, *args, idempotency_key=idempotency_key, **kw)

    def _edit(
        self,
        episode_id: str,
        take_id: str,
        kind: str,
        params: dict,
        profile_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict:
        episode = self.store.get_episode(episode_id)
        series = self.store.get_series(episode.series_id)
        take = episode.take(take_id)
        if take is None:
            raise RenderError(f"候选不存在：{take_id}")
        panel = episode.panel(take.panel_id)
        profile = self.profile(
            profile_id or (panel.overrides.profile_id if panel else None), series
        )
        snap = take.parameter_snapshot
        prompt = params.get("prompt") or snap.get("prompt", "")
        negative = params.get("negative") or snap.get("negative", "")
        seed = params.get("seed", self.rng.randrange(0, 2**48))
        if kind == "edit" and "edit" not in profile.edits:
            return self._cloud_edit(episode, take, params, idempotency_key)
        stage = profile.edits.get(kind)
        if stage is None:
            raise RenderError(f"出图配置 {profile.name} 没有「{kind}」工作流")
        image = self.assets.read(take.asset_id)
        size = imaging.size_of(image)
        values = {
            "prompt": params.get("instruction") if kind == "edit" else prompt,
            "negative": negative,
            "seed": seed,
            "init": asset_value(take.asset_id),
        }
        record = {k: v for k, v in params.items() if k != "mask_asset_id"}
        if kind == "inpaint":
            mask_id = (
                params.get("mask_asset_id")
                or self.assets.put(
                    imaging.make_mask(
                        size,
                        params.get("boxes") or (),
                        params.get("polygons") or (),
                        int(params.get("feather", 12)),
                    ),
                    source="mask",
                ).id
            )
            values["mask"] = asset_value(mask_id)
            record["mask_asset_id"] = mask_id
        elif kind == "outpaint":
            ratio = (
                parse_ratio(params["aspect_ratio"])
                if params.get("aspect_ratio")
                else (parse_ratio(panel.aspect_ratio) if panel else size[0] / size[1])
            )
            pads = tuple(
                params.get("pads")
                or imaging.outpaint_pads(size, ratio, params.get("anchor", "center"))
            )
            if not any(pads):
                raise RenderError("图片已经是目标比例，不需要外扩")
            padded, mask = imaging.outpaint(image, pads)
            values["init"] = asset_value(self.assets.put(padded, source="outpaint").id)
            values["mask"] = asset_value(self.assets.put(mask, source="mask").id)
            record["pads"] = list(pads)
        if "denoise" in params:
            values["denoise"] = params["denoise"]
        data, _, _ = self._compile_stage(
            stage, values, panel.overrides.node_overrides if panel else None
        )
        meta = {
            "episode_id": episode.id,
            "panel_id": take.panel_id,
            "variant_id": take.variant_id,
            "stage": take.stage,
            "seed": seed,
            "prompt": prompt,
            "negative": negative,
            "profile_id": profile.id,
            "parent_take_id": take.id,
            "edit": {"kind": kind, "params": record},
        }
        spec = ItemSpec(
            input={"stages": [data], "feeds": [None], "meta": meta},
            resource=COMFY,
            group=profile.model_group or data.get("checkpoint") or "",
            instances=tuple(profile.instances),
            label=f"修图 · {kind}",
        )
        return self.engine.submit(
            "comfy.render",
            [spec],
            {"episode_id": episode.id, "purpose": "edit"},
            title=f"{episode.title} · 单格修图（{kind}）",
            idempotency_key=idempotency_key,
            priority=10,
            owner=episode.id,
        )

    # --------------------------------------------------------------- cloud
    def _cloud_edit(
        self, episode: Episode, take: Take, params: dict, idempotency_key: str | None
    ) -> dict:
        instruction = (params.get("instruction") or "").strip()
        if not instruction:
            raise RenderError("指令修图需要填写修改说明")
        meta = {
            "episode_id": episode.id,
            "panel_id": take.panel_id,
            "variant_id": take.variant_id,
            "stage": take.stage,
            "seed": take.seed,
            "prompt": take.parameter_snapshot.get("prompt", ""),
            "negative": take.parameter_snapshot.get("negative", ""),
            "parent_take_id": take.id,
            "edit": {"kind": "edit", "params": {"instruction": instruction, "route": "cloud"}},
        }
        spec = ItemSpec(
            input={
                "mode": "edit",
                "image": take.asset_id,
                "instruction": instruction,
                "refs": params.get("ref_asset_ids") or [],
                "meta": meta,
            },
            resource=LOCAL,
            label="指令修图 · 云端",
        )
        return self.engine.submit(
            "cloud.render",
            [spec],
            {"episode_id": episode.id, "purpose": "edit"},
            title=f"{episode.title} · 指令修图",
            idempotency_key=idempotency_key,
            priority=10,
            owner=episode.id,
        )

    def _render_hybrid(
        self, series, episode, profile, panel_ids, idempotency_key, priority, qa
    ) -> dict:
        from .story import to_story

        story = to_story(series, episode)
        specs = []
        for panel in episode.ordered_panels():
            if panel_ids is not None and panel.id not in panel_ids:
                continue
            refs = select_references(series.bible, panel, include_scene=False)
            sheets = {r.owner: r.asset_id for r in refs if r.owner != "manual"}
            pv = next(p for p in story["panels"] if p["id"] == panel.id)
            pp = compile_panel(
                series,
                episode,
                panel,
                dialect="tags",
                quality=profile.quality_tags,
                negative=profile.negative_tags,
                rng=self.rng,
            )
            meta = {
                "episode_id": episode.id,
                "panel_id": panel.id,
                "variant_id": None,
                "stage": "shape",
                "seed": pp.seed,
                "prompt": pp.positive,
                "negative": pp.negative,
                "profile_id": profile.id,
                "width": pp.width,
                "height": pp.height,
                "refine": bool(profile.final or profile.draft[1:]),
            }
            specs.append(
                ItemSpec(
                    input={
                        "mode": "shape",
                        "story": story,
                        "panel": pv,
                        "sheets": sheets,
                        "meta": meta,
                    },
                    resource=LOCAL,
                    label=f"第 {panel.order + 1} 格 · 云端定形",
                )
            )
        if not specs:
            raise RenderError("没有要出图的格")
        return self.engine.submit(
            "cloud.render",
            specs,
            {"episode_id": episode.id, "profile_id": profile.id, "purpose": "hybrid", "qa": qa},
            title=f"{episode.title} · 云端定形",
            idempotency_key=idempotency_key,
            priority=priority,
            owner=episode.id,
        )

    def refine_shape(self, episode_id: str, take_id: str, profile_id: str) -> dict | None:
        """Hybrid second step: local style unification of a cloud-shaped take."""
        episode = self.store.get_episode(episode_id)
        take = episode.take(take_id)
        profile = self.store.get_doc("profile", profile_id)
        chain = profile.final or profile.draft[1:]
        if take is None or not chain:
            return None
        snap = take.parameter_snapshot
        values = {
            "prompt": snap.get("prompt", ""),
            "negative": snap.get("negative", ""),
            "seed": take.seed or 0,
            "init": asset_value(take.asset_id),
        }
        stages, feeds = self._chain(
            chain, values, {k: v for k, v in values.items() if k != "init"}, {}, []
        )
        meta = {
            **{k: snap.get(k) for k in ("prompt", "negative")},
            "episode_id": episode.id,
            "panel_id": take.panel_id,
            "variant_id": take.variant_id,
            "stage": "draft",
            "seed": take.seed,
            "profile_id": profile.id,
            "parent_take_id": take.id,
            "edit": {"kind": "refine", "params": {"route": "hybrid"}},
        }
        spec = ItemSpec(
            input={"stages": stages, "feeds": feeds, "meta": meta},
            resource=COMFY,
            group=profile.model_group or stages[0].get("checkpoint") or "",
            instances=tuple(profile.instances),
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
