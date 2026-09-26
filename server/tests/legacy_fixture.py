"""Copy only the *shipped* legacy data (``data/distribution.json``) into a temp dir.

AGENTS.md: fixtures must never copy the whole ``data/`` directory — it also holds local user data.
Some checkouts store non-ASCII file names mangled as ``#Uxxxx``; both spellings are accepted.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LEGACY_KINDS = ("storyboards", "presets/characters", "workflows", "collections")


def mangle(name: str) -> str:
    return "".join(c if ord(c) < 128 else f"#U{ord(c):04x}" for c in name)


def copy_shipped_legacy(dest: Path, source: Path | None = None) -> Path:
    source = source or REPO / "data"
    manifest = json.loads((source / "distribution.json").read_text(encoding="utf-8"))
    for rel in manifest["files"]:
        if not rel.startswith(tuple(k + "/" for k in LEGACY_KINDS)):
            continue
        src = source / rel
        if not src.exists():
            src = source / mangle(rel)
        if not src.exists():
            continue
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
    return dest
