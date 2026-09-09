import base64
import http.client
import json
import os
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import server
import mio_api

TOKEN = 't' * 40
CONFIG = {
    'templates': [{'id': 's1', 'title': 'A', 'frames': [{'id': 'f1', 'prompt': 'test', '_execution': {'key': 'SECRET'}}]}],
    'savedGalleries': [{'id': 'b1', 'title': 'B', 'sourceSnapshot': {'key': 'SECRET'}}],
    'uiConfig': {'comfyStudio': {'settings': {'imageGeneration': {'profiles': [
        {'id': 'p1', 'title': 'API', 'provider': 'openai', 'model': 'gpt-image-1', 'baseUrl': 'https://example.com/v1', 'key': 'SECRET'}]}}}}
}


class ExternalApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ComicRequestHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def setUp(self):
        self.env = patch.dict(os.environ, {'MIO_API_TOKEN': TOKEN})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.config = patch.object(server, 'read_merged_config', return_value=CONFIG)
        self.config.start()
        self.addCleanup(self.config.stop)

    def request(self, path, method='GET', body=None, token=TOKEN, extra=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        self.addCleanup(conn.close)
        headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', **(extra or {})}
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = conn.getresponse()
        raw = response.read()
        return response.status, json.loads(raw), response.headers

    def test_disabled_without_strong_token(self):
        with patch.dict(os.environ, {'MIO_API_TOKEN': ''}):
            status, data, _ = self.request('/api/v1/health')
        self.assertEqual(status, 503)
        self.assertEqual(data['error']['code'], 'api_disabled')

    def test_token_required(self):
        status, data, _ = self.request('/api/v1/health', token='bad')
        self.assertEqual(status, 401)
        self.assertTrue(data['requestId'].startswith('req_'))

    def test_health(self):
        status, data, _ = self.request('/api/v1/health')
        self.assertEqual(status, 200)
        self.assertEqual(data['data']['name'], 'Mio')

    def test_capabilities_are_honest(self):
        _, data, _ = self.request('/api/v1/capabilities')
        self.assertFalse(data['data']['browserQueueIntegration'])
        self.assertNotIn('comfyui', data['data']['generationProviders'])

    def test_schema_is_raw_and_secured(self):
        status, data, _ = self.request('/api/v1/openapi.json')
        self.assertEqual(status, 200)
        self.assertEqual(data['openapi'], '3.1.0')
        self.assertIn('/api/v1/images/generations', data['paths'])
        self.assertIn('bearerAuth', data['components']['securitySchemes'])

    def test_provider_dto_does_not_leak_secrets_or_urls(self):
        _, data, _ = self.request('/api/v1/providers')
        self.assertNotIn('SECRET', json.dumps(data))
        self.assertNotIn('baseUrl', json.dumps(data))
        self.assertEqual(data['data'][0]['id'], 'p1')

    def test_storyboard_dto_removes_execution_snapshots(self):
        _, data, _ = self.request('/api/v1/storyboards?limit=1&offset=0')
        self.assertEqual(data['data']['total'], 1)
        self.assertNotIn('SECRET', json.dumps(data))
        self.assertEqual(data['data']['items'][0]['frames'][0]['prompt'], 'test')

    def test_album_dto_removes_source_snapshots(self):
        _, data, _ = self.request('/api/v1/albums')
        self.assertNotIn('sourceSnapshot', json.dumps(data))

    def test_invalid_pagination(self):
        for query in ('limit=101', 'offset=-1', 'limit=no'):
            self.assertEqual(self.request('/api/v1/albums?' + query)[0], 400)

    def test_origin_rejected_on_external_and_private_reads(self):
        for path in ('/api/v1/health', '/api/config'):
            self.assertEqual(self.request(path, extra={'Origin': 'https://evil.example'})[0], 403)

    def test_preflight_allows_authorization_only_for_known_origins(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        self.addCleanup(conn.close)
        conn.request('OPTIONS', '/api/v1/health', headers={'Origin': f'http://localhost:{server.PORT}'})
        response = conn.getresponse()
        self.assertEqual(response.status, 204)
        self.assertIn('Authorization', response.getheader('Access-Control-Allow-Headers'))
        response.read()

    def test_unknown_route_and_method(self):
        self.assertEqual(self.request('/api/v1/nope')[0], 404)
        self.assertEqual(self.request('/api/v1/albums', method='DELETE')[0], 405)

    def test_generates_once_without_mutating_browser_queue(self):
        with patch.object(server, 'generate_provider_image', return_value={'image': '/images/a.png', 'offlineFallback': False}) as generate, patch.object(server, 'write_split_config') as write:
            status, data, _ = self.request('/api/v1/images/generations', 'POST', {'providerId': 'p1', 'prompt': 'test', 'apiKey': 'private-key'})
        self.assertEqual(status, 200)
        generate.assert_called_once()
        write.assert_not_called()
        self.assertNotIn('private-key', json.dumps(data))
        self.assertNotIn('key', generate.call_args.args[0]['config'])
        self.assertEqual(generate.call_args.args[0]['albumId'], 'external')

    def test_rejects_ambiguous_or_unsupported_requests(self):
        for body in ({'providerId': 'p1', 'config': {}, 'prompt': 'x'}, {'config': {'provider': 'comfyui'}, 'prompt': 'x'}, {'providerId': 'p1', 'prompt': ''}, {'providerId': 'p1', 'prompt': 'x', 'frame': {'workflow': {}}}, {'providerId': 'p1', 'prompt': 'x', 'forceWrite': True}):
            self.assertEqual(self.request('/api/v1/images/generations', 'POST', body)[0], 400)

    def test_busy_returns_429(self):
        mio_api.GENERATION_SLOT.acquire()
        try:
            self.assertEqual(self.request('/api/v1/images/generations', 'POST', {'providerId': 'p1', 'prompt': 'x'})[0], 429)
        finally:
            mio_api.GENERATION_SLOT.release()

    def test_upstream_error_is_sanitized_and_slot_released(self):
        with patch.object(server, 'generate_provider_image', side_effect=RuntimeError('SECRET')):
            status, data, _ = self.request('/api/v1/images/generations', 'POST', {'providerId': 'p1', 'prompt': 'x'})
        self.assertEqual(status, 502)
        self.assertNotIn('SECRET', json.dumps(data))
        self.assertTrue(mio_api.GENERATION_SLOT.acquire(blocking=False))
        mio_api.GENERATION_SLOT.release()

    def test_asset_path_is_local_and_traversal_safe(self):
        for path in ('https%3A%2F%2Fevil.example%2Fa.png', '%2Fimages%2F..%2Fserver.py', '%2Fetc%2Fpasswd'):
            self.assertEqual(self.request('/api/v1/assets?path=' + path)[0], 400)
        with patch.object(server, 'image_url_to_data_url', return_value='data:image/png;base64,AA=='):
            status, data, _ = self.request('/api/v1/assets?path=%2Fimages%2Fa.png')
        self.assertEqual(status, 200)
        self.assertIn('dataUrl', data['data'])

    def test_mio_environment_takes_precedence_with_legacy_fallback(self):
        with patch.dict(os.environ, {'MIO_PORT': '8899', 'COMFY_COMIC_PORT': '8777'}):
            self.assertEqual(server._read_port_from_env(), 8899)

    def test_openapi_file_matches_runtime(self):
        from pathlib import Path
        spec = json.loads((Path(__file__).resolve().parents[1] / 'docs/api/openapi.json').read_text())
        self.assertEqual(spec, mio_api.openapi())
