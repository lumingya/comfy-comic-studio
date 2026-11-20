"""Pure QA panels preserve intent, authorization, digest revocation and CLI safeguards."""

import argparse
import importlib.util
import io
import json
import unittest
import zipfile
from pathlib import Path
from unittest.mock import Mock, patch

from mio_server.models import Episode, Panel, Series, Take, TakeStatus

from .api_harness import ApiCase

EXAMPLE = Path(__file__).resolve().parents[2] / "examples/extensions/qa-review"


class QAExtensionTests(ApiCase):
    def setUp(self):
        super().setUp()
        package = io.BytesIO()
        with zipfile.ZipFile(package, "w") as archive:
            for name in ("mio-extension.json", "cli.py", "panel.html", "panel.js", "README.md"):
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
            "take_ids": [take.id for take in self.episode.takes],
            "idempotency_key": "qa-review-test",
            "auto_adopt": False,
        }
        self.endpoint = "/api/extension-panels/qa-review/review/requests"

    def enable(self):
        info = self.ctx.extensions.info("qa-review")
        enabled = self.ok(
            self.client.post("/api/extensions/qa-review/enable", json={"digest": info.digest})
        )
        self.panel = next(
            p
            for p in self.ok(self.client.get("/api/extension-panels"))
            if p["extension"] == "qa-review"
        )
        return enabled

    def intent(self, request_id="review", **kwargs):
        return {
            "activation": self.panel["activation"],
            "digest": self.panel["digest"],
            "request_id": request_id,
            "path_params": {"episode_id": self.episode.id},
            **({"body": self.body} if request_id == "review" else {}),
            **kwargs,
        }

    def test_install_enable_and_read_are_inert_and_use_only_core_operations(self):
        self.assertEqual(self.info["status"], "disabled")
        self.assertIsNone(self.ctx.extensions.info("qa-review").manifest.main)
        self.assertEqual(self.ok(self.client.get("/api/extension-panels")), [])
        self.assertFalse(self.enable()["restart_required"])
        page = self.ok(self.client.get(self.panel["url"]))
        self.assertIn("connect-src 'none'", page.headers["content-security-policy"])
        self.assertIn('src="panel.js"', page.text)
        script = self.ok(self.client.get("/api/extensions/qa-review/files/panel.js"))
        self.assertIn("mio:panel:ready", script.text)
        self.assertEqual(self.ctx.engine.list(), [])
        episode = self.ok(self.client.post(self.endpoint, json=self.intent("episode")))
        self.assertEqual(episode["data"]["id"], self.episode.id)
        self.assertEqual(self.ctx.engine.list(), [])
        self.assertTrue(
            all(not spec["path"].startswith("/ext/") for spec in self.panel["requests"])
        )

    def test_explicit_queue_is_idempotent_and_result_never_changes_adoption(self):
        self.enable()
        first = self.ok(self.client.post(self.endpoint, json=self.intent()))["data"]
        again = self.ok(self.client.post(self.endpoint, json=self.intent()))["data"]
        self.assertEqual(first["id"], again["id"])
        self.assertFalse(first["snapshot"]["auto_adopt"])
        self.assertEqual(len(self.ctx.engine.list()), 1)
        changed = self.intent(body={**self.body, "take_ids": self.body["take_ids"][:1]})
        self.assertEqual(self.ok(self.client.post(self.endpoint, json=changed))["status"], 409)
        result = {"qa": {"passed": True, "score": 1.0}, "faces": []}
        with patch.object(self.ctx.qa, "execute", return_value=result):
            self.drain(first)
        stored = self.ctx.store.get_episode(self.episode.id)
        self.assertTrue(all(take.qa and take.qa.passed for take in stored.takes))
        self.assertEqual(
            [take.status for take in stored.takes], [TakeStatus.adopted, TakeStatus.candidate]
        )

    def test_typed_validation_and_declaration_whitelist_prevent_unintended_work(self):
        self.enable()
        for body in ({"take_ids": "invalid"}, {**self.body, "votes": 8}):
            with self.subTest(body=body):
                reply = self.ok(self.client.post(self.endpoint, json=self.intent(body=body)))
                self.assertEqual(reply["status"], 422)
        self.assertEqual(
            self.client.post(self.endpoint, json=self.intent("settings")).status_code, 403
        )
        self.assertEqual(
            self.client.post(self.endpoint, json=self.intent(path_params={})).status_code, 422
        )
        self.assertEqual(
            self.client.post(self.endpoint, json={**self.intent(), "headers": {}}).status_code, 422
        )
        self.assertEqual(self.ctx.engine.list(), [])

    def test_disable_reenable_rejects_old_activation_without_submitting(self):
        self.enable()
        old = self.intent()
        self.ok(self.client.post("/api/extensions/qa-review/disable"))
        self.assertEqual(self.client.post(self.endpoint, json=old).status_code, 404)
        self.enable()
        self.assertNotEqual(old["activation"], self.panel["activation"])
        self.assertEqual(self.client.post(self.endpoint, json=old).status_code, 404)
        self.assertEqual(self.ctx.engine.list(), [])
        self.assertEqual(
            self.ok(self.client.post(self.endpoint, json=self.intent()))["status"], 200
        )

    def test_changed_or_untrusted_panel_files_reject_before_any_qa_submission(self):
        self.enable()
        path = self.ctx.extensions.root / "qa-review/panel.js"
        original = path.read_text(encoding="utf-8")
        path.write_text(original + "\n// changed after review\n", encoding="utf-8")
        with patch.object(self.ctx.qa, "submit") as submit:
            self.assertEqual(self.client.post(self.endpoint, json=self.intent()).status_code, 404)
            path.write_text(original, encoding="utf-8")
            self.ctx.extensions._save_state("qa-review", True, "untrusted")
            self.assertEqual(self.client.post(self.endpoint, json=self.intent()).status_code, 404)
            submit.assert_not_called()

    def test_panel_requires_read_and_target_render_permission_and_same_origin(self):
        self.enable()
        self.assertEqual(
            self.client.post(
                self.endpoint, json=self.intent(), headers={"Origin": "https://other.test"}
            ).status_code,
            403,
        )
        endpoint = self.endpoint.replace("/api/", "/api/v2/")
        self.assertEqual(self.client.post(endpoint, json=self.intent()).status_code, 401)
        for scopes, outer, inner in (
            (["read"], 200, 403),
            (["write"], 403, None),
            (["render"], 403, None),
            (["read", "render"], 200, 200),
        ):
            token = self.ok(
                self.client.post("/api/tokens", json={"name": "Review", "scopes": scopes}), 201
            )["token"]
            result = self.client.post(
                endpoint, json=self.intent(), headers={"Authorization": f"Bearer {token}"}
            )
            self.assertEqual(result.status_code, outer)
            if inner is not None:
                self.assertEqual(result.json()["status"], inner)
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

    def test_cli_submits_only_explicit_core_qa_without_automatic_adoption(self):
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
        self.assertEqual(request.full_url, "http://127.0.0.1:8788/api/episodes/ep/qa")
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            json.loads(request.data),
            {"take_ids": ["take"], "idempotency_key": "retry-1", "auto_adopt": False},
        )
        self.assertEqual(json.loads(output.getvalue()), {"id": "job_qa"})
