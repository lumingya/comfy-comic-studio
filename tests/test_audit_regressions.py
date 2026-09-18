"""Audit regressions: no real credentials, no remote model calls."""
import http.client
import json
import re
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from backend import server
from backend.mio_http import HTTPRoutes
from backend.production.queue import ProductionQueue
from backend.production.store import TaskStore
from backend.mio_library import LibraryError


class BrowserBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ComicRequestHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.origin = f'http://127.0.0.1:{self.httpd.server_port}'
        allowed = patch.object(server, 'ALLOWED_ORIGINS', {self.origin, 'null'})
        allowed.start(); self.addCleanup(allowed.stop)
        config = patch.object(server, 'read_merged_config', return_value={'private': 'fixture'})
        config.start(); self.addCleanup(config.stop)

    def stop(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.thread.join()

    def request(self, path, method='GET', headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, '{}' if method == 'POST' else None,
                     {'Content-Type': 'application/json', **(headers or {})})
        response = conn.getresponse()
        return response.status, response.headers, response.read()

    def test_opaque_origin_denied_even_if_explicitly_allowlisted(self):
        for method, path in [('GET', '/api/config'), ('POST', '/api/production/pause'),
                             ('OPTIONS', '/api/config')]:
            status, headers, _ = self.request(path, method, {'Origin': 'null'})
            self.assertEqual(status, 403)
            self.assertIsNone(headers.get('Access-Control-Allow-Origin'))

    def test_private_browser_read_requires_unpredictable_token(self):
        for headers in ({'Origin': self.origin}, {'Sec-Fetch-Site': 'same-origin'},
                        {'Origin': self.origin, 'X-Mio-CSRF': 'wrong'}):
            self.assertEqual(self.request('/api/config', headers=headers)[0], 403)
        status, _, body = self.request('/index.html')
        self.assertEqual(status, 200)
        token = re.search(rb'<meta name="mio-csrf" content="([^"]+)', body)[1].decode()
        self.assertGreater(len(token), 30)
        self.assertEqual(self.request('/api/config', headers={'Origin': self.origin, 'X-Mio-CSRF': token})[0], 200)
        self.assertEqual(self.request('/api/config', headers={'Origin': 'https://evil.example', 'X-Mio-CSRF': token})[0], 403)

    def test_cli_without_browser_origin_remains_supported(self):
        self.assertEqual(self.request('/api/config')[0], 200)

    def test_private_writes_need_token_before_dispatch(self):
        status, _, body = self.request('/api/production/pause', 'POST', {'Origin': self.origin})
        self.assertEqual(status, 403)
        self.assertIn(b'MIO-CSRF-001', body)


class LeaseShutdownTests(unittest.TestCase):
    def test_timeout_keeps_lease_until_provider_really_returns(self):
        with tempfile.TemporaryDirectory() as root:
            entered, release = threading.Event(), threading.Event()
            def render(*_):
                entered.set(); release.wait(5)
                return {'image': '/images/fixture.png'}
            q = ProductionQueue(root, lambda *_: {}, render)
            try:
                task = q.assemble({'story': {'frames': [{}]}}, 'fixture', 'once')
                q.start(task['id'], trusted=True)
                self.assertTrue(entered.wait(2))
                self.assertFalse(q.close(timeout=.02))
                self.assertTrue(q.worker.is_alive()); self.assertFalse(q.lease.closed)
                self.assertTrue(q.list()['uncleanShutdown'])
                with self.assertRaises(LibraryError): ProductionQueue(root, lambda *_: {}, render)
                with self.assertRaises(LibraryError): q.start(task['id'], trusted=True)
                with self.assertRaises(LibraryError): q.resume()
            finally:
                release.set(); self.assertTrue(q.close(timeout=5))
            self.assertTrue(q.lease.closed)
            other = ProductionQueue(root, lambda *_: {}, lambda *_: {'image': '/images/new.png'})
            try:
                with self.assertRaisesRegex(LibraryError, 'UNCERTAIN'):
                    other.start(task['id'], trusted=True)
                self.assertTrue(other.list()['paused'])
                self.assertFalse(other.control['batch'])
                other.start(task['id'], trusted=True, confirm_uncertain=True)
            finally: other.close()

    def test_batch_checks_uncertain_before_changing_any_task(self):
        with tempfile.TemporaryDirectory() as root:
            q = ProductionQueue(root, lambda *_: {}, lambda *_: {})
            try:
                a = q.assemble({'story': {'frames': [{}]}}, 'first', 'a')
                b = q.assemble({'story': {'frames': [{}]}}, 'second', 'b')
                b['pages'][0]['state'] = 'uncertain'; q.tasks.set(b['id'], b)
                with self.assertRaises(LibraryError): q.start(a['id'], sequential=True, trusted=True)
                self.assertEqual(q.get(a['id'])['status'], 'standby')
                self.assertEqual(q.get(b['id'])['pages'][0]['state'], 'uncertain')
            finally: q.close()


class SummaryReadTests(unittest.TestCase):
    def test_fifty_tasks_sixty_four_pages_no_object_reads(self):
        with tempfile.TemporaryDirectory() as root:
            q = ProductionQueue(root, lambda *_: {}, lambda *_: {})
            try:
                for i in range(50):
                    id = f'assembly-fixture-{i}'
                    task = {'id': id, 'title': 'fixture', 'status': 'complete', 'snapshot': {'story': {'title': 'story', 'frames': [{}]*64}}, 'prepared': None,
                            'pages': [{'index': j, 'state': 'complete', 'result': {'image': '/images/test.png', 'prompt': 'large-private-prompt'},
                                       'attempts': [{'status': 'complete', 'rawError': 'never in list'}]} for j in range(64)]}
                    q.tasks.set(id, task); q.control['order'].append(id)
                with patch.object(q.tasks, '_read', side_effect=AssertionError('poll read an object')):
                    result = q.list()
                self.assertEqual(len(result['tasks']), 50)
                self.assertEqual(len(result['tasks'][0]['pages']), 64)
                self.assertNotIn('large-private-prompt', json.dumps(result))
                self.assertNotIn('rawError', json.dumps(result))
                self.assertLess(len(json.dumps(result)), 800000)
            finally: q.close()

    def test_existing_manifest_upgraded_once_without_provider_or_data_loss(self):
        with tempfile.TemporaryDirectory() as root:
            s = TaskStore(root)
            task = {'snapshot': {'story': {'title': 'x'}}, 'prepared': None,
                    'pages': [{'index': 0, 'state': 'failed', 'attempts': [{'status': 'failed', 'rawError': 'full detail'}]*7, 'result': None}]}
            s.set('assembly-old', task)
            manifest = json.loads(s.file('assembly-old').read_text()); del manifest['pageSummaries']
            s.file('assembly-old').write_text(json.dumps(manifest))
            self.assertEqual(s.get('assembly-old', summary=True)['pages'][0]['attemptCount'], 7)
            with patch.object(s, '_read', side_effect=AssertionError('cache missed')):
                self.assertEqual(s.get('assembly-old', summary=True)['pages'][0]['attemptCount'], 7)
            self.assertEqual(s.get('assembly-old'), task)
