"""Sandbox requests retain the real API contract and never gain the host's v2 permissions."""

import json

from fastapi.testclient import TestClient
from pydantic import ValidationError

from mio_server.api import create_app
from mio_server.extensions.manifest import PanelSpec
from mio_server.models import Episode, Series

from .api_harness import LOCAL, ApiCase
from .test_extensions import write_ext

MAIN = """
from fastapi.responses import PlainTextResponse, RedirectResponse
from pydantic import BaseModel
class Body(BaseModel):
    value: int
def activate(mio):
    @mio.route("POST", "/run", scope="render")
    def run(body: Body) -> dict:
        mio.save_settings({"value": body.value})
        return {"value": body.value}
    @mio.route("GET", "/large", scope="read")
    def large() -> dict:
        return {"value": "a" * (1024 * 1024)}
    @mio.route("GET", "/text", scope="read")
    def text():
        return PlainTextResponse("not json")
    @mio.route("GET", "/redirect", scope="read")
    def redirect():
        return RedirectResponse("https://example.invalid")
"""


def declaration(id, method, path, scope):
    return {"id": id, "method": method, "path": path, "scope": scope}


class PanelBridgeTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.folder = write_ext(
            self.ctx.extensions.root,
            main=MAIN,
            panels=[
                {
                    "id": "review",
                    "title": "Review",
                    "slot": "episode",
                    "entry": "panel.html",
                    "requests": [
                        declaration("episode", "GET", "/episodes/{episode_id}", "read"),
                        declaration("create", "POST", "/series", "write"),
                        declaration("run", "POST", "/ext/demo/run", "render"),
                        declaration("lowered", "POST", "/ext/demo/run", "read"),
                        declaration("admin", "GET", "/settings", "admin"),
                        declaration("wrong-core", "GET", "/settings", "read"),
                        declaration("foreign", "GET", "/ext/other/read", "read"),
                        declaration("absent", "GET", "/made-up", "read"),
                        declaration(
                            "recursive",
                            "POST",
                            "/extension-panels/{ext_id}/{panel_id}/requests",
                            "read",
                        ),
                        *[
                            declaration(name, "GET", f"/ext/demo/{name}", "read")
                            for name in ("large", "text", "redirect")
                        ],
                    ],
                }
            ],
        )
        (self.folder / "panel.html").write_text("<!doctype html><p>Review</p>", encoding="utf-8")
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        self.client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)
        self.panel = self.ok(self.client.get("/api/extension-panels"))[0]
        self.series = self.ctx.store.create_series(Series(title="A work"))
        self.episode = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="A chapter", order=0)
        )

    def call(self, request_id="episode", *, v2=False, token=None, **changes):
        body = {
            "activation": self.panel["activation"],
            "digest": self.panel["digest"],
            "request_id": request_id,
            **changes,
        }
        if request_id == "episode" and "path_params" not in changes:
            body["path_params"] = {"episode_id": self.episode.id}
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        prefix = "/api/v2" if v2 else "/api"
        return self.client.post(
            f"{prefix}/extension-panels/demo/review/requests", json=body, headers=headers
        )

    def token(self, *scopes):
        return self.ok(
            self.client.post("/api/tokens", json={"name": "panel", "scopes": scopes}), 201
        )["token"]

    def test_read_and_validated_mutation_use_original_operation_once(self):
        result = self.ok(
            self.call(context={"episode_id": self.episode.id, "series_id": self.series.id})
        )
        self.assertEqual(result["data"]["id"], self.episode.id)
        calls = []

        async def wrapper(next, ctx, payload):
            calls.append(payload.title)
            return await next(payload=payload.model_copy(update={"title": "wrapped"}))

        self.ctx.registry.register("operation", "POST /series", wrapper, source="test")
        result = self.ok(self.call("create", body={"title": "Original"}))
        self.assertEqual(
            (result["status"], result["data"]["title"], calls), (201, "wrapped", ["Original"])
        )
        bad = self.ok(self.call("create", body={"title": []}))
        self.assertEqual(bad["status"], 422)
        self.assertEqual(calls, ["Original"])

    def test_v2_checks_actual_scope_without_promoting_read_token(self):
        read = self.token("read")
        self.assertEqual(self.call(v2=True).status_code, 401)
        self.assertEqual(self.ok(self.call(v2=True, token=read))["status"], 200)
        for name, body in (
            ("run", {"value": 1}),
            ("create", {"title": "Forbidden"}),
            ("admin", None),
        ):
            result = self.ok(self.call(name, body=body, v2=True, token=read))
            self.assertEqual(result["status"], 403, name)
        self.assertEqual(self.ctx.extensions.loaded["demo"].api.load_settings(), {})
        allowed = self.token("read", "render")
        self.assertEqual(
            self.ok(self.call("run", body={"value": 3}, v2=True, token=allowed))["data"],
            {"value": 3},
        )
        self.assertEqual(
            self.ok(self.call("run", body={"value": "bad"}, v2=True, token=allowed))["status"], 422
        )

    def test_whitelist_template_scope_context_and_injection_rejections(self):
        for name in ("undeclared", "lowered", "wrong-core", "foreign", "absent", "recursive"):
            self.assertEqual(self.call(name).status_code, 403, name)
        for params in (
            {},
            {"episode_id": "../settings"},
            {"episode_id": "%2Fsettings"},
            {"episode_id": self.episode.id, "extra": "x"},
        ):
            self.assertEqual(self.call(path_params=params).status_code, 422)
        self.assertEqual(self.call(context={"episode_id": "missing"}).status_code, 404)
        other = self.ctx.store.create_series(Series(title="Other"))
        self.assertEqual(
            self.call(context={"episode_id": self.episode.id, "series_id": other.id}).status_code,
            422,
        )
        self.assertEqual(
            self.call(url="https://example.invalid", headers={"Authorization": "fake"}).status_code,
            422,
        )

    def test_disabled_changed_and_reenabled_activation_refuse_old_panel(self):
        self.ctx.extensions.disable("demo")
        self.assertEqual(self.call().status_code, 404)
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        self.assertEqual(self.call().status_code, 404)
        self.panel = self.ok(self.client.get("/api/extension-panels"))[0]
        self.assertEqual(self.ok(self.call())["status"], 200)
        # Custom HTTP routes remain tied to the old activation until the app is restarted.
        self.assertEqual(self.ok(self.call("run", body={"value": 1}))["status"], 404)
        (self.folder / "panel.html").write_text("changed", encoding="utf-8")
        self.assertEqual(self.call().status_code, 404)
        self.assertEqual(self.ok(self.client.get("/api/extension-panels")), [])

    def test_limits_and_non_json_responses_do_not_escape_bridge(self):
        self.assertEqual(self.call("create", body={"title": "x" * 65536}).status_code, 413)
        for name, status in (("large", 413), ("text", 415), ("redirect", 415)):
            self.assertEqual(self.call(name).status_code, status, name)
        slots = self.ctx.extensions.loaded["demo"].api._panel_slots
        for _ in range(4):
            slots.acquire()
        try:
            self.assertEqual(self.call().status_code, 429)
        finally:
            for _ in range(4):
                slots.release()
        self.assertEqual(self.ok(self.call())["status"], 200)

    def test_manifest_rejects_urls_and_duplicate_ids(self):
        base = {"id": "review", "title": "Review", "slot": "episode", "entry": "panel.html"}
        for path in (
            "https://example.invalid",
            "//example.invalid",
            "/api/../settings",
            "/series?x=1",
            "/series#x",
        ):
            with self.assertRaises(ValidationError):
                PanelSpec(**base, requests=[declaration("read", "GET", path, "read")])
        with self.assertRaises(ValidationError):
            PanelSpec(**base, requests=[declaration("read", "GET", "/series", "read")] * 2)
        self.assertEqual(json.loads(PanelSpec(**base).model_dump_json())["requests"], [])
