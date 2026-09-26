"""Extension manifest (``mio-extension.json``) and content digest.

An extension is a folder under ``<data>/extensions/<id>/``.  Declarative contributions (themes,
album templates, SFX and slice presets) are inert data; ``main`` (Python) and ``panels`` (HTML
shown in a sandboxed iframe) are code.  Either way nothing loads until the user enables the exact
content they reviewed: enabling stores the folder's sha256 digest, and any later change to a file
turns the extension into ``changed`` until it is enabled again.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError

from ..models import StrictModel

MANIFEST = "mio-extension.json"
ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{1,47}$"
SKIP_DIRS = {"__pycache__", ".git", "node_modules"}


class SlicePresetSpec(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")
    label: str
    width: int = Field(ge=0, le=4000)
    max_height: int = Field(ge=0, le=20000)
    fmt: Literal["JPEG", "PNG", "WEBP"] = "JPEG"
    quality: int = Field(default=90, ge=40, le=100)


class PanelSpec(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")
    slot: Literal["episode", "settings"]
    title: str
    entry: str = Field(description="HTML file inside the extension folder")


class Contributes(StrictModel):
    themes: list[str] = Field(default_factory=list, description="Theme JSON files")
    album_templates: list[str] = Field(default_factory=list, description="Album template JSON")
    sfx_presets: dict[str, dict] = Field(default_factory=dict)
    slice_presets: list[SlicePresetSpec] = Field(default_factory=list)
    panels: list[PanelSpec] = Field(default_factory=list)


class Manifest(StrictModel):
    id: str = Field(pattern=ID_PATTERN)
    name: str
    version: str = "0.1.0"
    description: str = ""
    author: str = ""
    homepage: str = ""
    main: str | None = Field(default=None, description="Python entry: activate(mio) is called")
    contributes: Contributes = Field(default_factory=Contributes)

    @property
    def runs_code(self) -> bool:
        return bool(self.main or self.contributes.panels)


class ManifestError(ValueError):
    pass


def read_manifest(folder: Path) -> Manifest:
    path = folder / MANIFEST
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ManifestError(f"缺少 {MANIFEST}") from None
    except (OSError, ValueError) as exc:
        raise ManifestError(f"{MANIFEST} 不是合法的 JSON：{exc}") from None
    try:
        manifest = Manifest.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise ManifestError(f"{MANIFEST} 字段 {where}：{first['msg']}") from None
    for rel in [manifest.main or "", *manifest.contributes.themes]:
        if rel:
            inside(folder, rel)
    for rel in manifest.contributes.album_templates + [
        p.entry for p in manifest.contributes.panels
    ]:
        inside(folder, rel)
    return manifest


def inside(folder: Path, rel: str) -> Path:
    """Resolve ``rel`` inside ``folder``; refuse absolute paths and ``..`` escapes."""
    root = folder.resolve()
    target = (root / rel).resolve()
    if rel.startswith(("/", "\\")) or (target != root and root not in target.parents):
        raise ManifestError(f"路径超出扩展目录：{rel}")
    return target


def files(folder: Path) -> list[Path]:
    out = []
    for path in sorted(folder.rglob("*")):
        rel = path.relative_to(folder)
        if any(part in SKIP_DIRS for part in rel.parts) or path.suffix in (".pyc", ".pyo"):
            continue
        if path.is_file():
            out.append(path)
    return out


def digest(folder: Path) -> str:
    """sha256 over every file's relative path and bytes (order-independent of the filesystem)."""
    h = hashlib.sha256()
    for path in files(folder):
        rel = path.relative_to(folder).as_posix().encode("utf-8")
        data = path.read_bytes()
        h.update(len(rel).to_bytes(4, "big") + rel + len(data).to_bytes(8, "big") + data)
    return h.hexdigest()
