"""创作工坊 (the legacy "assembly workshop"): independent storyboards and presets, assembled
into albums.

* **分镜** (storyboards) are the episodes of one hidden series of ``kind="workshop"``; they belong
  to no book and name no character – prompts use ``{变量}`` such as ``{character}``.
* **预设** (presets) are named sets of variable values stored on that series (``Series.presets``).
* **装配** copies one storyboard plus the merged values of the chosen presets into a new album
  (``kind="album"``, status ``draft`` = waiting in the queue).  The copy is a snapshot: editing
  the storyboard or a preset later never changes an album that was already assembled.

On first use the workshop is seeded from the legacy ``data/`` directory (its storyboards and
character presets), so the old 分镜工坊 / 预设工坊 content is where the user left it.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

from .assembly import AssemblyPreview, build_snapshot, inspect_snapshot
from .models import (
    Episode,
    Panel,
    PanelOverrides,
    Preset,
    PresetBinding,
    PresetEntry,
    PresetGroup,
    Series,
)
from .storage import NotFound

log = logging.getLogger("mio.workshop")

WORKSHOP_TITLE = "创作工坊"
# ``Series.subtitle`` of the one-frame albums made by 预设工坊「独立试绘」 (the preset page lists them).
PREVIEW_SUBTITLE = "预设试绘"

# Labels / hints the legacy 预设工坊 shows for its well-known variables.
LABELS: dict[str, tuple[str, str]] = {
    "character_display_name": ("角色展示名 / 旁白", "旁白显示名，例如「七海」。"),
    "character": ("角色名 / 提示词", "角色提示词，例如 nanami。"),
    "outfit": ("服装", "服装提示词，例如 white shirt, navy skirt。"),
    "style": ("画风", "画风提示词，例如 cinematic anime illustration。"),
    "scene": ("场景与环境", "场景提示词，例如 a quiet coastal town in summer。"),
    "weapon": ("道具", "可留空。"),
    "lora": ("LoRA", "可留空。"),
}


def entry(key: str, value: str = "", group_id: str | None = None) -> PresetEntry:
    label, hint = LABELS.get(key, ("", ""))
    return PresetEntry(key=key, value=value, label=label, hint=hint, group_id=group_id)


def default_preset(title: str = "默认预设") -> Preset:
    people = PresetGroup(id="group-character", title="主角与服装")
    visual = PresetGroup(id="group-visual", title="画风与场景")
    return Preset(
        title=title,
        groups=[people, visual],
        entries=[
            entry("character_display_name", "", people.id),
            entry("character", "", people.id),
            entry("outfit", "", people.id),
            entry("style", "", visual.id),
            entry("scene", "", visual.id),
        ],
    )


def preset_from_legacy(data: dict) -> Preset:
    groups = [
        PresetGroup(id=str(g["id"]), title=str(g.get("title") or g["id"]))
        for g in data.get("settingsGroups") or []
        if isinstance(g, dict) and g.get("id")
    ]
    known = {g.id for g in groups}
    entries = []
    for e in data.get("entries") or []:
        if not isinstance(e, dict) or not e.get("key") or e.get("type", "text") != "text":
            continue
        group = str(e.get("groupId") or "") or None
        try:
            entries.append(
                entry(str(e["key"]), str(e.get("value") or ""), group if group in known else None)
            )
        except ValueError:  # a key the variable syntax can't express
            continue
    bindings = []
    for b in data.get("bindings") or []:
        if not isinstance(b, dict) or b.get("source", "literal") not in ("literal", "variable"):
            continue
        try:
            binding = PresetBinding(
                node_id=str(b.get("nodeId") or ""),
                path=str(b.get("path") or ""),
                source=b.get("source") or "literal",
                type=b.get("type") or "auto",
                value=str(b.get("value") if b.get("value") is not None else ""),
                enabled=bool(b.get("enabled", True)),
            )
        except ValueError:  # an incomplete legacy row
            continue
        # A second enabled binding of the same input was never applied by the legacy app either.
        if binding.enabled and any(x.enabled and x.pointer == binding.pointer for x in bindings):
            binding.enabled = False
        bindings.append(binding)
    return Preset(
        title=str(data.get("title") or data["id"]),
        groups=groups,
        entries=entries,
        bindings=bindings,
    )


def _legacy_assets(store, series_id: str, root: Path) -> None:
    from .importer import _load_dir, _safe_id, convert_frame

    warnings: list[str] = []
    for order, board in enumerate(_load_dir(root, "storyboards")):
        panels = [
            convert_frame(f, i, {}, warnings)
            for i, f in enumerate(board.get("frames") or [])
            if isinstance(f, dict)
        ]
        store.create_episode(
            Episode(
                id=_safe_id("board", str(board["id"])),
                series_id=series_id,
                title=str(board.get("title") or board["id"]),
                order=order,
                synopsis=str(board.get("outline") or ""),
                base_prompt=str(board.get("basePrompt") or ""),
                panels=panels,
            )
        )


def find_workshop(store) -> Series | None:
    return next((s for s in store.list_series() if s.kind == "workshop"), None)


def ensure_workshop(store, root: str | Path | None = None) -> Series:
    """Seed once even when several browser tabs open the workshop simultaneously."""
    with store.lock:
        return _ensure_workshop(store, root)


def _ensure_workshop(store, root: str | Path | None = None) -> Series:
    found = find_workshop(store)
    if found:
        return found
    from .importer import LEGACY_ROOT, _load_dir

    root = Path(root) if root else LEGACY_ROOT
    presets = []
    if root.is_dir():
        for data in _load_dir(root, "presets/characters"):
            try:
                presets.append(preset_from_legacy(data))
            except ValueError as exc:
                log.warning("skipped legacy preset %s: %s", data.get("id"), exc)
    series = store.create_series(
        Series(title=WORKSHOP_TITLE, kind="workshop", presets=presets or [default_preset()])
    )
    if root.is_dir():
        _legacy_assets(store, series.id, root)
    if not store.list_episodes(series.id):
        store.create_episode(Episode(series_id=series.id, title="第一个分镜", order=0))
    return store.get_series(series.id)


def assemble(
    store,
    storyboard_id: str,
    preset_ids: list[str],
    title: str,
    profile_id: str | None = None,
    variables: dict[str, str] | None = None,
    idempotency_key: str | None = None,
) -> tuple[Series, Episode]:
    """Storyboard + presets → a new album waiting in the queue (no model is called)."""
    request = {
        "storyboard_id": storyboard_id,
        "preset_ids": preset_ids,
        "title": title,
        "profile_id": profile_id,
        "variables": variables or {},
    }
    request_sha = hashlib.sha256(
        json.dumps(request, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()
    with store.lock:
        if idempotency_key:
            previous = store.assembly_receipt(idempotency_key, request_sha)
            if previous:
                return previous
        snapshot = _assembly_snapshot(
            store, storyboard_id, preset_ids, title, profile_id, variables
        )
        return store.create_assembly(
            snapshot.series,
            snapshot.episode,
            idempotency_key=idempotency_key,
            request_sha=request_sha,
        )


def _assembly_snapshot(store, storyboard_id, preset_ids, title, profile_id, variables):
    workshop = find_workshop(store)
    if workshop is None:
        raise NotFound("workshop not found")
    snapshot = build_snapshot(
        workshop, store.get_episode(storyboard_id), preset_ids, title, profile_id, variables
    )
    if snapshot.series.default_profile_id:
        store.get_doc("profile", snapshot.series.default_profile_id)
    return snapshot


def assembly_preview(
    store,
    storyboard_id: str,
    preset_ids: list[str],
    title: str = "",
    profile_id: str | None = None,
    variables: dict[str, str] | None = None,
) -> AssemblyPreview:
    """Inspect the same prospective album as assemble, without writes or remote calls."""
    with store.lock:
        snapshot = _assembly_snapshot(
            store, storyboard_id, preset_ids, title, profile_id, variables
        )
        return inspect_snapshot(store, snapshot, storyboard_id)


def preview(
    store,
    preset_ids: list[str],
    prompt: str,
    title: str = "",
    profile_id: str | None = None,
    *,
    source_id: str | None = None,
) -> tuple[Series, Episode]:
    """预设工坊「独立试绘」: one prompt + the chosen presets → a one-frame album waiting in the
    queue (no storyboard involved).  The legacy workshop used it to check a character or style
    preset on its own; the album is marked with ``subtitle = PREVIEW_SUBTITLE`` so the preset page
    can list its results."""
    with store.tx():
        workshop = store.get_series(source_id) if source_id else ensure_workshop(store)
        if source_id and workshop.kind != "kit":
            raise NotFound(f"creation kit not found: {source_id}")
        return _preview_source(store, workshop, preset_ids, prompt, title, profile_id)


def _preview_source(store, workshop, preset_ids, prompt, title, profile_id):
    """Freeze the selected resource source and both new records in the caller's transaction."""
    by_id = {p.id: p for p in workshop.presets}
    missing = [pid for pid in preset_ids if pid not in by_id]
    if missing:
        raise NotFound(f"preset not found: {missing[0]}")
    if not preset_ids:
        raise ValueError("请先选择要试绘的预设")
    text = prompt.strip()
    if not text:
        raise ValueError("请先填写画面描述")
    chosen_profile = profile_id or workshop.default_profile_id
    if chosen_profile:
        store.get_doc("profile", chosen_profile)
    variables = dict(workshop.variables)
    for pid in preset_ids:
        variables.update(by_id[pid].variables())
    first = by_id[preset_ids[0]]
    album = store.create_series(
        Series(
            title=(title.strip() or f"{first.title} · 试绘")[:120],
            subtitle=PREVIEW_SUBTITLE,
            kind="album",
            presets=[by_id[pid].model_copy(deep=True) for pid in preset_ids],
            bible=workshop.bible.model_copy(deep=True),
            variants=[v.model_copy(deep=True) for v in workshop.variants],
            variables=variables,
            default_profile_id=chosen_profile,
        )
    )
    # Raw mode keeps the ``{变量}`` prompt as written; a fixed seed makes presets comparable.
    panel = Panel(order=0, description=text, overrides=PanelOverrides(raw_prompt=text, seed=1))
    episode = store.create_episode(
        Episode(series_id=album.id, title="试绘", order=0, synopsis=text, panels=[panel])
    )
    return album, episode


