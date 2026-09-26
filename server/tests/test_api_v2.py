"""P5: API v2 (tokens + scopes), webhooks, the generated Python client and the bot flow."""

from __future__ import annotations

import hashlib
import hmac
import json
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import httpx

from mio_server.auth import required_scope
from mio_server.webhooks import sign

from .api_harness import ApiCase
from .test_jobs import drain

CLIENTS = Path(__file__).resolve().parents[2] / "clients"


class ScopeTests(unittest.TestCase):
    def test_scope_table(self):
        cases = {
            ("GET", "/series"): "read",
            ("WS", "/ws/jobs"): "read",
            ("POST", "/series"): "write",
            ("PATCH", "/episodes/e1/panels/p1"): "write",
            ("POST", "/series/s1/episodes/generate"): "render",
            ("POST", "/episodes/e1/render"): "render",
            ("POST", "/episodes/e1/assistant/propose"): "render",
            ("POST", "/episodes/e1/assistant/apply"): "write",
            ("POST", "/jobs/j1/retry"): "render",
            ("POST", "/jobs/j1/cancel"): "write",
            ("GET", "/settings"): "admin",
            ("POST", "/webhooks"): "admin",
            ("GET", "/instances"): "admin",
        }
        for (method, path), scope in cases.items():
            self.assertEqual(required_scope(method, path), scope, (method, path))


class ApiV2Tests(ApiCase):
    def token(self, *scopes, **extra) -> str:
        body = {"name": "bot", "scopes": list(scopes), **extra}
        return self.ok(self.client.post("/api/tokens", json=body), 201)["token"]

    def v2(self, method, path, token=None, **kw):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.request(method, f"/api/v2{path}", headers=headers, **kw)

    def test_tokens_and_scopes(self):
        self.assertEqual(self.v2("GET", "/meta").json()["api"], "2.0")
        self.assertEqual(self.v2("GET", "/series").status_code, 401)
        self.assertEqual(self.v2("GET", "/series", "mio_tok_x_" + "a" * 30).status_code, 401)
        read = self.token("read")
        listed = self.ok(self.client.get("/api/tokens"))["items"]
        self.assertNotIn("secret_hash", listed[0])
        self.assertEqual(listed[0]["hint"], read[-4:])
        self.assertEqual(self.v2("GET", "/whoami", read).json()["scopes"], ["read"])
        self.assertEqual(self.v2("GET", "/series", read).status_code, 200)
        denied = self.v2("POST", "/series", read, json={"title": "x"})
        self.assertEqual((denied.status_code, denied.json()["kind"]), (403, "forbidden"))
        write = self.token("write", "read")
        series = self.ok(self.v2("POST", "/series", write, json={"title": "雨夜"}), 201)
        gen = self.v2(
            "POST", f"/series/{series['id']}/episodes/generate", write, json={"sentence": "x"}
        )
        self.assertEqual(gen.status_code, 403)  # spending needs "render"
        self.assertEqual(self.v2("GET", "/settings", write).status_code, 403)
        for hidden in ("/tokens", "/extensions"):
            self.assertEqual(self.v2("GET", hidden, self.token("admin", "read")).status_code, 404)

        token_id = read.split("_")[1] + "_" + read.split("_")[2]
        self.ok(self.client.delete(f"/api/tokens/{token_id}"), 204)
        self.assertEqual(self.v2("GET", "/series", read).status_code, 401)
        old = self.token("read", expires_at="2000-01-01T00:00:00Z")
        self.assertEqual(self.v2("GET", "/series", old).status_code, 401)

    def test_v2_schema_is_separate_and_secured(self):
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        self.assertIn("bearer", schema["components"]["securitySchemes"])
        self.assertIn("/series", schema["paths"])
        self.assertNotIn("/tokens", schema["paths"])
        ui = self.ok(self.client.get("/openapi.json"))
        self.assertFalse(any(p.startswith("/api/v2") for p in ui["paths"]))


class Receiver:
    def __init__(self, *statuses):
        self.statuses, self.requests = list(statuses), []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.statuses.pop(0) if self.statuses else 200)

    def events(self) -> list[str]:
        return [r.headers["x-mio-event"] for r in self.requests]


