"""Refresh checksums for the explicit v4 seed-data list.

New files require ``--add`` so local drafts are never shipped by accident.

    python tools/build_distribution.py
    python tools/build_distribution.py --check
    python tools/build_distribution.py --approve-changes
    python tools/build_distribution.py --add catalog/example.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from check_distribution import DistributionError, digest_file, distribution, owned_path

ROOT = Path(__file__).resolve().parents[1]
IGNORED_PREFIXES = (
    ".cache/",
    ".transactions/",
    ".trash/",
    "runtime/",
    "production/",
    "ecosystem/",
)
IGNORED_NAMES = {".write.lock", "distribution.json", "secrets.json"}


def unlisted(source: Path, files: dict) -> list[str]:
    listed = set(files)
    found = []
    for path in sorted(source.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(source).as_posix()
        if (
            relative in listed
            or relative.startswith(IGNORED_PREFIXES)
            or path.name in IGNORED_NAMES
            or path.name.endswith(".lock")
        ):
            continue
        found.append(relative)
    return found


def changed_since_head(source: Path, files: dict, repo_root: Path) -> list[str]:
    root = Path(repo_root).resolve()
    source = Path(source).resolve()
    relative_source = source.relative_to(root).as_posix()
    candidates = [f"{relative_source}/distribution.json"]
    candidates.extend(f"{relative_source}/{relative}" for relative in files)
    changed = []
    for relative in candidates:
        baseline = subprocess.run(
            ["git", "rev-parse", "--verify", f"HEAD:{relative}"],
            cwd=root,
            capture_output=True,
            check=False,
        )
        if baseline.returncode:
            continue
        current = subprocess.run(
            ["git", "hash-object", "--", relative],
            cwd=root,
            capture_output=True,
            check=False,
        )
        if current.returncode or current.stdout.strip() != baseline.stdout.strip():
            changed.append(relative)
    return changed


def build(
    source: Path,
    additions: tuple[str, ...] = (),
    check: bool = False,
    approve_changes: bool = False,
    repo_root: Path | None = None,
) -> int:
    source = Path(source)
    manifest_path = source / "distribution.json"
    manifest = distribution(source)
    files = dict(manifest["files"])
    for relative in additions:
        path = owned_path(source, relative)
        if not path.is_file():
            raise DistributionError(f"Cannot add missing file: {relative}")
        files[relative] = ""

    if not check:
        if repo_root is None and source.resolve() == (ROOT / "data").resolve():
            repo_root = ROOT
        if (
            repo_root is not None
            and not approve_changes
            and changed_since_head(source, files, repo_root)
        ):
            print(
                "refusing to refresh release data changed from HEAD; review the intended seed edits",
                file=sys.stderr,
            )
            print("then rerun with --approve-changes.", file=sys.stderr)
            return 1

    stale = []
    missing = []
    for relative in list(files):
        path = owned_path(source, relative)
        if not path.is_file():
            missing.append(relative)
            continue
        checksum = digest_file(path)
        if files[relative] != checksum:
            stale.append(relative)
            files[relative] = checksum

    for relative in unlisted(source, files):
        print("note: unlisted file (not shipped to new workspaces):", relative)
    for relative in missing:
        print("error: listed file missing:", relative)

    if check:
        for relative in stale:
            print("stale checksum:", relative)
        if stale or missing:
            print("data/distribution.json is out of date; run python tools/build_distribution.py")
            return 1
        print(f"data/distribution.json matches {len(files)} shipped files")
        return 0

    if missing:
        return 1
    manifest["version"] = json.loads((ROOT / "web" / "package.json").read_text("utf-8"))["version"]
    manifest["files"] = dict(sorted(files.items()))
    encoded = (json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode(
        "utf-8"
    )
    changed = encoded != manifest_path.read_bytes()
    if changed:
        manifest_path.write_bytes(encoded)
    print(
        f"{'Updated' if changed else 'Unchanged'} data/distribution.json · "
        f"{len(files)} files · {len(stale)} checksums refreshed"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--check", action="store_true", help="verify only; exit 1 when stale")
    parser.add_argument(
        "--add", action="append", default=[], metavar="RELATIVE", help="register a new shipped file"
    )
    parser.add_argument(
        "--approve-changes",
        action="store_true",
        help="allow refreshing checksums for reviewed tracked edits",
    )
    args = parser.parse_args()
    try:
        return build(
            ROOT / "data",
            tuple(args.add),
            args.check,
            args.approve_changes,
            ROOT,
        )
    except (DistributionError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
