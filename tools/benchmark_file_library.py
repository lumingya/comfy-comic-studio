#!/usr/bin/env python3
"""Reproducible local metadata benchmark; deletes all generated fixtures.
Run: python tools/benchmark_file_library.py --albums 5000
No network, no image decoding, no existing user data access.
"""
import argparse
import json
from pathlib import Path
import platform
import statistics
import sys
import tempfile
import time
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.mio_library import FileLibrary, encode


def measure(fn):
    start = time.perf_counter()
    value = fn()
    return value, round((time.perf_counter() - start) * 1000, 3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--albums', type=int, default=5000)
    args = parser.parse_args()
    if not 1 <= args.albums <= 100000:
        parser.error('--albums must be 1..100000')
    with tempfile.TemporaryDirectory(prefix='mio-library-benchmark-') as root:
        library = FileLibrary(root)
        parent = Path(root) / 'albums'
        total_bytes = 0
        prompt = '构图保持完整，人物身份和服装一致，使用清晰的叙事光线。' * 40
        for n in range(args.albums):
            folder = parent / ('book_' + str(n).zfill(6))
            folder.mkdir()
            doc = {'schema': 'mio.resource.v2', 'kind': 'albums', 'id': folder.name,
                   'title': '性能测试画册 ' + str(n), 'totalSteps': 12, 'createdAt': 1700000000000+n,
                   'steps': [{'stepIndex': i, 'name': '第 ' + str(i+1) + ' 幕',
                              'prompt': prompt, 'caption': '完整正文并不进入目录缓存。'} for i in range(12)]}
            raw = encode(doc); (folder / 'album.json').write_bytes(raw); total_bytes += len(raw)
        scan, cold_ms = measure(library.scan)
        before = library.catalog('albums', limit=60)
        assert before['total'] == args.albums
        assert len(before['items']) == min(60, args.albums)
        assert prompt not in json.dumps(before, ensure_ascii=False)
        library.close()
        library, open_ms = measure(lambda: FileLibrary(root))
        timings = []
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('Warm catalogue read opened source JSON')):
            for _ in range(20):
                _, ms = measure(lambda: library.catalog('albums', limit=60))
                timings.append(ms)
            warm_scan, scan_ms = measure(library.scan)
        assert warm_scan['changed'] == 0
        file = parent / 'book_000000' / 'album.json'
        changed = json.loads(file.read_bytes()); changed['title'] = '只改了一本'; file.write_bytes(encode(changed))
        increment, increment_ms = measure(library.scan)
        assert increment['changed'] == 1
        report = {'environment': {'python': platform.python_version(), 'platform': platform.platform(), 'note': 'Sandbox filesystem/OS cache; not physical disk cold boot or native Windows performance'},
                  'fixture': {'albums': args.albums, 'scenesPerAlbum': 12, 'sourceJsonBytes': total_bytes, 'imageFiles': 0},
                  'resultMs': {'rebuildMissingCache': cold_ms, 'openValidCache': open_ms,
                               'catalogPage60Median': round(statistics.median(timings), 3),
                               'catalogPage60Max': max(timings), 'unchangedShallowMetadataScan': scan_ms,
                               'singleChangedFileScan': increment_ms},
                  'checks': {'warmPageSourceJsonReads': 0, 'warmScanSourceJsonReads': 0,
                             'singleChangedFileReads': increment['changed'], 'decodedImages': 0,
                             'pageBytes': len(encode(before))},
                  'limits': ['This is the storage layer, NOT end-to-end app startup.',
                             'A missing cache requires a background read of all entity JSON once.',
                             'Warm discovery still stats each metadata file, O(number of entities).',
                             'Exact total and duplicate exclusion use SQL index scans; no O(1) claim.',
                             'No real image corpus, mobile device, Windows or network filesystem was benchmarked.']}
        library.close()
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
