"""Retain reviewed extension data contracts independently of activation and workspace restore."""

import json
import re
import shutil
from pathlib import Path

from .manifest import MANIFEST, SKIP_DIRS, digest, read_manifest


def trust_root(workspace):
    workspace = Path(workspace).resolve()
    return workspace.parent / f".{workspace.name}.mio-recovery"


def remember_package(workspace, folder, expected):
    folder = Path(folder)
    manifest = read_manifest(folder)
    root = trust_root(workspace)
    destination = root / "trusted-extensions" / manifest.id / expected
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(folder, destination, ignore=shutil.ignore_patterns(*SKIP_DIRS, "*.pyc"))
    if digest(destination) != expected:
        raise ValueError("reviewed extension snapshot changed")
    index = root / "extension-trust.json"
    entries = json.loads(index.read_text(encoding="utf-8")) if index.exists() else {}
    entries[manifest.id] = expected
    temp = index.with_suffix(".tmp")
    temp.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    temp.replace(index)


def reviewed_packages(workspace):
    root = trust_root(workspace)
    index = root / "extension-trust.json"
    if not index.is_file():
        return []
    entries = json.loads(index.read_text(encoding="utf-8"))
    result = []
    for identifier, pinned in entries.items():
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,47}", identifier) or not re.fullmatch(
            r"[0-9a-f]{64}", pinned
        ):
            raise ValueError("invalid extension trust record")
        folder = root / "trusted-extensions" / identifier / pinned
        if not (folder / MANIFEST).is_file() or digest(folder) != pinned:
            raise ValueError("reviewed extension snapshot is missing or changed")
        if read_manifest(folder).id != identifier:
            raise ValueError("reviewed extension identity changed")
        result.append(folder)
    return result
