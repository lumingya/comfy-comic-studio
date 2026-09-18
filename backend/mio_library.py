"""File-native workspace. Entity JSON and owned assets are authoritative.

The SQLite catalogue is expendable: never use it to reconstruct user content.
No import of the old workspace layout happens here. All writes are explicit,
conditional and atomically journalled. Share packages exclude runtime/settings.
"""
from __future__ import annotations
import base64
import contextlib
import copy
import hashlib
import io
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import threading
import time
import unicodedata
import uuid
import zipfile

VERSION = 2
KINDS = {'storyboards': ('storyboards', 'storyboard'),
         'characters': ('presets/characters', 'preset'),
         'scenes': ('presets/scenes', 'preset'),
         'collections': ('collections', 'collection'),
         'plans': ('plans', 'plan'),
         'albums': ('albums', 'album'),
         'layouts': ('layouts', 'layout'),
         'workflows': ('workflows', 'workflow'),
         'rows': ('records/characters', 'row'),
         'conversations': ('records/conversations', 'conversation'),
         'tasks': ('runtime/queue', 'task')}
MAX_DOCUMENT = 16 * 1024 * 1024
MAX_ASSET = 50 * 1024 * 1024
MAX_BUNDLE = 192 * 1024 * 1024
ID = re.compile(r'^[A-Za-z0-9_-]{1,150}$')
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.svg'}
PRIVATE_KEYS = {'apikey', 'api_key', 'secret', 'password', 'token',
                'authorization', 'credentials', 'secrets', 'headers', 'cookie', 'x-api-key', 'x-auth-token', 'sourceSnapshot',
                'request', 'response', 'logs', 'execution', 'providerConfig'}


class LibraryError(ValueError):
    def __init__(self, message, status=400, code='invalid_resource'):
        super().__init__(message)
        self.status, self.code = status, code


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode('utf-8')


def decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in ('__proto__', 'prototype', 'constructor'):
                raise LibraryError('Reserved JSON member: ' + key)
            if key in result:
                raise LibraryError('Duplicate JSON member: ' + str(key))
            result[key] = value
        return result
    def constant(value):
        raise LibraryError('Non-finite JSON number: ' + value)
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError) as e:
        raise LibraryError('Invalid resource JSON: ' + str(e)) from None


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_name(title):
    name = unicodedata.normalize('NFC', str(title)).strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name).strip(' .')[:64]
    if not name or re.match(r'^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)', name, re.I):
        name = '未命名_' + name
    while len(name.encode('utf-8')) > 180:
        name = name[:-1]
    return name


def atomic_write(path, raw, private=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('xb') as f:
            if private:
                os.chmod(temp, 0o600)
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
        sync_dir(path.parent)
    finally:
        temp.unlink(missing_ok=True)


def sync_dir(path):
    if os.name != 'nt':
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def owned_path(root, relative):
    """Reject traversal AND symlinks, even when a symlink points back inside."""
    if not isinstance(relative, str) or '\\' in relative or '\x00' in relative:
        raise LibraryError('Unsafe resource path')
    p = PurePosixPath(relative)
    if p.is_absolute() or not p.parts or relative != p.as_posix() or any(x in ('', '.', '..') or x.endswith((' ', '.')) or re.match(r'^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)', x, re.I) for x in p.parts) or ':' in relative:
        raise LibraryError('Unsafe resource path')
    root = Path(root).absolute()
    candidate = root
    for part in p.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise LibraryError('Symbolic links are not resource files')
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise LibraryError('Resource path escapes its owner')
    return candidate


def image_type(raw):
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png', '.png'
    if raw.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg', '.jpg'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'image/webp', '.webp'
    if raw.lstrip(b'\xef\xbb\xbf \t\r\n').startswith((b'<svg', b'<?xml')):
        from backend.mio_safe_svg import validate_svg
        try:
            validate_svg(raw)
        except ValueError as e:
            raise LibraryError(str(e)) from None
        return 'image/svg+xml', '.svg'
    raise LibraryError('Only raster images and validated passive SVG images are accepted')


def image_refs(value):
    if isinstance(value, str) and value.startswith('images/'):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from image_refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from image_refs(child)


def scrub(value):
    """Sharing is an allowlisted DTO; also strip sensitive nested extensions."""
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()
                if (k != 'key' or (value.get('type') in ('image', 'text', 'number', 'boolean', 'json') or str(value.get('type','')).startswith('plugin:')) or value.get('kind') == 'mio-image')
                and not k.startswith('_') and k not in PRIVATE_KEYS
                and k.lower() not in {x.lower() for x in PRIVATE_KEYS}}
    if isinstance(value, list):
        return [scrub(x) for x in value]
    return value


