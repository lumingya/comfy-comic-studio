import hashlib
import io
import json
import os
import re
from pathlib import Path, PurePosixPath
import stat
import subprocess
import urllib.parse
import zipfile
from backend.mio_library import LibraryError
from .storage import identifier, owned

MAX_ARCHIVE=256*1024*1024
MAX_UNPACKED=1024*1024*1024
MAX_ENTRIES=20000
SKIP_DIRS={'.git','node_modules','__pycache__','.venv','venv','.mypy_cache','.pytest_cache','.cache'}
VARIANT_NAME=re.compile(r'^[a-z][a-z0-9-]{0,31}$')
FILE_NAME=re.compile(r'^[^\x00]{1,240}$')

def unpack(raw,destination):
    if len(raw)>MAX_ARCHIVE:raise LibraryError('ZIP exceeds 256 MiB')
    try:z=zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:raise LibraryError('Invalid ZIP') from None
    with z:
        entries=z.infolist()
        if len(entries)>MAX_ENTRIES or sum(x.file_size for x in entries)>MAX_UNPACKED:raise LibraryError('ZIP quota exceeded (20000 entries / 1 GiB)')
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
                if item.file_size>MAX_ARCHIVE:raise LibraryError('Package file too large')
                p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(item))

OPTIONAL_KEYS=('description','author','homepage','license','preview','minHost')

def _file_list(value,label):
    items=[value] if isinstance(value,str) else value
    if not isinstance(items,list) or not all(isinstance(x,str) and FILE_NAME.fullmatch(x) for x in items):raise LibraryError(label+' must be a file name or a list of file names')
    return items

def scan_revision(folder,limit=20000):
    """Content-change token for a folder on disk (paths + mtimes + sizes)."""
    digest=hashlib.sha1();count=0
    for root,dirs,files in os.walk(folder):
        dirs[:]=sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith('.'))
        for name in sorted(files):
            if name.startswith('.'):continue
            p=Path(root)/name
            try:st=p.stat()
            except OSError:continue
            digest.update((str(p.relative_to(folder))+'\0'+str(st.st_mtime_ns)+'\0'+str(st.st_size)+'\n').encode('utf-8','replace'))
            count+=1
            if count>=limit:return digest.hexdigest()[:12]
    return digest.hexdigest()[:12]

