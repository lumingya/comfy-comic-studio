"""Copy only the explicitly shipped seed data into a temp directory.

AGENTS.md: fixtures must never copy the whole ``data/`` directory — it also holds local user data.
Some checkouts store non-ASCII file names mangled as ``#Uxxxx``; both spellings are accepted.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SEED_KINDS = ("storyboards", "presets/characters", "workflows", "collections")


def mangle(name: str) -> str:
    return "".join(c if ord(c) < 128 else f"#U{ord(c):04x}" for c in name)


def committed_seed(relative: str, expected: str) -> bytes | None:
    result = subprocess.run(
        ["git", "show", f"HEAD:data/{relative}"],
        cwd=REPO,
        capture_output=True,
        check=False,
    )
    if result.returncode == 0 and hashlib.sha256(result.stdout).hexdigest() == expected:
        return result.stdout
    return None


def copy_shipped_data(
    dest: Path, source: Path | None = None, kinds: tuple[str, ...] = SEED_KINDS
) -> Path:
    source_is_repo = source is None
    source = source or REPO / "data"
    manifest_bytes = None
    if source_is_repo:
        result = subprocess.run(
            ["git", "show", "HEAD:data/distribution.json"],
            cwd=REPO,
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            manifest_bytes = result.stdout
    manifest_bytes = manifest_bytes or (source / "distribution.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    for rel in manifest["files"]:
        if not rel.startswith(tuple(k + "/" for k in kinds)):
            continue
        src = source / rel
        if not src.exists():
            src = source / mangle(rel)
        expected = manifest["files"][rel]
        raw = src.read_bytes() if src.exists() else None
        if raw is None or hashlib.sha256(raw).hexdigest() != expected:
            committed = committed_seed(rel, expected) if source_is_repo else None
            if committed is not None:
                raw = committed
            elif raw is None:
                continue
            else:
                raise ValueError(f"Shipped seed differs from its manifest: {rel}")
            src = dest / rel
            src.parent.mkdir(parents=True, exist_ok=True)
            src.write_bytes(raw)
            continue
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
    return dest
