"""Runtime content loading. Release checksum verification lives in tools/."""
import base64
from pathlib import Path
from backend.mio_library import LibraryError, atomic_write, decode, encode, owned_path, image_type


def distribution(source):
    """Read the explicit seed list, not an integrity verdict on a mutable workspace.

    Hashes are release metadata. Runtime still validates the manifest structure
    and all paths before importing anything, but never compares file hashes.
    """
    source = Path(source)
    try:
        manifest = decode(owned_path(source, 'distribution.json').read_bytes())
    except FileNotFoundError:
        raise LibraryError('缺少 data/distribution.json 内容清单，请检查程序目录。', 500) from None
    if (not isinstance(manifest, dict)
            or manifest.get('schema') != 'mio.distribution.v1'
            or not isinstance(manifest.get('version'), str)
            or not isinstance(manifest.get('files'), dict)):
        raise LibraryError('Invalid distribution manifest', 500)
    for relative in manifest['files']:
        owned_path(source, relative)
    return manifest


def _record_installation(marker, manifest):
    # Diagnostics describe this startup, not historical checksum mismatches.
    # Do not deserialize/replay old markers or reseed a workspace when damaged.
    raw = encode({'version': manifest['version']})
    if not marker.is_file() or marker.read_bytes() != raw:
        atomic_write(marker, raw)


def initialize(store, project):
    """Seed only genuinely new workspaces; never overwrite or resurrect user data.

    Locally edited seeds are valid runtime input. Missing seeds are skipped and
    reported; invalid entity JSON is handled by the file library's diagnostics.
    Unlisted drafts, secrets and runtime files are never discovered or copied.
    """
    source = Path(project) / 'data'
    marker = owned_path(store.root, 'runtime/content-installed.json')
    store.content_problems = []
    if marker.exists():
        refresh_catalog(store, source, marker)
        return False
    manifest = distribution(source)
    same = source.resolve() == store.root.resolve()
    fresh = store.read(album_summaries=True, include_baseline=False)['_emptyWorkspace'] and store.was_empty_at_open
    with store.library.writer():
        if marker.exists():
            return False
        for relative in (() if same else manifest['files']):
            if relative == 'workspace.json':
                continue
            if not fresh and not relative.startswith('catalog/'):
                continue
            target = owned_path(store.root, relative)
            if target.exists():
                continue
            shipped = owned_path(source, relative)
            if not shipped.is_file():
                store.content_problems.append({'file': relative, 'reason': 'missing'})
                continue
            atomic_write(target, shipped.read_bytes())
        _record_installation(marker, manifest)
    store.library.scan()
    return fresh or same


def refresh_catalog(store, source, marker):
    """Refresh program-owned UI text, including local development edits.

    Never refresh albums, presets, settings or other workspace entities. Do not
    consult persisted checksum warnings: fixing a source file clears the warning
    on the next startup, without replaying the first-install entity import.
    """
    source = Path(source)
    if not (source / 'distribution.json').is_file() or source.resolve() == store.root.resolve():
        return []
    manifest = distribution(source)
    refreshed = []
    with store.library.writer():
        for relative in manifest['files']:
            if not relative.startswith('catalog/'):
                continue
            shipped = owned_path(source, relative)
            if not shipped.is_file():
                store.content_problems.append({'file': relative, 'reason': 'missing'})
                continue
            raw = shipped.read_bytes()
            target = owned_path(store.root, relative)
            if target.is_file() and target.read_bytes() == raw:
                continue
            atomic_write(target, raw)
            refreshed.append(relative)
        _record_installation(marker, manifest)
    return refreshed


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
