import io
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tempfile
import urllib.parse
import zipfile
from backend.mio_library import LibraryError
from .storage import identifier, owned

MAX_ARCHIVE=32*1024*1024

def unpack(raw,destination):
    if len(raw)>MAX_ARCHIVE:raise LibraryError('ZIP exceeds 32 MiB')
    try:z=zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:raise LibraryError('Invalid ZIP') from None
    with z:
        entries=z.infolist()
        if len(entries)>2048 or sum(x.file_size for x in entries)>128*1024*1024:raise LibraryError('ZIP quota exceeded')
        seen=set()
        for item in entries:
            name=item.filename
            if '\\' in name or ':' in name or '\x00' in name:raise LibraryError('Invalid ZIP path')
            rel=PurePosixPath(name)
            if '.git' in rel.parts or stat.S_ISLNK(item.external_attr>>16):raise LibraryError('ZIP contains forbidden metadata or links')
            p=owned(destination,name)
            if str(p).lower() in seen:raise LibraryError('Duplicate ZIP path')
            seen.add(str(p).lower())
            if item.is_dir():p.mkdir(parents=True,exist_ok=True)
            else:
                if item.file_size>32*1024*1024:raise LibraryError('Package file too large')
                p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(item))

def manifest(folder,kind):
    p=Path(folder)/('mio.'+kind+'.json')
    if not p.is_file():raise LibraryError('Missing '+p.name)
    if p.stat().st_size>65536:raise LibraryError('Manifest too large')
    d=json.loads(p.read_text());identifier(d.get('id'))
    if d.get('apiVersion')!=1 or not isinstance(d.get('name'),str) or not d['name'].strip():raise LibraryError('Unsupported package manifest')
    if not isinstance(d.get('version'),str):raise LibraryError('Manifest requires version')
    entry='index.js' if kind=='extension' else d.get('css','theme.css')
    if not owned(folder,entry).is_file():raise LibraryError('Missing package entry: '+entry)
    for p in Path(folder).rglob('*'):
        if p.is_symlink():raise LibraryError('Package symlinks forbidden')
    return {k:d[k] for k in ('id','name','version','apiVersion')}|({'css':entry} if kind=='theme' else {})

def package_root(folder,kind):
    if (Path(folder)/('mio.'+kind+'.json')).exists():return Path(folder)
    children=[p for p in Path(folder).iterdir() if p.is_dir() and p.name!='__MACOSX']
    if len(children)==1:return children[0]
    raise LibraryError('Package must have one root directory')

def git_command(args,cwd=None,timeout=90):
    try:
        r=subprocess.run(['git','-c','core.hooksPath=/dev/null','-c','protocol.file.allow=never',*args],cwd=cwd,stdin=subprocess.DEVNULL,capture_output=True,timeout=timeout,env={'PATH':__import__('os').environ.get('PATH',''),'HOME':str(Path.home()),'GIT_TERMINAL_PROMPT':'0','GIT_CONFIG_NOSYSTEM':'1'})
    except subprocess.TimeoutExpired:raise LibraryError('Git timed out; installation not published',408) from None
    if r.returncode:raise LibraryError('Git operation failed. Check repository URL, branch, network or local changes.',400)

def clone(url,branch,dest):
    u=urllib.parse.urlsplit(url)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.hostname in ('localhost','127.0.0.1','::1'):raise LibraryError('Use a public HTTPS Git URL without credentials')
    args=['clone','--depth=1','--no-recurse-submodules']
    if branch:
        import re
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,120}',branch) or '..' in branch:raise LibraryError('Invalid branch')
        args+=['--branch',branch]
    git_command(args+['--',url,str(dest)])
