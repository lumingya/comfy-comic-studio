"""First-use protocol boundaries, no external network or credentials."""
import io
import json
import unittest
import urllib.error
from unittest.mock import patch
from backend.mio_connection_check import check_comfy
from backend.production.api import interpolate
from backend.mio_library import LibraryError

class ComfyConnectionTests(unittest.TestCase):
    def test_only_bounded_read_only_system_stats_request(self):
        seen = []
        class Opener:
            def open(self, request, timeout):
                seen.append((request.full_url, request.get_method(), request.data, timeout))
                return io.BytesIO(json.dumps({'system': {}, 'devices': []}).encode())
        with patch('urllib.request.build_opener', return_value=Opener()):
            self.assertTrue(check_comfy({'baseUrl': 'http://127.0.0.1:8188/'})['ok'])
        self.assertEqual(seen, [('http://127.0.0.1:8188/system_stats', 'GET', None, 5)])

    def test_bad_urls_do_not_reach_network(self):
        with patch('urllib.request.build_opener', side_effect=AssertionError('network')):
            for url in ('file:///etc/passwd', 'http://user:secret@localhost', 'http://localhost?key=secret', 'http://localhost:wrong', 'bad'):
                with self.subTest(url=url), self.assertRaises(ValueError): check_comfy({'baseUrl': url})

    def test_oversized_and_non_comfy_response_rejected(self):
        for body in (b'x' * (256 * 1024 + 1), b'<html>wrong endpoint</html>', b'{}', b'{"system":"not stats"}'):
            with self.subTest(size=len(body)), patch('urllib.request.build_opener') as build:
                build.return_value.open.return_value = io.BytesIO(body)
                with self.assertRaises(ValueError): check_comfy({'baseUrl': 'http://localhost:8188'})

    def test_no_redirect_and_no_remote_error_body_leak(self):
        captured = []
        def build(handler):
            self.assertIsNone(handler().redirect_request(None, None, 302, '', {}, 'http://elsewhere'))
            captured.append(True)
            raise urllib.error.URLError('arbitrary upstream error')
        with patch('urllib.request.build_opener', side_effect=build):
            with self.assertRaisesRegex(ValueError, '无法读取 ComfyUI 状态'):
                check_comfy({'baseUrl': 'http://localhost:8188'})
        self.assertEqual(captured, [True])

class NovelAIBraceTests(unittest.TestCase):
    def test_literal_weight_braces_and_known_variables_coexist(self):
        self.assertEqual(interpolate('{masterpiece}, {{soft_light}}, {hero}', {'hero': 'Ada'}, literal_unknown=True), '{masterpiece}, {{soft_light}}, Ada')

    def test_other_channels_and_captions_remain_strict(self):
        with self.assertRaisesRegex(LibraryError, '缺少变量'):
            interpolate('{missing}', {})

    def test_image_variables_still_bind_under_novelai_policy(self):
        images=[]
        self.assertEqual(interpolate('{weight}, {reference}', {'reference': {'kind': 'mio-image', 'src': '/images/a.png'}}, images, literal_unknown=True), '{weight}, @image_1')
        self.assertEqual(images, ['/images/a.png'])

class CheckHTTPBoundaryTests(unittest.TestCase):
    def setUp(self):
        import threading
        from http.server import ThreadingHTTPServer
        from backend import server
        self.server = server
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ComicRequestHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.origin = 'http://127.0.0.1:' + str(self.httpd.server_port)
        p = patch.object(server, 'ALLOWED_ORIGINS', {self.origin}); p.start(); self.addCleanup(p.stop)

    def stop(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.thread.join()

    def request(self, payload, origin=None, csrf=True):
        import http.client
        c = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=3)
        headers = {'Content-Type': 'application/json', 'Origin': origin or self.origin}
        if csrf: headers['X-Mio-CSRF'] = self.server.ComicRequestHandler.csrf_token
        try:
            c.request('POST', '/api/image/comfy-check', json.dumps(payload), headers)
            r = c.getresponse(); return r.status, r.read()
        finally: c.close()

    def test_opaque_foreign_and_missing_csrf_cannot_probe_network(self):
        with patch('backend.mio_connection_check.check_comfy') as probe:
            for origin, csrf in [('null', True), ('https://foreign.invalid', True), (self.origin, False)]:
                self.assertEqual(self.request({'baseUrl': 'http://localhost:8188'}, origin, csrf)[0], 403)
            probe.assert_not_called()

    def test_authenticated_route_and_bounded_json(self):
        with patch('backend.mio_connection_check.check_comfy', return_value={'ok': True}) as probe:
            self.assertEqual(self.request({'baseUrl': 'http://localhost:8188'})[0], 200)
            probe.assert_called_once_with({'baseUrl': 'http://localhost:8188'})
            self.assertEqual(self.request({'baseUrl': 'x' * 4096})[0], 413)
            self.assertEqual(self.request([])[0], 400)
            self.assertEqual(probe.call_count, 1)