class WebhookTests(ApiCase):
    def hook(self, **body) -> dict:
        body = {"url": "https://example.test/hook", **body}
        return self.ok(self.client.post("/api/webhooks", json=body), 201)

    def test_signed_deliveries_for_domain_events(self):
        rx = Receiver()
        self.ctx.webhooks.transport = httpx.MockTransport(rx)
        created = self.hook(events=["job.completed", "take.created", "take.status"])
        self.assertGreater(len(created["secret"]), 20)
        listed = self.ok(self.client.get("/api/webhooks"))
        self.assertTrue(listed["items"][0]["secret"].endswith("…"))
        self.assertIn("job.failed", listed["events"])

        _, ep = self.make_episode()
        self.adopt_all(ep)
        self.ctx.webhooks.flush()
        events = rx.events()
        self.assertIn("job.completed", events)
        self.assertIn("take.created", events)
        self.assertIn("take.status", events)
        req = rx.requests[0]
        body = req.content
        expected = sign(created["secret"], req.headers["x-mio-timestamp"], body)
        self.assertEqual(req.headers["x-mio-signature"], expected)
        mac = hmac.new(
            created["secret"].encode(),
            req.headers["x-mio-timestamp"].encode() + b"." + body,
            hashlib.sha256,
        )
        self.assertEqual(expected, "sha256=" + mac.hexdigest())
        job_event = next(
            json.loads(r.content)
            for r in rx.requests
            if r.headers["x-mio-event"] == "job.completed"
        )
        self.assertEqual(job_event["data"]["kind"], "comfy.render")
        self.assertEqual(job_event["data"]["owner"], ep["id"])

    def test_retry_ping_patch_and_validation(self):
        rx = Receiver(503, 200)
        self.ctx.webhooks.transport = httpx.MockTransport(rx)
        self.ctx.webhooks.sleep = lambda s: None
        created = self.hook(events=["*"])
        record = self.ctx.webhooks.deliver(
            self.ctx.store.get_doc("webhook", created["id"]), "ping", {}
        )
        self.assertEqual((record["status"], record["attempts"]), (200, 2))
        rx.statuses = [500]
        ping = self.ok(self.client.post(f"/api/webhooks/{created['id']}/test"))
        self.assertEqual((ping["status"], ping["attempts"]), (500, 1))  # manual test: no retries
        history = self.ok(self.client.get(f"/api/webhooks/{created['id']}/deliveries"))
        self.assertEqual(len(history), 2)

        patched = self.ok(
            self.client.patch(
                f"/api/webhooks/{created['id']}", json={"enabled": False, "rotate_secret": True}
            )
        )
        self.assertFalse(patched["enabled"])
        self.assertNotEqual(patched["secret"], created["secret"])
        bad = self.client.post(
            "/api/webhooks", json={"url": "ftp://x", "events": ["job.completed"]}
        )
        self.assertEqual(bad.status_code, 400)
        bad = self.client.post("/api/webhooks", json={"url": "https://x", "events": ["nope"]})
        self.assertEqual(bad.status_code, 400)
        self.ok(self.client.delete(f"/api/webhooks/{created['id']}"), 204)


class LiveServer:
    """The real app on a random localhost port (the generated client speaks plain HTTP)."""

    def __init__(self, app):
        import uvicorn

        config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self) -> str:
        self.thread.start()
        deadline = time.monotonic() + 10
        while not self.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("server did not start")
            time.sleep(0.02)
        port = self.server.servers[0].sockets[0].getsockname()[1]
        return f"http://127.0.0.1:{port}"

    def __exit__(self, *exc):
        self.server.should_exit = True
        self.thread.join(timeout=5)


class ClientAndBotTests(ApiCase):
    def setUp(self):
        super().setUp()
        for sub in ("python", "astrbot_mio"):
            path = str(CLIENTS / sub)
            if path not in sys.path:
                sys.path.insert(0, path)

    def test_generated_client_and_bot_draw_flow(self):
        import flow
        from mio_client import MioClient, MioError

        token = self.ok(
            self.client.post(
                "/api/tokens", json={"name": "bot", "scopes": ["read", "write", "render"]}
            ),
            201,
        )["token"]
        app = self.client.app
        with LiveServer(app) as url:
            mio = MioClient(url, token=token, timeout=30)
            self.assertEqual(mio.whoami()["name"], "bot")
            with self.assertRaises(MioError) as caught:
                MioClient(url, token="").list_series()
            self.assertEqual(
                (caught.exception.status, caught.exception.kind), (401, "unauthorized")
            )
            engine = self.ctx.engine
            wait = lambda _self, job_id, **kw: drain(engine, job_id)  # noqa: E731 (no autostart)
            with mock.patch.object(MioClient, "wait_job", wait):
                notes = []
                episode, png = flow.draw(mio, "雨夜的便利店", progress=notes.append, width=320)
            self.assertTrue(png.startswith(b"\x89PNG"))
            adopted = {t["panel_id"] for t in episode["takes"] if t["status"] == "adopted"}
            self.assertEqual(adopted, {p["id"] for p in episode["panels"]})
            self.assertIn("开始出图", notes[0])
            self.assertIn("机器人作品", flow.series_list(mio))
            self.assertIn("没有进行中的任务", flow.job_summary(mio))
            asset = mio.upload_asset(png, filename="strip.png")
            self.assertEqual(mio.get_asset(asset["id"])[:4], b"\x89PNG")

    def test_generated_client_is_current(self):
        import subprocess

        done = subprocess.run(
            [sys.executable, str(CLIENTS / "python" / "generate.py"), "--check"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)


if __name__ == "__main__":
    unittest.main()
