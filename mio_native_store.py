"""Native runtime: independent authoritative files, entity CAS, owned immutable assets.
The flat DTO is an in-memory domain adapter only; it is never an on-disk store.
"""
import base64
import copy
import hashlib
import json
import re
import time
import uuid
import urllib.parse
from pathlib import Path
from mio_library import FileLibrary, LibraryError, ID, atomic_write, decode, digest, encode, image_type, owned_path
from mio_library_settings import FileSettings, leaves, binding
from mio_library_workspace import WorkspaceRepository, GROUPS, map_images


def merge_three(base, ours, current):
    """Three-way field merge; overlapping edits conflict, never last-writer-wins."""
    missing = _MISSING
    if ours == base: return copy.deepcopy(current) if current is not missing else missing
    if current == base or ours == current: return copy.deepcopy(ours) if ours is not missing else missing
    if all(isinstance(v, dict) for v in (base, ours, current)):
        result = {}
        for key in base.keys() | ours.keys() | current.keys():
            if key in ('updatedAt','savedAt') and all(type(v.get(key)) in (int,float) for v in (ours,current)):
                result[key]=max(ours[key],current[key]);continue
            try:value = merge_three(base.get(key,missing), ours.get(key,missing), current.get(key,missing))
            except LibraryError as e:raise LibraryError(str(key)+'.'+str(e),e.status,e.code) from None
            if value is not missing: result[key] = value
        return result
    if all(isinstance(v,list) for v in (base,ours,current)):
        items = base + ours + current
        field = 'id' if items and all(isinstance(v,dict) and 'id' in v for v in items) else 'stepIndex'
        if items and all(isinstance(v,dict) and field in v for v in items):
            maps = [{v[field]:v for v in arr} for arr in (base,ours,current)]
            if any(len(m)!=len(arr) for m,arr in zip(maps,(base,ours,current))):
                raise LibraryError('Duplicate merge identity',409,'revision_conflict')
            merged=merge_three(*maps)
            order=list(dict.fromkeys([v[field] for v in ours+current]))
            return [merged[k] for k in order if k in merged]
    raise LibraryError('同一字段已被其他编辑者修改；本页草稿未覆盖磁盘内容。',409,'revision_conflict')

_MISSING = object()


def split_dto(value):
    c = copy.deepcopy(value)
    ui = c.pop('uiConfig', {})
    meta = ui.setdefault('comfyStudio', {})
    creation = meta.setdefault('creation', {})
    matrix = c.pop('batchMatrix', {}); chats = c.pop('chatConfig', {}); queue = c.pop('batchRunState', {})
    groups = {'storyboards': c.pop('templates', []), 'albums': c.pop('savedGalleries', []),
              'workflows': c.pop('comfyWorkflows', []), 'rows': matrix.pop('rows', []),
              'collections': meta.pop('projects', []), 'plans': creation.pop('plans', []),
              'layouts': meta.pop('exportTemplates', []), 'conversations': chats.pop('sessions', []),
              'tasks': queue.pop('queue', []), 'characters': [], 'scenes': []}
    presets = creation.pop('variableSets', [])
    for item in presets:
        groups['scenes' if item.get('category') == 'scenes' else 'characters'].append(item)
    settings = {name: c.pop(field, {}) for name, field in [('comfy','comfyConfig'),('llm','llmConfig'),('xml','xmlConfig')]}
    ordering = {field: [x['id'] for x in groups[kind]] for field, kind in GROUPS.items()}
    ordering['variableSets'] = [x['id'] for x in presets]
    settings['workspace'] = {'globals': {k:v for k,v in c.items() if not k.startswith('_') and k not in ('expectedRevision','forceWrite','updatedAt')},
                             'ui': ui, 'matrix': matrix, 'chats': chats, 'queue': queue, 'ordering': ordering, 'aliases': [], 'executionStartPolicy': 'manual'}
    return groups, settings


