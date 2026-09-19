"""Data-only distribution and catalog loading. No authored resource bodies live here."""
import base64
from pathlib import Path
from backend.mio_library import LibraryError, atomic_write, decode, encode, digest, owned_path, image_type


def verify(source):
    """Return (manifest, problems). Never raises for a single damaged shipped file.

    Each problem is {'file', 'reason'} where reason is 'missing' or 'changed'.
    """
    source=Path(source);manifest=decode(owned_path(source,'distribution.json').read_bytes())
    if manifest.get('schema')!='mio.distribution.v1':raise LibraryError('Invalid distribution manifest')
    problems=[]
    for relative,checksum in manifest['files'].items():
        path=owned_path(source,relative)
        if not path.is_file():problems.append({'file':relative,'reason':'missing'})
        elif digest(path.read_bytes())!=checksum:problems.append({'file':relative,'reason':'changed'})
    return manifest,problems


def distribution(source):
    """Strict verification used by tools/check_distribution.py and release builds."""
    manifest,problems=verify(source)
    if problems:
        detail=', '.join(p['file']+' ('+p['reason']+')' for p in problems)
        raise LibraryError('MIO-DATA-001: Shipped data changed: '+detail+'。请重新下载完整程序包，并运行 python tools/check_distribution.py；未导入未通过校验的内容。',500)
    return manifest


def initialize(store, project):
    """Only a genuinely empty workspace receives shipped entities. Existing IDs are never replaced.

    A damaged or edited shipped file never blocks startup: it is skipped, and the
    problem is reported through store.content_problems (surfaced by /api/content)
    so the user can re-download the package or re-run tools/build_distribution.py.
    """
    source=Path(project)/'data';marker=store.root/'runtime/content-installed.json'
    store.content_problems=[]
    if marker.exists():
        try:
            store.content_problems=list(decode(marker.read_bytes()).get('problems',[]))
        except (LibraryError,OSError,ValueError,AttributeError):
            store.content_problems=[]
        return False
    if not (source/'distribution.json').is_file():raise LibraryError('缺少随包 data/，请解压完整项目而不是只复制程序文件。',500)
    same=source.resolve()==store.root.resolve()
    fresh=store.read(album_summaries=True,include_baseline=False)['_emptyWorkspace'] and store.was_empty_at_open
    with store.library.writer():
        if marker.exists():return False
        if same:
            manifest=decode((source/'distribution.json').read_bytes());problems=[]
        else:
            manifest,problems=verify(source)
        unverified={p['file'] for p in problems}
        for relative in (() if same else manifest['files']):
            # Never overwrite workspace identity or resurrect deleted entities.
            if relative == 'workspace.json':
                continue
            if not fresh and not relative.startswith('catalog/'):
                continue
            # Unverified content is never imported; the catalog is UI text the app
            # cannot boot without, so it is copied and flagged rather than dropped.
            if relative in unverified and not (relative.startswith('catalog/') and owned_path(source,relative).is_file()):
                continue
            target=owned_path(store.root,relative)
            if target.exists():continue
            atomic_write(target,owned_path(source,relative).read_bytes())
        store.content_problems=problems
        atomic_write(marker,encode({'version':manifest['version'],'problems':problems}))
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
    values['contentProblems']=list(getattr(store,'content_problems',[]) or [])
    # Read only the designated tiny cover asset, never a catalogue of album bodies.
    values['cover']=''
    try:
        kind,id,relative=registry['cover']
        raw,_=store.image_bytes('/images/library/'+kind+'/'+id+'/'+relative)
        mime,_=image_type(raw)
        values['cover']='data:'+mime+';base64,'+base64.b64encode(raw).decode()
    except (LibraryError,OSError,KeyError):pass
    return values
