"""Data-only distribution and catalog loading. No authored resource bodies live here."""
import base64
from pathlib import Path
from backend.mio_library import LibraryError, atomic_write, decode, encode, digest, owned_path, image_type


def distribution(source):
    source=Path(source);manifest=decode(owned_path(source,'distribution.json').read_bytes())
    if manifest.get('schema')!='mio.distribution.v1':raise LibraryError('Invalid distribution manifest')
    for relative,checksum in manifest['files'].items():
        path=owned_path(source,relative)
        if not path.is_file() or digest(path.read_bytes())!=checksum:raise LibraryError('Shipped data changed: '+relative)
    return manifest


def initialize(store, project):
    """Only a genuinely empty workspace receives shipped entities. Existing IDs are never replaced."""
    source=Path(project)/'data';marker=store.root/'runtime/content-installed.json'
    if marker.exists():return False
    if not (source/'distribution.json').is_file():raise LibraryError('缺少随包 data/，请解压完整项目而不是只复制程序文件。',500)
    same=source.resolve()==store.root.resolve()
    fresh=store.read(album_summaries=True,include_baseline=False)['_emptyWorkspace'] and store.was_empty_at_open
    with store.library.writer():
        if marker.exists():return False
        manifest=decode((source/'distribution.json').read_bytes()) if same else distribution(source)
        for relative in (() if same else manifest['files']):
            if relative=='workspace.json' or not fresh and not relative.startswith('catalog/'):continue
            target=owned_path(store.root,relative)
            if target.exists():continue
            atomic_write(target,owned_path(source,relative).read_bytes())
        atomic_write(marker,encode({'version':manifest['version']}))
    store.library.scan()
    return fresh or same


def bootstrap(store):
    store.library.scan()
    registry=decode(owned_path(store.root,'catalog/index.json').read_bytes())
    if registry.get('schema')!='mio.content.v1':raise LibraryError('Unsupported content catalog')
    def load(path):
        if isinstance(path,list):return [load(p) for p in path]
        if not isinstance(path,str) or not path.startswith('catalog/'):raise LibraryError('Catalog path is outside catalog/')
        raw=owned_path(store.root,path).read_bytes()
        if path.endswith('.svg'):
            mime,_=image_type(raw);return 'data:'+mime+';base64,'+base64.b64encode(raw).decode()
        return decode(raw)
    values={k:load(v) for k,v in registry['entries'].items()}
    config=store.read(album_summaries=not getattr(store,'fresh_content',False),include_baseline=False)
    store.fresh_content=False
    values.update(config=config,registry=registry,layouts=config['uiConfig']['comfyStudio']['exportTemplates'])
    # Read only the designated tiny cover asset, never a catalogue of album bodies.
    values['cover']=''
    try:
        kind,id,relative=registry['cover']
        raw,_=store.image_bytes('/images/library/'+kind+'/'+id+'/'+relative)
        mime,_=image_type(raw)
        values['cover']='data:'+mime+';base64,'+base64.b64encode(raw).decode()
    except (LibraryError,OSError,KeyError):pass
    return values
