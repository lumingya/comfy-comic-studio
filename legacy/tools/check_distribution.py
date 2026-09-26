"""Explicit release-integrity check, never a runtime or storage precondition.

Exit 1 for missing/changed release files. Intentional edits are fine during
normal use. Before publishing, review the seed files for private data and run
python tools/build_distribution.py to approve their new checksums.
"""
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.mio_content import distribution
from backend.mio_library import LibraryError, digest, owned_path
from backend.mio_paths import shipped_data_dir


def verify(source):
    """Return the manifest and every missing/changed release file."""
    source = Path(source)
    manifest = distribution(source)
    problems = []
    for relative, checksum in manifest['files'].items():
        if not isinstance(checksum, str) or not re.fullmatch(r'[0-9a-f]{64}', checksum):
            raise LibraryError('Invalid release checksum: ' + relative)
        path = owned_path(source, relative)
        if not path.is_file():
            problems.append({'file': relative, 'reason': 'missing'})
        elif digest(path.read_bytes()) != checksum:
            problems.append({'file': relative, 'reason': 'changed'})
    return manifest, problems


def require_verified_distribution(source):
    """Fail closed when producing a release, not when loading mutable data."""
    manifest, problems = verify(source)
    if problems:
        detail = ', '.join(p['file'] + ' (' + p['reason'] + ')' for p in problems)
        raise LibraryError('MIO-DATA-001: Release data differs: ' + detail
                           + '。仅影响发布校验；正常编辑无需重新下载。发布前请审查内容并运行 python tools/build_distribution.py。')
    return manifest


def main():
    try:
        manifest = require_verified_distribution(shipped_data_dir(Path(__file__).resolve().parents[1]))
    except (LibraryError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print('Verified', len(manifest['files']), 'release data files (not a runtime requirement)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
