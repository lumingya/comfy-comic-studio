import contextlib
import json
import os
from pathlib import Path
import re
import threading
from backend.mio_library import atomic_write, LibraryError

LOCK = threading.RLock()

def identifier(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}',value) or value in ('core','api','runtime','settings'):
        raise LibraryError('Invalid package identifier',400)
    return value

def owned(root, relative):
    original=Path(root).absolute()
    if any(p.is_symlink() for p in [original,*original.parents]):raise LibraryError('Symlink storage roots are forbidden')
    root=original.resolve(); rel=Path(relative)
    if rel.is_absolute() or '..' in rel.parts or not rel.parts:
        raise LibraryError('Path outside package',400)
    path=root/rel
    if any(p.is_symlink() for p in [path,*path.parents] if p!=root.parent):
        raise LibraryError('Symlinks are not allowed',400)
    if not path.resolve().is_relative_to(root):raise LibraryError('Path outside package',400)
    return path

VALUE_LIMIT=32*1024*1024
QUOTA=1024*1024*1024

class Storage:
    """Atomic owner-scoped JSON. This SDK is not an OS sandbox for trusted Python."""
    def __init__(self,root,value_limit=VALUE_LIMIT,quota=QUOTA):self.root=Path(root);self.value_limit=value_limit;self.quota=quota
    def file(self,key):
        if not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',key):raise LibraryError('Invalid storage key')
        return owned(self.root,key+'.json')
    @contextlib.contextmanager
    def locked(self):
        with LOCK:
            lock=owned(self.root,'.store.lock')
            self.root.mkdir(parents=True,exist_ok=True)
            with open(lock,'a+b') as handle:
                if os.name=='nt':
                    import msvcrt
                    if handle.tell()==0:handle.write(b'0');handle.flush()
                    handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_LOCK,1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(),fcntl.LOCK_EX)
                try:yield
                finally:
                    if os.name=='nt':handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
                    else:fcntl.flock(handle.fileno(),fcntl.LOCK_UN)
    def get(self,key,default=None):
        with self.locked():
            p=self.file(key)
            return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    def set(self,key,value):
        raw=json.dumps(value,ensure_ascii=False,allow_nan=False).encode()
        if len(raw)>self.value_limit:raise LibraryError('Storage value exceeds '+str(self.value_limit//(1024*1024))+' MiB')
        with self.locked():
            target=self.file(key)
            if sum(p.stat().st_size for p in self.root.glob('*.json') if p!=target)+len(raw)>self.quota:raise LibraryError('Storage quota exceeded')
            atomic_write(self.file(key),raw);os.chmod(self.file(key),0o600)
        return value
    def delete(self,key):
        with self.locked():self.file(key).unlink(missing_ok=True)
    def keys(self):
        with self.locked():
            return sorted(p.stem for p in self.root.glob('*.json')) if self.root.is_dir() else []
