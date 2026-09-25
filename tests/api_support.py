"""A real HTTP server on an isolated temporary workspace for public API tests.

Never touches the repository ``data/`` folder and never reaches the network:
provider calls must be patched by the individual tests.
"""
import base64
import http.client
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from backend import mio_foundation, server
from backend.ecosystem import api as ecosystem_api

TOKEN = "t" * 40
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfX8AAAAASUVORK5CYII=")
PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


class QuietHandler(server.ComicRequestHandler):
    def log_message(self, *args):
        pass


class Response:
    def __init__(self, status, headers, raw):
        self.status, self.headers, self.raw = status, headers, raw

    @property
    def json(self):
        return json.loads(self.raw)

    @property
    def data(self):
        return self.json["data"]

    @property
    def error(self):
        return self.json["error"]


class ApiServerCase(unittest.TestCase):
    """One server + one temporary workspace per test class."""

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="mio-api-")
        cls.root = cls.temp.name
        cls.patches = [
            patch.object(server, "DATA_DIR", cls.root),
            patch.object(server, "IMAGES_DIR", os.path.join(cls.root, "assets", "images")),
            patch.dict(os.environ, {"MIO_API_TOKEN": TOKEN}),
        ]
        for item in cls.patches:
            item.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.seed()

    @classmethod
    def seed(cls):
        """Hook for subclasses: create fixture content through the store."""

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        eco = ecosystem_api.SERVICES.pop((str(server.BASE_DIR), str(cls.root)), None)
        if eco is not None:
            eco.close()
        from backend import mio_update

        mio_update._services.pop((str(server.BASE_DIR), str(cls.root)), None)
        jobs = mio_foundation._STORES.pop(os.path.join(cls.root, "runtime", "execution"), None)
        if jobs is not None:
            jobs.close()
        server.reset_native_stores()
        for item in reversed(cls.patches):
            item.stop()
        cls.temp.cleanup()

    @classmethod
    def store(cls):
        return server.native_store()

    def call(self, method, path, body=None, token=TOKEN, headers=None, raw=None, content_type="application/json"):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=15)
        try:
            sent = {"Authorization": "Bearer " + token, **(headers or {})}
            payload = raw
            if body is not None:
                payload = json.dumps(body).encode()
            if payload is not None:
                sent.setdefault("Content-Type", content_type)
            conn.request(method, path, payload, sent)
            response = conn.getresponse()
            return Response(response.status, response.headers, response.read())
        finally:
            conn.close()

    def get(self, path, **kw):
        return self.call("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.call("POST", path, body if body is not None else {}, **kw)

    def put(self, path, body, **kw):
        return self.call("PUT", path, body, **kw)

    def patch(self, path, body, **kw):
        return self.call("PATCH", path, body, **kw)

    def delete(self, path, **kw):
        return self.call("DELETE", path, **kw)

    def ok(self, response, status=200):
        self.assertEqual(response.status, status, response.raw[:600])
        return response.data if response.headers.get("Content-Type", "").startswith("application/json") else response
