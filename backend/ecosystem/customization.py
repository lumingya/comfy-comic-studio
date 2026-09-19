"""User-owned CSS, deliberately trusted, with bounded history and optimistic locking.

This is not a CSS sanitizer. Even seemingly innocuous CSS can leak data or hide UI.
Activation requires an explicit trust decision; safe mode bypasses it completely.
"""
import copy
import json
import re
import threading
import time
from backend.mio_library import LibraryError
from .storage import Storage, identifier


class Customization:
    def __init__(self, data):
        self.store = Storage(data / 'ecosystem')
        self.lock = threading.RLock()

    @staticmethod
    def defaults():
        return {'version': 1, 'enabled': False, 'tokens': {}, 'snippets': []}

    @classmethod
    def validate(cls, value):
        if not isinstance(value, dict) or value.get('version') != 1:
            raise LibraryError('Unsupported customization document')
        if type(value.get('enabled')) is not bool:
            raise LibraryError('enabled must be boolean')
        tokens, snippets = value.get('tokens', {}), value.get('snippets', [])
        if not isinstance(tokens, dict) or len(tokens) > 100:
            raise LibraryError('At most 100 design tokens')
        for key, item in tokens.items():
            if not re.fullmatch(r'--[a-zA-Z][a-zA-Z0-9_-]{0,79}', key) or not isinstance(item, str) or len(item) > 2000:
                raise LibraryError('Invalid CSS token')
        if not isinstance(snippets, list) or len(snippets) > 64:
            raise LibraryError('At most 64 CSS snippets')
        cleaned, ids = [], set()
        for item in snippets:
            if not isinstance(item, dict):
                raise LibraryError('Invalid CSS snippet')
            key = identifier(item.get('id'))
            if key in ids:
                raise LibraryError('Duplicate snippet ID')
            ids.add(key)
            name, css, scope = item.get('name'), item.get('css'), item.get('scope', 'global')
            if not isinstance(name, str) or not name.strip() or len(name) > 120:
                raise LibraryError('Snippet needs a name (1–120 characters)')
            if not isinstance(css, str) or '\x00' in css:
                raise LibraryError('Invalid CSS text')
            if not isinstance(scope, str) or not re.fullmatch(r'global|workspace:[a-zA-Z0-9_:-]{1,140}', scope):
                raise LibraryError('Invalid workspace scope')
            if type(item.get('enabled')) is not bool:
                raise LibraryError('Snippet enabled must be boolean')
            cleaned.append({'id': key, 'name': name.strip(), 'css': css, 'scope': scope, 'enabled': item['enabled']})
        result = {'version': 1, 'enabled': value['enabled'], 'tokens': tokens, 'snippets': cleaned}
        if len(json.dumps(result, ensure_ascii=False).encode()) > 128 * 1024:
            raise LibraryError('Customization document exceeds 128 KiB')
        return result

    def read(self):
        with self.lock:
            return self.store.get('customization', {'revision': 0, 'document': self.defaults(), 'history': []})

    def save(self, document, revision, trusted=False):
        clean = self.validate(document)
        if clean['enabled'] and trusted is not True:
            raise LibraryError('Confirm trust: CSS can change all UI and contact external servers', 403)
        with self.lock:
            current = self.read()
            if type(revision) is not int or current['revision'] != revision:
                raise LibraryError('Styles changed in another window. Export your draft, then reload.', 409)
            history = current['history'] + [{'revision': current['revision'], 'savedAt': time.time(), 'document': current['document']}]
            result = {'revision': revision + 1, 'document': copy.deepcopy(clean), 'history': history[-10:]}
            self.store.set('customization', result)
            return result

    def reset(self):
        with self.lock:
            current = self.read()
            document = current['document']
            document['enabled'] = False
            return self.save(document, current['revision'])
