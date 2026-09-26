"""Deterministic script assistant used until the LLM reviewer UI is wired in.

It returns an explicit diff object so the React UI can show what will be inserted before applying it.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from .models import Dialogue, DialogueKind, Episode, Panel


class ScriptRequest(BaseModel):
    idea: str
    panel_count: int = Field(default=12, ge=4, le=60)


class ScriptDiff(BaseModel):
    summary: str
    added_panels: list[Panel]
    episode: Episode


def plan_episode(series_id: str, title: str, request: ScriptRequest) -> ScriptDiff:
    beats = [part.strip(" ，。.!?？") for part in request.idea.replace("\n", " ").split("，") if part.strip()]
    if not beats:
        beats = [request.idea.strip() or "新的故事"]
    panels = []
    for i in range(request.panel_count):
        beat = beats[i % len(beats)]
        panels.append(Panel(order=i, shot="wide" if i % 5 == 0 else "close" if i % 5 == 3 else "medium",
                            description=f"{beat}（第 {i + 1} 格）",
                            dialogues=[Dialogue(kind=DialogueKind.narration, text=beat[:48])]))
    episode = Episode(series_id=series_id, title=title, order=0, panels=panels)
    return ScriptDiff(summary=f"将创建 {len(panels)} 格结构化剧本，来源：{request.idea[:40]}", added_panels=panels, episode=episode)
