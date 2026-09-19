import base64
import json
import mimetypes
from pathlib import Path
import re
import shutil
import tempfile
import uuid
import threading
from functools import wraps

def synchronized(fn):
    @wraps(fn)
    def call(self,*args,**kwargs):
        with self.lock:return fn(self,*args,**kwargs)
    return call
from backend.mio_library import LibraryError
from .storage import Storage,identifier,owned
from .packages import unpack,manifest,package_root

class Themes:
    def __init__(self,data):self.root=Path(data)/'themes';self.state=Storage(Path(data)/'ecosystem');self.lock=threading.RLock()
    def records(self):return self.state.get('themes',{})
    @synchronized
    def css(self,id):
        meta=self.records().get(identifier(id))
        if not meta:raise LibraryError('Theme not found',404)
        root=self.root/id;css=owned(root,meta['css']).read_text(encoding='utf-8-sig')
        if len(css)>2*1024*1024:raise LibraryError('CSS exceeds 2 MiB')
        if meta.get('cssPolicy')=='trusted':return css
        # No escapes/import chains: prevents obfuscated external fetches in theme styles.
        clean=re.sub(r'/\*.*?\*/','',css,flags=re.S)
        if '\\' in clean or re.search(r'@import\b|expression\s*\(',clean,re.I):raise LibraryError('Theme CSS cannot use escapes, @import or expression')
        if re.search(r'(?:https?:|ftp:|file:|image-set\s*\(|image\s*\(|src\s*\()',clean,re.I):raise LibraryError('Use package-local url() assets only')
        expanded=0
        def asset(match):
            nonlocal expanded
            url=match.group(1).strip().strip('\"\'')
            if url.startswith('data:'):
                if not re.match(r'data:(image/(png|jpeg|webp)|font/(woff2?|ttf|otf));base64,',url):raise LibraryError('Unsupported inline theme asset')
                return 'url("'+url+'")'
            if url.startswith('#'):return 'url("'+url+'")'
            if ':' in url or url.startswith('/'):raise LibraryError('Theme assets must be package-local')
            path=owned(root,str(Path(meta['css']).parent/url))
            if path.suffix.lower() not in ('.png','.jpg','.jpeg','.webp','.woff','.woff2','.ttf','.otf'):raise LibraryError('Unsupported theme asset type')
            if not path.is_file() or path.stat().st_size>8*1024*1024:raise LibraryError('Missing or oversized theme asset')
            mime={'.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'}.get(path.suffix.lower(),mimetypes.guess_type(path)[0])
            expanded+=path.stat().st_size*4//3+100
            if expanded>24*1024*1024:raise LibraryError('Expanded theme exceeds 24 MiB')
            return 'url("data:'+mime+';base64,'+base64.b64encode(path.read_bytes()).decode()+'")'
        result=re.sub(r'url\(\s*([^)]*)\)',asset,clean,flags=re.I)
        if len(result)>24*1024*1024:raise LibraryError('Expanded theme exceeds 24 MiB')
        return result
    @synchronized
    def install(self,raw,filename,trusted=False):
        if not trusted:raise LibraryError('Confirm trust: global CSS can hide or imitate application controls',403)
        self.root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.root,prefix='.theme-') as tmp:
            stage=Path(tmp)/'code';stage.mkdir()
            if filename.lower().endswith('.css'):
                meta={'id':'theme-'+uuid.uuid4().hex[:10],'name':Path(filename).name,'version':'1.0.0','apiVersion':1,'css':'theme.css'}
                (stage/'theme.css').write_bytes(raw);(stage/'mio.theme.json').write_text(json.dumps(meta))
            else:unpack(raw,stage);stage=package_root(stage,'theme');meta=manifest(stage,'theme')
            if len(self.records())>=32:raise LibraryError('Theme limit reached (32)')
            target=owned(self.root,meta['id'])
            if target.exists():raise LibraryError('Theme ID already installed',409)
            shutil.move(str(stage),target);items=self.records();items[meta['id']]=meta;self.state.set('themes',items)
            try:self.css(meta['id'])
            except Exception:
                items.pop(meta['id']);self.state.set('themes',items);shutil.rmtree(target);raise
            return meta
    @synchronized
    def select(self,id):
        if id:self.css(id)
        self.state.set('active-theme',id);return id
    @synchronized
    def uninstall(self,id):
        identifier(id)
        if self.state.get('active-theme','')==id:self.select('')
        items=self.records();items.pop(id,None);self.state.set('themes',items)
        if (self.root/id).exists():shutil.rmtree(owned(self.root,id))
    @synchronized
    def list(self):return {'items':list(self.records().values()),'active':self.state.get('active-theme','')}

    @synchronized
    def asset(self,id,relative):
        meta=self.records().get(identifier(id))
        if not meta or meta.get('cssPolicy')!='trusted':raise LibraryError('Theme asset unavailable',404)
        path=owned(self.root/id,relative)
        if path.suffix.lower() not in ('.css','.png','.jpg','.jpeg','.webp','.gif','.svg','.woff','.woff2','.ttf','.otf'):
            raise LibraryError('Asset type not public',403)
        if not path.is_file() or path.stat().st_size>8*1024*1024:raise LibraryError('Missing or oversized theme asset',404)
        return path
