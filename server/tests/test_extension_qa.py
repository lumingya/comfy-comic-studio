"""Explicit QA extension requests and revocation of mounted activation identities."""

import argparse
import importlib.util
import io
import json
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from starlette.requests import HTTPConnection

from mio_server.api import create_app
from mio_server.api.extension_routes import extension_guard
from mio_server.models import Episode, Panel, Series, Take, TakeStatus
from mio_server.storage import NotFound

from .api_harness import LOCAL, ApiCase

EXAMPLE = Path(__file__).resolve().parents[2] / "examples" / "extensions" / "qa-review"
ROUTE = "/api/ext/qa-review/queue"


class QAExtensionTests(ApiCase):
    def setUp(self):
        super().setUp()
        package = io.BytesIO()
        with zipfile.ZipFile(package, "w") as archive:
            for name in ("mio-extension.json", "main.py", "cli.py", "panel.html", "README.md"):
                archive.write(EXAMPLE / name, "qa-review/" + name)
        self.info = self.ok(self.client.post("/api/extensions", content=package.getvalue()), 201)
        series = self.ctx.store.create_series(Series(title="QA example"))
        panel = Panel(order=0, description="A quiet room")
        self.episode = self.ctx.store.create_episode(
            Episode(
                series_id=series.id,
                title="Review",
                order=0,
                panels=[panel],
                takes=[
                    Take(panel_id=panel.id, asset_id="fake-a", status=TakeStatus.adopted),
                    Take(panel_id=panel.id, asset_id="fake-b"),
                ],
            )
        )
        self.body = {
            "episode_id": self.episode.id,
            "take_ids": [take.id for take in self.episode.takes],
            "idempotency_key": "qa-review-test",
        }

    def enable(self):
        info = self.ctx.extensions.info("qa-review")
        return self.ok(
            self.client.post("/api/extensions/qa-review/enable", json={"digest": info.digest})
        )

    def remount(self):
        return TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)

    def test_panel_is_inert_until_explicit_bridge_request(self):
        self.enable()
        active = self.remount()
        panel = self.ok(active.get("/api/extension-panels"))[0]
        page = self.ok(active.get(panel["url"]))
        self.assertIn("connect-src 'none'", page.headers["content-security-policy"])
        self.assertIn("mio:panel:ready", page.text)
        self.assertEqual(self.ctx.engine.list(), [])
        base = {"activation": panel["activation"], "digest": panel["digest"]}
        endpoint = "/api/extension-panels/qa-review/review/requests"
        result = self.ok(
            active.post(
                endpoint,
                json={
                    **base,
                    "request_id": "episode",
                    "path_params": {"episode_id": self.episode.id},
                },
            )
        )
        self.assertEqual(result["data"]["id"], self.episode.id)
        self.assertEqual(self.ctx.engine.list(), [])
        queued = self.ok(
            active.post(endpoint, json={**base, "request_id": "review", "body": self.body})
        )
        self.assertEqual(queued["status"], 200)
        self.assertFalse(queued["data"]["snapshot"]["auto_adopt"])
        self.assertEqual(len(self.ctx.engine.list()), 1)

    def test_installed_and_enabled_extensions_do_nothing_until_explicit_queue(self):
        self.assertEqual(self.info["status"], "disabled")
        self.assertEqual(self.client.post(ROUTE, json=self.body).status_code, 404)
        self.assertEqual(self.ctx.engine.list(), [])
        enabled = self.enable()
        self.assertFalse(enabled["restart_required"])
        active = self.client
        self.assertFalse(self.ctx.extensions.info("qa-review").restart_required)
        self.assertEqual(active.get(ROUTE).status_code, 405)
        self.assertEqual(self.ctx.engine.list(), [])
        with patch.object(self.ctx.qa, "submit", wraps=self.ctx.qa.submit) as submit:
            first = self.ok(active.post(ROUTE, json=self.body))
            repeat = self.ok(active.post(ROUTE, json=self.body))
        self.assertEqual(first["id"], repeat["id"])
        self.assertEqual(len(self.ctx.engine.list()), 1)
        self.assertEqual(first["kind"], "qa.check")
        self.assertFalse(first["snapshot"]["auto_adopt"])
        submit.assert_called_with(
            self.episode.id,
            take_ids=self.body["take_ids"],
            auto_adopt=False,
            idempotency_key=self.body["idempotency_key"],
        )
        conflict = active.post(ROUTE, json={**self.body, "take_ids": self.body["take_ids"][:1]})
        self.assertEqual(conflict.status_code, 409)
        result = {"qa": {"passed": True, "score": 1.0}, "faces": []}
        with patch.object(self.ctx.qa, "execute", return_value=result):
            self.ctx.engine.tick()
            done = self.ctx.engine.wait(first["id"])
        self.assertEqual(done["state"], "completed")
        stored = self.ctx.store.get_episode(self.episode.id)
        self.assertTrue(all(take.qa and take.qa.passed for take in stored.takes))
        self.assertEqual(
            [take.status for take in stored.takes], [TakeStatus.adopted, TakeStatus.candidate]
        )

    def test_required_body_fields_and_extra_auto_adopt_cannot_trigger_work(self):
        self.enable()
        active = self.remount()
        for field in self.body:
            invalid = {key: value for key, value in self.body.items() if key != field}
            with self.subTest(missing=field):
                self.assertEqual(active.post(ROUTE, json=invalid).status_code, 422)
        for overrides in ({"take_ids": []}, {"idempotency_key": ""}, {"auto_adopt": True}):
            with self.subTest(overrides=overrides):
                self.assertEqual(
                    active.post(ROUTE, json={**self.body, **overrides}).status_code, 422
                )
        self.assertEqual(self.ctx.engine.list(), [])

    def test_disable_revokes_mounted_route_and_reenable_does_not_revive_old_closure(self):
        self.enable()
        active = self.remount()
        old = self.ctx.extensions.loaded["qa-review"]
        old_guard = extension_guard(self.ctx.extensions, "qa-review", old, old.api.digest)
        self.ok(active.post("/api/extensions/qa-review/disable"))
        with patch.object(self.ctx.qa, "submit") as submit:
            self.assertEqual(active.post(ROUTE, json=self.body).status_code, 404)
            info = self.enable()
            self.assertFalse(info["restart_required"])
            self.assertIsNot(self.ctx.extensions.loaded["qa-review"], old)
            with self.assertRaises(NotFound):
                old_guard(HTTPConnection({"type": "http", "headers": []}))
            submit.assert_not_called()
        self.assertEqual(self.ctx.engine.list(), [])
        self.ok(active.post(ROUTE, json=self.body))
        self.assertEqual(len(self.ctx.engine.list()), 1)

    def test_changed_or_untrusted_files_reject_requests_before_any_qa_submission(self):
        self.enable()
        active = self.remount()
        path = self.ctx.extensions.root / "qa-review" / "main.py"
        original = path.read_text(encoding="utf-8")
        path.write_text(original + "\n# changed after review\n", encoding="utf-8")
        with patch.object(self.ctx.qa, "submit") as submit:
            self.assertEqual(active.post(ROUTE, json=self.body).status_code, 404)
            path.write_text(original, encoding="utf-8")
            self.ctx.extensions._save_state("qa-review", True, "untrusted")
            self.assertEqual(active.post(ROUTE, json=self.body).status_code, 404)
            submit.assert_not_called()
        self.assertEqual(self.ctx.engine.list(), [])

    def test_changed_code_requires_new_activation_and_mounts_immediately(self):
        self.enable()
        active = self.remount()
        path = self.ctx.extensions.root / "qa-review" / "main.py"
        path.write_text(
            "def activate(mio):\n"
            '    @mio.router.post("/queue")\n'
            "    def changed():\n"
            '        return {"version": "new"}\n',
            encoding="utf-8",
        )
        self.assertEqual(active.post(ROUTE, json=self.body).status_code, 404)
        self.enable()
        self.assertEqual(self.ok(active.post(ROUTE)), {"version": "new"})
        self.assertEqual(self.ctx.engine.list(), [])

    def test_extension_route_requires_render_token_and_keeps_local_origin_guard(self):
        self.enable()
        active = self.remount()
        self.assertEqual(
            active.post(
                ROUTE, json=self.body, headers={"Origin": "https://other.test"}
            ).status_code,
            403,
        )
        self.assertEqual(
            active.post("/api/v2/ext/qa-review/queue", json=self.body).status_code, 401
        )
        self.assertEqual(self.ctx.engine.list(), [])
        for scope, code in (("read", 403), ("write", 403), ("render", 200)):
            token = self.ok(
                active.post("/api/tokens", json={"name": "QA", "scopes": [scope]}), 201
            )["token"]
            self.assertEqual(
                active.post(
                    "/api/v2/ext/qa-review/queue",
                    json=self.body,
                    headers={"Authorization": f"Bearer {token}"},
                ).status_code,
                code,
            )
        self.assertEqual(len(self.ctx.engine.list()), 1)


