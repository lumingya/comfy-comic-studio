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
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from pydantic import Field, StrictInt, ValidationError, field_validator, model_validator

from ..models import StrictModel

MANIFEST = "mio-extension.json"
ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{1,47}$"
# No package-owned directories are omitted from the review digest. Python bytecode is included
# too, because import machinery may execute a valid cache instead of the adjacent source file.
SKIP_DIRS: set[str] = set()


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
    response: Literal["json", "image", "download"] = "json"
    input: Literal["json", "image"] = "json"

    @model_validator(mode="after")
    def binary_request_kind(self):
        if self.input == "image" and (
            self.method != "POST"
            or self.path != "/assets"
            or self.scope != "write"
            or self.response != "json"
        ):
            raise ValueError(
                "panel image uploads require POST /assets, write scope and JSON response"
            )
        if self.response == "image" and (self.method != "GET" or self.scope != "read"):
            raise ValueError("panel images require a read-only GET operation")
        if self.response == "download" and self.method not in {"GET", "POST"}:
            raise ValueError("panel downloads require a GET or POST operation")
        return self

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
    priority: int = Field(default=0, strict=True)
    requests: list[PanelRequestSpec] = Field(default_factory=list, max_length=32)
    subscriptions: list[Literal["creation.context.changed", "selection.changed"]] = Field(
        default_factory=list, max_length=2
    )

    @model_validator(mode="after")
    def read_only_subscriptions(self):
        if len(set(self.subscriptions)) != len(self.subscriptions):
            raise ValueError("panel subscriptions must be unique")
        if self.subscriptions and not any(
            request.method == "GET" and request.scope == "read" for request in self.requests
        ):
            raise ValueError("creation subscriptions require a declared read-only operation")
        return self

    @field_validator("requests")
    @classmethod
    def unique_requests(cls, values: list[PanelRequestSpec]) -> list[PanelRequestSpec]:
        if len({value.id for value in values}) != len(values):
            raise ValueError("panel request IDs must be unique")
        return values


class FloatingPosition(StrictModel):
    x: Literal["left", "right"] | Annotated[StrictInt, Field(ge=0, le=10000)]
    y: Literal["top", "bottom"] | Annotated[StrictInt, Field(ge=0, le=10000)]
    offset: tuple[
        Annotated[StrictInt, Field(ge=0, le=10000)],
        Annotated[StrictInt, Field(ge=0, le=10000)],
    ] = (20, 20)


class FloatingSurfaceSpec(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")
    title: str = Field(min_length=1, max_length=120)
    entry: str = Field(min_length=1, max_length=240)
    global_: bool = Field(alias="global", strict=True)
    transparent: bool = Field(default=True, strict=True)
    default_position: FloatingPosition = Field(
        default_factory=lambda: FloatingPosition(x="right", y="bottom")
    )
    priority: int = Field(default=0, strict=True)

    @field_validator("title")
    @classmethod
    def non_blank_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("floating surface title must not be blank")
        return value

    @field_validator("entry")
    @classmethod
    def local_html_entry(cls, value: str) -> str:
        if (
            any(part in {"", ".", ".."} for part in value.split("/"))
            or any(char in "\\:?#" or ord(char) < 32 for char in value)
            or PurePosixPath(value).suffix.lower() != ".html"
        ):
            raise ValueError("floating surface entry must be a relative HTML path")
        return value


class HostPanelAction(StrictModel):
    kind: Literal["open_panel"]
    panel_id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")


class HostSlotSpec(StrictModel):
    version: Literal[1] = 1
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")
    slot: Literal["command_palette", "context_menu.episode", "inspector.panel"]
    title: str = Field(min_length=1, max_length=80)
    icon: Literal["eye", "book", "image", "list", "spark", "nodes"] = "eye"
    priority: int = Field(default=0, ge=-100, le=100, strict=True)
    action: HostPanelAction

    @field_validator("version", mode="before")
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int:
            raise ValueError("host slot version requires an integer")
        return value

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value):
        if not value.strip():
            raise ValueError("host slot title cannot be blank")
        return value


