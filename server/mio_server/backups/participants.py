"""Data-only backup contracts declared by installed, reviewed extension packages.

Offline restoration cannot activate services or trust Python contained in an imported archive.
Participants are loaded from shipped packages or verified review snapshots, independently of
whether their interactive extension is enabled. Unknown data areas remain rejected.
"""

from __future__ import annotations

import hashlib
import importlib.util
import sys
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Protocol

from .extension_data import allowed_extension_path, regular_path, with_extension_head
from .paths import sha_file
from .themes import allowed_theme_path, copy_themes, theme_files
from .ui_data import allowed_path as allowed_ui_path
from .ui_data import copy_data as copy_ui_data
from .ui_data import data_files as ui_data_files
from .ui_data import size_limit as ui_size_limit

EXTENSIONS_ROOT = Path(__file__).resolve().parents[3] / "extensions"
_CATALOG: ContextVar[tuple | None] = ContextVar("backup_participants", default=None)


class BackupParticipant(Protocol):
    root: str

    def allowed(self, name: str) -> bool: ...
    def size_limit(self, name: str) -> int: ...
    def files(self, workspace: Path, *, include_credentials: bool = True): ...
    def snapshot(
        self, source: Path, target: Path, *, include_credentials: bool, byte_budget: int
    ) -> int: ...
    def lock(self, ctx): ...
    def restore_guard(self, ctx) -> None: ...


@lru_cache(maxsize=32)
def _load(path: str, content: bytes) -> ModuleType:
    name = "mio_backup_" + hashlib.sha256(path.encode()).hexdigest()[:16]
    spec = importlib.util.spec_from_file_location(
        name, path, submodule_search_locations=[str(Path(path).parent)]
    )
    if spec is None:
        raise ValueError("extension backup entry cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        exec(compile(content, path, "exec"), module.__dict__)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


def participants(workspace: Path | None = None) -> list[BackupParticipant]:
    cached = _CATALOG.get()
    identity = workspace.resolve() if workspace is not None else None
    if cached is not None and cached[0] == identity:
        return cached[1]
    # Import lazily: startup recovery runs before context/extension manager construction.
    from ..extensions.manifest import inside, read_manifest

    folders = sorted(EXTENSIONS_ROOT.iterdir()) if EXTENSIONS_ROOT.is_dir() else []
    if workspace is not None:
        from ..extensions.trust import reviewed_packages

        folders += list(reviewed_packages(workspace))
    found = []
    roots = set()
    seen = set()
    for folder in folders:
        if not folder.is_dir() or not (folder / "mio-extension.json").is_file():
            continue
        regular_path(folder)
        manifest = read_manifest(folder)
        if manifest.id in seen:
            continue
        seen.add(manifest.id)
        entry = getattr(manifest, "backup", None)
        if not entry:
            continue
        path = inside(folder, entry)
        regular_path(path)
        participant = getattr(_load(str(path), path.read_bytes()), "PARTICIPANT", None)
        methods = ("allowed", "size_limit", "files", "snapshot", "lock", "restore_guard")
        if (
            participant is None
            or any(not callable(getattr(participant, method, None)) for method in methods)
            or getattr(participant, "root", "") != f"extensions_data/{manifest.id}"
            or participant.root in roots
        ):
            raise ValueError("invalid or duplicate extension backup participant")
        roots.add(participant.root)
        found.append(participant)
    return found


@contextmanager
def catalog_scope(workspace: Path | None):
    identity = workspace.resolve() if workspace is not None else None
    token = _CATALOG.set((identity, participants(workspace)))
    try:
        yield
    finally:
        _CATALOG.reset(token)


def owner(name: str, workspace: Path | None = None):
    if not safe_member(name) or allowed_extension_path(name) or allowed_ui_path(name):
        return None
    for participant in participants(workspace):
        if name.startswith(participant.root + "/") and participant.allowed(name):
            return participant
    return None


def safe_member(name: str) -> bool:
    return (
        "\\" not in name
        and ":" not in name
        and all(part and part not in {".", ".."} for part in name.split("/"))
    )


def allowed_path(name: str, workspace: Path | None = None) -> bool:
    return allowed_ui_path(name) or allowed_theme_path(name) or owner(name, workspace) is not None


def size_limit(name: str, workspace: Path | None = None) -> int:
    if allowed_ui_path(name):
        return ui_size_limit(name)
    if allowed_theme_path(name):
        from ..theme_packages import MAX_FILE

        return MAX_FILE
    participant = owner(name, workspace)
    if participant is None:
        raise ValueError("unrecognized extension backup path")
    return participant.size_limit(name)


def data_files(
    workspace: Path, *, include_credentials: bool = True, trusted_workspace: Path | None = None
):
    yield from theme_files(workspace)
    yield from ui_data_files(workspace, include_credentials=include_credentials)
    cached = _CATALOG.get()
    selected = (
        cached[1]
        if cached is not None and trusted_workspace is None
        else participants(trusted_workspace or workspace)
    )
    for participant in selected:
        for name, path in participant.files(workspace, include_credentials=include_credentials):
            if (
                not safe_member(name)
                or allowed_extension_path(name)
                or allowed_ui_path(name)
                or not name.startswith(participant.root + "/")
                or not participant.allowed(name)
            ):
                raise ValueError(
                    "extension backup participant returned a path outside its data area"
                )
            regular_path(path)
            if path.resolve() != (workspace / name).resolve() or not path.resolve().is_relative_to(
                workspace.resolve()
            ):
                raise ValueError("extension backup participant escaped the workspace")
            yield name, path


def with_workspace_head(database_head: str, workspace: Path) -> str:
    base = with_extension_head(database_head, workspace)
    digest = hashlib.sha256(b"mio.workspace.head.v3\0" + base.encode("ascii"))
    found = False
    for name, path in data_files(workspace):
        found = True
        digest.update(b"\0" + name.encode("utf-8") + b"\0" + bytes.fromhex(sha_file(path)))
    return digest.hexdigest() if found else base


def copy_data(source: Path, target: Path, *, include_credentials: bool, byte_budget: int) -> int:
    total = copy_themes(source, target, byte_budget=byte_budget)
    total += copy_ui_data(
        source,
        target,
        include_credentials=include_credentials,
        byte_budget=byte_budget - total,
    )

    def host_head() -> str:
        digest = hashlib.sha256(with_extension_head("0" * 64, target).encode("ascii"))
        for name, path in ui_data_files(target):
            digest.update(name.encode("utf-8") + b"\0" + bytes.fromhex(sha_file(path)))
        return digest.hexdigest()

    settings_head = host_head()
    for participant in participants(source):
        if any(
            participant.allowed(f"{participant.root}/{filename}")
            for filename in ("settings.json", "preferences.json")
        ):
            raise ValueError("extension backup participants cannot claim host-owned settings")
        total += participant.snapshot(
            source, target, include_credentials=include_credentials, byte_budget=byte_budget - total
        )
        if host_head() != settings_head:
            raise ValueError("extension backup participant changed host-owned settings")
        if total > byte_budget:
            raise ValueError("workspace exceeds the archive size limit")
    return total


def acquire_locks(ctx, stack):
    if getattr(ctx, "theme_packages", None) is not None:
        stack.enter_context(ctx.theme_packages._lock)
    for participant in participants(ctx.data_dir):
        stack.enter_context(participant.lock(ctx))


def require_restore_idle(ctx):
    for participant in participants(ctx.data_dir):
        participant.restore_guard(ctx)
