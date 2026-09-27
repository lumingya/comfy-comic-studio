"""One-time importer: legacy ``data/`` (schema ``mio.resource.v2``) → v3 documents.

* collections / ``projectId`` → :class:`Series` (title from the collection);
* character presets → ``Series.variables`` (every entry, so legacy ``{变量}`` prompts render the
  same) and, when a preset names a character (``character_display_name``), a bible character;
* storyboards → :class:`Episode`; frames become panels in **raw mode** (the legacy prompt is
  kept verbatim, variables included), size / seed / steps / cfg / denoise carried over, legacy
  ``nodeOverrides`` (keyed by binding id) turned into JSON Pointer overrides;
* workflows → :class:`WorkflowDoc` with the legacy mapping / bindings as JSON Pointer mappings,
  fixed-value bindings as overrides and the ``workflow_slots`` plan preserved;
* albums (finished books, ``albums/<name>/album.json`` plus ``images/``) → one :class:`Series`
  each, with a single episode whose panels carry the legacy frames and whose images come in as
  adopted takes, so the first picture is the cover.  The legacy collection name (画册集) becomes
  ``collection_title``.  :func:`seed_albums` does this once on first start, so the default shelf
  is the old one (the bundled 「遇见你，真好」 with 《海风与未寄出的信》) rather than an empty one.

The legacy files are only read.  Importing twice is safe: ids are derived from legacy ids, and
existing documents are skipped unless ``overwrite`` is set.
"""

from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .models import (
    Character,
    Dialogue,
    DialogueKind,
    Episode,
    Panel,
    PanelOverrides,
    Series,
    SeriesStatus,
    Take,
    TakeStatus,
)
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
log = logging.getLogger("mio.importer")
# Repository ``data/`` (the legacy app's data directory, bundled seed album included).
LEGACY_ROOT = Path(__file__).resolve().parents[2] / "data"
# characterName values that mean "no named character" in the legacy app.
ANONYMOUS = {"", "原创", "原创画册"}
SCENE_PARAMS = {"seed", "steps", "cfg", "denoise", "width", "height", "sampler", "scheduler"}
FRAME_DEFAULTS = {"steps": 24, "cfg": 7, "denoise": 1}


@dataclass
class ImportReport:
    series: list[str] = field(default_factory=list)
    episodes: list[str] = field(default_factory=list)
    albums: list[str] = field(default_factory=list)
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


