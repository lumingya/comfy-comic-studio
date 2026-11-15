"""One explicit workflow trial, using the ordinary album and render job paths."""

from __future__ import annotations

import hashlib
import json

from pydantic import Field

from . import generation as G
from .models import Episode, GenerationOptions, Panel, PanelOverrides, Series, StrictModel
from .render_models import RenderProfile


class WorkflowTrialRequest(StrictModel):
    instance_id: str | None = None
    prompt: str = Field(min_length=1, max_length=8000)
    negative_prompt: str = Field(default="", max_length=8000)
    width: int | None = Field(default=None, ge=64, le=8192)
    height: int | None = Field(default=None, ge=64, le=8192)
    values: dict[str, object] = Field(default_factory=dict)
    overrides: dict[str, object] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)


class WorkflowTrialResult(StrictModel):
    series: Series
    episode: Episode
    job: dict[str, object]


def trial(ctx, workflow_id: str, body: WorkflowTrialRequest) -> WorkflowTrialResult:
    request = {"workflow_id": workflow_id, **body.model_dump(exclude={"idempotency_key"})}
    sha = hashlib.sha256(
        json.dumps(request, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    key = f"workflow-trial:{body.idempotency_key}" if body.idempotency_key else None
    with ctx.store.tx():
        previous = ctx.store.assembly_receipt(key, sha) if key else None
        if previous:
            series, episode = previous
        else:
            doc = ctx.store.get_doc("workflow", workflow_id)
            if body.instance_id:
                instance = ctx.store.get_doc("instance", body.instance_id)
                if not instance.enabled:
                    raise ValueError("所选 ComfyUI 实例已停用")
            series = Series(title=f"{doc.name} · 试生成", subtitle="工作流试生成")
            episode = Episode(
                series_id=series.id,
                title="试生成",
                order=0,
                panels=[
                    Panel(
                        order=0,
                        description=body.prompt,
                        overrides=PanelOverrides(
                            raw_prompt=body.prompt,
                            raw_negative=body.negative_prompt,
                        ),
                    )
                ],
            )
            G.attach(
                ctx.store,
                series,
                episode,
                GenerationOptions(
                    workflow_id=workflow_id,
                    candidates=1,
                    width=body.width,
                    height=body.height,
                ),
            )
            profile = RenderProfile.model_validate(series.generation.profile)
            profile.instances = [body.instance_id] if body.instance_id else []
            profile.draft[0].values = {**body.values, "batch": 1}
            profile.draft[0].overrides = dict(body.overrides)
            series.generation.profile = profile.model_dump()
            series.generation.profiles[profile.id] = profile.model_dump()
            series, episode = ctx.store.create_assembly(
                series, episode, idempotency_key=key, request_sha=sha
            )
    ctx.queue.track(series.id)
    job = ctx.render.render(episode.id, candidates=1, adopt_first=True, idempotency_key=key)
    return WorkflowTrialResult(series=series, episode=episode, job=job)