class QACliTests(unittest.TestCase):
    def setUp(self):
        super().setUp()
        spec = importlib.util.spec_from_file_location("qa_review_cli_test", EXAMPLE / "cli.py")
        self.cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.cli)

    def test_cli_refuses_remote_origins_credentials_paths_and_redirects(self):
        for url in (
            "https://remote.example",
            "http://127.0.0.1.example",
            "file:///tmp/x",
            "http://user:pass@localhost",
            "http://localhost/api",
            "http://localhost?x=y",
        ):
            with self.subTest(url=url), self.assertRaises(argparse.ArgumentTypeError):
                self.cli.local_base(url)
        self.assertEqual(self.cli.local_base("http://127.0.0.1:8788/"), "http://127.0.0.1:8788")
        self.assertEqual(self.cli.local_base("http://[::1]:8788"), "http://[::1]:8788")
        with self.assertRaises(ValueError):
            self.cli.NoRedirect().redirect_request(None, None, 302, "", {}, "https://remote.test")

    def test_cli_submits_only_explicit_queue_and_preserves_idempotency_key(self):
        opener = Mock()
        opener.open.return_value.__enter__ = Mock(return_value=io.BytesIO(b'{"id":"job_qa"}'))
        opener.open.return_value.__exit__ = Mock(return_value=False)
        with patch.object(self.cli.urllib.request, "build_opener", return_value=opener):
            with patch("sys.stdout", new_callable=io.StringIO) as output:
                self.assertEqual(
                    self.cli.main(
                        ["queue", "--episode", "ep", "--takes", "take", "--key", "retry-1"]
                    ),
                    0,
                )
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:8788" + ROUTE)
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            json.loads(request.data),
            {
                "episode_id": "ep",
                "take_ids": ["take"],
                "idempotency_key": "retry-1",
            },
        )
        self.assertEqual(json.loads(output.getvalue()), {"id": "job_qa"})
