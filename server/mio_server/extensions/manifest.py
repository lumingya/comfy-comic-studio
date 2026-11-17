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
import os
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError, field_validator

from ..models import StrictModel

MANIFEST = "mio-extension.json"
ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{1,47}$"
SKIP_DIRS = {"__pycache__", ".git", "node_modules", ".ruff_cache", ".pytest_cache", ".venv"}


class SlicePresetSpec(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")
    label: str
    width: int = Field(ge=0, le=4000)
    max_height: int = Field(ge=0, le=20000)
    fmt: Literal["JPEG", "PNG", "WEBP"] = "JPEG"
    quality: int = Field(default=90, ge=40, le=100)


class PanelRequestSpec(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,47}$")
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    path: str = Field(min_length=1, max_length=240)
    scope: Literal["read", "write", "render", "admin"]

    @field_validator("path")
    @classmethod
    def local_template(cls, value: str) -> str:
        import re

        if not re.fullmatch(
            r"/(?:[A-Za-z0-9_.-]+|\{[A-Za-z_][A-Za-z0-9_]*\})(?:/(?:[A-Za-z0-9_.-]+|\{[A-Za-z_][A-Za-z0-9_]*\}))*",
            value,
        ):
            raise ValueError("panel requests require an exact API path template, not a URL")
        if any(part in (".", "..") for part in value.split("/")):
            raise ValueError("panel request paths cannot traverse directories")
        return value


class PanelSpec(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")
    slot: Literal["episode", "settings"]
    title: str
    entry: str = Field(description="HTML file inside the extension folder")
    requests: list[PanelRequestSpec] = Field(default_factory=list, max_length=32)

    @field_validator("requests")
    @classmethod
    def unique_requests(cls, values: list[PanelRequestSpec]) -> list[PanelRequestSpec]:
        if len({value.id for value in values}) != len(values):
            raise ValueError("panel request IDs must be unique")
        return values


class Contributes(StrictModel):
    themes: list[str] = Field(default_factory=list, description="Theme JSON files")
    album_templates: list[str] = Field(default_factory=list, description="Album template JSON")
    sfx_presets: dict[str, dict] = Field(default_factory=dict)
    slice_presets: list[SlicePresetSpec] = Field(default_factory=list)
    panels: list[PanelSpec] = Field(default_factory=list)


class WorkspaceSpec(StrictModel):
    entry: str
    title: str


class Manifest(StrictModel):
    id: str = Field(pattern=ID_PATTERN)
    name: str
    version: str = "0.1.0"
    description: str = ""
    author: str = ""
    homepage: str = ""
    main: str | None = Field(default=None, description="Python entry: activate(mio) is called")
    workspace: WorkspaceSpec | None = None
    backup: str | None = None
    contributes: Contributes = Field(default_factory=Contributes)

    @property
    def runs_code(self) -> bool:
        return bool(self.main or self.contributes.panels or self.workspace or self.backup)


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
    for rel in [
        manifest.main or "",
        manifest.backup or "",
        manifest.workspace.entry if manifest.workspace else "",
        *manifest.contributes.themes,
    ]:
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
    for current, directories, names in os.walk(folder):
        directories[:] = [name for name in directories if name not in SKIP_DIRS]
        for name in names:
            path = Path(current) / name
            if path.suffix not in (".pyc", ".pyo") and path.is_file():
                out.append(path)
    return sorted(out)


def digest(folder: Path) -> str:
    """sha256 over every file's relative path and bytes (order-independent of the filesystem)."""
    h = hashlib.sha256()
    for path in files(folder):
        rel = path.relative_to(folder).as_posix().encode("utf-8")
        data = path.read_bytes()
        h.update(len(rel).to_bytes(4, "big") + rel + len(data).to_bytes(8, "big") + data)
    return h.hexdigest()
