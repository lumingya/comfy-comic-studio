"""One-time importer: legacy ``data/`` (schema ``mio.resource.v2``) → v3 documents.

* collections / ``projectId`` → :class:`Series` (title from the collection);
* character presets → ``Series.variables`` (every entry, so legacy ``{变量}`` prompts render the
  same) and, when a preset names a character (``character_display_name``), a bible character;
* storyboards → :class:`Episode`; frames become panels in **raw mode** (the legacy prompt is
  kept verbatim, variables included), size / seed / steps / cfg / denoise carried over, legacy
  ``nodeOverrides`` (keyed by binding id) turned into JSON Pointer overrides;
* workflows → :class:`WorkflowDoc` with the legacy mapping / bindings as JSON Pointer mappings,
  fixed-value bindings as overrides and the ``workflow_slots`` plan preserved.

The legacy files are only read.  Importing twice is safe: ids are derived from legacy ids, and
existing documents are skipped unless ``overwrite`` is set.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

from .models import Character, Dialogue, DialogueKind, Episode, Panel, PanelOverrides, Series
from .render_models import WorkflowConfig, WorkflowDoc
from .storage import NotFound

SHOTS = [
    ("extreme close", "extreme_close"),
    ("close", "close"),
    ("cowboy", "cowboy"),
    ("medium", "medium"),
    ("full", "full"),
    ("long", "wide"),
    ("wide", "wide"),
    ("establish", "wide"),
]
SCENE_PARAMS = {"seed", "steps", "cfg", "denoise", "width", "height", "sampler", "scheduler"}
FRAME_DEFAULTS = {"steps": 24, "cfg": 7, "denoise": 1}


@dataclass
class ImportReport:
    series: list[str] = field(default_factory=list)
    episodes: list[str] = field(default_factory=list)
    workflows: list[str] = field(default_factory=list)
    characters: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return self.__dict__.copy()


def _load_dir(root: Path, sub: str) -> list[dict]:
    out = []
    for path in sorted((root / sub).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and data.get("id"):
            out.append(data)
    return out


def _safe_id(prefix: str, legacy_id: str) -> str:
    return f"{prefix}_{re.sub(r'[^A-Za-z0-9_-]', '_', legacy_id)[:48]}"


def shot_of(camera: str) -> str:
    low = (camera or "").lower()
    return next((v for k, v in SHOTS if k in low), "medium")


def ratio_of(width, height) -> str:
    try:
        w, h = int(width), int(height)
    except (TypeError, ValueError):
        return "2:3"
    if w <= 0 or h <= 0:
        return "2:3"
    g = math.gcd(w, h)
    w, h = w // g, h // g
    return f"{w}:{h}" if max(w, h) <= 64 else f"{round(w / h * 100)}:100"


def pointer(node: str, field_name: str) -> str:
    return f"/{node}/inputs/{field_name}"


def convert_workflow(data: dict) -> tuple[WorkflowDoc, dict[str, str], list[str]]:
    """Legacy workflow → ``(doc, binding id → pointer, warnings)``."""
    graph = data.get("workflow") or {}
    warnings: list[str] = []
    mapping: dict[str, list[str]] = {}
    overrides: dict[str, object] = {}
    by_binding: dict[str, str] = {}

    def add(kind: str, node: str, field_name: str) -> None:
        if node in graph and field_name in (graph[node].get("inputs") or {}):
            ptr = pointer(node, field_name)
            if ptr not in mapping.setdefault(kind, []):
                mapping[kind].append(ptr)

    m = data.get("mapping") or {}
    if m.get("positive"):
        add("prompt", str(m["positive"]), m.get("positiveField") or "text")
    if m.get("negative"):
        add("negative", str(m["negative"]), m.get("negativeField") or "text")
    if m.get("sampler"):
        node = str(m["sampler"])
        for kind, fields in (
            ("seed", ("seed", "noise_seed")),
            ("steps", ("steps",)),
            ("cfg", ("cfg",)),
            ("denoise", ("denoise",)),
        ):
            for f in fields:
                add(kind, node, f)
    if m.get("size"):
        add("width", str(m["size"]), "width")
        add("height", str(m["size"]), "height")
    if m.get("image"):
        add("init", str(m["image"]), "image")
    for b in data.get("bindings") or []:
        node, path = str(b.get("nodeId") or ""), str(b.get("path") or "")
        if not node or not path or node not in graph:
            continue
        by_binding[str(b.get("id"))] = pointer(node, path)
        if not b.get("enabled", True):
            continue
        source, value = b.get("source"), b.get("value")
        if source in ("positive", "negative"):
            add("prompt" if source == "positive" else "negative", node, path)
        elif source == "sceneParameter" and value in SCENE_PARAMS:
            add(str(value), node, path)
        elif source == "variable" and value:
            add(f"var.{str(value).strip('{}')}", node, path)
        elif source == "literal":
            overrides[pointer(node, path)] = value
        else:
            warnings.append(
                f"工作流 {data.get('title')}：绑定 {b.get('label') or path} 的来源 {source} 未导入"
            )
    out_node = str(data.get("outputNodeId") or m.get("output") or "")
    if out_node in graph:
        meta = graph[out_node].setdefault("_meta", {})
        if "[mio:output" not in meta.get("title", ""):
            meta["title"] = (meta.get("title", "") + " [mio:output]").strip()
    slots = (data.get("slots") or {}).get("plan") if isinstance(data.get("slots"), dict) else None
    doc = WorkflowDoc(
        id=_safe_id("wf", str(data["id"]).removeprefix("wf_")),
        name=str(data.get("title") or data["id"]),
        graph=graph,
        config=WorkflowConfig(mapping=mapping, overrides=overrides),
        slots=slots,
        source="legacy",
        notes=f"导入自旧版工作流 {data['id']}",
    )
    return doc, by_binding, warnings


def convert_frame(
    frame: dict, order: int, binding_ptrs: dict[str, str], warnings: list[str]
) -> Panel:
    values = {
        k: frame[k]
        for k in ("steps", "cfg", "denoise")
        if isinstance(frame.get(k), (int, float)) and frame[k] != FRAME_DEFAULTS[k]
    }
    node_overrides = {}
    for bid, value in (frame.get("nodeOverrides") or {}).items():
        if bid in binding_ptrs:
            node_overrides[binding_ptrs[bid]] = value
        else:
            warnings.append(
                f"分镜 {frame.get('name')}：节点覆盖 {bid} 找不到对应工作流绑定，已跳过"
            )
    seed = frame.get("seed")
    width, height = frame.get("width"), frame.get("height")
    size_ok = all(isinstance(v, int) and 64 <= v <= 4096 for v in (width, height))
    overrides = PanelOverrides(
        raw_prompt=str(frame.get("prompt") or ""),
        raw_negative=str(frame["negative"]) if frame.get("negative") else None,
        seed=seed if isinstance(seed, int) and seed >= 0 else None,
        width=width if size_ok else None,
        height=height if size_ok else None,
        values=values,
        node_overrides=node_overrides,
    )
    caption = str(frame.get("caption") or "").strip()
    return Panel(
        order=order,
        shot=shot_of(frame.get("camera", "")),
        description=str(frame.get("name") or ""),
        aspect_ratio=ratio_of(width, height),
        dialogues=[Dialogue(text=caption, kind=DialogueKind.narration)] if caption else [],
        overrides=overrides,
    )


def character_from_preset(preset: dict, variables: dict[str, str]) -> Character | None:
    name = variables.get("character_display_name")
    if not name:
        return None
    tags = [t.strip() for t in (variables.get("character") or "").split(",") if t.strip()]
    outfit = [t.strip() for t in (variables.get("outfit") or "").split(",") if t.strip()]
    return Character(
        id=_safe_id("char", str(preset["id"])),
        name=name,
        age=20,
        tag_description=tags,
        outfits={"default": outfit} if outfit else {},
        description="导入自旧版预设（年龄为默认值，请核对）",
    )


class LegacyImporter:
    def __init__(self, store, root: str | Path):
        self.store = store
        self.root = Path(root)

    def scan(self) -> dict:
        return {
            sub: len(_load_dir(self.root, sub))
            for sub in ("collections", "storyboards", "presets/characters", "workflows")
        }

    def run(self, overwrite: bool = False) -> ImportReport:
        report = ImportReport()
        binding_ptrs: dict[str, str] = {}
        for data in _load_dir(self.root, "workflows"):
            if not isinstance(data.get("workflow"), dict) or not data["workflow"]:
                report.skipped.append(f"workflow {data['id']}（没有 API 格式工作流）")
                continue
            try:
                doc, ptrs, warns = convert_workflow(data)
            except ValueError as exc:
                report.skipped.append(f"workflow {data['id']}：{exc}")
                continue
            binding_ptrs.update(ptrs)
            report.warnings += warns
            if overwrite or not self._exists("workflow", doc.id):
                self.store.put_doc(doc)
                report.workflows.append(doc.id)
        titles = {c["id"]: c.get("title") for c in _load_dir(self.root, "collections")}
        presets = _load_dir(self.root, "presets/characters")
        boards = _load_dir(self.root, "storyboards")
        projects = sorted({str(x.get("projectId") or "default") for x in presets + boards})
        for project in projects:
            self._import_project(project, titles, presets, boards, binding_ptrs, overwrite, report)
        return report

    def _exists(self, kind: str, doc_id: str) -> bool:
        try:
            self.store.get_doc(kind, doc_id)
            return True
        except NotFound:
            return False

    def _import_project(self, project, titles, presets, boards, ptrs, overwrite, report) -> None:
        series_id = _safe_id("series", project)
        mine = [p for p in presets if str(p.get("projectId") or "default") == project]
        variables: dict[str, str] = {}
        characters = []
        for preset in mine:
            entries = {
                str(e["key"]): str(e.get("value") or "")
                for e in preset.get("entries") or []
                if e.get("key") and e.get("type", "text") == "text"
            }
            variables.update(entries)
            ch = character_from_preset(preset, entries)
            if ch and ch.id not in {c.id for c in characters}:
                characters.append(ch)
        try:
            existing = self.store.get_series(series_id, include_deleted=True)
        except NotFound:
            existing = None
        if existing and not overwrite:
            report.skipped.append(f"series {series_id}（已导入）")
            return
        if existing:
            self.store.delete_series(series_id)
        series = Series(id=series_id, title=titles.get(project) or project, variables=variables)
        series.bible.characters = characters
        self.store.create_series(series)
        report.series.append(series_id)
        report.characters += [c.id for c in characters]
        order = 0
        for board in boards:
            if str(board.get("projectId") or "default") != project:
                continue
            panels = [
                convert_frame(f, i, ptrs, report.warnings)
                for i, f in enumerate(board.get("frames") or [])
                if isinstance(f, dict)
            ]
            episode = Episode(
                id=_safe_id("episode", str(board["id"])),
                series_id=series_id,
                title=str(board.get("title") or board["id"]),
                order=order,
                synopsis=str(board.get("outline") or ""),
                panels=panels,
            )
            self.store.create_episode(episode)
            report.episodes.append(episode.id)
            order += 1
