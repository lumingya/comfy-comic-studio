"""Recompute the checksums of the explicit shipped-data list in data/distribution.json.

The file list is authoritative and is never auto-discovered: editing a shipped
file requires re-running this tool, and adding a new shipped file requires an
explicit ``--add`` so personal drafts under data/ are never registered by
accident. Unlisted files are only reported.

    python tools/build_distribution.py            # refresh checksums
    python tools/build_distribution.py --check    # exit 1 when stale (CI / pre-commit)
    python tools/build_distribution.py --add storyboards/新分镜--abc123.json
"""
from pathlib import Path
import argparse
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.mio_library import decode, digest, encode, owned_path  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
IGNORED_PREFIXES = ('.cache/', '.transactions/', '.trash/', 'runtime/', 'production/', 'ecosystem/')
IGNORED_NAMES = ('.write.lock', 'distribution.json', 'secrets.json')


def unlisted(source, manifest):
    listed = set(manifest['files'])
    found = []
    for path in sorted(source.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(source).as_posix()
        if relative in listed or relative.startswith(IGNORED_PREFIXES) or path.name in IGNORED_NAMES or path.name.endswith('.lock'):
            continue
        found.append(relative)
    return found


def build(source, additions=(), check=False):
    source = Path(source)
    target = owned_path(source, 'distribution.json')
    manifest = decode(target.read_bytes())
    if manifest.get('schema') != 'mio.distribution.v1':
        raise SystemExit('Invalid distribution manifest')
    files = dict(manifest['files'])
    for relative in additions:
        if not owned_path(source, relative).is_file():
            raise SystemExit('Cannot add missing file: ' + relative)
        files[relative] = ''
    stale, missing = [], []
    for relative in list(files):
        path = owned_path(source, relative)
        if not path.is_file():
            missing.append(relative)
            continue
        checksum = digest(path.read_bytes())
        if files[relative] != checksum:
            stale.append(relative)
            files[relative] = checksum
    manifest['files'] = dict(sorted(files.items()))
    encoded = encode(manifest)
    changed = encoded != target.read_bytes()
    for relative in unlisted(source, manifest):
        print('note: unlisted file (not shipped to new workspaces):', relative)
    for relative in missing:
        print('error: listed file missing:', relative)
    if check:
        for relative in stale:
            print('stale checksum:', relative)
        if stale or missing:
            print('data/distribution.json is out of date; run python tools/build_distribution.py')
            return 1
        print('data/distribution.json matches', len(files), 'shipped files')
        return 0
    if missing:
        return 1
    if changed:
        target.write_bytes(encoded)
    print(('Updated' if changed else 'Unchanged'), 'data/distribution.json ·', len(files), 'files ·', len(stale), 'checksums refreshed')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='verify only; exit 1 when checksums are stale')
    parser.add_argument('--add', action='append', default=[], metavar='RELATIVE', help='register a new shipped file (relative to data/)')
    args = parser.parse_args()
    sys.exit(build(ROOT / 'data', args.add, args.check))
