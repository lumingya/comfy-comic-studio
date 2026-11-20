"""Assemble a storyboard and optionally submit its first render job."""

from __future__ import annotations

from typing import Annotated

from fastapi import Request, status
from pydantic import Field, StringConstraints, model_validator

from .. import workshop
from ..auth import AuthError
from ..comfy.slot_adapters import installed
from ..jobs import JobError
from ..models import Episode, GenerationOptions, Series, StrictModel
from ..slot_models import TaskLoRASelection, TaskSlotOverrides, task_slots
from ..storage import Conflict
from .deps import Ctx
from .operations import Router

router = Router(tags=["workshop"])
Identifier = Annotated[str, StringConstraints(min_length=1, max_length=256)]
VariableKey = Annotated[str, StringConstraints(min_length=1, max_length=256)]
VariableValue = Annotated[str, StringConstraints(max_length=8000)]


class TaskGeneration(GenerationOptions):
    workflow_id: Identifier | None = None
    cloud_channel_id: Annotated[str, StringConstraints(max_length=256)] | None = None
    profile_id: Identifier | None = None


class WorkshopTaskRequest(StrictModel):
    storyboard_id: Identifier
    preset_ids: list[Identifier] = Field(default_factory=list, max_length=128)
    title: str = Field(default="", max_length=120)
    workflow_id: Identifier | None = None
    profile_id: Identifier | None = None
    cloud_channel: str | None = Field(default=None, max_length=256)
    generation: TaskGeneration | None = None
    variables: dict[VariableKey, VariableValue] = Field(default_factory=dict, max_length=128)
    loras: list[TaskLoRASelection] = Field(default_factory=list, max_length=128)
    slot_overrides: TaskSlotOverrides | None = None
    auto_start: bool = False
    adopt_first: bool = False
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)

    def generation_options(self) -> GenerationOptions | None:
        data = self.generation.model_dump(exclude_unset=True) if self.generation else {}
        for key, value in (
            ("workflow_id", self.workflow_id),
            ("profile_id", self.profile_id),
            ("cloud_channel_id", self.cloud_channel),
        ):
            if value is None:
                continue
            if data.get(key) not in (None, value):
                raise ValueError("请选择一个出图来源")
            data[key] = value
        return GenerationOptions.model_validate(data) if data else None

    @model_validator(mode="after")
    def one_source(self):
        self.generation_options()
        if self.adopt_first and not self.auto_start:
            raise ValueError("自动采用需要同时启用自动出图")
        return self


class WorkshopTaskResult(StrictModel):
    series: Series
    episode: Episode
    job: dict | None = None
    job_id: str | None = None
    start_error: str | None = None


@router.post(
    "/workshop/tasks",
    status_code=status.HTTP_201_CREATED,
    response_model=WorkshopTaskResult,
    openapi_extra={"x-mio-conditional-scopes": {"auto_start": ["render"]}},
)
def create_workshop_task(
    ctx: Ctx, body: WorkshopTaskRequest, request: Request
) -> WorkshopTaskResult:
    """Assemble an album with write scope. Auto-start also requires render scope.

    A planning failure returns the assembled album with start_error. Retry the same request
    with its original idempotency key to start that album after resolving the problem.
    """
    token = getattr(request.state, "api_token", None)
    if body.auto_start and token is not None and "render" not in token.scopes:
        raise AuthError("令牌缺少权限：render", 403)
    receipt_key = None
    if body.idempotency_key is not None:
        receipt_key = f"workshop-task:{body.idempotency_key}"
    with ctx.engine.hold_operation():
        series, episode = workshop.assemble(
            ctx.store,
            body.storyboard_id,
            body.preset_ids,
            body.title,
            variables=body.variables,
            idempotency_key=receipt_key,
            generation=body.generation_options(),
            slot_overrides=task_slots(body.slot_overrides, body.loras),
            slot_adapters=installed(ctx.registry),
            task_intent={"auto_start": body.auto_start, "adopt_first": body.adopt_first},
        )
        ctx.queue.track(series.id)
        if not body.auto_start:
            return WorkshopTaskResult(series=series, episode=episode)
        job_id = ctx.store.workshop_launch(episode.id)
        if job_id is not None:
            return WorkshopTaskResult(
                series=series, episode=episode, job_id=job_id, job=ctx.engine.get(job_id)
            )
        job_key = f"workshop-task-render:{episode.id}"
        previous = ctx.engine.find_submission(job_key)
        if previous is not None:
            if previous["owner"] != episode.id or previous["kind"] not in (
                "comfy.render",
                "cloud.render",
            ):
                raise Conflict("出图请求标识已被占用")
            job = previous
        else:
            try:
                job = ctx.render.render(
                    episode.id, idempotency_key=job_key, adopt_first=body.adopt_first
                )
            except (ValueError, JobError) as exc:
                return WorkshopTaskResult(series=series, episode=episode, start_error=str(exc))
        ctx.store.record_workshop_launch(episode.id, job["id"])
        return WorkshopTaskResult(series=series, episode=episode, job_id=job["id"], job=job)
