"""Explicit, offline, non-destructive conversion to a NEW file-native directory.

Never import server.py, instantiate a worker, fetch a URL, or open source SQLite
with SQLite. Its DB/WAL/SHM files are copied first; recovery happens privately.
"""
from __future__ import annotations
import base64
from collections import OrderedDict
from contextlib import contextmanager
import copy
import ctypes
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import uuid

from backend.mio_library import (FileLibrary, LibraryError, KINDS, ID, MAX_ASSET, atomic_write,
                         decode, digest, encode, image_refs, image_type, owned_path, sync_dir)
from backend.mio_library_settings import FileSettings, binding, leaves
from backend.mio_library_workspace import GROUPS, WorkspaceRepository

SPLIT = {'content': 'storyboards/templates.json', 'galleries': 'albums/index.json',
         'matrix': 'presets/characters.json', 'workflows': 'workflows/library.json',
         'comfy': 'settings/comfy.json', 'llm': 'settings/llm.json',
         'xml_template': 'settings/xml_template.json', 'chat': 'conversations/sessions.json',
         'ui': 'workspace/state.json', 'queue': 'queue/tasks.json',
         'projects': 'workspace/collections.json', 'plans': 'storyboards/plans.json',
         'presets': 'presets/scene-presets.json'}
FLAT = ('content', 'comfy', 'llm', 'xml_template', 'chat', 'ui')
REQUIRED = ('templates', 'savedGalleries', 'batchMatrix', 'comfyWorkflows', 'comfyConfig',
            'llmConfig', 'xmlConfig', 'chatConfig', 'uiConfig', 'batchRunState')
IMAGE_FIELDS = {'image', 'offlineImage', 'originalImage', 'src', 'raster', 'editedImage'}


class ConversionError(LibraryError):
    def __init__(self, message, code='conversion_failed'):
        super().__init__(message, 409, code)


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def inventory(root):
    """Stat inventory detects additions/removals as well as changed tracked reads."""
    if not root.exists():
        return {}
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            if path.is_symlink():
                raise ConversionError('Source contains a symbolic link: ' + path.relative_to(root).as_posix())
        for name in files:
            path = Path(directory) / name
            s = path.stat()
            result[path.relative_to(root).as_posix()] = [s.st_size, s.st_mtime_ns]
    return result


@contextmanager
def stopped_source(data):
    lock = data / 'execution/worker.lock'
    f = None
    try:
        if lock.exists():
            owned_path(data, 'execution/worker.lock')
            f = lock.open('r+b' if os.name == 'nt' else 'rb')
            try:
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise ConversionError('The old worker is still running. Stop the old service before converting.', 'source_running') from None
        yield
    finally:
        if f:
            f.close()


def publish_new_directory(source, destination):
    """Atomic no-replace rename, including refusal to replace an EMPTY directory."""
    if os.name == 'nt':
        os.rename(source, destination)  # Windows rename never replaces an existing destination.
    elif sys.platform.startswith('linux'):
        libc = ctypes.CDLL(None, use_errno=True)
        rename = getattr(libc, 'renameat2', None)
        if rename is None:
            raise ConversionError('Atomic no-replace rename is not available on this system')
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1):
            e = ctypes.get_errno()
            raise OSError(e, os.strerror(e), str(destination))
    elif sys.platform == 'darwin':
        libc = ctypes.CDLL(None, use_errno=True)
        rename = libc.renamex_np
        rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(os.fsencode(source), os.fsencode(destination), 4):
            e = ctypes.get_errno()
            raise OSError(e, os.strerror(e), str(destination))
    else:
        raise ConversionError('Atomic directory publication is not supported on this platform')
    sync_dir(Path(destination).parent)


