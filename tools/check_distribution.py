"""Verify the explicit, checksummed seed-data manifest used by v4 releases."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath

SCHEMA = "mio.distribution.v1"
CHECKSUM = re.compile(r"^[0-9a-f]{64}$")
WINDOWS_DEVICE = re.compile(r"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)", re.IGNORECASE)


class DistributionError(ValueError):
    """The shipped-data manifest or one of its paths is invalid."""


def _object_pairs(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in {"__proto__", "prototype", "constructor"}:
            raise DistributionError(f"Reserved JSON member: {key}")
        if key in result:
            raise DistributionError(f"Duplicate JSON member: {key}")
        result[key] = value
    return result


def _constant(value: str) -> None:
    raise DistributionError(f"Non-finite JSON number: {value}")


def owned_path(root: str | Path, relative: str) -> Path:
    """Resolve a manifest path while rejecting traversal and symlinks."""
    if not isinstance(relative, str) or "\\" in relative or "\x00" in relative:
        raise DistributionError("Unsafe resource path")
    path = PurePosixPath(relative)
    if (
        path.is_absolute()
        or not path.parts
        or relative != path.as_posix()
        or any(
            part in ("", ".", "..") or part.endswith((" ", ".")) or WINDOWS_DEVICE.match(part)
            for part in path.parts
        )
        or ":" in relative
    ):
        raise DistributionError("Unsafe resource path")
    base = Path(root).absolute()
    candidate = base
    for part in path.parts:
        candidate /= part
        if candidate.is_symlink():
            raise DistributionError("Symbolic links are not shipped-data files")
    if not candidate.resolve().is_relative_to(base.resolve()):
        raise DistributionError("Resource path escapes its owner")
    return candidate


def digest_file(path: Path) -> str:
    """Hash incrementally so large image seeds do not need to fit in memory."""
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def distribution(source: str | Path) -> dict:
    """Read and validate the manifest envelope, without requiring every file to exist."""
    source = Path(source)
    manifest_path = owned_path(source, "distribution.json")
    try:
        manifest = json.loads(
            manifest_path.read_text(encoding="utf-8"),
            object_pairs_hook=_object_pairs,
            parse_constant=_constant,
        )
    except (OSError, ValueError, UnicodeError, RecursionError) as error:
        raise DistributionError(f"Cannot read data/distribution.json: {error}") from error
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        raise DistributionError("Invalid distribution manifest")
    if not isinstance(manifest.get("version"), str):
        raise DistributionError("Invalid distribution version")
    if not isinstance(manifest.get("files"), dict):
        raise DistributionError("Invalid distribution file list")
    for relative in manifest["files"]:
        owned_path(source, relative)
    return manifest


def verify(source: str | Path) -> tuple[dict, list[dict[str, str]]]:
    """Return the manifest and any missing or changed shipped files."""
    source = Path(source)
    manifest = distribution(source)
    problems = []
    for relative, checksum in manifest["files"].items():
        if not isinstance(checksum, str) or not CHECKSUM.fullmatch(checksum):
            raise DistributionError(f"Invalid release checksum: {relative}")
        path = owned_path(source, relative)
        if not path.is_file():
            problems.append({"file": relative, "reason": "missing"})
        elif digest_file(path) != checksum:
            problems.append({"file": relative, "reason": "changed"})
    return manifest, problems


def require_verified_distribution(source: str | Path) -> dict:
    """Fail closed for release packaging; ordinary editing remains unrestricted."""
    manifest, problems = verify(source)
    if problems:
        detail = ", ".join(f"{item['file']} ({item['reason']})" for item in problems)
        raise DistributionError(
            "Release data differs: "
            + detail
            + ". Review the seed files and run python tools/build_distribution.py before release."
        )
    return manifest


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    try:
        manifest = require_verified_distribution(root / "data")
    except (DistributionError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"Verified {len(manifest['files'])} release data files (not a runtime requirement)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
