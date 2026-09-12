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

    def test_ordered_multi_image_multipart(self):
        payload = self.payload()
        second = PNG + b'second'
        payload['images'] = ['data:image/png;base64,' + base64.b64encode(raw).decode() for raw in (PNG, second)]
        req = self.run_provider(payload, json.dumps({'data': [{'b64_json': base64.b64encode(PNG).decode()}]}).encode())
        from email.parser import BytesParser
        from email.policy import default
        message = BytesParser(policy=default).parsebytes(('Content-Type: ' + req.get_header('Content-type') + '\r\n\r\n').encode() + req.data)
        parts = [part for part in message.iter_parts() if part.get_filename()]
        self.assertEqual([part.get_param('name', header='content-disposition') for part in parts], ['image[]', 'image[]'])
        self.assertEqual([part.get_filename() for part in parts], ['image_1.png', 'image_2.png'])
        self.assertEqual([part.get_payload(decode=True) for part in parts], [PNG, second])
        self.assertTrue(req.full_url.endswith('/images/edits'))

    def test_ordered_multi_image_chat(self):
        payload = self.payload()
        payload['config']['protocol'] = 'chat'
        payload['images'] = ['data:image/png;base64,' + base64.b64encode(raw).decode() for raw in (PNG, PNG + b'second')]
        raw = json.dumps({'choices': [{'message': {'images': [{'image_url': {'url': payload['images'][0]}}]}}]}).encode()
        req = self.run_provider(payload, raw)
        parts = json.loads(req.data)['messages'][0]['content']
        self.assertEqual([part['image_url']['url'] for part in parts[1:]], payload['images'])

    def test_novelai_ordered_reference_array_without_img2img(self):
        payload = self.payload('novelai')
        payload['images'] = ['data:image/png;base64,' + base64.b64encode(raw).decode() for raw in (PNG, PNG + b'second')]
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('image.png', PNG)
        req = self.run_provider(payload, data.getvalue())
        body = json.loads(req.data)
        self.assertEqual(body['action'], 'generate')
        self.assertEqual(body['parameters']['reference_image_multiple'], [image.split(',')[1] for image in payload['images']])
        self.assertNotIn('image', body['parameters'])
        self.assertNotIn('strength', body['parameters'])

    def test_missing_image_fails_before_paid_request(self):
        payload = self.payload()
        payload['images'] = ['/images/variable-assets/missing.png']
        with patch.object(server.urllib.request, 'build_opener') as opener:
            with self.assertRaises(FileNotFoundError):
                server.generate_provider_image(payload)
        opener.assert_not_called()

    def test_remote_image_reference_is_not_fetched(self):
        payload = self.payload()
        payload['images'] = ['https://example.com/private.png']
        with patch.object(server.urllib.request, 'build_opener') as opener:
            with self.assertRaises(ValueError):
                server.generate_provider_image(payload)
        opener.assert_not_called()

    def test_ordered_array_type_and_count_are_checked(self):
        for images in ('bad', [None], [''] * 33):
            payload = self.payload()
            payload['images'] = images
            with self.assertRaises(ValueError):
                server.generate_provider_image(payload)

    def test_http_error_body_and_status_preserved_without_retry_or_key(self):
        import urllib.error
        payload = self.payload()
        raw = ('{"error":{"code":"unsupported_images","message":"参数错误 ' + 'detail ' * 100 + 'secret"}}').encode()
        error = urllib.error.HTTPError('https://example.com', 422, 'Unprocessable', {}, io.BytesIO(raw))
        opener = MagicMock()
        opener.open.side_effect = error
        with patch.object(server.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaises(server.ProviderHTTPError) as caught:
                server.generate_provider_image(payload)
        self.assertEqual(caught.exception.status, 422)
        self.assertEqual(caught.exception.body, raw.replace(b'secret', b'[REDACTED]'))
        self.assertEqual(opener.open.call_count, 1)

    def test_variable_asset_content_addressed_and_readable_after_reload(self):
        import tempfile
        import os
        with tempfile.TemporaryDirectory() as root, patch.object(server, 'IMAGES_DIR', root):
            first = server.store_image_data('data:image/png;base64,' + base64.b64encode(PNG).decode(), 'variable-assets')
            second = server.store_image_data('data:image/png;base64,' + base64.b64encode(PNG + b'new').decode(), 'variable-assets')
            self.assertNotEqual(first, second)
            self.assertEqual(server.store_image_data('data:image/png;base64,' + base64.b64encode(PNG).decode(), 'variable-assets'), first)
            self.assertEqual(server.provider_image_input(first)[1], PNG)
            self.assertEqual(server.provider_image_input(second)[1], PNG + b'new')
            self.assertTrue(os.path.isfile(os.path.join(root, first.removeprefix('/images/'))))

    def test_multi_output_preserves_all_artifacts(self):
        from unittest.mock import MagicMock, patch
        response=MagicMock();response.headers={};response.read.side_effect=[json.dumps({'data':[{'b64_json':base64.b64encode(PNG).decode()},{'b64_json':base64.b64encode(PNG+b'2').decode()}]}).encode(),b''];response.__enter__.return_value=response
        opener=MagicMock();opener.open.return_value=response
        with patch.object(server.urllib.request,'build_opener',return_value=opener),patch.object(server,'store_image_data',side_effect=['/images/1.png','/images/2.png']):result=server.generate_provider_image(self.payload())
        self.assertEqual([a['url'] for a in result['artifacts']],['/images/1.png','/images/2.png']);self.assertEqual(result['image'],'/images/1.png');self.assertEqual(result['contractVersion'],1)

    def test_chat_markdown_and_plain_urls_download(self):
        cases = [
            ('![生成图](https://cdn.example/output.png)', 'https://cdn.example/output.png'),
            ('![带标题](<https://cdn.example/render?id=1&sig=a%2Bb> "生成结果")', 'https://cdn.example/render?id=1&sig=a%2Bb'),
            ('图片：https://cdn.example/a(b).png。', 'https://cdn.example/a(b).png'),
            ('![x](http://127.0.0.1:5104/download/42)', 'http://127.0.0.1:5104/download/42'),
            ('![x](https://cdn.example/a\\(b\\).png)', 'https://cdn.example/a(b).png'),
        ]
        for content, url in cases:
            with self.subTest(content=content), patch.object(server, 'fetch_remote_image', return_value=(PNG, 'image/png')) as fetch:
                payload = self.payload(); payload['config']['protocol'] = 'chat'
                self.run_provider(payload, json.dumps({'choices': [{'message': {'content': content}}]}).encode())
                fetch.assert_called_once_with(url)

    def test_chat_content_blocks_order_and_deduplication(self):
        from providers.openai_chat import extract_images
        message = {'images': [{'image_url': 'https://cdn.example/one'}], 'content': [
            {'type': 'text', 'text': '![same](https://cdn.example/one)![next](https://cdn.example/two)'},
            {'type': 'image_url', 'image_url': {'url': 'https://cdn.example/three'}},
            {'type': 'text', 'text': 'http://127.0.0.1/four'},
        ]}
        self.assertEqual([i['url'] for i in extract_images(message)], ['https://cdn.example/one', 'https://cdn.example/two', 'https://cdn.example/three'])

    def test_chat_base64_text_and_pure_text(self):
        from providers.openai_chat import extract_images
        data = 'data:image/png;base64,' + base64.b64encode(PNG).decode()
        self.assertEqual(extract_images({'content': '![image]('+data+')'}), [{'url': data}])
        self.assertEqual(extract_images({'content': 'Sorry, no image.'}), [])
        self.assertEqual(extract_images({'content': '![x](file:///etc/passwd) ![y](javascript:alert(1))'}), [])

    def test_extensionless_download_validates_bytes_not_headers(self):
        response = MagicMock(); response.__enter__.return_value = response
        response.read.side_effect = [PNG, b'']
        with patch.object(server.urllib.request, 'urlopen', return_value=response) as request:
            raw, mime = server.fetch_remote_image('https://cdn.example/render?id=123')
        self.assertEqual((raw, mime), (PNG, 'image/png'))
        self.assertIsNone(request.call_args.args[0].get_header('Authorization'))

    def test_html_download_is_not_an_image(self):
        response = MagicMock(); response.__enter__.return_value = response
        response.read.side_effect = [b'<html>Not an image</html>', b'']
        with patch.object(server.urllib.request, 'urlopen', return_value=response), self.assertRaisesRegex(ValueError, 'invalid image'):
            server.fetch_remote_image('https://cdn.example/fake.png')

    def test_chat_explicit_images_ignore_incidental_site_links(self):
        from providers.openai_chat import extract_images
        self.assertEqual(extract_images({'content':'![https://example.com](https://cdn.example/image) See https://example.com/docs'}), [{'url':'https://cdn.example/image'}])
        self.assertEqual(extract_images({'images':[{'image_url':{'url':'https://cdn.example/image'}}], 'content':'Made with https://example.com'}), [{'url':'https://cdn.example/image'}])
        self.assertEqual(extract_images({'content':'https://cdn.example/one https://cdn.example/two'}), [{'url':'https://cdn.example/one'}, {'url':'https://cdn.example/two'}])

    def test_configured_timeout_reaches_http_and_remote_download(self):
        payload=self.payload();payload['_requestTimeout']=75
        response=MagicMock();response.headers={};response.read.side_effect=[b'{"data":[{"url":"https://example.com/result.png"}]}',b''];response.__enter__.return_value=response
        opener=MagicMock();opener.open.return_value=response
        with patch.object(server.urllib.request,'build_opener',return_value=opener),patch.object(server,'fetch_remote_image',return_value=(PNG,'image/png')) as fetch,patch.object(server,'store_image_data',return_value='/images/test.png'):
            server.generate_provider_image(payload)
        self.assertEqual(opener.open.call_args.kwargs['timeout'],75);self.assertEqual(fetch.call_args.kwargs['timeout'],75)
        self.assertNotIn('_requestTimeout',json.loads(opener.open.call_args.args[0].data))