class Source:
    def __init__(self, path, project=None):
        self.input = Path(path).absolute()
        if self.input.is_symlink() or not self.input.exists():
            raise ConversionError('Source must be an existing, non-symlink path')
        if self.input.is_file():
            self.data = self.input.parent
            self.project = Path(project).absolute() if project else self.data.parent if self.data.name == 'data' else self.data
        else:
            self.data = self.input / 'data' if (self.input / 'data').is_dir() else self.input
            self.project = Path(project).absolute() if project else self.data.parent if self.data.name == 'data' else self.input
        self.hashes = {}
        self.paths = {}
        self.cache = OrderedDict()
        self.cache_bytes = 0
        self.read_assets = set()
        self.initial_inventory = inventory(self.data)
        self.initial_legacy_images = inventory(self.project / 'images')
        self.format = ''
        self.journal = False

    def read(self, path, max_bytes=512 * 1024 * 1024):
        path = Path(path).absolute()
        root = self.data if path.is_relative_to(self.data) else self.project
        owned_path(root, path.relative_to(root).as_posix())
        if path.stat().st_size > max_bytes:
            raise ConversionError('Source file exceeds conversion size limit: ' + path.name)
        if path in self.cache:
            self.cache.move_to_end(path)
            return self.cache[path]
        raw = path.read_bytes()
        hashed = digest(raw)
        key = ('data/' if root == self.data else 'project/') + path.relative_to(root).as_posix()
        if key in self.hashes and self.hashes[key] != hashed:
            raise ConversionError('Source changed during conversion', 'source_changed')
        self.hashes[key] = hashed
        self.paths[key] = path
        if len(raw) <= 8 * 1024 * 1024:
            while self.cache and self.cache_bytes + len(raw) > 32 * 1024 * 1024:
                _, old = self.cache.popitem(last=False); self.cache_bytes -= len(old)
            self.cache[path] = raw; self.cache_bytes += len(raw)
        return raw

    def unchanged(self):
        if inventory(self.data) != self.initial_inventory or inventory(self.project / 'images') != self.initial_legacy_images:
            raise ConversionError('Source file set or timestamps changed during conversion', 'source_changed')
        for key, expected in self.hashes.items():
            if file_hash(self.paths[key]) != expected:
                raise ConversionError('Source content changed during conversion: ' + key, 'source_changed')

    def config(self):
        if (self.data / 'workspace.json').exists():
            try:
                if decode(self.read(self.data / 'workspace.json')).get('schema') == 'mio.workspace.v2':
                    raise ConversionError('Source already uses v2; use resource copy/share, not the old-workspace converter')
            except AttributeError:
                pass
        chunks = []
        if self.input.is_file():
            self.format = 'flat-config-json'
            chunks = [decode(self.read(self.input))]
        elif (self.data / '.config-transaction.json').exists():
            journal = decode(self.read(self.data / '.config-transaction.json'))
            if not isinstance(journal, dict) or set(journal) != set(SPLIT):
                raise ConversionError('Incomplete config transaction; no source files were recovered or changed')
            chunks = list(journal.values()); self.format = 'structured-transaction'; self.journal = True
        elif any((self.data / p).exists() for p in SPLIT.values()):
            missing = [p for p in SPLIT.values() if not (self.data / p).is_file()]
            if missing:
                raise ConversionError('Structured source is incomplete: ' + ', '.join(missing))
            chunks = [decode(self.read(self.data / p)) for p in SPLIT.values()]
            self.format = 'structured-1.x'
        elif any((self.data / (name + '.json')).exists() for name in FLAT):
            missing = [n for n in FLAT if not (self.data / (n + '.json')).is_file()]
            if missing:
                raise ConversionError('Split source is incomplete: ' + ', '.join(missing))
            chunks = [decode(self.read(self.data / (name + '.json'))) for name in FLAT]
            self.format = 'six-file-1.x'
        elif (self.project / 'comfy_comic_data.json').is_file():
            chunks = [decode(self.read(self.project / 'comfy_comic_data.json'))]
            self.format = 'monolithic-1.x'
        else:
            raise ConversionError('No persisted source configuration found; demo content is not generated by this converter')
        result = {}
        for chunk in chunks:
            if not isinstance(chunk, dict):
                raise ConversionError('Source config chunk must contain an object')
            for key, value in chunk.items():
                if key in result and result[key] != value:
                    raise ConversionError('Conflicting source config fields: ' + key)
                result[key] = value
        if '_studioProjects' in result:
            meta = result.setdefault('uiConfig', {}).setdefault('comfyStudio', {})
            meta['projects'] = result.pop('_studioProjects')
            creation = result.pop('_studioCreation', {})
            creation['plans'] = result.pop('_studioPlans', [])
            creation['variableSets'] = result.pop('_studioPresets', [])
            meta['creation'] = creation
            result.pop('_hasStudioMetadata', None)
        missing = [key for key in REQUIRED if key not in result]
        if missing:
            raise ConversionError('Source is not a complete saved workspace: ' + ', '.join(missing))
        for key in ('templates', 'savedGalleries', 'comfyWorkflows'):
            if not isinstance(result[key], list):
                raise ConversionError('Unsupported source collection shape: ' + key)
        for key in REQUIRED[2:]:
            if key != 'comfyWorkflows' and not isinstance(result[key], dict):
                raise ConversionError('Unsupported source object shape: ' + key)
        return result

    def image(self, value, context):
        if value.startswith('data:image/'):
            try:
                header, encoded = value.split(',', 1)
                raw = base64.b64decode(encoded, validate=True) if header.endswith(';base64') else urllib.parse.unquote_to_bytes(encoded)
            except (ValueError, TypeError):
                raise ConversionError('Invalid inline image at ' + context) from None
            if len(raw) > MAX_ASSET:
                raise ConversionError('Image exceeds 50 MiB at ' + context)
            image_type(raw)
            return raw
        parsed = urllib.parse.urlsplit(value)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ConversionError('Image reference contains credentials, query or fragment at ' + context)
        if parsed.scheme and (parsed.scheme not in ('http', 'https') or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')):
            raise ConversionError('Remote image must be saved locally before conversion at ' + context, 'remote_asset')
        path = urllib.parse.unquote(parsed.path)
        candidates = []
        if path.startswith('/images/'):
            relative = path[len('/images/'):]
            candidates = [owned_path(self.data / 'assets/images', relative), owned_path(self.project / 'images', relative)]
        elif path.startswith(('/vendor/', '/examples/')) or path.startswith(('vendor/', 'examples/')):
            candidates = [owned_path(self.project, path.lstrip('/'))]
        else:
            raise ConversionError('Unsupported image reference at ' + context)
        existing = [p for p in candidates if p.is_file()]
        if not existing:
            raise ConversionError('Missing local image at ' + context, 'missing_asset')
        # Matching paths in both old image roots must not silently select different bytes.
        raws = [self.read(p, MAX_ASSET) for p in existing]
        if any(raw != raws[0] for raw in raws[1:]):
            raise ConversionError('Ambiguous local image roots at ' + context)
        self.read_assets.update(existing)
        image_type(raws[0])
        return raws[0]


class Builder:
    def __init__(self, source, stage):
        self.source = source
        self.root = Path(stage)
        self.counts = {kind: 0 for kind in KINDS}
        self.written = []
        self.image_files = set()
        self.image_references = 0
        self.secret_fields = 0
        self.external_secret_refs = {}
        self.runtime_changes = []
        self.dropped_deleted = []
        self.generated_workflows = []
        self.vault = {'version': 1, 'keys': [], 'values': {}}
        keyfile = source.data / 'secrets/provider-keys.json'
        if keyfile.exists():
            old = decode(source.read(keyfile))
            if not isinstance(old, dict) or old.get('version') != 1 or not isinstance(old.get('keys'), list):
                raise ConversionError('Old credential store is unreadable')
            self.vault['keys'] = copy.deepcopy(old['keys'])
        self.library = FileLibrary(stage)
        self.db_path = None

    def secretize(self, value, owner):
        document = copy.deepcopy(value)
        refs = {}
        for parent, key, pointer in leaves(document):
            if not parent[key]:
                continue
            ref = 'secret_' + uuid.uuid4().hex
            self.vault['values'][ref] = {'owner': owner, 'pointer': pointer,
                'binding': binding(parent), 'value': parent[key]}
            parent[key] = ''; refs[pointer] = ref; self.secret_fields += 1
        if refs:
            if not isinstance(document, dict):
                self.external_secret_refs[owner] = refs
                return document
            if document.get('_secretRefs'):
                raise ConversionError('Input already contains a secret-reference map at ' + owner)
            document['_secretRefs'] = refs
        return document

    def images(self, value, base, context, runtime=False, force=False):
        if isinstance(value, str):
            candidate = value.startswith(('data:image/', '/images/', '/vendor/', '/examples/', 'vendor/', 'examples/'))
            if not candidate and not (force and value):
                return value
            raw = self.source.image(value, context)
            _, suffix = image_type(raw)
            relative = 'images/' + digest(raw) + suffix
            path = owned_path(base, relative)
            if not path.exists():
                atomic_write(path, raw)
            self.image_references += 1
            self.image_files.add(path.relative_to(self.root).as_posix())
            return '/images/assets/' + Path(relative).name if runtime else relative
        if isinstance(value, dict):
            return {key: self.images(child, base, context + '/' + key, runtime,
                force=key in IMAGE_FIELDS and ('stepIndex' in value or value.get('kind') == 'mio-image' or key in ('offlineImage', 'originalImage')))
                    for key, child in value.items()}
        if isinstance(value, list):
            return [self.images(child, base, context + '/' + str(i), runtime) for i, child in enumerate(value)]
        return value

    def record(self, kind, original, position):
        if not isinstance(original, dict):
            raise ConversionError('Resource is not an object: ' + kind)
        doc = copy.deepcopy(original)
        if not isinstance(doc.get('id'), str) or not ID.fullmatch(doc['id']) or doc['id'] in ('__proto__', 'prototype', 'constructor'):
            raise ConversionError('Resource requires an existing stable ID: ' + kind)
        if len(str(doc.get('title', ''))) > 500:
            raise ConversionError('Resource title exceeds 500 characters: ' + kind)
        replaced = {key: doc[key] for key in ('schema', 'kind') if key in doc}
        added = []
        if not isinstance(doc.get('title'), str) or not doc['title'].strip():
            if 'title' in doc:
                replaced['title'] = doc['title']
            else:
                added.append('title')
            doc['title'] = str(doc.get('name') or doc.get('bookTitle') or doc.get('character') or doc['id'])
        doc['_sourceFormat'] = {'replaced': replaced, 'added': added}
        doc.update(schema='mio.resource.v2', kind=kind, _position=position)
        with self.library.writer():
            if self.library.db.execute('SELECT 1 FROM catalog WHERE kind=? AND id=?', (kind, doc['id'])).fetchone():
                raise ConversionError('Duplicate source resource ID: ' + kind + '/' + doc['id'], 'duplicate_id')
            path = self.library._new_path(kind, doc)
            doc = self.images(doc, self.library.asset_root(kind, path), kind + '/' + doc['id'])
            doc = self.secretize(doc, kind + ':' + doc['id'])
            self.library.validate(kind, doc)
            for ref in set(image_refs(doc)):
                if not owned_path(self.library.asset_root(kind, path), ref).is_file():
                    raise ConversionError('Unresolved relative image in ' + kind + '/' + doc['id'])
            self.library._commit([(path.relative_to(self.root).as_posix(), encode(doc))])
            self.library._record(kind, path)
        self.counts[kind] += 1
        self.written.append({'kind': kind, 'id': doc['id'], 'file': path.relative_to(self.root).as_posix()})

    def copy_execution(self):
        old = self.source.data / 'execution/jobs.sqlite3'
        if not old.exists():
            return
        private = self.root / '.conversion-input'
        private.mkdir(mode=0o700)
        for suffix in ('', '-wal', '-shm', '-journal'):
            source = old.with_name(old.name + suffix)
            if source.exists():
                atomic_write(private / ('jobs.sqlite3' + suffix), self.source.read(source), private=True)
        self.db_path = self.root / 'runtime/execution/jobs.sqlite3'
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        src = dst = None
        try:
            src = sqlite3.connect(private / 'jobs.sqlite3')
            dst = sqlite3.connect(self.db_path)
            if src.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ConversionError('Execution database failed integrity check')
            src.backup(dst)
        finally:
            if src:
                src.close()
            if dst:
                dst.close()
        os.chmod(self.db_path, 0o600)
        shutil.rmtree(private)

    def project_execution(self, config):
        if not self.db_path:
            return
        db = sqlite3.connect(self.db_path); db.row_factory = sqlite3.Row
        try:
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            deleted = {r[0] for r in db.execute('SELECT id FROM deleted_albums')} if 'deleted_albums' in tables else set()
            self.dropped_deleted = [b['id'] for b in config['savedGalleries'] if b.get('id') in deleted]
            config['savedGalleries'] = [b for b in config['savedGalleries'] if b.get('id') not in deleted]
            queue = config['batchRunState'].get('queue', [])
            config['batchRunState']['queue'] = queue = [q for q in queue if q.get('bookId') not in deleted]
            books = {b['id']: b for b in config['savedGalleries']}
            if 'jobs' in tables:
                for row in db.execute('SELECT * FROM jobs'):
                    job = dict(row); payload = decode(job['payload'])
                    q = next((q for q in queue if q.get('serverId') == job['id'] or q.get('id') == payload.get('owner')), None)
                    book = books.get(payload.get('albumId') or (q or {}).get('bookId'))
                    if not book:
                        continue
                    results = {r['index']: r for r in decode(job.get('results') or '[]')}
                    if 'job_frames' in tables:
                        for frame in db.execute('SELECT idx,result FROM job_frames WHERE job=? AND result IS NOT NULL', (job['id'],)):
                            results[frame['idx']] = decode(frame['result'])
                    for index, result in results.items():
                        if type(index) is not int or not 0 <= index < len(payload.get('frames', [])):
                            raise ConversionError('Invalid persisted result index in execution database')
                        indices = (q or {}).get('serverIndices', (q or {}).get('indices', []))
                        target = indices[index] if index < len(indices) else payload['frames'][index].get('frameIndex')
                        if type(target) is not int or not 0 <= target < book.get('totalSteps', 0):
                            raise ConversionError('Cannot safely bind a persisted result to its album scene')
                        if not result.get('image'):
                            continue
                        steps = book.setdefault('steps', [])
                        old = next((step for step in steps if step.get('stepIndex') == target), None)
                        if old and old.get('image') or str(target) in book.get('pictureEdits', {}):
                            continue
                        frames = book.get('sourceSnapshot', {}).get('frames', [])
                        metadata = (q or {}).get('serverMeta', [])
                        template = metadata[index] if index < len(metadata) else frames[target] if target < len(frames) else {}
                        step = {key: copy.deepcopy(template.get(key, '')) for key in ('name', 'prompt', 'caption')}
                        step.update(stepIndex=target, prompt=result.get('prompt', step['prompt']), image=result['image'], artifacts=result.get('artifacts', []), offlineFallback=False)
                        if old is not None:
                            old.update(step)
                        else:
                            steps.append(step)
            if 'picture_edits' in tables:
                # Pure record projection: importing this module never creates a worker.
                from backend.mio_pictures import apply_record
                for row in db.execute('SELECT album,idx,revision,record FROM picture_edits ORDER BY seq'):
                    if row['album'] in books:
                        record = decode(row['record'])
                        record.update(index=row['idx'], revision=row['revision'])
                        apply_record(books[row['album']], record)
            for book in books.values():
                book['steps'].sort(key=lambda step: step['stepIndex'])
                book['generatedSteps'] = sum(bool(step.get('image')) for step in book['steps'])
                book['inProgress'] = False
                if book['generatedSteps'] >= book.get('totalSteps', 0):
                    book['status'] = 'complete'
        finally:
            db.close()

    def sanitize_execution(self):
        if not self.db_path:
            return
        db = sqlite3.connect(self.db_path)
        try:
            db.execute('PRAGMA secure_delete=ON')
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            columns = {'jobs': ('payload', 'results', 'error', 'upstream', 'errors', 'meta'),
                       'job_frames': ('result', 'error', 'upstream'), 'request_inputs': ('input',),
                       'request_parameters': ('parameters',), 'picture_edits': ('record',),
                       'events': ('data',), 'revisions': ('changes',), 'settings': ('value',)}
            for table, candidates in columns.items():
                if table not in tables:
                    continue
                info = list(db.execute('PRAGMA table_info("' + table + '")'))
                present = {r[1] for r in info}
                primary = [r[1] for r in sorted(info, key=lambda r: r[5]) if r[5]]
                for column in candidates:
                    if column not in present:
                        continue
                    key_sql = ''.join(',"' + key + '"' for key in primary)
                    for record in db.execute('SELECT rowid,"' + column + '"' + key_sql + ' FROM "' + table + '"').fetchall():
                        rowid, text, *identity = record
                        identity = json.dumps(identity if primary else [rowid], ensure_ascii=False, separators=(',', ':'))
                        if not isinstance(text, str) or not text.strip().startswith(('{', '[')):
                            continue
                        try:
                            value = decode(text)
                        except LibraryError:
                            raise ConversionError('Invalid runtime JSON in ' + table + '/' + column) from None
                        value = self.images(value, self.root / 'assets', 'execution/' + table + '/' + str(rowid) + '/' + column, runtime=True)
                        value = self.secretize(value, 'execution:' + table + ':' + identity + ':' + column)
                        db.execute('UPDATE "' + table + '" SET "' + column + '"=? WHERE rowid=?', (json.dumps(value, ensure_ascii=False), rowid))
            if 'settings' not in tables:
                db.execute('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)')
            db.execute("INSERT OR REPLACE INTO settings VALUES('paused','true')")
            if 'jobs' in tables:
                present = {r[1] for r in db.execute('PRAGMA table_info(jobs)')}
                for id, state in db.execute('SELECT id,state FROM jobs').fetchall():
                    if state in ('running', 'pending', 'retry_wait', 'paused'):
                        self.runtime_changes.append({'id': id, 'before': state, 'after': 'unknown' if state == 'running' else 'paused'})
                        db.execute('UPDATE jobs SET state=? WHERE id=?', ('unknown' if state == 'running' else 'paused', id))
                        if state == 'running' and 'error' in present:
                            db.execute('UPDATE jobs SET error=COALESCE(error,?) WHERE id=?', (json.dumps({'kind':'result_unconfirmed','message':'Conversion found an interrupted request. No automatic retry.'}), id))
                if 'enabled' in present:
                    db.execute('UPDATE jobs SET enabled=0')
                if 'digest' in present:
                    db.execute('CREATE TABLE IF NOT EXISTS conversion_job_digests(job TEXT PRIMARY KEY,source_digest TEXT,converted_digest TEXT)')
                    for job_id, previous, payload_text in db.execute('SELECT id,digest,payload FROM jobs').fetchall():
                        canonical = json.dumps(decode(payload_text), sort_keys=True, ensure_ascii=False, allow_nan=False)
                        updated_digest = digest(canonical.encode('utf-8'))
                        db.execute('INSERT OR REPLACE INTO conversion_job_digests VALUES(?,?,?)', (job_id, previous, updated_digest))
                        db.execute('UPDATE jobs SET digest=? WHERE id=?', (updated_digest, job_id))
            if 'job_frames' in tables:
                db.execute("UPDATE job_frames SET state='unknown',epoch=epoch+1,error=COALESCE(error,?) WHERE state='running'", (json.dumps({'kind':'result_unconfirmed','message':'Source request was in flight. No automatic retry.'}),))
            db.commit()
            db.execute('VACUUM')
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ConversionError('Converted execution database failed integrity check')
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            db.execute('PRAGMA journal_mode=DELETE')
        finally:
            db.close()
        try:
            with self.db_path.open('r+b') as f:
                os.fsync(f.fileno())
        except OSError:
            pass

    def unassigned_images(self):
        preserved = []
        for base in (self.source.data / 'assets/images', self.source.project / 'images'):
            if not base.exists():
                continue
            for directory, dirs, files in os.walk(base, followlinks=False):
                for name in dirs + files:
                    if (Path(directory) / name).is_symlink():
                        raise ConversionError('Symbolic link in source image library')
                for name in files:
                    path = Path(directory) / name
                    if path in self.source.read_assets:
                        continue
                    raw = self.source.read(path, MAX_ASSET)
                    try:
                        _, suffix = image_type(raw)
                        relative = 'assets/images/' + digest(raw) + suffix
                    except LibraryError:
                        relative = 'runtime/quarantine/' + digest(raw) + '.bin'
                    destination = self.root / relative
                    if not destination.exists():
                        atomic_write(destination, raw, private=True)
                    preserved.append({'source': path.relative_to(base).as_posix(), 'file': relative, 'sha256': digest(raw)})
        return preserved

    def build(self, config):
        config = copy.deepcopy(config)
        self.copy_execution()
        self.project_execution(config)
        ui = config['uiConfig']; meta = ui.setdefault('comfyStudio', {})
        creation = meta.setdefault('creation', {})
        aliases = []
        for alias in ('creation', 'projects'):
            if alias in ui:
                if alias in meta and ui[alias] != meta[alias]:
                    raise ConversionError('Conflicting duplicated UI ' + alias + ' metadata')
                if alias not in meta:
                    meta[alias] = ui[alias]
                ui.pop(alias); aliases.append(alias)
        creation = meta.setdefault('creation', {})
        groups = {'templates': config.pop('templates'), 'savedGalleries': config.pop('savedGalleries'),
                  'rows': config['batchMatrix'].pop('rows', []), 'projects': meta.pop('projects', []),
                  'plans': creation.pop('plans', []), 'exportTemplates': meta.pop('exportTemplates', []),
                  'comfyWorkflows': config.pop('comfyWorkflows'), 'sessions': config['chatConfig'].pop('sessions', []),
                  'queue': config['batchRunState'].pop('queue', []), 'characters': [], 'scenes': []}
        presets = creation.pop('variableSets', [])
        preset_ids = [item.get('id') for item in presets if isinstance(item, dict)]
        if len(preset_ids) != len(presets) or any(not isinstance(id, str) for id in preset_ids) or len(set(preset_ids)) != len(preset_ids):
            raise ConversionError('Duplicate or invalid preset IDs across character/scene categories', 'duplicate_id')
        for item in presets:
            category = item.get('category', 'characters')
            if category not in ('characters', 'scenes'):
                raise ConversionError('Unknown preset category; choose characters or scenes explicitly')
            groups[category].append(item)
        ordering = {'variableSets': [item['id'] for item in presets]}
        original_counts = {field: len(items) for field, items in groups.items()}
        graph_lookup = {digest(encode(item.get('workflow'))): item['id'] for item in groups['comfyWorkflows'] if item.get('workflow')}
        def detach_graphs(value):
            if isinstance(value, dict):
                result = {k: detach_graphs(v) for k, v in value.items() if k != 'workflow'}
                graph = value.get('workflow')
                if graph:
                    if not isinstance(graph, dict):
                        raise ConversionError('Active workflow must be a JSON graph')
                    key = digest(encode(graph)); id = graph_lookup.get(key)
                    if not id:
                        id = 'workflow_active_' + key[:20]
                        groups['comfyWorkflows'].append({'id': id, 'title': '当前工作流', 'workflow': graph, '_workspaceActiveOnly': True})
                        graph_lookup[key] = id; self.generated_workflows.append(id)
                    result['_workflowRef'] = id
                elif 'workflow' in value:
                    result['workflow'] = graph
                return result
            if isinstance(value, list):
                return [detach_graphs(v) for v in value]
            return value
        ordinary = {name: detach_graphs(config.pop(key)) for name, key in (('comfy', 'comfyConfig'), ('llm', 'llmConfig'), ('xml', 'xmlConfig'))}
        ui = detach_graphs(config.pop('uiConfig'))
        for field, items in groups.items():
            if not isinstance(items, list):
                raise ConversionError('Expected an array for ' + field)
            ordering[field] = [item['id'] for item in items]
            for index, item in enumerate(items):
                if field == 'queue' and item.get('status') in ('pending', 'running', 'paused'):
                    item = {**item, '_conversionHold': {'previousStatus': item['status']}, 'status': 'paused'}
                self.record(GROUPS[field], item, index)
        self.sanitize_execution()
        atomic_write(self.root / 'settings/secrets.json', encode(self.vault), private=True)
        native = {'globals': {k: v for k, v in config.items() if k not in ('batchMatrix', 'chatConfig', 'batchRunState')},
                  'ui': ui, 'matrix': config['batchMatrix'], 'chats': config['chatConfig'],
                  'queue': config['batchRunState'], 'ordering': ordering, 'aliases': aliases,
                  'executionStartPolicy': 'manual'}
        ordinary['workspace'] = native
        settings = FileSettings(self.library)
        for name, value in ordinary.items():
            value = self.images(value, self.root / 'settings' / (name + '.assets'), 'settings/' + name)
            settings.put(name, value)
        unassigned = self.unassigned_images()
        # Preserve non-cache asset provenance as a private conversion record.
        provenance = self.source.data / 'assets/origins.json'
        if provenance.exists():
            value = self.secretize(decode(self.source.read(provenance)), 'conversion:asset-origins')
            atomic_write(self.root / 'runtime/conversion/asset-origins.json', encode(value), private=True)
            # Merge late provenance credential extraction without losing settings credentials.
            vault = settings._vault(); vault['values'].update(self.vault['values'])
            atomic_write(self.root / 'settings/secrets.json', encode(vault), private=True)
        self.library.scan(force=True)
        if self.library.problems():
            raise ConversionError('Output index verification found invalid or duplicate resources')
        for record in self.written:
            got = self.library.get(record['kind'], record['id'])
            for ref in set(image_refs(got['document'])):
                raw, _ = self.library.asset(record['kind'], record['id'], ref)
                if digest(raw) not in ref:
                    raise ConversionError('Output image hash mismatch')
        reconstructed = WorkspaceRepository(self.library).read()
        if len(reconstructed['savedGalleries']) != self.counts['albums'] or len(reconstructed['templates']) != self.counts['storyboards']:
            raise ConversionError('Domain readback counts differ from written source files')
        for name in ordinary:
            public = settings.get(name)['document']
            for ref in set(image_refs(public)):
                settings.asset(name, ref)
        self.source.unchanged()
        report = {'schema': 'mio.conversion-report.v2', 'sourceFormat': self.source.format,
                  'sourceUnchanged': True, 'configJournalReadWithoutModifyingSource': self.source.journal,
                  'counts': self.counts, 'sourceCollectionCountsAfterDeletionProjection': original_counts,
                  'generatedActiveWorkflowResources': self.generated_workflows,
                  'excludedDeletedAlbumIds': self.dropped_deleted,
                  'imageFiles': len(self.image_files), 'imageReferences': self.image_references,
                  'unassignedAssets': unassigned, 'relocatedResourceCredentialFields': self.secret_fields,
                  'runtimeChanges': self.runtime_changes, 'executionStartPolicy': 'manual',
                  'guiRuntimeIntegrated': True, 'resourceFiles': self.written,
                  'sourceFiles': self.source.hashes,
                  'limits': ['No generation or network request was made.',
                             'This directory is readable by the v2 repository, not yet by the current GUI.',
                             'Source service must remain stopped during the entire conversion.',
                             'Raw user-authored prompt text is preserved; arbitrary secrets in free text cannot be reliably identified.']}
        if self.external_secret_refs:
            atomic_write(self.root / 'runtime/secret-bindings.json', encode(self.external_secret_refs), private=True)
        report['retainedOnlyInSource'] = sorted(set(self.source.initial_inventory) - {p.relative_to(self.source.data).as_posix() for p in self.source.paths.values() if p.is_relative_to(self.source.data)})
        atomic_write(self.root / 'runtime/conversion/report.json', encode(report), private=True)
        marker = decode((self.root / 'workspace.json').read_bytes())
        marker['conversion'] = {'complete': True, 'executionStartPolicy': 'manual', 'report': 'runtime/conversion/report.json'}
        atomic_write(self.root / 'workspace.json', encode(marker))
        return report


def convert(source, output, *, source_stopped=False, dry_run=False, project=None):
    if not source_stopped:
        raise ConversionError('Stop the old service and pass --source-stopped explicitly', 'source_not_confirmed_stopped')
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ConversionError('Output already exists; even an empty directory will not be replaced', 'output_exists')
    if not output.parent.is_dir():
        raise ConversionError('Output parent directory must already exist')
    src = Source(source, project)
    if output.resolve().is_relative_to(src.data.resolve()) or src.data.resolve().is_relative_to(output.resolve()):
        raise ConversionError('Output must be separate from the source data directory')
    builder = None
    with stopped_source(src.data):
        # Re-snapshot after acquiring the worker lease, before reading any content.
        src.initial_inventory = inventory(src.data)
        src.initial_legacy_images = inventory(src.project / 'images')
        config = src.config()
        stage = Path(tempfile.mkdtemp(prefix='.' + output.name + '.converting-', dir=output.parent))
        try:
            builder = Builder(src, stage)
            report = builder.build(config)
            builder.library.close(); builder = None
            src.unchanged()
            if dry_run:
                report = {**report, 'dryRun': True, 'published': False}
            else:
                publish_new_directory(stage, output)
                report = {**report, 'dryRun': False, 'published': True, 'output': str(output)}
            return report
        finally:
            if builder:
                builder.library.close()
            if stage.exists():
                shutil.rmtree(stage)