def assert_no_credentials(value, pointer=''):
    secret_names = {'apikey', 'authorization', 'password', 'secret', 'token',
                    'accesstoken', 'refreshtoken', 'xapikey', 'xauthtoken', 'cookie'}
    if isinstance(value, dict):
        typed_variable = (value.get('type') in ('image', 'text', 'number', 'boolean', 'json') or str(value.get('type','')).startswith('plugin:')) and 'value' in value or value.get('kind') == 'mio-image'
        for key, child in value.items():
            normalized = re.sub('[^a-z0-9]', '', key.lower())
            if isinstance(child, str) and child and (normalized in secret_names or key == 'key' and not typed_variable):
                raise LibraryError('Credentials belong in settings/secrets.json, not resource files: ' + pointer + '/' + key, 422, 'unprotected_secret')
            assert_no_credentials(child, pointer + '/' + key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_credentials(child, pointer + '/' + str(index))


def share_document(kind, doc):
    fields = {'id', 'schema', 'kind', 'title', 'description', 'outline', 'createdAt',
              'updatedAt', 'tags', 'frames', 'entries', 'cover', 'coverPresentation',
              'synopsis', 'characterName', 'steps', 'totalSteps', 'generatedSteps',
              'pictureEdits', 'variables', 'html', 'options', 'assets', 'layout',
              'runtimeScript', 'scriptEnabled', 'enhancement', 'version', 'workflow',
              'bindings', 'outputNodeId', 'sharedSources', 'settingsGroups'}
    result = scrub({k: copy.deepcopy(v) for k, v in doc.items() if k in fields})
    if kind == 'albums':
        result.pop('variables', None)
    result['kind'] = kind
    result.pop('revision', None)
    return result


class FileLibrary:
    def __init__(self, root):
        self.root = Path(root).absolute()
        if self.root.is_symlink():
            raise LibraryError('Workspace root must not be a symlink')
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._writer_local = threading.local()
        self.cache_lock = threading.RLock()
        self._scan_thread = None
        self.scan_state = {'running': False, 'seen': 0, 'changed': 0, 'error': ''}
        marker = owned_path(self.root, 'workspace.json')
        if marker.exists():
            document = decode(marker.read_bytes())
            if document.get('schema') != 'mio.workspace.v2':
                raise LibraryError('Wrong workspace schema; use the one-time converter', 409)
        else:
            occupied = [p for p in self.root.iterdir() if p.name not in ('.cache', '.write.lock')]
            if occupied:
                raise LibraryError('Existing data left untouched. Choose an empty v2 directory or convert to a new directory.', 409, 'conversion_required')
            atomic_write(marker, encode({'schema': 'mio.workspace.v2', 'id': 'workspace_' + uuid.uuid4().hex,
                                         'createdAt': int(time.time() * 1000)}))
        for folder, _ in KINDS.values():
            owned_path(self.root, folder).mkdir(parents=True, exist_ok=True)
        for folder in ('settings', 'runtime', '.cache', '.transactions', '.trash'):
            owned_path(self.root, folder).mkdir(exist_ok=True)
        self.db_path = owned_path(self.root, '.cache/catalog.sqlite3')
        self._open_cache()
        with self.writer():
            self._recover()

    def _open_cache(self):
        try:
            self.db = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
            if self.db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise sqlite3.DatabaseError('Corrupt cache')
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.execute('CREATE TABLE IF NOT EXISTS catalog(path TEXT PRIMARY KEY, kind TEXT, id TEXT, stamp TEXT, etag TEXT, summary TEXT, error TEXT)')
            self.db.execute('CREATE INDEX IF NOT EXISTS by_identity ON catalog(kind,id)')
        except sqlite3.DatabaseError:
            with contextlib.suppress(Exception):
                self.db.close()
            for suffix in ('', '-wal', '-shm'):
                self.db_path.with_name(self.db_path.name + suffix).unlink(missing_ok=True)
            self.db = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
            self.db.execute('CREATE TABLE catalog(path TEXT PRIMARY KEY, kind TEXT, id TEXT, stamp TEXT, etag TEXT, summary TEXT, error TEXT)')
            self.db.execute('CREATE INDEX by_identity ON catalog(kind,id)')
        if self.db.execute('PRAGMA user_version').fetchone()[0] != 3:
            self.db.execute('DELETE FROM catalog')
            self.db.execute('PRAGMA user_version=3')

    def close(self):
        if self._scan_thread and self._scan_thread.is_alive():
            self._scan_thread.join()
        self.db.close()

    @contextlib.contextmanager
    def writer(self):
        """Single writer across both threads and processes; readers use atomic files."""
        with self.lock:
            if getattr(self._writer_local, 'active', False):
                yield
                return
            path = owned_path(self.root, '.write.lock')
            with path.open('a+b') as f:
                if os.name == 'nt':
                    import msvcrt
                    try:
                        f.seek(0)
                        if not f.read(1):
                            f.seek(0)
                            f.write(b'0'); f.flush()
                    except (PermissionError, OSError):
                        pass
                    f.seek(0)
                    msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
                else:
                    import fcntl
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                self._writer_local.active = True
                try:
                    yield
                finally:
                    self._writer_local.active = False
                    if os.name == 'nt':
                        f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)

    def validate(self, kind, doc):
        from backend.settings_schema import validate_settings_groups
        if isinstance(doc, dict) and kind in ('characters', 'scenes', 'plans'):
            validate_settings_groups(doc)
        if kind not in KINDS or not isinstance(doc, dict):
            raise LibraryError('Unknown resource kind')
        if not ID.fullmatch(str(doc.get('id', ''))) or doc.get('id') in ('__proto__', 'prototype', 'constructor'):
            raise LibraryError('Resource requires a stable alphanumeric ID')
        if not isinstance(doc.get('title'), str) or not doc['title'].strip() or len(doc['title']) > 500:
            raise LibraryError('Resource requires a title of 1..500 characters')
        if doc.get('kind', kind) != kind or doc.get('schema', 'mio.resource.v2') != 'mio.resource.v2':
            raise LibraryError('Unsupported resource schema/kind')
        if kind == 'storyboards':
            frames = doc.get('frames')
            if not isinstance(frames, list) or len(frames) > 512:
                raise LibraryError('Storyboard requires up to 512 frames')
            for f in frames:
                if not isinstance(f, dict) or any(not isinstance(f.get(k, ''), str) for k in ('name', 'prompt', 'caption', 'negative')):
                    raise LibraryError('Invalid storyboard frame')
        if kind == 'albums':
            steps = doc.get('steps')
            if not isinstance(steps, list) or len(steps) > 512:
                raise LibraryError('Album requires up to 512 scenes')
            indices = [f.get('stepIndex') for f in steps if isinstance(f, dict)]
            if len(indices) != len(steps) or any(type(i) is not int or not 0 <= i < 512 for i in indices) or len(indices) != len(set(indices)):
                raise LibraryError('Album scene indices must be unique integers')
            total = doc.get('totalSteps', len(steps))
            if type(total) is not int or not 0 <= total <= 512:
                raise LibraryError('Album scene count must be an integer in 0..512')
            for frame in steps:
                for key in ('image', 'originalImage', 'offlineImage'):
                    value = frame.get(key, '')
                    if not isinstance(value, str) or value and not value.startswith('images/'):
                        raise LibraryError('Album images must be owner-relative images/ paths, not external or legacy URLs')
        if kind in ('characters', 'scenes') and not isinstance(doc.get('entries'), list):
            raise LibraryError('Preset requires entries')
        assert_no_credentials(doc)
        if len(encode(doc)) > MAX_DOCUMENT:
            raise LibraryError('Resource JSON exceeds 16 MiB', 413)
        refs = set(image_refs(doc))
        if len({unicodedata.normalize('NFC', ref).casefold() for ref in refs}) != len(refs):
            raise LibraryError('Image paths differ only by case or Unicode normalization; not portable across systems')
        for ref in refs:
            p = PurePosixPath(ref)
            if ref != p.as_posix() or '\\' in ref or '..' in p.parts or ':' in ref or p.suffix.lower() not in IMAGE_SUFFIXES:
                raise LibraryError('Invalid relative image reference')
        return doc

    def _summary(self, kind, doc):
        fields = ('id', 'title', 'description', 'projectId', 'collectionId', 'status', 'createdAt', 'updatedAt', 'tags', 'cover', 'characterName', 'rowId', 'templateId', 'templateTitle', 'synopsis', 'storyTitle', 'liked', 'likes', 'curatedDemo', 'importedVariableSetIds')
        out = {k: doc[k] for k in fields if k in doc}
        for key in list(out):
            if isinstance(out[key], str):
                out[key] = out[key][:600]
            elif key == 'importedVariableSetIds':
                out[key] = [x for x in out[key] if isinstance(x,str) and ID.fullmatch(x)] if isinstance(out[key],list) else []
            elif key == 'tags':
                out[key] = [str(x)[:48] for x in out[key][:20]] if isinstance(out[key], list) else []
            elif not isinstance(out[key], (int, float, bool)):
                del out[key]
        out['kind'] = kind
        if kind == 'storyboards':
            out['frameCount'] = len(doc['frames'])
        elif kind == 'albums':
            steps = doc['steps']
            out['totalSteps'] = doc.get('totalSteps', len(steps))
            out['generatedSteps'] = sum(bool(f.get('image')) and not f.get('deletedImage') for f in steps)
            by_index = {f.get('stepIndex'):f for f in steps}
            out['_missingIndices'] = [i for i in range(out['totalSteps']) if not doc.get('pictureEdits', {}).get(str(i), {}).get('removed') and (not by_index.get(i, {}).get('image') or by_index.get(i, {}).get('offlineFallback'))]
            scores = [f['critique']['score'] for f in steps if isinstance(f.get('critique', {}).get('score'), (int,float))]
            out['_score'] = sum(scores)/len(scores) if scores else 0
            presentation = doc.get('coverPresentation', {})
            requested = presentation.get('index') if isinstance(presentation, dict) else None
            cover = next((f.get('image') for f in steps if f.get('stepIndex') == requested and f.get('image')), None)
            out['cover'] = cover or next((f['image'] for f in steps if f.get('image')), '')
        # No base64, prompts, snapshots, credentials or entire image recipes in catalogue.
        if not isinstance(out.get('cover', ''), str) or not out.get('cover', '').startswith('images/'):
            out['cover'] = ''
        return out

    def _record(self, kind, path):
        relative = path.relative_to(self.root).as_posix()
        try:
            safe = owned_path(self.root, relative)
            st = safe.stat()
            if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_DOCUMENT:
                raise LibraryError('Not a regular resource file or exceeds 16 MiB')
            raw = safe.read_bytes()
            doc = self.validate(kind, decode(raw))
            row = (relative, kind, doc['id'], str((st.st_mtime_ns, st.st_size)), digest(raw), json.dumps(self._summary(kind, doc), ensure_ascii=False), '')
        except (OSError, ValueError, LibraryError) as e:
            row = (relative, kind, '', '', '', '{}', str(e)[:500])
        with self.cache_lock:
            self.db.execute('INSERT OR REPLACE INTO catalog VALUES(?,?,?,?,?,?,?)', row)
        return row

    def scan(self, force=False):
        """One shallow metadata scan; never traverse images or decode an image."""
        with self.lock:
            self.scan_state = {'running': True, 'seen': 0, 'changed': 0, 'error': ''}
        seen = set()
        try:
            with self.cache_lock:
                stamps = dict(self.db.execute('SELECT path,stamp FROM catalog'))
            for kind, (folder, _) in KINDS.items():
                root = owned_path(self.root, folder)
                for entry in os.scandir(root):
                    if entry.name.startswith('.'):
                        continue
                    if kind == 'albums':
                        if not entry.is_dir(follow_symlinks=False):
                            continue
                        path = Path(entry.path) / 'album.json'
                        if not path.exists():
                            continue
                    else:
                        if not entry.is_file(follow_symlinks=False) or not entry.name.lower().endswith('.json'):
                            continue
                        path = Path(entry.path)
                    relative = path.relative_to(self.root).as_posix()
                    seen.add(relative)
                    self.scan_state['seen'] += 1
                    st = path.stat(follow_symlinks=False)
                    stamp = str((st.st_mtime_ns, st.st_size))
                    if force or stamps.get(relative) != stamp:
                        with self.writer():
                            self._record(kind, path)
                        self.scan_state['changed'] += 1
            # Do not remove entries created concurrently after the initial scan snapshot.
            missing = set(stamps) - seen
            with self.cache_lock:
                self.db.executemany('DELETE FROM catalog WHERE path=?', [(p,) for p in missing if not (self.root / p).exists()])
        except Exception as e:
            self.scan_state['error'] = str(e)
            raise
        finally:
            self.scan_state['running'] = False
        return dict(self.scan_state)

    def start_scan(self):
        with self.lock:
            if self._scan_thread and self._scan_thread.is_alive():
                return False
            def run():
                try:
                    self.scan()
                except Exception:
                    pass  # Exposed through scan_state, not silently replaced with empty content.
            self._scan_thread = threading.Thread(target=run, daemon=True, name='library-index')
            self._scan_thread.start()
            return True

    def catalog(self, kind, limit=60, offset=0, query=''):
        if kind not in KINDS or type(limit) is not int or not 1 <= limit <= 200 or type(offset) is not int or offset < 0:
            raise LibraryError('Invalid catalogue query')
        with self.cache_lock:
            # Exclude duplicate IDs instead of arbitrarily choosing and overwriting one.
            where = "kind=? AND error='' AND id NOT IN (SELECT id FROM catalog WHERE kind=? AND id<>'' GROUP BY id HAVING COUNT(*)>1)"
            args = [kind, kind]
            if query:
                where += ' AND summary LIKE ? ESCAPE \'\\\''
                args.append('%' + str(query).replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%')
            total = self.db.execute('SELECT COUNT(*) FROM catalog WHERE ' + where, args).fetchone()[0]
            rows = self.db.execute('SELECT summary,etag,path FROM catalog WHERE ' + where + ' ORDER BY id LIMIT ? OFFSET ?', args + [limit, offset]).fetchall()
        return {'items': [{**json.loads(s), 'etag': etag, 'file': p} for s, etag, p in rows],
                'total': total, 'limit': limit, 'offset': offset, 'index': dict(self.scan_state)}

    def problems(self):
        with self.cache_lock:
            errors = [{'file': p, 'message': e} for p, e in self.db.execute("SELECT path,error FROM catalog WHERE error<>''")]
            duplicates = self.db.execute("SELECT kind,id,GROUP_CONCAT(path) FROM catalog WHERE id<>'' GROUP BY kind,id HAVING COUNT(*)>1").fetchall()
        return errors + [{'kind': k, 'id': id, 'message': 'Duplicate ID: ' + paths} for k, id, paths in duplicates]

    def _path(self, kind, id):
        if kind not in KINDS or not ID.fullmatch(str(id)):
            raise LibraryError('Invalid resource identity')
        with self.cache_lock:
            rows = self.db.execute('SELECT path FROM catalog WHERE kind=? AND id=?', (kind, id)).fetchall()
        if not rows:
            raise LibraryError('Resource not found; rescan after copying a file', 404, 'not_found')
        if len(rows) != 1:
            raise LibraryError('Duplicate resource IDs; no file has been selected or overwritten', 409, 'duplicate_id')
        relative = PurePosixPath(rows[0][0])
        prefix = PurePosixPath(KINDS[kind][0]).parts
        suffix = relative.parts[len(prefix):]
        if relative.parts[:len(prefix)] != prefix or (len(suffix) != 2 or suffix[-1] != 'album.json' if kind == 'albums' else len(suffix) != 1 or not suffix[-1].lower().endswith('.json')):
            raise LibraryError('Catalogue path is outside this resource type; rebuild the cache', 409, 'invalid_cache')
        return owned_path(self.root, rows[0][0])

    def get(self, kind, id):
        with self.writer():
            self._recover()
            path = self._path(kind, id)
            try:
                raw = path.read_bytes()
            except FileNotFoundError:
                raise LibraryError('File was moved or removed; rescan the catalogue', 404) from None
            if len(raw) > MAX_DOCUMENT:
                raise LibraryError('Resource exceeds size limit', 413)
            doc = self.validate(kind, decode(raw))
            if doc['id'] != id:
                raise LibraryError('Resource ID changed on disk; rescan before editing', 409)
            return {'document': doc, 'etag': digest(raw), 'file': path.relative_to(self.root).as_posix()}

    def _new_path(self, kind, doc):
        folder = self.root / KINDS[kind][0]
        name = safe_name(doc['title']) + '--' + doc['id'][-12:]
        path = folder / name / 'album.json' if kind == 'albums' else folder / (name + '.json')
        if path.exists():
            name += '-' + uuid.uuid4().hex[:8]
            path = folder / name / 'album.json' if kind == 'albums' else folder / (name + '.json')
        return path

    def asset_root(self, kind, path):
        return path.parent if kind == 'albums' else path.with_suffix('.assets')

    def _commit(self, operations):
        txn = self.root / '.transactions' / uuid.uuid4().hex
        txn.mkdir(mode=0o700)
        sync_dir(txn.parent)
        manifest = []
        try:
            for i, operation in enumerate(operations):
                if isinstance(operation, dict):
                    owned_path(self.root, operation['source']); owned_path(self.root, operation['path'])
                    manifest.append(operation)
                    continue
                relative, raw = operation
                owned_path(self.root, relative)
                staged = str(i) + '.bin'
                atomic_write(txn / staged, raw, private=True)
                manifest.append({'path': relative, 'stage': staged, 'sha256': digest(raw)})
            atomic_write(txn / 'commit.json', encode(manifest))
            self._apply(txn, manifest)
        except Exception:
            if not (txn / 'commit.json').exists():
                shutil.rmtree(txn)
            raise

    def _apply(self, txn, manifest):
        for op in manifest:
            target = owned_path(self.root, op['path'])
            if op.get('type') == 'move':
                source = owned_path(self.root, op['source'])
                if source.exists():
                    if target.exists():
                        raise LibraryError('Recovery destination already exists; neither copy was overwritten', 409)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(source, target)
                    sync_dir(source.parent)
                    sync_dir(target.parent)
                elif not target.exists():
                    logging.warning(
                        "Both deletion recovery paths are missing (%s -> %s); safely skipping transaction move step",
                        op.get("source"),
                        op.get("path"),
                    )
                continue
            raw = owned_path(txn, op['stage']).read_bytes()
            if digest(raw) != op['sha256']:
                raise LibraryError('Transaction journal damaged; preserve it for recovery', 500)
            # Idempotent roll-forward, including interruption after some atomic renames.
            if not target.exists() or digest(target.read_bytes()) != op['sha256']:
                atomic_write(target, raw, private=op['path'] == 'settings/secrets.json')
        shutil.rmtree(txn)
        sync_dir(txn.parent)

    def _recover(self):
        for txn in (self.root / '.transactions').iterdir():
            if txn.is_symlink() or not txn.is_dir():
                raise LibraryError('Unsafe transaction directory', 500)
            commit = txn / 'commit.json'
            if commit.exists():
                self._apply(txn, decode(commit.read_bytes()))
            else:
                shutil.rmtree(txn)  # No durable commit intent; no authoritative files were changed.

    def put(self, kind, document, expected=None, create=False, assets=None, allocate_id=True):
        doc = copy.deepcopy(document)
        if create and allocate_id:
            doc['id'] = KINDS.get(kind, ('', 'resource'))[1] + '_' + uuid.uuid4().hex
        doc['schema'], doc['kind'] = 'mio.resource.v2', kind
        self.validate(kind, doc)
        with self.writer():
            self._recover()
            if create:
                with self.cache_lock:
                    if self.db.execute('SELECT 1 FROM catalog WHERE kind=? AND id=?', (kind, doc['id'])).fetchone():
                        raise LibraryError('Resource already exists; save as a new copy instead', 409, 'duplicate_id')
                path = self._new_path(kind, doc)
            else:
                current = self.get(kind, doc['id'])
                if not expected or current['etag'] != expected:
                    raise LibraryError('This file changed since it was read. Reload or save a new copy.', 409, 'revision_conflict')
                path = self.root / current['file']
            operations = []
            asset_base = self.asset_root(kind, path)
            refs = set(image_refs(doc))
            for ref in refs:
                target = owned_path(asset_base, ref)
                raw = (assets or {}).get(ref)
                if raw is not None:
                    if len(raw) > MAX_ASSET:
                        raise LibraryError('Image exceeds 50 MiB', 413)
                    image_type(raw)
                    if target.exists() and target.read_bytes() != raw:
                        raise LibraryError('Owned images are immutable; use a new filename', 409)
                    operations.append((target.relative_to(self.root).as_posix(), raw))
                elif not target.is_file():
                    raise LibraryError('Referenced image is missing: ' + ref, 422, 'missing_asset')
            serialized = encode(doc)
            if not create and serialized == path.read_bytes() and not operations:
                return current
            operations.append((path.relative_to(self.root).as_posix(), serialized))
            self._commit(operations)
            self._record(kind, path)
            return {'document': doc, 'etag': digest(encode(doc)), 'file': path.relative_to(self.root).as_posix()}

    def asset(self, kind, id, relative):
        if relative not in set(image_refs(self.get(kind, id)['document'])):
            raise LibraryError('Image is not referenced by this resource', 404)
        path = owned_path(self.asset_root(kind, self._path(kind, id)), relative)
        try:
            raw = path.read_bytes()
        except OSError:
            raise LibraryError('Owned image is missing or unreadable: ' + relative, 422, 'missing_asset') from None
        if len(raw) > MAX_ASSET:
            raise LibraryError('Image exceeds limit', 413)
        mime, _ = image_type(raw)
        return raw, mime

    def delete(self, kind, id, expected):
        with self.writer():
            current = self.get(kind, id)
            if current['etag'] != expected:
                raise LibraryError('Resource changed; deletion was not applied', 409, 'revision_conflict')
            path = self.root / current['file']
            trash = self.root / '.trash' / uuid.uuid4().hex
            trash.mkdir()
            # A durable move journal keeps JSON and its asset sidecar together after interruption.
            atomic_write(trash / 'receipt.json', encode({'kind': kind, 'id': id, 'original': current['file'], 'deletedAt': int(time.time()*1000)}))
            sources = [path.parent] if kind == 'albums' else [path]
            if kind != 'albums' and path.with_suffix('.assets').exists():
                sources.append(path.with_suffix('.assets'))
            manifest = [{'type': 'move', 'source': source.relative_to(self.root).as_posix(),
                         'path': (trash / source.name).relative_to(self.root).as_posix()} for source in sources]
            txn = self.root / '.transactions' / uuid.uuid4().hex
            txn.mkdir(mode=0o700)
            sync_dir(txn.parent)
            atomic_write(txn / 'commit.json', encode(manifest))
            self._apply(txn, manifest)
            with self.cache_lock:
                self.db.execute('DELETE FROM catalog WHERE path=?', (current['file'],))
            return {'deleted': id, 'trash': trash.relative_to(self.root).as_posix()}

    def export_bundle(self, kind, id):
        if kind not in ('storyboards', 'characters', 'scenes', 'albums', 'layouts', 'workflows'):
            raise LibraryError('This entity requires an explicit dependency export')
        with self.writer():
            current = self.get(kind, id)
            doc = share_document(kind, current['document'])
            files = {'resource.json': encode(doc)}
            for ref in sorted(set(image_refs(doc))):
                raw, _ = self.asset(kind, id, ref)
                files[ref] = raw
            if sum(map(len, files.values())) > MAX_BUNDLE:
                raise LibraryError('Share package exceeds 192 MiB', 413)
            manifest = {'schema': 'mio.resource-package.v2', 'kind': kind,
                        'files': {name: digest(raw) for name, raw in files.items()}}
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr('manifest.json', encode(manifest))
                for name, raw in files.items():
                    z.writestr(name, raw)
            return stream.getvalue()

    def inspect_bundle(self, raw, expected_kind=None):
        if len(raw) > MAX_BUNDLE:
            raise LibraryError('Share package exceeds size limit', 413)
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                items = z.infolist()
                names = [i.filename for i in items]
                if len(names) != len({unicodedata.normalize('NFC', name).casefold() for name in names}) or len(names) > 2048 or sum(i.file_size for i in items) > MAX_BUNDLE:
                    raise LibraryError('Duplicate paths or oversized ZIP')
                for i in items:
                    owned_path(self.root, i.filename)
                    if i.is_dir() or stat.S_ISLNK(i.external_attr >> 16) or i.flag_bits & 1:
                        raise LibraryError('Directories, symlinks and encrypted files are not share entries')
                    if i.filename not in ('manifest.json', 'resource.json') and not (i.filename.startswith('images/') and PurePosixPath(i.filename).suffix.lower() in IMAGE_SUFFIXES):
                        raise LibraryError('Unexpected file in share package')
                manifest = decode(z.read('manifest.json'))
                if manifest.get('schema') != 'mio.resource-package.v2' or set(manifest.get('files', {})) != set(names) - {'manifest.json'}:
                    raise LibraryError('Invalid share manifest')
                kind = manifest.get('kind')
                if not isinstance(kind, str) or kind not in KINDS:
                    raise LibraryError('Unknown package kind')
                if expected_kind and kind not in ([expected_kind] if isinstance(expected_kind, str) else expected_kind):
                    raise LibraryError('Wrong resource type')
                files = {name: z.read(name) for name in manifest['files']}
                if any(digest(value) != manifest['files'][name] for name, value in files.items()):
                    raise LibraryError('Share checksum mismatch')
                document = decode(files.pop('resource.json'))
                document = share_document(kind, document)
                if kind == 'layouts':
                    document['scriptEnabled'] = False
                if set(files) != set(image_refs(document)):
                    raise LibraryError('Share image entries must exactly match resource references')
                self.validate(kind, document)
                for value in files.values():
                    if len(value) > MAX_ASSET:raise LibraryError('Image exceeds 50 MiB', 413)
                    image_type(value)
                return kind, document, files
        except (zipfile.BadZipFile, KeyError, json.JSONDecodeError, OSError) as e:
            raise LibraryError('Cannot read resource package: ' + str(e)) from None

    def import_bundle(self, raw, expected_kind=None, project_id=None):
        kind, document, files = self.inspect_bundle(raw, expected_kind)
        if project_id:document['projectId'] = project_id
        return self.put(kind, document, create=True, assets=files)