def manifest(folder,kind,strict=True):
    """Validate mio.<kind>.json.

    Extensions: apiVersion 1 (legacy toolbar SDK), 2 (platform SDK) or 3 (open platform).
    Themes: apiVersion 1 (single css), 2 (variants / tokens / icons) or 3 (stack, script, settings, any variant)."""
    p=Path(folder)/('mio.'+kind+'.json')
    if not p.is_file():raise LibraryError('Missing '+p.name)
    if p.stat().st_size>256*1024:raise LibraryError('Manifest too large')
    d=json.loads(p.read_text(encoding="utf-8-sig"));identifier(d.get('id'))
    if d.get('apiVersion') not in (1,2,3) or not isinstance(d.get('name'),str) or not d['name'].strip():raise LibraryError('Unsupported package manifest (apiVersion must be 1, 2 or 3)')
    if not isinstance(d.get('version'),str):raise LibraryError('Manifest requires version')
    result={k:d[k] for k in ('id','name','version','apiVersion')}
    for key in OPTIONAL_KEYS:
        if isinstance(d.get(key),str):result[key]=d[key][:300]
    from .registry import _field
    settings=d.get('settings',[])
    if settings:
        if not isinstance(settings,list) or len(settings)>200:raise LibraryError('settings must be a list of at most 200 fields')
        result['settings']=[]
        for item in settings:
            field=_field(item)
            if kind=='theme':
                var=item.get('var','')
                if var and (not isinstance(var,str) or not re.fullmatch(r'--[A-Za-z_][A-Za-z0-9_-]{0,79}',var)):raise LibraryError('Theme setting var must be a CSS custom property name')
                field['var']=var
                if isinstance(item.get('unit'),str):field['unit']=item['unit'][:12]
                if isinstance(item.get('selector'),str):field['selector']=item['selector'][:200]
                if isinstance(item.get('group'),str):field['group']=item['group'][:60]
            result['settings'].append(field)
    if kind=='extension':
        entry=d.get('entry','index.js')
        if not isinstance(entry,str) or not entry.endswith(('.js','.mjs')):raise LibraryError('Extension entry must be a JS module')
        has_js=owned(folder,entry).is_file();has_py=owned(folder,'plugin.py').is_file()
        if not has_js and not has_py:raise LibraryError('Extension needs index.js and/or plugin.py')
        result['entry']=entry if has_js else '';result['backend']=has_py
        styles=d.get('styles',[])
        if styles:
            result['styles']=_file_list(styles,'styles')
            for s in result['styles']:
                if not owned(folder,s).is_file():raise LibraryError('Missing extension style: '+s)
        slots=d.get('permissions',[])
        if slots and (not isinstance(slots,list) or not all(isinstance(x,str) for x in slots)):raise LibraryError('permissions must be a string list')
        if slots:result['permissions']=slots[:64]
        requirements=d.get('requirements')
        if requirements:
            if isinstance(requirements,str):
                if not owned(folder,requirements).is_file():raise LibraryError('Missing requirements file: '+requirements)
                result['requirements']=requirements
            elif isinstance(requirements,list) and all(isinstance(x,str) and x.strip() for x in requirements):result['requirements']=[x.strip()[:200] for x in requirements[:200]]
            else:raise LibraryError('requirements must be a file name or a list of pip specifiers')
        contributes=d.get('contributes')
        if contributes is not None:
            if not isinstance(contributes,dict) or len(json.dumps(contributes))>64*1024:raise LibraryError('contributes must be a small JSON object')
            result['contributes']=contributes
        if isinstance(d.get('keywords'),list):result['keywords']=[str(x)[:40] for x in d['keywords'][:20]]
    else:
        css=d.get('css','theme.css')
        files=_file_list(css,'css') if css else []
        for f in files:
            if not owned(folder,f).is_file():raise LibraryError('Missing package entry: '+f)
        result['css']=files
        variants=d.get('variants',{}) if d.get('apiVersion',1)>=2 else {}
        if not isinstance(variants,dict) or any(not VARIANT_NAME.fullmatch(str(k)) or not isinstance(v,str) for k,v in variants.items()):raise LibraryError('variants must map names like dark/light/sepia to CSS files')
        for v in variants.values():
            if not owned(folder,v).is_file():raise LibraryError('Missing variant CSS: '+v)
        result['variants']=variants
        if not files and not variants:raise LibraryError('Theme needs css and/or variants')
        tokens=d.get('tokens',{}) if d.get('apiVersion',1)>=2 else {}
        if not isinstance(tokens,dict) or any(not VARIANT_NAME.fullmatch(str(k)) and k!='shared' or not isinstance(v,dict) for k,v in tokens.items()):raise LibraryError('tokens must be {shared|dark|light|<variant>: {--name: value}}')
        result['tokens']=tokens
        icons=d.get('icons','')
        if icons:
            if not isinstance(icons,str) or not owned(folder,icons).is_file():raise LibraryError('icons must point to a JSON file inside the package')
            result['icons']=icons
        script=d.get('script','')
        if script:
            if not isinstance(script,str) or not script.endswith(('.js','.mjs')) or not owned(folder,script).is_file():raise LibraryError('script must point to a JS module inside the package')
            result['script']=script
        result['colorScheme']=d.get('colorScheme','auto') if d.get('colorScheme') in ('auto','dark','light') else 'auto'
        if isinstance(d.get('variantLabels'),dict):result['variantLabels']={str(k)[:32]:str(v)[:40] for k,v in d['variantLabels'].items()}
    if strict:
        for p in Path(folder).rglob('*'):
            if p.is_symlink():raise LibraryError('Package symlinks forbidden')
    return result

def package_root(folder,kind):
    if (Path(folder)/('mio.'+kind+'.json')).exists():return Path(folder)
    children=[p for p in Path(folder).iterdir() if p.is_dir() and p.name!='__MACOSX']
    if len(children)==1:return children[0]
    raise LibraryError('Package must have one root directory')

def git_command(args,cwd=None,timeout=180):
    try:
        r=subprocess.run(['git','-c','core.hooksPath=/dev/null','-c','protocol.file.allow=never',*args],cwd=cwd,stdin=subprocess.DEVNULL,capture_output=True,timeout=timeout,env={'PATH':os.environ.get('PATH',''),'HOME':str(Path.home()),'GIT_TERMINAL_PROMPT':'0','GIT_CONFIG_NOSYSTEM':'1'})
    except subprocess.TimeoutExpired:raise LibraryError('Git timed out; installation not published',408) from None
    if r.returncode:raise LibraryError('Git operation failed. Check repository URL, branch, network or local changes.',400)

def clone(url,branch,dest):
    u=urllib.parse.urlsplit(url)
    if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.hostname in ('localhost','127.0.0.1','::1'):raise LibraryError('Use a public HTTPS Git URL without credentials')
    args=['clone','--depth=1','--no-recurse-submodules']
    if branch:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,120}',branch) or '..' in branch:raise LibraryError('Invalid branch')
        args+=['--branch',branch]
    git_command(args+['--',url,str(dest)])
