"""Bounded LoRA selections shared by workshop and creation-kit assembly."""

from typing import Annotated

from pydantic import AllowInfNan, Field, StringConstraints, model_validator

from .comfy import workflow_slots as slots
from .models import StrictModel

SlotKey = Annotated[str, StringConstraints(min_length=1, max_length=512)]
Strength = Annotated[float, AllowInfNan(False), Field(ge=-100, le=100)]


class TaskLoRA(StrictModel):
    name: str = Field(min_length=1, max_length=300)
    key: SlotKey | None = None
    strength: Strength | None = None
    clip: Strength | None = None
    enabled: bool | None = None


class TaskLoRASelection(TaskLoRA):
    group_key: SlotKey | None = None

    @model_validator(mode="after")
    def pinned_address(self):
        if bool(self.group_key) != bool(self.key):
            raise ValueError("LoRA 固定槽位需要同时提供组标识和条目标识")
        return self


class TaskLoRAGroup(StrictModel):
    key: SlotKey
    loras: list[TaskLoRA] = Field(max_length=slots.MAX_LORAS)


class TaskSlotOverrides(StrictModel):
    loras: list[TaskLoRA] = Field(default_factory=list, max_length=slots.MAX_LORAS)
    groups: list[TaskLoRAGroup] = Field(default_factory=list, max_length=64)


def task_slots(overrides: TaskSlotOverrides | None, loras: list[TaskLoRASelection]) -> dict:
    source = overrides.model_dump(exclude_none=True, exclude_unset=True) if overrides else {}
    by_group: dict[str, list[dict]] = {}
    additions: list[dict] = []
    for item in loras:
        value = item.model_dump(exclude={"group_key"}, exclude_none=True, exclude_unset=True)
        if item.group_key:
            by_group.setdefault(item.group_key, []).append(value)
        else:
            additions.append(value)
    group_overrides = [{"key": key, "loras": values} for key, values in by_group.items()]
    selections = {
        **({"groups": group_overrides} if group_overrides else {}),
        **({"loras": additions} if additions else {}),
    }
    return slots.merge_overrides(source, selections)
