"""Requests that never reached the image service are plain failures, not unconfirmed results, and say why."""
import socket
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from http.client import RemoteDisconnected

from backend.production.queue import ProductionQueue
from backend.providers.reliability import failure_summary, never_sent, result_unconfirmed


def closed_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


class NeverSentTests(unittest.TestCase):
    def test_real_refused_connection_is_failed_and_explained(self):
        with self.assertRaises(urllib.error.URLError) as caught:
            urllib.request.urlopen('http://127.0.0.1:%d/prompt' % closed_port(), data=b'{}', timeout=2)
        self.assertTrue(never_sent(caught.exception))
        self.assertFalse(result_unconfirmed(caught.exception))
        self.assertIn('连接被拒绝', failure_summary(str(caught.exception), terminal=True))

    def test_dns_unreachable_tls_and_connect_timeout_are_never_sent(self):
        for reason, words in (
            (socket.gaierror(-2, 'Name or service not known'), '找不到服务器'),
            (OSError(101, 'Network is unreachable'), '网络不通'),
            (OSError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed'), '安全连接失败'),
            (socket.timeout('timed out'), '连接超时'),
        ):
            with self.subTest(reason=str(reason)):
                error = urllib.error.URLError(reason)
                self.assertFalse(result_unconfirmed(error))
                self.assertIn(words, failure_summary(str(error), terminal=True))

    def test_windows_wording_is_recognised(self):
        self.assertIn('连接被拒绝', failure_summary('<urlopen error [WinError 10061] 由于目标计算机积极拒绝，无法连接。>'))
        self.assertIn('找不到服务器', failure_summary('<urlopen error [Errno 11001] getaddrinfo failed>'))

    def test_breaks_after_sending_stay_unconfirmed(self):
        self.assertTrue(result_unconfirmed(RemoteDisconnected('Remote end closed connection without response')))
        self.assertTrue(result_unconfirmed(TimeoutError('timed out')))
        self.assertIn('请求可能已被接收', failure_summary('Remote end closed connection without response', terminal=True))
        # A saved upstream id proves the service accepted the job, whatever fails afterwards.
        self.assertTrue(result_unconfirmed(urllib.error.URLError(ConnectionRefusedError(111, 'Connection refused')), upstream='p1'))

    def test_http_rejections_are_not_transport_failures(self):
        error = urllib.error.HTTPError('http://x', 401, 'Unauthorized', {}, None)
        self.assertFalse(never_sent(error))


class QueueReportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        port = closed_port()

        def render(task, index, cancel):
            urllib.request.urlopen('http://127.0.0.1:%d/prompt' % port, data=b'{}', timeout=2)

        self.q = ProductionQueue(self.tmp.name, lambda task, cancel: {'ready': True}, render)
        self.addCleanup(self.q.close)

    def wait(self, id):
        for _ in range(400):
            task = self.q.get(id)
            if task['status'] in ('failed', 'partial') and not self.q.active:
                return task
            time.sleep(.01)
        self.fail(str(self.q.list()))

    def test_refused_service_fails_the_page_and_can_simply_be_started_again(self):
        task = self.q.assemble({'story': {'id': 's', 'title': 'S', 'frames': [{'prompt': 'x'}] * 3}, 'presets': []}, 'A', 'A')
        self.q.start(task['id'], trusted=True)
        after = self.wait(task['id'])
        self.assertEqual([p['state'] for p in after['pages']], ['failed', 'standby', 'standby'])
        self.assertIn('连接被拒绝', after['error'])
        self.assertIn('其余 2 幕没有发出', after['error'])
        # No "possible double billing" confirmation: nothing was sent.
        self.q.start(task['id'], trusted=True)
        self.wait(task['id'])


if __name__ == '__main__':
    unittest.main()
