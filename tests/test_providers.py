"""Paid upstream calls are intercepted; verify real wire formats and failures."""
import base64
import io
import json
import unittest
import zipfile
from unittest.mock import patch, MagicMock
import server

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')

class ProviderTests(unittest.TestCase):
    def payload(self, provider='openai'):
        return dict(config=dict(provider=provider, baseUrl='https://example.com/v1', model='gpt-image-1'), key='secret', prompt='test', negative='blur', frame={}, albumId='test')

    def run_provider(self, payload, raw):
        response = MagicMock()
        response.headers = {}
        response.read.side_effect = [raw, b'']
        response.__enter__.return_value = response
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(server.urllib.request, 'build_opener', return_value=opener), patch.object(server, 'store_image_data', return_value='/images/test.png') as store:
            result = server.generate_provider_image(payload)
        self.assertEqual(result['image'], '/images/test.png')
        self.assertFalse(result['offlineFallback'])
        self.assertTrue(store.call_args.args[0].startswith('data:image/png;base64,'))
        self.assertEqual(opener.open.call_count, 1)
        return opener.open.call_args.args[0]

    def test_images_base64(self):
        req = self.run_provider(self.payload(), json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())
        self.assertEqual(req.full_url, 'https://example.com/v1/images/generations')
        body = json.loads(req.data)
        self.assertEqual(body['model'], 'gpt-image-1')
        self.assertNotIn('steps', body)
        self.assertNotIn('response_format', body)
        self.assertIn('Avoid: blur', body['prompt'])

    def test_novelai_zip_and_v4(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('image_0.png', PNG)
        payload = self.payload('novelai')
        payload['config'].update(baseUrl='https://image.novelai.net', model='nai-diffusion-4-5-full')
        req = self.run_provider(payload, data.getvalue())
        body = json.loads(req.data)
        self.assertEqual(req.full_url, 'https://image.novelai.net/ai/generate-image')
        self.assertEqual(body['parameters']['v4_prompt']['caption']['base_caption'], 'test')
        self.assertEqual(body['parameters']['negative_prompt'], 'blur')
        self.assertEqual(body['action'], 'generate')

    def test_edit_multipart(self):
        payload = self.payload()
        payload['source'] = 'data:image/png;base64,' + base64.b64encode(PNG).decode()
        req = self.run_provider(payload, json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())
        boundary = req.get_header('Content-type').split('boundary=')[1].encode()
        self.assertTrue(req.data.startswith(b'--' + boundary + b'\r\n'))
        self.assertTrue(req.data.endswith(b'--' + boundary + b'--\r\n'))
        self.assertIn(b'name="image"', req.data)
        self.assertIn(PNG, req.data)
        self.assertTrue(req.full_url.endswith('/images/edits'))

    def test_chat_image_and_reference(self):
        payload = self.payload()
        payload['config']['protocol'] = 'chat'
        payload['source'] = 'data:image/png;base64,' + base64.b64encode(PNG).decode()
        raw = json.dumps({'choices': [{'message': {'images': [{'image_url': {'url': payload['source']}}]}}]}).encode()
        req = self.run_provider(payload, raw)
        self.assertEqual(json.loads(req.data)['messages'][0]['content'][1]['image_url']['url'], payload['source'])
        self.assertTrue(req.full_url.endswith('/chat/completions'))

    def test_empty_text_response_is_failure(self):
        with self.assertRaisesRegex(ValueError, 'no image'):
            self.run_provider(self.payload(), b'{"choices":[{"message":{"content":"Sorry"}}]}')

    def test_empty_key_is_allowed_and_https_still_required(self):
        payload = self.payload()
        payload['key'] = ''
        payload['config']['keyMode'] = 'none'
        with patch.dict(server.os.environ, {'OPENAI_API_KEY': 'must-not-leak'}):
            req = self.run_provider(payload, json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())
        self.assertIsNone(req.get_header('Authorization'))
        payload['config']['baseUrl'] = 'http://example.com'
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            server.generate_provider_image(payload)

    def test_invalid_novelai_size_rejected_before_network(self):
        payload = self.payload('novelai')
        payload['frame']['width'] = 777
        with self.assertRaisesRegex(ValueError, 'multiples of 64'):
            server.generate_provider_image(payload)

    def test_returned_url_is_downloaded_without_api_key(self):
        with patch.object(server, 'fetch_remote_image', return_value=(PNG, 'image/png')) as fetch:
            self.run_provider(self.payload(), b'{"data":[{"url":"https://cdn.example/a.png"}]}')
        fetch.assert_called_once_with('https://cdn.example/a.png')

    def test_svg_from_provider_is_not_accepted_as_generated_artwork(self):
        svg = base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').decode()
        with self.assertRaisesRegex(ValueError, 'PNG, JPEG or WebP'):
            self.run_provider(self.payload(), json.dumps({'data': [{'b64_json': svg}]}).encode())

    def test_spoofed_reference_mime_is_rejected(self):
        payload = self.payload()
        payload['source'] = 'data:image/png;base64,' + base64.b64encode(b'<svg/>').decode()
        with self.assertRaisesRegex(ValueError, 'Reference bytes'):
            server.generate_provider_image(payload)

    def test_disabled_size_and_quality_are_omitted_even_with_saved_values(self):
        payload = self.payload()
        payload['config'].update(size='1024x1024', quality='high', sendSize=False, sendQuality=False)
        req = self.run_provider(payload, json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())
        body = json.loads(req.data)
        self.assertNotIn('size', body)
        self.assertNotIn('quality', body)

    def test_blank_optional_values_are_not_replaced_with_defaults(self):
        payload = self.payload()
        payload['config'].update(size='', quality='', sendSize=True, sendQuality=True)
        req = self.run_provider(payload, json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())
        body = json.loads(req.data)
        self.assertNotIn('size', body)
        self.assertNotIn('quality', body)

    def test_edit_multipart_omits_disabled_optional_fields(self):
        payload = self.payload()
        payload['source'] = 'data:image/png;base64,' + base64.b64encode(PNG).decode()
        payload['config'].update(size='1024x1024', quality='high', sendSize=False, sendQuality=False)
        req = self.run_provider(payload, json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())
        self.assertNotIn(b'name="size"', req.data)
        self.assertNotIn(b'name="quality"', req.data)

    def test_enabled_optional_fields_are_sent(self):
        payload = self.payload()
        payload['config'].update(size='1024x1536', quality='high', sendSize=True, sendQuality=True)
        req = self.run_provider(payload, json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())
        self.assertEqual(json.loads(req.data)['size'], '1024x1536')
        self.assertEqual(json.loads(req.data)['quality'], 'high')