def clone_task(store, series_id: str, title: str = "") -> tuple[Series, Episode]:
    """装配队列「克隆」: copy a queued album's frozen frames, presets, variables and profile into a
    new standby album.  Images, candidates and the cover are not copied (nothing is generated)."""
    source = store.get_series(series_id)
    if source.kind != "album":
        raise NotFound(f"album not found: {series_id}")
    items, _ = store.episode_summaries(series_id, 0, 1)
    if not items:
        raise NotFound(f"album has no storyboard: {series_id}")
    board = store.get_episode(items[0]["id"])
    album = store.create_series(
        Series(
            title=(title.strip() or f"{source.title} 副本")[:120],
            subtitle=source.subtitle,
            kind="album",
            presets=[p.model_copy(deep=True) for p in source.presets],
            bible=source.bible.model_copy(deep=True),
            variants=[v.model_copy(deep=True) for v in source.variants],
            variables=dict(source.variables),
            default_profile_id=source.default_profile_id,
        )
    )
    panels = [Panel.model_validate(p.model_dump()) for p in board.ordered_panels()]
    episode = store.create_episode(
        Episode(
            series_id=album.id,
            title=board.title,
            order=0,
            synopsis=board.synopsis,
            base_prompt=board.base_prompt,
            panels=panels,
            strip=board.strip.model_copy(deep=True),
        )
    )
    return album, episode
