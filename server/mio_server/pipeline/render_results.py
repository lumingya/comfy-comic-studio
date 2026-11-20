"""Deliver generated takes atomically while preserving current author selections.

Mixed into RenderService; job delivery receipts and takes are persisted together in
the works store before take.created notifications are emitted.
"""

from __future__ import annotations

from ..models import Episode, Take, TakeEdit, TakeStatus


class ResultDeliveryMixin:
    def apply_result(self, job: dict, item: dict, result: dict) -> list[str]:
        meta = result.get("meta") or item["input"].get("meta") or {}
        created: list[str] = []

        def mutate(ep: Episode) -> list[str]:
            if ep.panel(meta["panel_id"]) is None:
                return []  # deleted panel: retain the result without recreating the panel
            parent = ep.take(meta["parent_take_id"]) if meta.get("parent_take_id") else None
            replaced = False
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
                    seed=(
                        result["cloud"]["effective"].get("seed")
                        if result.get("cloud")
                        and result["cloud"]["parameter_modes"]["seed"] == "native"
                        else None
                        if result.get("cloud")
                        else meta.get("seed")
                    ),
                    cloud_request=result.get("cloud"),
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
                if meta.get("adopt") and parent and parent.status == TakeStatus.adopted:
                    for t in ep.takes:
                        if (
                            t.panel_id == take.panel_id
                            and t.variant_id == take.variant_id
                            and t.status == TakeStatus.adopted
                        ):
                            t.status = TakeStatus.candidate
                    take.status = TakeStatus.adopted
                elif meta.get("adopt_replace") and not replaced:
                    for t in ep.takes:
                        if (
                            t.panel_id == take.panel_id
                            and t.variant_id == take.variant_id
                            and t.status == TakeStatus.adopted
                        ):
                            t.status = TakeStatus.candidate
                    take.status = TakeStatus.adopted
                    replaced = True
                elif meta.get("adopt_first") and ep.adopted(take.panel_id, take.variant_id) is None:
                    take.status = TakeStatus.adopted
                ep.takes.append(take)
                created.append(take.id)
            return created

        if item.get("delivery_id"):
            created, applied = self.store.apply_episode_delivery(
                meta["episode_id"], item["delivery_id"], item["delivery_sha"], mutate
            )
            if not applied:
                return created
        else:
            self.store.update_episode(meta["episode_id"], mutate)
        for take_id in created:
            self.hooks.action(
                "take.created",
                {
                    "episode_id": meta["episode_id"],
                    "panel_id": meta["panel_id"],
                    "take_id": take_id,
                    "stage": meta.get("stage", "draft"),
                    "job_id": job["id"],
                    "delivery_id": item.get("delivery_id"),
                },
            )
        return created
