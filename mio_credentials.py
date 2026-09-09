"""Local provider credential store. Secrets never leave through list responses.

This is a permissions-restricted local file, NOT encrypted storage. It is kept
outside the native workspace config and its normal export/restore contract.
"""
import json
import os
import tempfile
import threading
import time
import urllib.parse
import uuid

LOCK = threading.RLock()


def endpoint(config):
    provider = config.get('provider')
    if provider not in ('openai', 'novelai'):
        raise ValueError('Unsupported provider')
    base = str(config.get('baseUrl', '')).strip().rstrip('/')
    p = urllib.parse.urlsplit(base)
    if p.scheme not in ('https', 'http') or not p.hostname or p.username or p.password or p.query or p.fragment:
        raise ValueError('Invalid provider base URL')
    if p.scheme == 'http' and p.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Remote providers require HTTPS')
    # Normalize host/scheme without changing case-sensitive API paths.
    host = p.hostname.lower()
    if ':' in host:
        host = '[' + host + ']'
    port = p.port
    if port and not (p.scheme == 'https' and port == 443 or p.scheme == 'http' and port == 80):
        host += ':' + str(port)
    return provider, urllib.parse.urlunsplit((p.scheme, host, p.path.rstrip('/'), '', ''))


def scope(config):
    provider, base = endpoint(config)
    profile_id = config.get('id', '')
    if not isinstance(profile_id, str) or not profile_id or len(profile_id) > 150:
        raise ValueError('A valid channel ID is required')
    return {'profileId': profile_id, 'provider': provider, 'baseUrl': base}


def path_for(data_dir):
    return os.path.join(data_dir, 'secrets', 'provider-keys.json')


def read(data_dir):
    path = path_for(data_dir)
    if not os.path.exists(path):
        return {'version': 1, 'keys': []}
    try:
        with open(path, encoding='utf-8') as handle:
            value = json.load(handle)
        if value.get('version') != 1 or not isinstance(value.get('keys'), list):
            raise ValueError()
        return value
    except Exception:
        raise ValueError('Local credential store is unreadable; restore a trusted backup before changing keys') from None


def write(data_dir, value):
    path = path_for(data_dir)
    parent = os.path.dirname(path)
    os.makedirs(parent, mode=0o700, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.keys-', dir=parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def metadata(item):
    return {k: item[k] for k in ('id', 'label', 'createdAt')}


def manage(data_dir, payload):
    config = payload.get('config') or {}
    action = payload.get('action', 'list')
    if action == 'purge':
        profile_id = config.get('id')
        if not isinstance(profile_id, str) or not profile_id or len(profile_id) > 150:
            raise ValueError('A valid channel ID is required')
        binding = {'profileId': profile_id}
    else:
        binding = scope(config)
    with LOCK:
        value = read(data_dir)
        matches = [item for item in value['keys'] if item.get('scope') == binding]
        if action == 'list':
            return {'keys': [metadata(item) for item in matches]}
        if action == 'add':
            key = payload.get('key', '')
            if not isinstance(key, str) or not key.strip() or len(key) > 16384 or '\n' in key or '\r' in key:
                raise ValueError('Enter a nonempty API key; choose no authentication to use an empty key')
            if len(value['keys']) >= 1000:
                raise ValueError('Credential store limit reached')
            item = {'id': 'key_' + uuid.uuid4().hex, 'label': str(payload.get('label') or 'API Key').strip()[:80],
                    'createdAt': int(time.time() * 1000), 'scope': binding, 'secret': key.strip()}
            value['keys'].append(item)
            write(data_dir, value)
            return {'key': metadata(item)}
        if action == 'delete':
            key_id = payload.get('keyId')
            if not any(item['id'] == key_id for item in matches):
                raise ValueError('Key not found for this channel and endpoint')
            value['keys'] = [item for item in value['keys'] if item['id'] != key_id]
        elif action == 'purge':
            # A channel removal also removes keys for its previous endpoint URLs.
            value['keys'] = [item for item in value['keys'] if item.get('scope', {}).get('profileId') != binding['profileId']]
        else:
            raise ValueError('Unsupported credential operation')
        write(data_dir, value)
        return {'ok': True}


def resolve(data_dir, payload):
    config = payload.get('config') or {}
    provider, _ = endpoint(config)
    # Explicit raw credentials are for trusted external clients / old callers.
    if payload.get('key'):
        key = payload['key']
    else:
        mode = config.get('keyMode', 'environment')  # old snapshots keep old env behavior
        if mode == 'none':
            return ''
        if mode == 'environment':
            key = os.environ.get('NOVELAI_API_KEY' if provider == 'novelai' else 'OPENAI_API_KEY', '')
        elif mode == 'stored':
            binding = scope(config)
            with LOCK:
                item = next((k for k in read(data_dir)['keys'] if k['id'] == config.get('keyId') and k.get('scope') == binding), None)
            if item is None:
                raise ValueError('Saved key is missing or belongs to a different endpoint; select or save a key for this channel')
            key = item['secret']
        else:
            raise ValueError('Unsupported authentication mode')
    if not isinstance(key, str) or '\r' in key or '\n' in key:
        raise ValueError('Invalid API key')
    return key.strip()