class NativeStore(WorkspaceRepository):
    def __init__(self, root, project):
        self.was_empty_at_open = not (Path(root)/'workspace.json').exists()
        library = FileLibrary(root)
        super().__init__(library)
        self.root = library.root
        self.project = Path(project)
        self.root.joinpath('runtime/staging/images').mkdir(parents=True, exist_ok=True)
        # A warm cache serves immediately. Cold rebuilding is explicit to the client;
        # empty cached results must never trigger default-data seeding during rebuild.
        self.ready = False
        self.library.start_scan()

    def wait_index(self):
        thread = self.library._scan_thread
        if thread:
            thread.join()
        if self.library.scan_state.get('error'):
            raise LibraryError('Index could not be rebuilt: ' + self.library.scan_state['error'], 503)
        self.ready = True

    def entity(self, kind, id, urls=True):
        result = super().entity(kind, id, urls)
        if kind in ('characters', 'scenes'):
            result['document']['category'] = kind
        return result

    def summary(self, kind, row):
        item = {**copy.deepcopy(row), '_lazy': True}
        item.pop('etag', None); item.pop('file', None)
        if kind == 'albums':
            item.setdefault('steps', [])
            for key in ('characterName','rowId','templateId','templateTitle','synopsis','storyTitle'):
                item.setdefault(key, '' if key not in ('rowId','templateId') else 'unassigned')
            item.setdefault('tags', []); item.setdefault('totalSteps', 0); item.setdefault('generatedSteps', 0)
            item.setdefault('createdAt', 0); item.setdefault('updatedAt', item['createdAt'])
            item.setdefault('status', 'partial'); item['inProgress'] = False
            item['_cover'] = '/images/library/albums/' + row['id'] + '/' + row['cover'] if row.get('cover') else ''
        elif kind == 'storyboards':
            item.setdefault('frames', []); item.setdefault('outline', '')
        return item

    def read(self, album_summaries=False, include_baseline=True):
        self.wait_index()
        if self.library.problems():
            # Valid resources remain visible, with diagnostics. Never silently replace bad files.
            problems = self.library.problems()
        else:
            problems = []
        for receipt in (self.root/'runtime/materialization').glob('*.json'):
            try:
                if decode(receipt.read_bytes()).get('error'):
                    problems.append({'file':receipt.relative_to(self.root).as_posix(),'message':'执行或图片记录已保存，但独立画册文件整理失败。请检查磁盘权限/空间，重启后恢复；不会重新调用模型。'})
            except (OSError, ValueError):
                problems.append({'file':receipt.relative_to(self.root).as_posix(),'message':'无法读取画册整理记录，请检查文件；没有自动删除。'})
        result = super().read(album_summaries=album_summaries)
        presets=result['uiConfig']['comfyStudio']['creation']['variableSets']
        ids=[v['id'] for v in presets]
        if len(ids)!=len(set(ids)):
            raise LibraryError('角色与场景设定的 ID 重复；请修正复制文件的 ID 后重新读取，未覆盖原件。',409)

        revisions = {}
        for kind in GROUPS.values():
            rows = self.records(kind)
            for r in rows:
                revisions[kind + ':' + r['id']] = r['etag']
            if kind == 'albums' and album_summaries:
                result['savedGalleries'] = [self.summary(kind, r) for r in rows]
        for name in ('workspace','comfy','llm','xml'):
            revisions['settings:' + name] = self.settings.get(name)['etag']
        result['_fileRevisions'] = revisions
        result['_libraryProblems'] = problems
        result['_emptyWorkspace'] = not revisions.get('settings:workspace') and not any(not k.startswith('settings:') for k in revisions) and not problems
        result['updatedAt'] = self.revision()
        # Store canonical baseline hashes for internal writers. Clients use entity deltas.
        if not include_baseline:return result
        groups, settings = split_dto(result)
        result['_fileBaseline'] = {kind+':'+x['id']: digest(encode(x)) for kind,items in groups.items() for x in items}
        result['_fileBaseline'].update({'settings:'+k: digest(encode(v)) for k,v in settings.items()})
        return result

    def image_path(self, url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme and (parsed.scheme not in ('http','https') or parsed.hostname not in ('localhost','127.0.0.1','::1')):
            raise LibraryError('Only local immutable images are accepted', 422)
        p = urllib.parse.unquote(parsed.path)
        if p.startswith('/images/library/'):
            parts = p[len('/images/library/'):].split('/', 2)
            if len(parts) != 3:
                raise LibraryError('Invalid image address')
            kind, id, relative = parts
            try:
                if kind == 'settings':
                    self.settings.asset(id, relative)
                meta = self.settings._path(id) if kind == 'settings' else self.library._path(kind, id)
                base = meta.with_suffix('.assets') if kind == 'settings' else self.library.asset_root(kind, meta)
                path = owned_path(base, relative)
                if not relative.startswith('images/'):
                    raise LibraryError('Invalid image scope')
                if path.is_file():
                    image_type(path.read_bytes())
                    return path
            except LibraryError as e:
                if kind == 'settings' or e.status != 404:
                    raise
            # Snapshots may outlive their source preset. Content-addressed staging
            # remains immutable; every accepted native image is mirrored here.
            name = Path(relative).name
        elif p.startswith('/images/runtime/images/'):
            name = p[len('/images/runtime/images/'):]
        elif p.startswith(('/vendor/','/examples/')):
            path = owned_path(self.project, p.lstrip('/'))
            image_type(path.read_bytes())
            return path
        else:
            raise LibraryError('Unknown native image path', 404)
        if not re.fullmatch(r'[a-f0-9]{64}\.(png|jpg|jpeg|webp|svg)', name):
            raise LibraryError('Invalid immutable image identity', 404)
        for folder in ('runtime/staging/images','runtime/execution/images','runtime/unassigned/images'):
            path = owned_path(self.root, folder + '/' + name)
            if path.is_file():
                return path
        raise LibraryError('Image is missing', 404)

    def image_bytes(self, value):
        if value.startswith('data:image/'):
            header, data = value.split(',', 1)
            raw = base64.b64decode(data, validate=True) if header.endswith(';base64') else urllib.parse.unquote_to_bytes(data)
        else:
            raw = self.image_path(value).read_bytes()
        if len(raw) > 50 * 1024 * 1024:
            raise LibraryError('Image exceeds 50 MiB', 413)
        _, extension = image_type(raw)
        return raw, digest(raw) + extension

    def upload(self, value):
        raw, name = self.image_bytes(value)
        path = self.root / 'runtime/staging/images' / name
        if not path.exists():
            atomic_write(path, raw)
        return '/images/runtime/images/' + name

    def localize(self, value, base):
        if isinstance(value, str) and value.startswith(('/images/','data:image/','/vendor/','/examples/')):
            raw, name = self.image_bytes(value)
            for path in (base / 'images' / name, self.root / 'runtime/staging/images' / name):
                if not path.exists():
                    atomic_write(path, raw)
            return 'images/' + name
        if isinstance(value, dict):
            return {k:self.localize(v, base) for k,v in value.items()}
        if isinstance(value, list):
            return [self.localize(v, base) for v in value]
        return value

    def freeze(self, value):
        if isinstance(value, str) and value.startswith('/images/'):
            return self.upload(value)
        if isinstance(value, dict):
            return {k:self.freeze(v) for k,v in value.items()}
        if isinstance(value, list):
            return [self.freeze(v) for v in value]
        return value

    def _resource(self, kind, value, path, previous=None):
        doc = copy.deepcopy(value)
        for key in ('_lazy','_cover','_missingIndices','_score','etag','file'):
            doc.pop(key, None)
        replaced = {k:doc[k] for k in ('schema','kind') if k in doc}
        added = []
        if not doc.get('title'):
            doc['title'] = str(doc.get('name') or doc.get('bookTitle') or doc.get('character') or doc['id']); added.append('title')
        doc['_sourceFormat'] = {'replaced': replaced, 'added': added}
        doc.update(schema='mio.resource.v2', kind=kind)
        doc = self.localize(doc, self.library.asset_root(kind, path))
        self.library.validate(kind, doc)
        return doc

    def apply(self, changes, removals=(), settings_changes=(), internal=False, before_commit=None):
        self.wait_index()
        if len(changes) + len(removals) > 20000:
            raise LibraryError('Too many entity operations')
        with self.library.writer():
            self.library._recover()
            prepared = []
            deleted={(op.get('kind'),op.get('id')) for op in removals}
            created={(op.get('kind'),op.get('id')) for op in changes}
            for kind,id in created:
                if kind not in ('characters','scenes'):continue
                other='scenes' if kind=='characters' else 'characters'
                if (other,id) in created:
                    raise LibraryError('角色和场景设定不能使用相同 ID',409)
                if (other,id) not in deleted:
                    try:self.library.get(other,id)
                    except LibraryError as exc:
                        if exc.status!=404:raise
                    else:raise LibraryError('其他类别已有相同设定 ID，未覆盖文件',409)
            identities = set()
            for op in list(changes) + list(removals):
                kind, id = op.get('kind'), op.get('id')
                if kind not in GROUPS.values() or not ID.fullmatch(str(id)):
                    raise LibraryError('Invalid resource identity')
                key = kind + ':' + id
                if key in identities:
                    raise LibraryError('Repeated resource operation')
                identities.add(key)
                try:
                    current = self.library.get(kind, id)
                except LibraryError as e:
                    if e.status != 404:
                        raise
                    current = None
                conflict = not (op in removals and current is None) and (current['etag'] if current else None) != op.get('expected')
                if conflict and (op in removals or not current or not isinstance(op.get('baseline'),dict)):
                    raise LibraryError('文件已被其他编辑者修改：' + id, 409, 'revision_conflict')
                if op in removals:
                    if current:
                        prepared.append(('delete', kind, id, current))
                    continue
                value = op['document']
                if value.get('id') != id or value.get('_lazy'):
                    raise LibraryError('目录摘要不能作为完整资源保存', 422)
                path = self.root / current['file'] if current else self.library._new_path(kind, {**value,'title':value.get('title') or value.get('bookTitle') or id})
                doc = self._resource(kind, value, path, current)
                if conflict:
                    baseline=self._resource(kind,op['baseline'],path)
                    if kind=='tasks' and current['document'].get('serverId') and not internal:
                        managed=[k for k in current['document'] if k.startswith('server') and k not in ('serverInput','serverId','serverIndices','serverMeta','serverLiveInputs')]+['status','done','error']
                    elif kind=='albums':managed=['status','generatedSteps','inProgress']
                    else:managed=[]
                    for field in managed:
                        if field in current['document']:
                            baseline[field]=copy.deepcopy(current['document'][field]);doc[field]=copy.deepcopy(current['document'][field])
                    doc=merge_three(baseline,doc,current['document'])
                    self.library.validate(kind,doc)
                prepared.append(('put',kind,id,(path,doc)))
            operations = []
            vault = self.settings._vault()
            vault_before = encode(vault)
            setting_refs = {}
            names = set()
            for op in settings_changes:
                name = op['name']
                if name in names:
                    raise LibraryError('Repeated settings operation')
                names.add(name)
                current = self.settings.get(name)
                base_path=self.settings._path(name).with_suffix('.assets')
                doc = self.localize(op['document'], base_path)
                if current['etag'] != op.get('expected'):
                    if not isinstance(op.get('baseline'),dict):
                        raise LibraryError('设置已被其他编辑者修改：' + name, 409, 'revision_conflict')
                    baseline=self.localize(op['baseline'],base_path)
                    public_current=copy.deepcopy(current['document'])
                    for obj in (baseline,doc,public_current):obj.pop('_secretRefs',None)
                    doc=merge_three(baseline,doc,public_current)
                refs = dict(current['document'].get('_secretRefs', {}))
                for pointer in op.get('clearSecrets', []):
                    ref=refs.pop(pointer, None)
                    if ref:vault['values'].pop(ref,None)
                doc['_secretRefs'] = refs
                doc = self.settings.prepare(name, doc, vault)
                path=self.settings._path(name);raw=encode(doc)
                if not path.exists() or path.read_bytes()!=raw:operations.append(('settings/' + name + '.json',raw))
                setting_refs[name] = doc.get('_secretRefs', {})
            if encode(vault) != vault_before:
                operations.append(('settings/secrets.json', encode(vault)))
            for action,kind,id,value in prepared:
                if action == 'put':
                    path,doc = value
                    raw=encode(doc)
                    if not path.exists() or path.read_bytes()!=raw:operations.append((path.relative_to(self.root).as_posix(), raw))
                else:
                    path = self.root / value['file']
                    trash = self.root / '.trash' / uuid.uuid4().hex
                    operations.append(((trash / 'receipt.json').relative_to(self.root).as_posix(), encode({'kind':kind,'id':id,'original':value['file'],'deletedAt':int(time.time()*1000)})))
                    sources = [path.parent] if kind == 'albums' else [path]
                    if kind != 'albums' and path.with_suffix('.assets').exists():
                        sources.append(path.with_suffix('.assets'))
                    operations.extend({'type':'move','source':source.relative_to(self.root).as_posix(),'path':(trash/source.name).relative_to(self.root).as_posix()} for source in sources)
            # All metadata, vault changes and deletions have one durable commit intent.
            # Image preparation only adds immutable content; it never overwrites old bytes.
            revision = self.revision()
            if operations:
                revision = max(int(time.time()*1000), revision+1)
                operations.append(('runtime/revision.json', encode({'value':revision})))
                if before_commit:before_commit()
                self.library._commit(operations)
            for action,kind,id,value in prepared:
                if action == 'put':
                    self.library._record(kind,value[0])
                else:
                    with self.library.cache_lock:
                        self.library.db.execute('DELETE FROM catalog WHERE path=?', (value['file'],))
            revisions = {}
            for action,kind,id,value in prepared:
                revisions[kind+':'+id] = self.library.get(kind,id)['etag'] if action == 'put' else None
            for op in settings_changes:
                revisions['settings:'+op['name']] = self.settings.get(op['name'])['etag']
            return {'ok':True, 'revision':revision, 'revisions':revisions, 'secretRefs':setting_refs, 'settingsDocuments':{op['name']:map_images(self.settings.get(op['name'])['document'],'/images/library/settings/'+op['name']) for op in settings_changes}, 'entities':{kind+':'+id:self.entity(kind,id)['document'] for action,kind,id,_ in prepared if action=='put'}}

    def revision(self):
        path = self.root / 'runtime/revision.json'
        return decode(path.read_bytes())['value'] if path.exists() else 0

    def write(self, config):
        """Internal projection saves compare the captured baseline, not whole arrays."""
        groups, settings = split_dto(config)
        revisions = config.get('_fileRevisions', {})
        baseline = config.get('_fileBaseline', {})
        changes = []
        for kind, items in groups.items():
            for item in items:
                key = kind + ':' + item['id']
                if not item.get('_lazy') and digest(encode(item)) != baseline.get(key):
                    changes.append({'kind':kind,'id':item['id'],'document':item,'expected':revisions.get(key)})
        settings_changes = [{'name':name,'document':doc,'expected':revisions.get('settings:'+name)} for name,doc in settings.items() if digest(encode(doc)) != baseline.get('settings:'+name)]
        return self.apply(changes, settings_changes=settings_changes, internal=True)

    def prepare_execution(self, row, frame):
        """Promote converted snapshot keys to scoped vault references before logging input.
        Owners come from the private SQLite row, never an HTTP-provided scope.
        """
        import mio_credentials
        frame = copy.deepcopy(frame)
        config = frame.get('config', {})
        sources = []
        original = json.loads(row['payload'])
        owner = 'execution:jobs:' + json.dumps([row['id']], separators=(',',':')) + ':payload'
        if original.get('_secretRefs'):
            resolved = self.settings.resolve_document(owner, original)
            sources.append(resolved.get('frames', [])[row['idx']])
        workspace = self.settings.resolve('workspace')
        profiles = workspace.get('ui',{}).get('comfyStudio',{}).get('settings',{}).get('imageProviders',{}).get('profiles',[])
        sources.extend({'config':p} for p in profiles if p.get('id') and p.get('id') == config.get('id'))
        secret = ''
        for source in sources:
            candidate = source.get('config',{})
            if all(str(candidate.get(k,''))==str(config.get(k,'')) for k in ('provider','baseUrl')):
                secret = source.get('key') or source.get('apiKey') or candidate.get('key') or candidate.get('apiKey') or secret
        for item in (frame,config):
            item.pop('key',None); item.pop('apiKey',None)
        if secret and config.get('provider') in ('openai','novelai'):
            config.setdefault('id','snapshot_'+row['id']+'_'+str(row['idx']))
            scope = mio_credentials.scope(config)
            with self.library.writer():
                vault = self.settings._vault()
                item = next((k for k in vault['keys'] if k.get('scope')==scope and k.get('secret')==secret),None)
                if not item:
                    item={'id':'key_'+uuid.uuid4().hex,'label':'Converted snapshot','createdAt':int(time.time()*1000),'scope':scope,'secret':secret}
                    vault['keys'].append(item)
                    self.library._commit([('settings/secrets.json',encode(vault))])
                config.update(keyMode='stored',keyId=item['id'])
        album=original.get('albumId')
        if album and ID.fullmatch(str(album)):
            self.mark_materialization(album,row['id']+'_'+str(row['idx'])+'_'+str(row['frame_attempt']))
        return self.freeze(frame)

    def mark_materialization(self, album, identity=None):
        if not ID.fullmatch(str(album)):raise LibraryError('Invalid album identity')
        path=self.root/'runtime/materialization'/((identity or uuid.uuid4().hex)+'.json')
        atomic_write(path,encode({'albumId':album}))
        return path
