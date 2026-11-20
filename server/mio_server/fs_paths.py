"""Inspect path components without treating Windows short-name aliases as links."""

from __future__ import annotations

import stat
from os import stat_result
from pathlib import Path


def regular_path_metadata(
    path: Path, *, directory: bool | None = None, missing: bool = False
) -> stat_result | None:
    """Require regular components using lstat before any path canonicalization.

    A normal 8.3 alias may resolve to a differently spelled path. Link safety instead
    depends on each component's actual type and Windows reparse-point attributes.
    This does not defeat a same-user process racing subsequent filesystem operations.
    """
    path = Path(path).absolute()
    for component in (*reversed(path.parents), path):
        leaf = component == path
        try:
            metadata = component.lstat()
        except FileNotFoundError:
            if leaf and not missing:
                raise ValueError("path does not exist") from None
            continue
        if stat.S_ISLNK(metadata.st_mode) or getattr(metadata, "st_file_attributes", 0) & getattr(
            stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400
        ):
            raise ValueError("path must not contain links or reparse points")
        is_directory = stat.S_ISDIR(metadata.st_mode)
        if not (is_directory or stat.S_ISREG(metadata.st_mode)):
            raise ValueError("path must contain regular files and directories")
        expected_directory = directory if leaf else True
        if expected_directory is not None and is_directory != expected_directory:
            raise ValueError("path has the wrong file or directory type")
        if leaf:
            return metadata
    return None
