"""Portable themes are bounded inert package data, never extension code."""

import re
from pathlib import Path

from ..theme_packages import PACKAGE_FILES, _read_folder
from .extension_data import RESERVED, regular_path

THEME_PATH = re.compile(r"themes/([a-z0-9][a-z0-9_-]{1,47})/([^/]+)")


def allowed_theme_path(name: str) -> bool:
    match = THEME_PATH.fullmatch(name)
    return bool(match and match[1] not in RESERVED and match[2] in PACKAGE_FILES)


def theme_files(workspace: Path):
    root = workspace.resolve() / "themes"
    regular_path(root)
    if not root.exists():
        return
    if not root.is_dir() or root.resolve() != root:
        raise ValueError("theme packages must use a regular local directory")
    for folder in sorted(root.iterdir()):
        regular_path(folder)
        _, _, files = _read_folder(folder)
        for filename in sorted(files):
            name = f"themes/{folder.name}/{filename}"
            if not allowed_theme_path(name):
                raise ValueError("theme package contains an unsupported path")
            yield name, folder / filename


def copy_themes(source: Path, target: Path, *, byte_budget: int) -> int:
    total = 0
    for name, path in theme_files(source):
        raw = path.read_bytes()
        total += len(raw)
        if total > byte_budget:
            raise ValueError("workspace exceeds the archive size limit")
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
    return total
