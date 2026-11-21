"""Official package smoke tests against the typed local API and activation bridge."""

from __future__ import annotations

import io
import sys
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from mio_server.extensions.ctk import check_package
from mio_server.models import Episode, Panel, Series, Take
from tests.api_harness import ApiCase

PACKAGE = Path(__file__).resolve().parent
FILES = (
    "mio-extension.json",
    "panel.html",
    "panel.css",
    "panel.js",
    "cli.py",
    "README.md",
)


class OfficialPackageTests(ApiCase):
    def setUp(self):
        super().setUp()
        report = check_package(PACKAGE, "extension")
        self.assertTrue(report.valid, report.model_dump())
        self.series = self.ctx.store.create_series(
            Series(title="QA extension contract")
        )
        panel = Panel(order=0, description="Quiet room")
        self.episode = self.ctx.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="A review",
                order=0,
                panels=[panel],
                takes=[
                    Take(panel_id=panel.id, asset_id="fixture-first"),
                    Take(panel_id=panel.id, asset_id="fixture-second"),
                ],
            )
        )
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            for name in FILES:
                output.write(PACKAGE / name, "qa-review/" + name)
        installed = self.ok(
            self.client.post("/api/extensions", content=archive.getvalue()), 201
        )
        self.assertEqual(installed["status"], "disabled")
        self.assertEqual(installed["id"], "qa-review")
        current = self.ctx.extensions.info("qa-review")
        self.ok(
            self.client.post(
                "/api/extensions/qa-review/enable", json={"digest": current.digest}
            )
        )
        self.panel = next(
            item
            for item in self.ok(self.client.get("/api/extension-panels"))
            if item["extension"] == "qa-review"
        )
        self.endpoint = "/api/extension-panels/qa-review/review/requests"

    def bridge(self, request_id, *, body=None, take_id=None):
        params = {"episode_id": self.episode.id}
        if take_id:
            params["take_id"] = take_id
        payload = {
            "activation": self.panel["activation"],
            "digest": self.panel["digest"],
            "request_id": request_id,
            "path_params": params,
            "context": {"episode_id": self.episode.id, "series_id": self.series.id},
        }
        if body is not None:
            payload["body"] = body
        response = self.client.post(self.endpoint, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_review_is_real_explicit_and_does_not_adopt(self):
        result = self.bridge(
            "review",
            body={
                "take_ids": [take.id for take in self.episode.takes],
                "votes": 1,
                "auto_adopt": False,
                "idempotency_key": "official-qa-review",
            },
        )
        self.assertEqual(result["status"], 200)
        self.assertFalse(result["data"]["snapshot"]["auto_adopt"])
        self.assertEqual(len(self.ctx.engine.list()), 1)
        self.assertEqual(
            [take.status for take in self.ctx.store.get_episode(self.episode.id).takes],
            ["candidate", "candidate"],
        )

    def test_adopt_and_reject_use_declared_core_routes(self):
        first, second = (take.id for take in self.episode.takes)
        self.bridge("adopt", take_id=first)
        self.bridge("reject", take_id=second)
        statuses = [
            take.status for take in self.ctx.store.get_episode(self.episode.id).takes
        ]
        self.assertEqual(statuses, ["adopted", "rejected"])

    def test_enabled_digest_and_context_are_required(self):
        body = {
            "activation": self.panel["activation"],
            "digest": self.panel["digest"],
            "request_id": "episode",
            "path_params": {"episode_id": self.episode.id},
            "context": {"episode_id": "missing-episode", "series_id": self.series.id},
        }
        response = self.client.post(self.endpoint, json=body)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.ctx.engine.list(), [])


if __name__ == "__main__":
    unittest.main()
