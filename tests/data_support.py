"""Fixtures that need the shipped workspace copy the release data only.

Copying the whole data/ directory would drag in a developer's personal workspace
(thousands of production/asset files on a real machine), which made these tests
slow and machine-dependent. The shipped set is exactly data/distribution.json
plus the files it lists, which is also everything a clean CI checkout contains.
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def copy_shipped_data(dest, source=None):
    """Copy data/distribution.json and every file it lists into dest; return dest."""
    source = Path(source or ROOT / 'data')
    dest = Path(dest)
    manifest = json.loads((source / 'distribution.json').read_text(encoding='utf-8'))
    for relative in ['distribution.json', *manifest['files']]:
        target = dest / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, target)
    return dest
