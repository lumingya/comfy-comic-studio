"""Single-take edits (inpaint / outpaint / instruction edit) and the hybrid cloud route.

Mixed into :class:`~mio_server.pipeline.render.RenderService`; relies on its ``store``,
``assets``, ``engine``, ``rng``, ``profile()``, ``_compile_stage()`` and ``_chain()``.
"""

from __future__ import annotations

from copy import deepcopy
from itertools import groupby

from .. import imaging
from ..comfy.compile import asset_value
from ..jobs import COMFY, LOCAL, ItemSpec
from ..models import Episode, Take, parse_ratio
from . import cloud_request as CR
from .cloud import CloudRenderer
from .compiler import compile_panel
from .node_overrides import node_overrides
from .refs import select_references


class RenderError(ValueError):
    pass


class EditsMixin:
    def _cloud_request(
        self, channel_id: str, requested: dict, *, allow_missing: bool = False, recipe=None
    ) -> dict:
        try:
            request = CR.freeze_request(
                self.cloud_backend(channel_id), requested, channel_id=channel_id, rng=self.rng
            )
            snapshot = getattr(self._local, "generation", None)
            channel = (
                recipe.model_dump()
                if recipe is not None
                else (snapshot.channels.get(channel_id) if snapshot else None)
            )
            if channel:
                if channel["kind"] != request["kind"]:
                    raise LookupError("云端渠道类型已改变，请重新装配任务")
                seed = request["options"].get("seed")
                request["model"] = channel["model"]
                request["options"] = deepcopy(channel["options"])
                if seed is not None:
                    request["options"]["seed"] = seed
            return request
        except LookupError as exc:
            if allow_missing:
                return {
                    "channel_id": channel_id,
                    "kind": "missing",
                    "model": "",
                    "requested": requested,
                    "options": {},
                }
            raise RenderError(str(exc)) from None

    # ---------------------------------------------------------------- edit
    def edit(self, episode_id: str, *args, idempotency_key: str | None = None, **kw) -> dict:
        with (
            self.engine.hold_operation(),
            self.seeded(idempotency_key),
            self.task_snapshot(episode_id),
        ):
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
        self.require_bound_profile(profile)
        snap = take.parameter_snapshot
        prompt = params.get("prompt") or snap.get("prompt", "")
        negative = params.get("negative") or snap.get("negative", "")
        seed = params.get("seed", self.rng.randrange(0, 2**48))
        if kind == "edit" and "edit" not in profile.edits:
            return self._cloud_edit(episode, take, params, idempotency_key)
        stage = profile.edits.get(kind)
        if stage is None:
            raise RenderError(f"出图配置 {profile.name} 没有「{kind}」工作流")
        if not stage.enabled:
            raise RenderError(f"出图配置 {profile.name} 的「{kind}」工作流已停用")
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
        (panel_slots,) = self._panel_slots_by_stage([stage], panel.overrides.slot_overrides, False)
        data, _, _ = self._compile_stage(
            stage, values, node_overrides(series, panel), slot_overrides=panel_slots
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
            input={"stages": [data], "feeds": [[]], "meta": meta},
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
        refs = [take.asset_id, *(params.get("ref_asset_ids") or [])]
        request = self._cloud_request(
            params.get("channel") or "",
            {
                "prompt": CloudRenderer.edit_prompt(instruction),
                "negative": params.get("negative") or take.parameter_snapshot.get("negative", ""),
                "width": params.get("width") or take.width,
                "height": params.get("height") or take.height,
                "seed": params.get("seed"),
                "reference_mode": "manual",
                "refs": [
                    {
                        "slot": i + 1,
                        "asset_id": aid,
                        "role": "reference",
                        "owner": "manual",
                        "reason": "编辑原图" if i == 0 else "手动指定",
                    }
                    for i, aid in enumerate(refs)
                ],
            },
            allow_missing=True,
        )
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
                "channel": params.get("channel") or "",
                "request": request,
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
        self,
        series,
        episode,
        profile,
        selected,
        idempotency_key,
        priority,
        qa,
        *,
        candidates=None,
        adopt_first=False,
        adopt_replace=False,
    ) -> dict:
        from .story import apply_variant, to_story

        specs = []
        for _, entries in groupby(selected, key=lambda entry: entry[0].id if entry[0] else None):
            entries = list(entries)
            variant = entries[0][0]
            bible = apply_variant(series.bible, variant)
            story = to_story(series, episode, variant)
            for _, panel, prof in entries:
                refs = select_references(
                    bible, panel, style_id=variant.style_id if variant else None
                )
                pv = next(p for p in story["panels"] if p["id"] == panel.id)
                refine = prof.cloud_refine
                for k in range(
                    candidates
                    or (series.generation.candidates if series.generation else prof.candidates)
                ):
                    pp = compile_panel(
                        series,
                        episode,
                        panel,
                        dialect=prof.dialect,
                        variant=variant,
                        quality=prof.quality_tags,
                        negative=prof.negative_tags,
                        rng=self.rng,
                        references=refs,
                    )
                    self.prompt_hook(pp, series, episode, panel)
                    meta = {
                        "episode_id": episode.id,
                        "panel_id": panel.id,
                        "variant_id": variant.id if variant else None,
                        "stage": "shape" if refine else "draft",
                        "seed": pp.seed,
                        "prompt": pp.positive,
                        "negative": pp.negative,
                        "profile_id": prof.id,
                        "dialect": pp.dialect,
                        "raw": pp.raw,
                        "candidate": k,
                        "width": pp.width,
                        "height": pp.height,
                        "refine": refine,
                        "refs": [r.to_json() for r in refs],
                        # Queue progress counts adopted images: only mark the final output,
                        # not an intermediate cloud shape that is still waiting for ComfyUI.
                        "adopt_first": (adopt_first or adopt_replace) and k == 0 and not refine,
                        "refine_adopt_first": (adopt_first or adopt_replace) and k == 0 and refine,
                        "adopt_replace": adopt_replace and k == 0 and not refine,
                        "refine_adopt_replace": adopt_replace and k == 0 and refine,
                    }
                    refinement = (
                        self.plan_cloud_refinement(prof, meta, panel.overrides.slot_overrides)
                        if refine
                        else None
                    )
                    requested = {
                        "prompt": pp.positive,
                        "negative": pp.negative,
                        "width": pp.width,
                        "height": pp.height,
                        "seed": pp.seed,
                        "reference_mode": panel.reference_mode,
                        "refs": meta["refs"],
                    }
                    if series.generation:
                        for name in ("width", "height"):
                            if (
                                getattr(series.generation, name) is None
                                and getattr(panel.overrides, name) is None
                            ):
                                requested.pop(name, None)
                    request = self._cloud_request(
                        prof.cloud_channel, requested, recipe=prof.cloud_recipe
                    )
                    specs.append(
                        ItemSpec(
                            input={
                                "mode": "shape",
                                "story": story,
                                "panel": pv,
                                "request": request,
                                "prompt": pp.positive,
                                "channel": prof.cloud_channel,
                                "meta": meta,
                                "refinement": refinement,
                            },
                            resource=LOCAL,
                            label=f"第 {panel.order + 1} 格 · 云端出图 · 候选 {k + 1}",
                        )
                    )
        if not specs:
            raise RenderError("没有要出图的格")
        return self.engine.submit(
            "cloud.render",
            specs,
            {
                "episode_id": episode.id,
                "profile_id": profile.id,
                "purpose": "hybrid" if any(s.input["refinement"] for s in specs) else "cloud",
                "qa": qa,
            },
            title=f"{episode.title} · 云端出图",
            idempotency_key=idempotency_key,
            priority=priority,
            owner=episode.id,
        )
