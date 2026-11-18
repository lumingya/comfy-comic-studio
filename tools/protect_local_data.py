"""Keep local edits to tracked seed data out of accidental commits.

    python tools/protect_local_data.py
    python tools/protect_local_data.py --status
    python tools/protect_local_data.py --undo

The skip-worktree flag is local to this checkout and does not alter GitHub or other clones.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from check_distribution import distribution, owned_path

ROOT = Path(__file__).resolve().parents[1]


def shipped_paths(root: Path = ROOT) -> list[str]:
    data = root / "data"
    manifest = distribution(data)
    for relative in manifest["files"]:
        owned_path(data, relative)
    return ["data/" + relative for relative in sorted(manifest["files"])]


def git(root: Path, *arguments: str, stdin: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["git", *arguments], cwd=root, input=stdin, capture_output=True, check=True
    )
    return result.stdout


def tracked(root: Path, paths: list[str]) -> list[str]:
    listed = git(root, "ls-files", "-z", "--", *paths).split(b"\0")
    return [path.decode("utf-8") for path in listed if path]


def set_protection(root: Path, paths: list[str], protect: bool = True) -> list[str]:
    paths = tracked(root, paths)
    if paths:
        flag = "--skip-worktree" if protect else "--no-skip-worktree"
        payload = b"\0".join(path.encode("utf-8") for path in paths) + b"\0"
        git(root, "update-index", flag, "-z", "--stdin", stdin=payload)
    return paths


def status(root: Path, paths: list[str]) -> tuple[list[str], list[str]]:
    paths = tracked(root, paths)
    protected = []
    for line in git(root, "ls-files", "-v", "-z", "--", *paths).split(b"\0"):
        if line[:2] == b"S ":
            protected.append(line[2:].decode("utf-8"))
    changed = []
    for path in paths:
        committed = git(root, "show", "HEAD:" + path)
        try:
            current = (root / path).read_bytes()
        except OSError:
            current = None
        if current != committed:
            changed.append(path)
    return protected, changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--undo", action="store_true", help="stop protecting shipped data files")
    group.add_argument(
        "--status", action="store_true", help="show protected and locally changed files"
    )
    args = parser.parse_args()
    paths = shipped_paths(ROOT)
    if args.status:
        protected, changed = status(ROOT, paths)
        print(f"{len(protected)}/{len(paths)} shipped data files protected (skip-worktree).")
        for path in changed:
            print("  locally changed:", path)
        return 0
    done = set_protection(ROOT, paths, protect=not args.undo)
    print(("Unprotected " if args.undo else "Protected ") + f"{len(done)} shipped data files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
