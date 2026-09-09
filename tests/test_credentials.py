import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import mio_credentials as vault
import mio_api
import server


class CredentialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = {'id': 'channel-a', 'provider': 'openai', 'baseUrl': 'https://example.com/v1', 'keyMode': 'none'}
        self.patch = patch.object(server, 'DATA_DIR', self.temp.name)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def add(self, secret='test-secret', label='Account', config=None):
        return vault.manage(self.temp.name, {'action': 'add', 'config': config or self.config, 'key': secret, 'label': label})['key']

    def test_metadata_does_not_reveal_secret_even_after_reopening(self):
        item = self.add()
        result = vault.manage(self.temp.name, {'config': self.config})
        self.assertEqual(result['keys'], [item])
        self.assertNotIn('test-secret', json.dumps(result))
        self.assertEqual(vault.resolve(self.temp.name, {'config': {**self.config, 'keyMode': 'stored', 'keyId': item['id']}}), 'test-secret')

    def test_local_file_permissions_and_private_static_path(self):
        self.add()
        path = Path(vault.path_for(self.temp.name))
        self.assertTrue(path.exists())
        if os.name != 'nt':
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertFalse(server.is_public_static_path('/data/secrets/provider-keys.json'))

    def test_multiple_keys_select_without_rotation(self):
        first, second = self.add('a'), self.add('b')
        self.assertEqual(len(vault.manage(self.temp.name, {'config': self.config})['keys']), 2)
        for item, expected in ((first, 'a'), (second, 'b')):
            self.assertEqual(vault.resolve(self.temp.name, {'config': {**self.config, 'keyMode': 'stored', 'keyId': item['id']}}), expected)

    def test_none_auth_does_not_fall_back_to_environment(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'environment-secret'}):
            self.assertEqual(vault.resolve(self.temp.name, {'config': self.config}), '')
            self.assertEqual(vault.resolve(self.temp.name, {'config': {**self.config, 'keyMode': 'environment'}}), 'environment-secret')

    def test_missing_saved_key_fails_without_fallback(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'environment-secret'}), self.assertRaisesRegex(ValueError, 'missing'):
            vault.resolve(self.temp.name, {'config': {**self.config, 'keyMode': 'stored', 'keyId': 'removed'}})

    def test_key_is_bound_to_channel_and_endpoint(self):
        item = self.add()
        for patch_config in ({'id': 'channel-b'}, {'baseUrl': 'https://other.example/v1'}, {'baseUrl': 'https://example.com/other'}):
            with self.assertRaisesRegex(ValueError, 'different endpoint'):
                vault.resolve(self.temp.name, {'config': {**self.config, 'keyMode': 'stored', 'keyId': item['id'], **patch_config}})

    def test_trailing_slash_and_default_port_normalize(self):
        item = self.add()
        self.assertEqual(vault.resolve(self.temp.name, {'config': {**self.config, 'baseUrl': 'https://EXAMPLE.com:443/v1/', 'keyMode': 'stored', 'keyId': item['id']}}), 'test-secret')

    def test_delete_one_key_retains_other_keys(self):
        first, second = self.add('a'), self.add('b')
        vault.manage(self.temp.name, {'action': 'delete', 'config': self.config, 'keyId': first['id']})
        self.assertEqual(vault.manage(self.temp.name, {'config': self.config})['keys'], [second])
        with self.assertRaises(ValueError):
            vault.resolve(self.temp.name, {'config': {**self.config, 'keyMode': 'stored', 'keyId': first['id']}})

    def test_purge_includes_prior_endpoints_but_not_other_channels(self):
        self.add()
        self.add('old-url', config={**self.config, 'baseUrl': 'https://old.example/v1'})
        keep = self.add('other', config={**self.config, 'id': 'channel-b'})
        vault.manage(self.temp.name, {'action': 'purge', 'config': {**self.config, 'baseUrl': 'not a valid URL'}})
        remaining = vault.read(self.temp.name)['keys']
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]['id'], keep['id'])

    def test_corrupt_store_is_not_silently_overwritten(self):
        self.add()
        path = Path(vault.path_for(self.temp.name))
        path.write_text('broken')
        with self.assertRaisesRegex(ValueError, 'unreadable'):
            self.add('next')
        self.assertEqual(path.read_text(), 'broken')

    def test_empty_key_not_saved_and_header_injection_rejected(self):
        for key in ('', '  ', 'key\r\nInjected: x'):
            with self.assertRaises(ValueError):
                self.add(key)

    def test_models_request_uses_selected_key_and_no_model_required(self):
        item = self.add()
        config = {**self.config, 'keyMode': 'stored', 'keyId': item['id']}
        response = MagicMock()
        response.headers = {}
        response.read.side_effect = [b'{"data":[{"id":"z"},{"id":"a"},{"id":"z"},{"id":null}]}', b'']
        response.__enter__.return_value = response
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(server.urllib.request, 'build_opener', return_value=opener):
            result = server.list_provider_models({'config': config})
        req = opener.open.call_args.args[0]
        self.assertEqual(req.full_url, 'https://example.com/v1/models')
        self.assertEqual(req.get_method(), 'GET')
        self.assertEqual(req.get_header('Authorization'), 'Bearer test-secret')
        self.assertEqual(result, {'models': ['a', 'z']})

    def test_models_failure_is_sanitized(self):
        opener = MagicMock()
        opener.open.side_effect = RuntimeError('test-secret')
        with patch.object(server.urllib.request, 'build_opener', return_value=opener), self.assertRaises(ValueError) as exc:
            server.list_provider_models({'config': self.config})
        self.assertNotIn('test-secret', str(exc.exception))

    def test_external_profile_preserves_key_reference_and_optional_flags(self):
        item = self.add()
        profile = {**self.config, 'model': 'gpt-image-1', 'keyMode': 'stored', 'keyId': item['id'], 'sendSize': False, 'sendQuality': False, 'keyLabel': 'not-needed', 'key': 'must-not-copy'}
        config = {'uiConfig': {'comfyStudio': {'settings': {'imageGeneration': {'profiles': [profile]}}}}}
        payload = mio_api.generation_payload({'providerId': 'channel-a', 'prompt': 'test'}, config)
        self.assertNotIn('key', payload['config'])
        self.assertFalse(payload['config']['sendSize'])
        self.assertEqual(vault.resolve(self.temp.name, payload), 'test-secret')
        blank = mio_api.generation_payload({'providerId': 'channel-a', 'prompt': 'test', 'apiKey': ''}, config)
        self.assertEqual(vault.resolve(self.temp.name, blank), '')
