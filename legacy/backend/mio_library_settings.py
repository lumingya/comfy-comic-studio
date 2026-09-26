"""Independent v2 settings and local secret vault.

Public reads return references, never secret values. resolve() is for backend
request construction only. This module does not send requests or start jobs.
The vault is access-controlled plaintext, NOT encrypted credential storage.
"""
import copy
import re
import uuid
import urllib.parse
from backend.mio_library import LibraryError, MAX_ASSET, decode, digest, encode, image_refs, image_type, owned_path, semantic_slot_identifier

SETTING_NAMES = {'comfy', 'llm', 'xml', 'appearance', 'workspace'}
SECRET_NAMES = {'key', 'apikey', 'authorization', 'password', 'secret', 'token',
                'accesstoken', 'refreshtoken', 'xapikey', 'xauthtoken', 'cookie'}


def secret_name(key):
    return re.sub('[^a-z0-9]', '', str(key).lower()) in SECRET_NAMES


def escape(value):
    return str(value).replace('~', '~0').replace('/', '~1')


def leaves(value, pointer=''):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == '_secretRefs':
                continue
            path = pointer + '/' + escape(key)
            typed_key = key == 'key' and ((value.get('type') in ('image', 'text', 'number', 'boolean', 'json') or str(value.get('type','')).startswith('plugin:')) and 'value' in value or value.get('kind') == 'mio-image')
            if secret_name(key) and not typed_key and not (key == 'key' and semantic_slot_identifier(value, pointer)) and isinstance(child, str):
                yield value, key, path
            else:
                yield from leaves(child, path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from leaves(child, pointer + '/' + str(index))


def binding(parent):
    for key in ('baseUrl', 'endpoint'):
        value = parent.get(key, '')
        if isinstance(value, str) and value:
            url = urllib.parse.urlsplit(value)
            if url.username or url.password or url.query or url.fragment:
                raise LibraryError('Endpoint URLs must not contain credentials, query strings or fragments')
    return {key: str(parent.get(key, '')) for key in ('id', 'provider', 'baseUrl', 'endpoint')}


def assert_public_endpoints(value):
    if isinstance(value, dict):
        if 'baseUrl' in value or 'endpoint' in value:
            binding(value)
        for child in value.values():
            assert_public_endpoints(child)
    elif isinstance(value, list):
        for child in value:
            assert_public_endpoints(child)


class FileSettings:
    def __init__(self, library):
        self.library = library

    def _path(self, name):
        if name not in SETTING_NAMES:
            raise LibraryError('Unknown public settings file')
        return owned_path(self.library.root, 'settings/' + name + '.json')

    def _vault(self):
        path = owned_path(self.library.root, 'settings/secrets.json')
        value = decode(path.read_bytes()) if path.exists() else {'version': 1, 'keys': [], 'values': {}}
        if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('values', {}), dict) or not isinstance(value.get('keys', []), list):
            raise LibraryError('Secret vault is damaged; no replacement was written', 409)
        value.setdefault('values', {})
        return value

    def get(self, name):
        with self.library.writer():
            self.library._recover()
            path = self._path(name)
            if not path.exists():
                return {'document': {}, 'etag': None}
            raw = path.read_bytes()
            document = decode(raw)
            if not isinstance(document, dict):
                raise LibraryError('Settings file must contain an object')
            assert_public_endpoints(document)
            if any(parent[key] for parent, key, _ in leaves(document)):
                raise LibraryError('A plaintext credential was found outside settings/secrets.json; use the settings writer to move it safely', 409, 'unprotected_secret')
            return {'document': document, 'etag': digest(raw)}

    def put(self, name, value, expected=None):
        if not isinstance(value, dict):
            raise LibraryError('Settings must be a JSON object')
        document = copy.deepcopy(value)
        assert_public_endpoints(document)
        with self.library.writer():
            self.library._recover()
            path = self._path(name)
            actual = digest(path.read_bytes()) if path.exists() else None
            if actual != expected:
                raise LibraryError('Settings changed since they were read', 409, 'revision_conflict')
            vault = self._vault()
            document = self.prepare(name, document, vault)
            raw = encode(document)
            # Both files commit together; staged secret files and final vault are private.
            self.library._commit([('settings/secrets.json', encode(vault)), ('settings/' + name + '.json', raw)])
            return {'document': document, 'etag': digest(raw)}

    def prepare(self, name, value, vault):
        if not isinstance(value, dict):
            raise LibraryError("Settings must be an object")
        document = copy.deepcopy(value)
        assert_public_endpoints(document)
        refs = document.pop('_secretRefs', {})
        if not isinstance(refs, dict):
            raise LibraryError('Invalid secret reference map')
        new_refs = {}
        for parent, key, pointer in leaves(document):
            value = parent[key]
            if value:
                if len(value) > 32768:
                    raise LibraryError('Credential exceeds size limit')
                ref = 'secret_' + uuid.uuid4().hex
                vault['values'][ref] = {'owner': name, 'pointer': pointer, 'binding': binding(parent), 'value': value}
                new_refs[pointer] = ref
                parent[key] = ''
            elif pointer in refs:
                ref = refs[pointer]
                item = vault['values'].get(ref)
                if not item or item.get('owner') != name or item.get('pointer') != pointer or item.get('binding') != binding(parent):
                    raise LibraryError('Credential binding changed; select or enter a key for this endpoint explicitly', 409, 'credential_binding_changed')
                new_refs[pointer] = ref
        if new_refs:
            document['_secretRefs'] = new_refs
        return document

    def asset(self, name, relative):
        """Read only explicitly referenced setting artwork, never arbitrary settings files."""
        document = self.get(name)['document']
        if relative not in set(image_refs(document)):
            raise LibraryError('Settings artwork is not referenced', 404)
        path = owned_path(self._path(name).with_suffix('.assets'), relative)
        if not path.is_file() or path.stat().st_size > MAX_ASSET:
            raise LibraryError('Settings artwork is missing or too large', 422)
        raw = path.read_bytes()
        mime, _ = image_type(raw)
        return raw, mime

    def resolve_document(self, owner, value, external_refs=None):
        """Backend-only resolution for an entity or an immutable runtime snapshot.

        The owner must be derived by trusted code from the resource identity / SQL
        primary key, never accepted as an arbitrary browser-provided secret scope.
        """
        with self.library.writer():
            self.library._recover()
            document = copy.deepcopy(value)
            refs = document.pop('_secretRefs', {}) if isinstance(document, dict) else (external_refs or {})
            if not isinstance(refs, dict):
                raise LibraryError('Invalid snapshot credential reference map')
            vault = self._vault()
            used = set()
            for parent, key, pointer in leaves(document):
                if pointer not in refs:
                    continue
                item = vault['values'].get(refs[pointer])
                if not item or item.get('owner') != owner or item.get('pointer') != pointer or item.get('binding') != binding(parent):
                    raise LibraryError('Snapshot credential is missing or bound to another owner', 409)
                parent[key] = item['value']
                used.add(pointer)
            if used != set(refs):
                raise LibraryError('Snapshot credential references no longer match its fields', 409)
            return document

    def resolve(self, name):
        """Never return this result from a public API or include it in an album."""
        with self.library.writer():
            document = self.get(name)['document']
            vault = self._vault()
            refs = document.pop('_secretRefs', {})
            for parent, key, pointer in leaves(document):
                if pointer not in refs:
                    continue
                item = vault['values'].get(refs[pointer])
                if not item or item.get('owner') != name or item.get('pointer') != pointer or item.get('binding') != binding(parent):
                    raise LibraryError('Secret reference is missing or bound to a different endpoint', 409)
                parent[key] = item['value']
            return document
