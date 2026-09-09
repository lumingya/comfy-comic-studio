import functools
import http.client
from pathlib import Path
import threading
import unittest
from http.server import ThreadingHTTPServer

import mio_docs
import server

ROOT = Path(__file__).resolve().parents[1]


class DocumentationServingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(server.ComicRequestHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def request(self, path, method='GET'):
        c = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        try:
            c.request(method, path)
            r = c.getresponse()
            return r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()
        finally:
            c.close()

    def test_legacy_markdown_url_serves_utf8_reader(self):
        status, headers, body = self.request('/docs/WORKFLOW_UPDATE.md')
        self.assertEqual(status, 200)
        self.assertEqual(headers['content-type'], 'text/html; charset=utf-8')
        self.assertIn('第一阶段：工作流模块修改说明', body.decode('utf-8'))
        self.assertIn('DOMPurify.sanitize', body.decode('utf-8'))
        self.assertEqual(int(headers['content-length']), len(body))

    def test_raw_markdown_is_explicit_utf8_without_modifying_source(self):
        status, headers, body = self.request('/docs/WORKFLOW_UPDATE.md?raw=1')
        self.assertEqual(status, 200)
        self.assertEqual(headers['content-type'], 'text/plain; charset=utf-8')
        self.assertEqual(body, (ROOT / 'docs/WORKFLOW_UPDATE.md').read_bytes())

    def test_head_matches_get(self):
        _, headers, body = self.request('/docs/WORKFLOW_UPDATE.md')
        status, head, empty = self.request('/docs/WORKFLOW_UPDATE.md', 'HEAD')
        self.assertEqual(status, 200)
        self.assertEqual(headers['content-type'], head['content-type'])
        self.assertEqual(int(head['content-length']), len(body))
        self.assertEqual(empty, b'')

    def test_prebuilt_guide_is_served_with_charset(self):
        status, headers, body = self.request('/docs/guide/CHANNELS_AND_KEYS.html')
        self.assertEqual(status, 200)
        self.assertEqual(headers['content-type'], 'text/html; charset=utf-8')
        self.assertIn('本地密钥', body.decode('utf-8'))

    def test_text_asset_charsets_are_explicit(self):
        for path, mime in [('/README.md?raw=1','text/plain'),('/docs/api/openapi.json','application/json'),('/styles.css','text/css')]:
            status, headers, _ = self.request(path)
            self.assertEqual(status, 200)
            self.assertEqual(headers['content-type'], mime + '; charset=utf-8')

    def test_renderer_does_not_allow_source_to_break_out_of_json(self):
        html = mio_docs.render_document(ROOT, Path('docs/probe.md'), '# 中文\n</script><script>window.pwned=1</script>')
        payload = html.split('<script id="document-data" type="application/json">')[1].split('</script>')[0]
        self.assertNotIn('</script>', payload)
        self.assertIn('\\u003c', payload)
        self.assertIn('中文', payload)

    def test_private_and_traversal_paths_remain_denied(self):
        for path in ('/docs/../server.py', '/docs/../data/secrets/provider-keys.json', '/mio_docs.py'):
            self.assertEqual(self.request(path)[0], 404)

    def test_readme_banner_is_vector_not_font_dependent_block_text(self):
        for name in ('README.md', 'README.en.md'):
            text = (ROOT / name).read_text()
            self.assertIn('mio-banner.svg', text)
            self.assertNotIn('███', text)

    def test_generated_documents_are_current(self):
        for path in mio_docs.source_documents(ROOT):
            self.assertEqual(path.with_suffix('.html').read_text(), mio_docs.render_document(ROOT, path.relative_to(ROOT)), str(path))