def _load_albums(root: Path) -> list[tuple[Path, dict]]:
    """``albums/<name>/album.json`` (one folder per book, images beside it)."""
    out = []
    for path in sorted((root / "albums").glob("*/album.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and data.get("id") and not data.get("deletedAt"):
            out.append((path.parent, data))
    return out


def _iso(ms) -> str | None:
    if not isinstance(ms, (int, float)) or ms <= 0:
        return None
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat(timespec="seconds")


def legacy_collection(root: str | Path) -> str | None:
    """Name of the legacy app's active collection (画册集), else of the one holding most books."""
    root = Path(root)
    titles = {c["id"]: str(c.get("title") or "") for c in _load_dir(root, "collections")}
    active = None
    try:
        ws = json.loads((root / "settings" / "workspace.json").read_text(encoding="utf-8"))
        active = ((ws.get("ui") or {}).get("comfyStudio") or {}).get("activeProjectId")
    except (OSError, ValueError, AttributeError):
        pass
    if active and titles.get(active):
        return titles[active]
    counts: dict[str, int] = {}
    for _, album in _load_albums(root):
        pid = str(album.get("projectId") or "")
        counts[pid] = counts.get(pid, 0) + 1
    for pid in sorted(counts, key=lambda k: -counts[k]):
        if titles.get(pid):
            return titles[pid]
    return next((t for t in titles.values() if t), None)


class LegacyImporter:
    def __init__(self, store, root: str | Path, assets=None):
        self.store = store
        self.root = Path(root)
        self.assets = assets

    def scan(self) -> dict:
        found = {
            sub: len(_load_dir(self.root, sub))
            for sub in ("collections", "storyboards", "presets/characters", "workflows")
        }
        found["albums"] = len(_load_albums(self.root))
        return found

    def import_albums(self, report: ImportReport | None = None, overwrite: bool = False):
        """Every legacy book → a series with one episode; images become adopted takes."""
        report = report or ImportReport()
        if self.assets is None:
            return report
        for folder, album in _load_albums(self.root):
            self._import_album(folder, album, overwrite, report)
        return report

    def _import_album(self, folder: Path, album: dict, overwrite: bool, report) -> None:
        legacy_id = str(album["id"])
        series_id = _safe_id("series_album", legacy_id)
        try:
            existing = self.store.get_series(series_id, include_deleted=True)
        except NotFound:
            existing = None
        if existing and not overwrite:
            report.skipped.append(f"album {legacy_id}（已导入）")
            return
        if existing:
            self.store.delete_series(series_id)
        steps = sorted(
            (s for s in album.get("steps") or [] if isinstance(s, dict)),
            key=lambda s: s.get("stepIndex") if isinstance(s.get("stepIndex"), int) else 0,
        )
        panels, takes = [], []
        stamp = _iso(album.get("updatedAt")) or _iso(album.get("createdAt"))
        for order, step in enumerate(steps):
            panel = convert_frame(step, order, {}, report.warnings)
            panels.append(panel)
            blob = self._image(folder, step.get("image"))
            if step.get("image") and blob is None:
                report.warnings.append(f"画册「{album.get('title')}」第 {order + 1} 幕：找不到图片")
            if blob is None or step.get("offlineFallback"):
                continue
            asset = self.assets.put(blob, source="legacy", filename=Path(step["image"]).name)
            takes.append(
                Take(
                    panel_id=panel.id,
                    asset_id=asset.id,
                    status=TakeStatus.adopted,
                    stage="final",
                    width=asset.width,
                    height=asset.height,
                    **({"created_at": stamp} if stamp else {}),
                )
            )
        created = _iso(album.get("createdAt"))
        updated = _iso(album.get("updatedAt")) or created
        name = str(album.get("characterName") or "").strip()
        series = Series(
            id=series_id,
            title=str(album.get("title") or legacy_id),
            subtitle=str(album.get("synopsis") or "").strip(),
            status=SeriesStatus.archived
            if album.get("status") == "complete"
            else SeriesStatus.draft,
            **({"created_at": created, "updated_at": updated} if created else {}),
        )
        if name not in ANONYMOUS:
            series.bible.characters = [
                Character(
                    id=_safe_id("char", str(album.get("rowId") or legacy_id)),
                    name=name,
                    age=20,
                    description="导入自旧版画册（年龄为默认值，请核对）",
                )
            ]
        self.store.create_series(series)
        episode = Episode(
            id=_safe_id("episode_album", legacy_id),
            series_id=series_id,
            title=str(album.get("storyTitle") or album.get("title") or legacy_id),
            order=0,
            synopsis=series.subtitle,
            panels=panels,
            takes=takes,
        )
        self.store.create_episode(episode)
        report.series.append(series_id)
        report.albums.append(series_id)
        report.episodes.append(episode.id)

    def _image(self, folder: Path, ref) -> bytes | None:
        if not isinstance(ref, str) or not ref or "://" in ref or ref.startswith("data:"):
            return None
        path = (folder / ref).resolve()
        if folder.resolve() not in path.parents:
            return None  # stay inside the album folder
        if not path.is_file():  # older books store the name without its extension
            matches = sorted(path.parent.glob(path.name + ".*")) if path.parent.is_dir() else []
            path = matches[0] if matches else path
        try:
            return path.read_bytes()
        except OSError:
            return None

    def run(self, overwrite: bool = False) -> ImportReport:
        report = ImportReport()
        self.import_albums(report, overwrite)
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


def seed_albums(ctx, root: str | Path = LEGACY_ROOT) -> ImportReport | None:
    """First start only: bring over the legacy books and collection name, so the default shelf is
    the one the old app had.  Runs once (``legacy_seeded``); later imports are manual."""
    from .settings import DEFAULT_COLLECTION

    settings = ctx.settings()
    root = Path(root)
    if settings.legacy_seeded or not (root / "albums").is_dir():
        return None
    report = LegacyImporter(ctx.store, root, ctx.assets).import_albums()
    title = legacy_collection(root)
    settings = ctx.settings()  # re-read: the import may take a moment
    if title and settings.collection_title == DEFAULT_COLLECTION:
        settings.collection_title = title[:80]
    settings.legacy_seeded = True
    ctx.store.put_doc(settings)
    if report.albums:
        log.info("imported %d legacy album(s) from %s", len(report.albums), root)
    return report
