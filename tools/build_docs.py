"""Generate self-contained HTML siblings for all maintained Markdown guides."""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import mio_docs

if __name__ == '__main__':
    print(f'Built {mio_docs.build(ROOT)} offline documentation pages.')