class Contributes(StrictModel):
    themes: list[str] = Field(default_factory=list, description="Theme JSON files")
    album_templates: list[str] = Field(default_factory=list, description="Album template JSON")
    sfx_presets: dict[str, dict] = Field(default_factory=dict)
    slice_presets: list[SlicePresetSpec] = Field(default_factory=list)
    panels: list[PanelSpec] = Field(default_factory=list)
    floating_surfaces: list[FloatingSurfaceSpec] = Field(default_factory=list)
    host_slots: list[HostSlotSpec] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def owned_host_panels(self):
        if len({panel.id for panel in self.panels}) != len(self.panels):
            raise ValueError("panel IDs must be unique within the extension")
        if len({slot.id for slot in self.host_slots}) != len(self.host_slots):
            raise ValueError("host slot IDs must be unique within the extension")
        panels = {panel.id: panel for panel in self.panels}
        for slot in self.host_slots:
            panel = panels.get(slot.action.panel_id)
            if panel is None or panel.slot != "episode":
                raise ValueError("host slots must open this extension's declared episode panel")
        return self

    @field_validator("floating_surfaces")
    @classmethod
    def unique_surface_ids(cls, values: list[FloatingSurfaceSpec]) -> list[FloatingSurfaceSpec]:
        if len({value.id for value in values}) != len(values):
            raise ValueError("floating surface IDs must be unique within the extension")
        return values


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
        return bool(
            self.main
            or self.contributes.panels
            or self.contributes.floating_surfaces
            or self.workspace
            or self.backup
        )


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
    for surface in manifest.contributes.floating_surfaces:
        if not inside(folder, surface.entry).is_file():
            raise ManifestError(f"floating surface entry is not an HTML file: {surface.entry}")
    try:
        _reject_symlinked_directories(folder)
    except OSError as exc:
        raise ManifestError(str(exc)) from None
    return manifest


def inside(folder: Path, rel: str) -> Path:
    """Resolve a digest-covered package path; refuse escapes and unhashed cache directories."""
    if not isinstance(rel, str):
        raise ManifestError("扩展路径必须是字符串")
    parts = PurePosixPath(rel.replace("\\", "/")).parts
    if any(part in SKIP_DIRS for part in parts):
        raise ManifestError(f"扩展不能从未纳入摘要的缓存路径读取：{rel}")
    root = folder.resolve()
    target = (root / rel).resolve()
    if rel.startswith(("/", "\\")) or (target != root and root not in target.parents):
        raise ManifestError(f"路径超出扩展目录：{rel}")
    return target


def _reject_symlinked_directories(folder: Path) -> None:
    for current, directories, names in os.walk(folder):
        directories[:] = [name for name in directories if name not in SKIP_DIRS]
        for name in directories:
            path = Path(current) / name
            if path.is_symlink():
                rel = path.relative_to(folder).as_posix()
                raise OSError(f"extension package contains a symlinked directory: {rel}")


def files(folder: Path) -> list[Path]:
    _reject_symlinked_directories(folder)
    out = []
    for current, directories, names in os.walk(folder):
        directories[:] = [name for name in directories if name not in SKIP_DIRS]
        for name in names:
            path = Path(current) / name
            if path.is_file():
                out.append(path)
    return sorted(out)


def digest(folder: Path) -> str:
    """sha256 over every file's relative path and bytes (order-independent of the filesystem)."""
    h = hashlib.sha256()
    for path in files(folder):
        rel = path.relative_to(folder).as_posix().encode("utf-8")
        size = path.stat().st_size
        h.update(len(rel).to_bytes(4, "big") + rel + size.to_bytes(8, "big"))
        total = 0
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                h.update(chunk)
                total += len(chunk)
        if total != size:
            raise OSError(f"extension file changed while hashing: {path.name}")
    return h.hexdigest()
