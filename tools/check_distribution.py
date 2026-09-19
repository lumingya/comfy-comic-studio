"""Verify the explicit shipped data list. Never auto-discover or include user content.

Exit code 1 lists every damaged or missing shipped file. To refresh checksums
after intentionally editing shipped data, run python tools/build_distribution.py.
"""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.mio_content import verify
if __name__=='__main__':
    root=Path(__file__).resolve().parents[1]/'data'
    manifest,problems=verify(root)
    for problem in problems:
        print('MIO-DATA-001:',problem['reason'],problem['file'])
    if problems:
        print('Shipped data does not match data/distribution.json. Re-download the package, or run python tools/build_distribution.py after an intentional edit.')
        sys.exit(1)
    print('Verified',len(manifest['files']),'independent data files')
