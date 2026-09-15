import copy
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch
from backend import mio_library as lib
from backend.mio_library_settings import FileSettings


class FileSettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.library = lib.FileLibrary(self.tmp.name)
        self.settings = FileSettings(self.library)

    def tearDown(self):
        self.library.close()
        self.tmp.cleanup()

    def save_key(self):
        return self.settings.put('llm', {'baseUrl': 'https://example.test/v1', 'model': 'test', 'key': 'ONLY_IN_VAULT'})

    def test_public_settings_never_contain_credential_values(self):
        saved = self.save_key()
        self.assertEqual(saved, self.settings.get('llm'))
        self.assertEqual(saved['document']['key'], '')
        self.assertNotIn('ONLY_IN_VAULT', lib.encode(saved).decode())
        public = Path(self.tmp.name) / 'settings/llm.json'
        vault = Path(self.tmp.name) / 'settings/secrets.json'
        self.assertNotIn(b'ONLY_IN_VAULT', public.read_bytes())
        self.assertIn(b'ONLY_IN_VAULT', vault.read_bytes())
        self.assertEqual(self.settings.resolve('llm')['key'], 'ONLY_IN_VAULT')
        if os.name != 'nt':
            self.assertEqual(vault.stat().st_mode & 0o777, 0o600)
        self.assertFalse(list((Path(self.tmp.name) / '.transactions').iterdir()))

    def test_retaining_reference_does_not_need_plaintext_round_trip(self):
        saved = self.save_key(); doc = copy.deepcopy(saved['document']); doc['model'] = 'new-model'
        again = self.settings.put('llm', doc, expected=saved['etag'])
        self.assertEqual(self.settings.resolve('llm')['key'], 'ONLY_IN_VAULT')
        self.assertEqual(again['document']['_secretRefs'], saved['document']['_secretRefs'])

    def test_endpoint_change_cannot_silently_reuse_an_old_key(self):
        saved = self.save_key(); doc = copy.deepcopy(saved['document']); doc['baseUrl'] = 'https://other.test/v1'
        with self.assertRaises(lib.LibraryError) as err:
            self.settings.put('llm', doc, expected=saved['etag'])
        self.assertEqual(err.exception.code, 'credential_binding_changed')
        self.assertEqual(self.settings.resolve('llm')['baseUrl'], 'https://example.test/v1')
        doc['key'] = 'EXPLICIT_NEW_KEY'
        self.settings.put('llm', doc, expected=saved['etag'])
        self.assertEqual(self.settings.resolve('llm')['key'], 'EXPLICIT_NEW_KEY')

    def test_other_settings_file_cannot_claim_secret_reference(self):
        saved = self.save_key()
        with self.assertRaises(lib.LibraryError):
            self.settings.put('comfy', saved['document'])
        self.assertEqual(self.settings.get('comfy')['document'], {})

    def test_conflicts_are_per_settings_file(self):
        saved = self.save_key()
        self.settings.put('appearance', {'theme': 'night'})
        self.settings.put('llm', saved['document'], expected=saved['etag'])
        changed = copy.deepcopy(saved['document']); changed['model'] = 'changed'
        self.settings.put('llm', changed, expected=saved['etag'])
        with self.assertRaises(lib.LibraryError):
            self.settings.put('llm', saved['document'], expected=saved['etag'])

    def test_unreadable_vault_never_gets_replaced_with_an_empty_one(self):
        self.save_key(); vault = Path(self.tmp.name) / 'settings/secrets.json'
        vault.write_bytes(b'broken-vault')
        with self.assertRaises(lib.LibraryError):
            self.settings.put('comfy', {'key': 'new'})
        self.assertEqual(vault.read_bytes(), b'broken-vault')

    def test_secret_journal_is_private_and_recovers_both_files(self):
        real = lib.atomic_write
        def fault(path, raw, private=False):
            if str(path).endswith('settings/llm.json'):
                raise OSError('controlled interruption after writing vault')
            return real(path, raw, private)
        with patch.object(lib, 'atomic_write', side_effect=fault), self.assertRaises(OSError):
            self.save_key()
        journals = list((Path(self.tmp.name) / '.transactions').glob('*/*.bin'))
        self.assertTrue(journals)
        if os.name != 'nt':
            for file in journals:
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
                self.assertEqual(file.parent.stat().st_mode & 0o777, 0o700)
        self.library.close(); self.library = lib.FileLibrary(self.tmp.name); self.settings = FileSettings(self.library)
        self.assertEqual(self.settings.resolve('llm')['key'], 'ONLY_IN_VAULT')
        self.assertEqual(self.settings.get('llm')['document']['key'], '')

    def test_keys_embedded_in_endpoint_urls_are_not_public_settings(self):
        for url in ('https://user:password@example.test/v1', 'https://example.test/v1?api_key=HIDDEN'):
            with self.assertRaises(lib.LibraryError):
                self.settings.put('llm', {'baseUrl': url})
        self.assertEqual(self.settings.get('llm')['document'], {})

    def test_plaintext_manual_settings_are_not_returned_publicly(self):
        file = Path(self.tmp.name) / 'settings/llm.json'; file.write_bytes(lib.encode({'key': 'INLINE_SECRET'}))
        with self.assertRaises(lib.LibraryError) as err:
            self.settings.get('llm')
        self.assertEqual(err.exception.code, 'unprotected_secret')
        self.assertNotIn('INLINE_SECRET', str(err.exception))


if __name__ == '__main__':
    unittest.main()
