"""Second-pass defects: controlled HTTP and threads, never paid providers."""
import http.client
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from backend import server
from backend.mio_library import LibraryError
from backend.production.queue import ProductionQueue
from backend.providers.reliability import ExecutionError


class RequestBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ComicRequestHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.origin = f'http://127.0.0.1:{self.httpd.server_port}'
        for name, value in [('ALLOWED_ORIGINS', {self.origin}), ('read_merged_config', lambda **_: {'private': 'fixture'})]:
            p = patch.object(server, name, value); p.start(); self.addCleanup(p.stop)

    def stop(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.thread.join()

    def request(self, path, headers):
        c = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=3)
        try:
            c.request('GET', path, headers=headers)
            r = c.getresponse()
            return r.status, r.read()
        finally:
            c.close()

    def test_non_ascii_csrf_is_rejected_without_disconnecting(self):
        status, body = self.request('/api/config', {'Origin': self.origin, 'X-Mio-CSRF': '\xe9'})
        self.assertEqual(status, 403)
        self.assertIn(b'MIO-CSRF-001', body)

    def test_untrusted_host_cannot_acquire_page_capability(self):
        status, body = self.request('/index.html', {'Host': 'rebound.example', 'Sec-Fetch-Site': 'same-origin'})
        self.assertEqual(status, 403)
        self.assertNotIn(b'<meta name="mio-csrf"', body)

    def test_untrusted_host_rejected_even_with_correct_capability(self):
        status, _ = self.request('/api/config', {'Host': 'rebound.example', 'Sec-Fetch-Site': 'same-origin', 'X-Mio-CSRF': server.ComicRequestHandler.csrf_token})
        self.assertEqual(status, 403)

    def test_explicit_custom_origin_host_and_loopback_still_work(self):
        with patch.object(server, 'ALLOWED_ORIGINS', {self.origin, 'https://studio.example'}):
            self.assertEqual(self.request('/index.html', {'Host': 'studio.example'})[0], 200)
        self.assertEqual(self.request('/api/config', {})[0], 200)


class QueueBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.q = ProductionQueue(self.temp.name, lambda *_: {}, lambda *_: {'image': '/images/test.png'})
        self.addCleanup(self.q.close)
        self.task = self.q.assemble({'story': {'frames': [{}]}}, 'fixture', 'fixture')

    def wait(self):
        for _ in range(300):
            t = self.q.get(self.task['id'])
            if t['status'] in ('failed', 'interrupted', 'complete') and self.q.active is None:
                return t
            time.sleep(.01)
        self.fail('worker did not settle')

    def test_transport_disconnect_requires_separate_retry_consent(self):
        for error in (TimeoutError('response timed out'), http.client.RemoteDisconnected('accepted then disconnected'), http.client.IncompleteRead(b'partial', 50)):
            with self.subTest(error=type(error).__name__):
                self.q.render = lambda *_, error=error: (_ for _ in ()).throw(error)
                self.q.start(self.task['id'], trusted=True, confirm_uncertain=True)
                t = self.wait()
                self.assertEqual(t['pages'][0]['state'], 'uncertain')
                with self.assertRaisesRegex(LibraryError, 'UNCERTAIN'):
                    self.q.start(t['id'], trusted=True)

    def test_real_http_accept_then_disconnect_is_not_resubmitted(self):
        from http.server import BaseHTTPRequestHandler
        import urllib.request
        calls = []
        class AcceptedThenDisconnected(BaseHTTPRequestHandler):
            def do_POST(self):
                calls.append(self.rfile.read(int(self.headers['Content-Length'])))
                self.close_connection = True  # accepted request, no response
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), AcceptedThenDisconnected)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        def render(*_):
            with urllib.request.urlopen(f'http://127.0.0.1:{httpd.server_port}/generate', data=b'fixture', timeout=2) as response:
                return {'image': response.read().decode()}
        self.q.render = render
        try:
            self.q.start(self.task['id'], trusted=True)
            self.assertEqual(self.wait()['pages'][0]['state'], 'uncertain')
            with self.assertRaisesRegex(LibraryError, 'UNCERTAIN'):
                self.q.start(self.task['id'], trusted=True)
            self.assertEqual(calls, [b'fixture'])
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join()

    def test_explicit_execution_rejection_remains_failed(self):
        def render(task, index, _):
            self.q.report_attempt(task['id'], index, {'upstream': 'accepted-but-failed'})
            raise ExecutionError('known workflow error')
        self.q.render = render
        self.q.start(self.task['id'], trusted=True)
        self.assertEqual(self.wait()['pages'][0]['state'], 'failed')

    def test_accepted_upstream_with_unusable_result_requires_consent(self):
        def render(task, index, _):
            self.q.report_attempt(task['id'], index, {'upstream': 'accepted-fixture'})
            raise ValueError('malformed upstream history')
        self.q.render = render
        self.q.start(self.task['id'], trusted=True)
        self.assertEqual(self.wait()['pages'][0]['state'], 'uncertain')

    def test_closed_scheduler_cannot_mutate_after_lease_transfer(self):
        self.q.close()
        successor = ProductionQueue(self.temp.name, lambda *_: {}, lambda *_: {})
        try:
            for action in (self.q.pause, self.q.cancel, lambda: self.q.remove(self.task['id']), lambda: self.q.recover_publication(self.task['id'], 0)):
                with self.subTest(action=action), self.assertRaises(LibraryError) as cm:
                    action()
                if 'cm' in locals() and hasattr(cm, 'exception'):
                    self.assertEqual(cm.exception.status, 503)
            self.assertIsNotNone(successor.get(self.task['id']))
        finally:
            successor.close()


class ExportStatusTests(unittest.TestCase):
    """C7: the exclusive export slot answers 409, and the HTTP layer must not flatten it to 400."""

    def setUp(self):
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.ComicRequestHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.origin = f'http://127.0.0.1:{self.httpd.server_port}'
        for name, value in [('ALLOWED_ORIGINS', {self.origin}), ('read_merged_config', lambda **_: {'private': 'fixture'})]:
            p = patch.object(server, name, value); p.start(); self.addCleanup(p.stop)

    def stop(self):
        self.httpd.shutdown(); self.httpd.server_close(); self.thread.join()

    def post(self, body):
        c = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        try:
            c.request('POST', '/api/export/portable', body=body, headers={'Content-Type': 'application/json', 'X-Mio-CSRF': server.ComicRequestHandler.csrf_token})
            r = c.getresponse()
            return r.status, r.read()
        finally:
            c.close()

    def test_busy_export_slot_is_reported_as_409_not_400(self):
        from backend import mio_export
        self.assertTrue(mio_export._export_slot.acquire(blocking=False))
        try:
            status, body = self.post(b'{"format":"zip","albumIds":[],"validateOnly":true}')
        finally:
            mio_export._export_slot.release()
        self.assertEqual(status, 409)
        self.assertIn('另一份导出'.encode('utf-8'), body)
        # Genuine input problems keep answering 400.
        status, body = self.post(b'{"format":"docx","albumIds":[]}')
        self.assertEqual(status, 400)
        self.assertIn('ZIP'.encode('utf-8'), body)
