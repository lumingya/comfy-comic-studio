#!/usr/bin/env python3
"""Convert a stopped Mio workspace into a separate file-native v2 directory.
This does not switch the current GUI to v2 and never starts generation.
"""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mio_library import LibraryError
from mio_library_conversion import convert


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Old project directory, data directory, or complete flat config JSON')
    parser.add_argument('--output', type=Path, required=True, help='New directory that MUST NOT exist; do not point at existing data')
    parser.add_argument('--project', type=Path, help='Original project root for /images, vendor and examples assets when converting a separately exported config')
    parser.add_argument('--source-stopped', action='store_true', help='Confirm that you stopped the old service; an active worker lease is also checked')
    parser.add_argument('--dry-run', action='store_true', help='Build and verify privately, then discard; no output directory is published')
    args = parser.parse_args(argv)
    try:
        result = convert(args.source, args.output, source_stopped=args.source_stopped, dry_run=args.dry_run, project=args.project)
        brief = {k: v for k, v in result.items() if k not in ('resourceFiles', 'sourceFiles', 'unassignedAssets')}
        brief['unassignedAssetCount'] = len(result['unassignedAssets'])
        brief['sourceFileCount'] = len(result['sourceFiles'])
        print(json.dumps(brief, ensure_ascii=False, indent=2))
        return 0
    except (LibraryError, OSError, ValueError, KeyError, TypeError) as e:
        print(json.dumps({'error': str(e), 'code': getattr(e, 'code', 'conversion_failed'), 'generationStarted': False}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
