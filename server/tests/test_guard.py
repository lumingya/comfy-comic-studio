"""The token-free local API refuses cross-site writes, foreign WebSockets and rebound hosts."""

from __future__ import annotations

import io
import json
import unittest
import zipfile
from unittest import mock

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from mio_server.api import create_app
from mio_server.api.guard import host_allowed, hostname, same_origin

from .api_harness import LOCAL, WS, ApiCase

EVIL = "http://evil.example"
JOBS_WS = f"{WS}/api/ws/jobs"


class HelperTests(unittest.TestCase):
    def test_hostname(self):
        self.assertEqual(hostname("Example.COM:8788"), "example.com")
        self.assertEqual(hostname("[::1]:8788"), "::1")
        self.assertEqual(hostname("127.0.0.1"), "127.0.0.1")
        self.assertEqual(hostname("[broken"), "")

    def test_hosts_an_attacker_cannot_rebind(self):
        for ok in (
            "127.0.0.1:8788",
            "localhost:8788",
            "LOCALHOST",
            "mio.localhost:1",
            "[::1]:8788",
        ):
            self.assertTrue(host_allowed(ok), ok)
        self.assertTrue(host_allowed("192.168.1.20:8788"))  # LAN access by IP (--host 0.0.0.0)
        for bad in (
            "evil.example",
            "evil.example:8788",
            "localhost.evil.example",
            "",
            "testserver",
        ):
            self.assertFalse(host_allowed(bad), bad)
        self.assertTrue(host_allowed("mio.lan:8788", frozenset({"mio.lan"})))
        self.assertTrue(host_allowed("anything:1", frozenset({"*"})))

    def test_same_origin(self):
        host = {"host": "127.0.0.1:8788"}
        self.assertTrue(same_origin({**host, "origin": "http://127.0.0.1:8788"}))
        self.assertTrue(same_origin(host))  # no Origin, no Sec-Fetch-Site: not a browser
        self.assertTrue(same_origin({**host, "sec-fetch-site": "same-origin"}))
        self.assertTrue(same_origin({**host, "sec-fetch-site": "none"}))  # typed into the bar
        self.assertFalse(same_origin({**host, "origin": EVIL}))
        self.assertFalse(same_origin({**host, "origin": "http://127.0.0.1:9999"}))
        self.assertFalse(same_origin({**host, "origin": "null"}))
        self.assertFalse(same_origin({**host, "sec-fetch-site": "cross-site"}))
        self.assertFalse(same_origin({**host, "sec-fetch-site": "same-site"}))
        proxied = {"host": "127.0.0.1:8788", "origin": "https://mio.lan"}
        self.assertTrue(same_origin(proxied, frozenset({"mio.lan"})))


class GuardApiTests(ApiCase):
    def series_count(self) -> int:
        return len(self.ok(self.client.get("/api/series")))

    def test_cross_site_writes_are_refused(self):
        for headers in (
            {"origin": EVIL},
            {"origin": "null"},
            {"sec-fetch-site": "cross-site"},
        ):
            r = self.client.post("/api/series", json={"title": "x"}, headers=headers)
            self.assertEqual(r.status_code, 403, headers)
            self.assertEqual(r.json()["kind"], "forbidden")
        # The classic no-cors form: a typeless body, which FastAPI would parse as JSON.
        r = self.client.post(
            "/api/series", content=b'{"title": "x"}', headers={"origin": EVIL, "content-type": ""}
        )
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.series_count(), 0)

    def test_same_origin_and_scripted_writes_pass(self):
        self.ok(
            self.client.post("/api/series", json={"title": "a"}, headers={"origin": LOCAL}), 201
        )
        self.ok(self.client.post("/api/series", json={"title": "b"}), 201)  # curl / scripts
        dev = {"host": "localhost:5173", "origin": "http://localhost:5173"}  # Vite proxy
        self.ok(self.client.post("/api/series", json={"title": "c"}, headers=dev), 201)
        self.assertEqual(self.series_count(), 3)

    def test_cross_site_reads_are_not_blocked_by_the_guard(self):
        # Reading is already prevented by the same-origin policy (no CORS headers).
        self.ok(self.client.get("/api/series", headers={"origin": EVIL}))

    def test_rebound_hosts_are_refused(self):
        r = self.client.get("/api/series", headers={"host": "evil.example:8788"})
        self.assertEqual(r.status_code, 403)
        self.assertIn("MIO_ALLOWED_HOSTS", r.json()["detail"])
        for host in ("localhost:8788", "127.0.0.1:8788", "192.168.1.20:8788", "[::1]:8788"):
            self.ok(self.client.get("/api/series", headers={"host": host}))

    def test_allowed_hosts_env(self):
        with mock.patch.dict("os.environ", {"MIO_ALLOWED_HOSTS": "mio.lan, Studio.Local"}):
            client = TestClient(create_app(self.ctx, serve_web=False), base_url="http://mio.lan")
        self.ok(client.get("/api/series"))
        self.ok(client.get("/api/series", headers={"host": "studio.local:8788"}))
        self.assertEqual(client.get("/api/series", headers={"host": "x.lan"}).status_code, 403)

    def test_healthz_and_v2_are_outside_the_guard(self):
        self.ok(self.client.get("/healthz", headers={"host": "evil.example"}))
        r = self.client.get("/api/v2/series", headers={"host": "evil.example", "origin": EVIL})
        self.assertEqual(r.status_code, 401)  # the bearer token protects v2

    def test_foreign_websocket_is_refused(self):
        with self.assertRaises(WebSocketDisconnect) as caught:
            with self.client.websocket_connect(JOBS_WS, headers={"origin": EVIL}):
                pass
        self.assertEqual(caught.exception.code, 1008)
        with self.client.websocket_connect(JOBS_WS, headers={"origin": LOCAL}) as ws:
            self.assertEqual(ws.receive_json()["type"], "hello")

    def test_extension_install_chain_is_refused_cross_site(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            manifest = {"id": "pwn", "name": "pwn", "main": "main.py", "runs_code": True}
            zf.writestr("mio-extension.json", json.dumps(manifest))
            zf.writestr("main.py", "def activate(mio):\n    raise SystemExit('pwned')\n")
        r = self.client.post("/api/extensions", content=buf.getvalue(), headers={"origin": EVIL})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.ok(self.client.get("/api/extensions"))["items"], [])


if __name__ == "__main__":
    unittest.main()
