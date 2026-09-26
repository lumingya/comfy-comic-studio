"""Keep personal runtime changes to shipped data out of commits (local clone only).

The app writes runtime state (active workflow, UI ordering, edits to built-in
samples) into files under data/ that also ship as release defaults. In a git
checkout those writes appear as modifications and are easily swept into a commit
by ``git add -A``. This tool marks every shipped file listed in
data/distribution.json as *skip-worktree*, so git ignores local edits to them.

    python tools/protect_local_data.py            # protect (idempotent)
    python tools/protect_local_data.py --status   # show protected / locally changed files
    python tools/protect_local_data.py --undo     # stop protecting

To change a shipped default on purpose: --undo, edit, run tools/build_distribution.py,
commit, then protect again. CI (tools/check_distribution.py) rejects commits whose
shipped data does not match the manifest. The flag is local to this clone.
"""
from pathlib import Path
import argparse
import json
import subprocess
import sys

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
from backend.mio_paths import shipped_data_dir  # noqa: E402

# The folder that contains data/ (the repository root, also after the legacy/ move); git runs
# there so the data/... paths below stay repository-relative.
ROOT = shipped_data_dir(PROGRAM).parent


def shipped_paths(root=ROOT):
    """Repository-relative paths (data/...) of every shipped data file in the manifest."""
    manifest = json.loads((Path(root) / 'data' / 'distribution.json').read_text(encoding='utf-8'))
    return ['data/' + relative for relative in sorted(manifest['files'])]


def _git(root, *args, stdin=None):
    return subprocess.run(['git', *args], cwd=root, input=stdin, capture_output=True, check=True).stdout


def tracked(root, paths):
    listed = _git(root, 'ls-files', '-z', '--', *paths).split(b'\0')
    return [p.decode('utf-8') for p in listed if p]


def set_protection(root, paths, protect=True):
    paths = tracked(root, paths)
    if paths:
        flag = '--skip-worktree' if protect else '--no-skip-worktree'
        _git(root, 'update-index', flag, '-z', '--stdin', stdin=b'\0'.join(p.encode('utf-8') for p in paths) + b'\0')
    return paths


def status(root, paths):
    """Return (protected, locally_changed) among the tracked shipped paths."""
    paths = tracked(root, paths)
    protected = []
    for line in _git(root, 'ls-files', '-v', '-z', '--', *paths).split(b'\0'):
        if line[:2] == b'S ':
            protected.append(line[2:].decode('utf-8'))
    changed = []
    for path in paths:
        committed = _git(root, 'show', 'HEAD:' + path)
        try:
            current = (Path(root) / path).read_bytes()
        except OSError:
            current = None
        if current != committed:
            changed.append(path)
    return protected, changed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--undo', action='store_true', help='stop protecting shipped data files')
    group.add_argument('--status', action='store_true', help='list protected and locally changed files')
    args = parser.parse_args(argv)
    paths = shipped_paths(ROOT)
    if args.status:
        protected, changed = status(ROOT, paths)
        print(f'{len(protected)}/{len(paths)} shipped data files protected (skip-worktree).')
        for path in changed:
            print('  locally changed:', path)
        return 0
    done = set_protection(ROOT, paths, protect=not args.undo)
    print(('Unprotected ' if args.undo else 'Protected ') + f'{len(done)} shipped data files.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
