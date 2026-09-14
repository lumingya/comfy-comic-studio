"""Verify the explicit shipped data list. Never auto-discover or include user content."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from mio_content import distribution
if __name__=='__main__':
    root=Path(__file__).resolve().parents[1]/'data'
    manifest=distribution(root)
    print('Verified',len(manifest['files']),'independent data files')
