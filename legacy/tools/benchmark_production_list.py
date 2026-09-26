"""Local-only summary benchmark. No provider, credentials, or user-data reads."""
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.production.queue import ProductionQueue


def main():
    with tempfile.TemporaryDirectory(prefix='mio-list-benchmark-') as root:
        q = ProductionQueue(root, lambda *_: {}, lambda *_: {})
        try:
            for i in range(50):
                key = f'assembly-bench-{i}'
                q.tasks.set(key, {
                    'id': key, 'title': 'benchmark', 'status': 'complete',
                    'snapshot': {'story': {'title': 'benchmark', 'frames': [{}] * 64}},
                    'prepared': None,
                    'pages': [{'index': n, 'state': 'complete',
                               'result': {'image': '/images/benchmark.png'},
                               'attempts': [{'status': 'complete', 'rawError': 'not returned'}]}
                              for n in range(64)]})
                q.control['order'].append(key)
            times = []
            with patch.object(q.tasks, '_read', wraps=q.tasks._read) as reads:
                for _ in range(10):
                    started = time.perf_counter()
                    result = q.list()
                    payload = json.dumps(result, ensure_ascii=False).encode()
                    times.append((time.perf_counter() - started) * 1000)
                assert reads.call_count == 0
                print(json.dumps({'tasks': 50, 'pagesPerTask': 64, 'samples': len(times),
                    'objectReadsTotal': reads.call_count, 'responseBytes': len(payload),
                    'listAndJSONMedianMs': round(statistics.median(times), 2),
                    'listAndJSONMaxMs': round(max(times), 2),
                    'scope': 'local fixture; manifest reads remain; not a provider benchmark'}, indent=2))
        finally:
            q.close()


if __name__ == '__main__':
    main()
