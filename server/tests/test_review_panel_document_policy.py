"""Reviewed panel documents and job cancellation retain the host's security boundary."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from mio_server.auth import required_scope
from mio_server.extensions.manifest import read_manifest

from .api_harness import ApiCase

PACKAGES = Path(__file__).resolve().parents[2] / "extensions"
PROFESSIONAL_PANELS = (
    "panel-retouch",
    "qa-review",
    "finalize-studio",
    "variant-workshop",
    "script-assistant",
    "motion-studio",
)
CANCEL_PANELS = {"panel-retouch": "retouch", "finalize-studio": "finalize"}


class ProfessionalPanelScopeReviewTests(unittest.TestCase):
    def test_reviewed_declarations_match_the_actual_operation_scopes(self):
        for identifier in PROFESSIONAL_PANELS:
            manifest = read_manifest(PACKAGES / identifier)
            for panel in manifest.contributes.panels:
                for declaration in panel.requests:
                    with self.subTest(package=identifier, request=declaration.id):
                        self.assertEqual(
                            declaration.scope,
                            required_scope(declaration.method, declaration.path),
                        )


class PanelDocumentPolicyReviewTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.folder = self.ctx.extensions.root / "policy-review"
        self.folder.mkdir(parents=True)
        manifest = {
            "id": "policy-review",
            "name": "Document policy review",
            "contributes": {
                "panels": [
                    {
                        "id": "review",
                        "title": "Review",
                        "slot": "episode",
                        "entry": "panel.html",
                    }
                ]
            },
        }
        (self.folder / "mio-extension.json").write_text(json.dumps(manifest), encoding="utf-8")
        (self.folder / "panel.html").write_text(
            '<!doctype html><script src="panel.js"></script><p>Review</p>', encoding="utf-8"
        )
        (self.folder / "panel.js").write_text("window.reviewed = true;", encoding="utf-8")
        (self.folder / "panel.svg").write_text(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>window.reviewed=true</script></svg>',
            encoding="utf-8",
        )
        enabled = self.ctx.extensions.enable(
            "policy-review", self.ctx.extensions.info("policy-review").digest
        )
        self.assertEqual(enabled.status, "active", enabled.error)

    def file(self, name="panel.html"):
        return self.client.get(f"/api/extensions/policy-review/files/{name}")

    def test_direct_documents_and_script_resources_receive_the_same_sandbox_policy(self):
        for name in ("panel.html", "panel.svg", "panel.js"):
            with self.subTest(file=name):
                response = self.file(name)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.content, (self.folder / name).read_bytes())
                directives = {}
                for part in response.headers["content-security-policy"].split(";"):
                    tokens = part.split()
                    if tokens:
                        directives[tokens[0]] = tokens[1:]
                self.assertEqual(directives["sandbox"], ["allow-scripts"])
                self.assertEqual(directives["connect-src"], ["'none'"])
                self.assertEqual(directives["frame-src"], ["'none'"])
                self.assertEqual(directives["form-action"], ["'none'"])
                self.assertEqual(directives["frame-ancestors"], ["'self'"])
                self.assertEqual(directives["script-src"], ["'self'", "'unsafe-inline'"])

    def test_changed_assets_cannot_be_served_under_the_old_review(self):
        (self.folder / "panel.js").write_text("window.unreviewed = true;", encoding="utf-8")
        for name in ("panel.html", "panel.svg", "panel.js"):
            with self.subTest(file=name):
                self.assertEqual(self.file(name).status_code, 404)

    def test_disabled_panel_documents_and_resources_are_not_served(self):
        self.ctx.extensions.disable("policy-review")
        for name in ("panel.html", "panel.svg", "panel.js"):
            with self.subTest(file=name):
                self.assertEqual(self.file(name).status_code, 404)


class ProfessionalPanelCancelReviewTests(ApiCase):
    def setUp(self):
        super().setUp()
        for identifier in CANCEL_PANELS:
            enabled = self.ctx.extensions.enable(
                identifier, self.ctx.extensions.info(identifier).digest
            )
            self.assertEqual(enabled.status, "active", enabled.error)
        self.panels = {
            panel["extension"]: panel for panel in self.ok(self.client.get("/api/extension-panels"))
        }

    def cancel(self, identifier, *, token=None):
        panel = self.panels[identifier]
        prefix = "/api/v2" if token else "/api"
        return self.client.post(
            f"{prefix}/extension-panels/{identifier}/{CANCEL_PANELS[identifier]}/requests",
            json={
                "activation": panel["activation"],
                "digest": panel["digest"],
                "request_id": "cancel",
                "path_params": {"job_id": "job-reviewed"},
            },
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )

    def token(self, *scopes):
        return self.ok(
            self.client.post("/api/tokens", json={"name": "cancel review", "scopes": scopes}),
            201,
        )["token"]

    def test_local_cancellation_reaches_the_original_operation(self):
        result = {"id": "job-reviewed", "state": "canceled"}
        for identifier in CANCEL_PANELS:
            with (
                self.subTest(package=identifier),
                patch.object(self.ctx.engine, "cancel", return_value=result) as cancel,
            ):
                response = self.ok(self.cancel(identifier))
                self.assertEqual((response["status"], response["data"]), (200, result))
                cancel.assert_called_once_with("job-reviewed")

    def test_v2_cancellation_requires_write_without_promoting_render(self):
        render = self.token("read", "render")
        write = self.token("read", "write")
        result = {"id": "job-reviewed", "state": "canceled"}
        for identifier in CANCEL_PANELS:
            with (
                self.subTest(package=identifier),
                patch.object(self.ctx.engine, "cancel", return_value=result) as cancel,
            ):
                denied = self.ok(self.cancel(identifier, token=render))
                self.assertEqual(denied["status"], 403)
                cancel.assert_not_called()
                allowed = self.ok(self.cancel(identifier, token=write))
                self.assertEqual((allowed["status"], allowed["data"]), (200, result))
                cancel.assert_called_once_with("job-reviewed")
