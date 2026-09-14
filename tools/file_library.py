#!/usr/bin/env python3
"""CLI for live file-native resources; never an implicit old-data migration.
Works only in explicitly selected v2 directories. Never starts generation.
"""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mio_library import FileLibrary, KINDS, LibraryError, MAX_BUNDLE, MAX_DOCUMENT, decode, image_refs, owned_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, required=True, help='An isolated v2 workspace directory; not an existing Mio 1.x data directory')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init', help='Create an empty v2 workspace, refusing an occupied old directory')
    scan = commands.add_parser('scan', help='Shallow incremental metadata scan; does not traverse image folders')
    scan.add_argument('--force', action='store_true')
    listing = commands.add_parser('list', help='Read a bounded catalogue page; scan first after copying files')
    listing.add_argument('kind', choices=KINDS)
    listing.add_argument('--limit', type=int, default=60)
    listing.add_argument('--offset', type=int, default=0)
    listing.add_argument('--query', default='')
    get = commands.add_parser('get', help='Read an authoritative resource JSON on demand')
    get.add_argument('kind', choices=KINDS); get.add_argument('id')
    imp = commands.add_parser('import', help='Import one JSON or resource ZIP as a NEW ID, never replace an existing resource')
    imp.add_argument('kind', choices=KINDS); imp.add_argument('file', type=Path)
    exp = commands.add_parser('export', help='Export one portable, credential-free resource ZIP; existing outputs are not overwritten')
    exp.add_argument('kind', choices=KINDS); exp.add_argument('id'); exp.add_argument('--output', type=Path, required=True)
    commands.add_parser('problems', help='Report invalid files and duplicate IDs')
    args = parser.parse_args(argv)
    store = None
    try:
        if args.command != 'init' and not (args.data / 'workspace.json').exists():
            raise LibraryError('Not an initialized v2 directory. Use init with an empty directory first; no old data was converted.')
        store = FileLibrary(args.data)
        if args.command == 'init':
            result = {'root': str(args.data.absolute()), 'schema': 'mio.workspace.v2', 'guiIntegrated': True}
        elif args.command == 'scan':
            result = {**store.scan(force=args.force), 'problems': store.problems()}
        elif args.command == 'list':
            result = store.catalog(args.kind, args.limit, args.offset, args.query)
        elif args.command == 'get':
            result = store.get(args.kind, args.id)
        elif args.command == 'problems':
            result = store.problems()
        elif args.command == 'import':
            limit = MAX_BUNDLE if args.file.suffix.lower() == '.zip' else MAX_DOCUMENT
            if args.file.stat().st_size > limit:
                raise LibraryError('Input exceeds size limit', 413)
            raw = args.file.read_bytes()
            if args.file.suffix.lower() == '.zip':
                result = store.import_bundle(raw, expected_kind=args.kind)
            else:
                document = decode(raw)
                base = args.file.parent if args.kind == 'albums' else args.file.with_suffix('.assets')
                assets = {ref: owned_path(base, ref).read_bytes() for ref in set(image_refs(document))}
                result = store.put(args.kind, document, create=True, assets=assets)
            result = {'id': result['document']['id'], 'file': result['file'], 'etag': result['etag']}
        elif args.command == 'export':
            raw = store.export_bundle(args.kind, args.id)
            with args.output.open('xb') as f:
                f.write(raw)
            result = {'output': str(args.output), 'bytes': len(raw)}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (LibraryError, OSError, ValueError) as e:
        print(json.dumps({'error': str(e), 'code': getattr(e, 'code', 'file_error')}, ensure_ascii=False), file=sys.stderr)
        return 2
    finally:
        if store:
            store.close()


if __name__ == '__main__':
    raise SystemExit(main())
