"""Two opt-in professional panels use native models through reviewed declarations only."""

from __future__ import annotations

import io
import json
import re
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from mio_server.auth import required_scope
from mio_server.extensions.ctk import check_package
from mio_server.models import Dialogue, Episode, Panel, Series, Take, TakeStatus, VariantSet

from .api_harness import ApiCase
from .test_compile_executor import png

EXAMPLES = Path(__file__).resolve().parents[2] / "examples/extensions"
PACKAGES = {"variant-workshop": "variants", "motion-studio": "motion"}


def package_bytes(identifier):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for path in sorted((EXAMPLES / identifier).iterdir()):
            if path.is_file():
                archive.write(path, f"{identifier}/{path.name}")
    return output.getvalue()


class ProfessionalPackageContractTests(unittest.TestCase):
    def test_packages_are_declarative_installable_and_use_actual_operation_scopes(self):
        for identifier in PACKAGES:
            with self.subTest(package=identifier):
                folder = EXAMPLES / identifier
                report = check_package(folder, "extension")
                self.assertTrue(report.valid, report)
                manifest = json.loads((folder / "mio-extension.json").read_text("utf-8"))
                self.assertNotIn("main", manifest)
                panels = manifest["contributes"]["panels"]
                self.assertEqual(len(panels), 1)
                self.assertEqual(panels[0]["slot"], "episode")
                for declaration in panels[0]["requests"]:
                    self.assertEqual(
                        declaration["scope"],
                        required_scope(declaration["method"], declaration["path"]),
                        declaration,
                    )
                scripts = "\n".join(path.read_text("utf-8") for path in folder.glob("*.js"))
                self.assertNotRegex(scripts, r"\bfetch\s*\(|XMLHttpRequest|ctx\.internal")
                self.assertRegex(scripts, r"['\"]mio:panel:request['\"]")
                self.assertRegex(scripts, r"['\"]mio:panel:release['\"]")
                if identifier == "variant-workshop":
                    append = next(
                        value for value in panels[0]["requests"] if value["id"] == "variants"
                    )
                    self.assertEqual(
                        (append["method"], append["path"]), ("POST", "/series/{series_id}/variants")
                    )


class ProfessionalPanelsTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.panels = {}
        for identifier in PACKAGES:
            self.ok(self.client.post("/api/extensions", content=package_bytes(identifier)), 201)
            info = self.ctx.extensions.info(identifier)
            self.ok(
                self.client.post(
                    f"/api/extensions/{identifier}/enable", json={"digest": info.digest}
                )
            )
        self.refresh_panels()
        self.series = self.ctx.store.create_series(Series(title="A quiet room"))
        self.panel = Panel(order=0, description="An empty desk", dialogues=[Dialogue(text="Rain.")])
        self.episode = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="Study", order=0, panels=[self.panel])
        )

    def refresh_panels(self):
        self.panels = {
            panel["extension"]: panel
            for panel in self.ok(self.client.get("/api/extension-panels"))
            if panel["extension"] in PACKAGES
        }

    def call(self, identifier, request_id, *, token=None, **values):
        panel = self.panels[identifier]
        body = {
            "activation": panel["activation"],
            "digest": panel["digest"],
            "request_id": request_id,
            "context": {"series_id": self.series.id, "episode_id": self.episode.id},
            **values,
        }
        prefix = "/api/v2" if token else "/api"
        return self.client.post(
            f"{prefix}/extension-panels/{identifier}/{PACKAGES[identifier]}/requests",
            json=body,
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )

    def payload(self, identifier, request_id, **values):
        response = self.ok(self.call(identifier, request_id, **values))
        self.assertLess(response["status"], 300, response)
        return response["data"]

    def add_image(self, *, variant_id=None):
        asset = self.ctx.assets.put(png(), filename="quiet-room.png")
        take = Take(
            panel_id=self.panel.id,
            variant_id=variant_id,
            asset_id=asset.id,
            status=TakeStatus.adopted,
        )
        self.ctx.store.update_episode(self.episode.id, lambda ep: ep.takes.append(take))
        return take

    def test_install_enable_disabled_start_and_uninstall_do_not_submit_work(self):
        self.assertEqual(set(self.panels), set(PACKAGES))
        self.assertEqual(self.ctx.engine.list(), [])
        for identifier, panel_id in PACKAGES.items():
            with self.subTest(package=identifier):
                listed = self.panels[identifier]
                page = self.ok(self.client.get(listed["url"]))
                self.assertIn("connect-src 'none'", page.headers["content-security-policy"])
                self.assertIn("panel.js", page.text)
                self.ctx.extensions.disable(identifier)
                self.assertEqual(
                    self.call(
                        identifier, "episode", path_params={"episode_id": self.episode.id}
                    ).status_code,
                    404,
                )
                info = self.ctx.extensions.info(identifier)
                self.ctx.extensions.enable(identifier, info.digest)
                self.assertEqual(
                    self.call(
                        identifier, "episode", path_params={"episode_id": self.episode.id}
                    ).status_code,
                    404,
                )
                self.refresh_panels()
                self.assertEqual(self.panels[identifier]["id"], panel_id)
                self.assertEqual(
                    self.payload(
                        identifier, "episode", path_params={"episode_id": self.episode.id}
                    )["id"],
                    self.episode.id,
                )
                self.ctx.extensions.disable(identifier)
                self.ctx.extensions.remove(identifier)
                self.assertFalse((self.ctx.extensions.root / identifier).exists())
                self.assertEqual(
                    self.ctx.store.get_episode(self.episode.id).panels[0].id, self.panel.id
                )
        self.assertEqual(self.ctx.engine.list(), [])

    def test_variant_requests_preserve_original_and_only_explicitly_adopt_same_variant(self):
        identifier = "variant-workshop"
        original = self.add_image()
        variants = [
            {"id": "var_ink", "name": "Ink", "characters": {}, "style_id": None},
            {"id": "var_paper", "name": "Paper", "characters": {}, "style_id": None},
        ]
        # A version saved by another window after this panel's initial read must survive.
        self.ctx.store.update_series(
            self.series.id,
            lambda work: work.variants.append(
                VariantSet(id="var_other_window", name="Other window")
            ),
        )
        saved = self.payload(
            identifier,
            "variants",
            path_params={"series_id": self.series.id},
            body={"variants": variants},
        )
        self.assertEqual(
            [item["id"] for item in saved["variants"]], ["var_other_window", "var_ink", "var_paper"]
        )
        self.assertEqual(self.ctx.engine.list(), [])
        snapshot = {
            "variant_ids": ["var_ink", "var_paper"],
            "candidates": 1,
            "adopt_first": False,
            "adopt_replace": False,
            "idempotency_key": "variants-once",
        }
        job = self.payload(
            identifier, "render", path_params={"episode_id": self.episode.id}, body=snapshot
        )
        repeated = self.payload(
            identifier, "render", path_params={"episode_id": self.episode.id}, body=snapshot
        )
        self.assertEqual(repeated["id"], job["id"])
        self.drain(job)
        episode = self.payload(identifier, "episode", path_params={"episode_id": self.episode.id})
        candidates = [take for take in episode["takes"] if take["id"] != original.id]
        self.assertEqual({take["variant_id"] for take in candidates}, {"var_ink", "var_paper"})
        self.assertTrue(all(take["status"] == "candidate" for take in candidates))
        selected = candidates[0]
        self.payload(
            identifier,
            "adopt",
            path_params={"episode_id": self.episode.id, "take_id": selected["id"]},
        )
        current = self.ctx.store.get_episode(self.episode.id)
        self.assertEqual(current.adopted(self.panel.id).id, original.id)
        self.assertEqual(current.adopted(self.panel.id, selected["variant_id"]).id, selected["id"])
        self.assertIsNone(current.adopted(self.panel.id, candidates[1]["variant_id"]))
        for take_id in (original.id, selected["id"]):
            image = self.ok(
                self.call(
                    identifier,
                    "take-image",
                    path_params={"episode_id": self.episode.id, "take_id": take_id},
                )
            )
            self.assertEqual(image.headers["x-mio-panel-response"], "image")
            take = self.ctx.store.get_episode(self.episode.id).take(take_id)
            self.assertEqual(image.content, self.ctx.assets.read(take.asset_id))
        for request_id, body, mime in (
            ("export-album", {"template_id": "export-monograph"}, "text/html"),
            ("export-pdf", {"format": "pdf"}, "application/pdf"),
        ):
            result = self.ok(
                self.call(
                    identifier,
                    request_id,
                    body={
                        "episode_ids": [self.episode.id],
                        "variant_id": selected["variant_id"],
                        "lettered": False,
                        **body,
                    },
                )
            )
            self.assertEqual(result.headers["x-mio-panel-response"], "download")
            self.assertIn(mime, result.headers["content-type"])
            self.assertTrue(result.content)

    def test_motion_revision_plan_image_and_offline_export_roundtrip(self):
        identifier = "motion-studio"
        original = self.add_image()
        paths = {"episode_id": self.episode.id}
        plan = self.payload(identifier, "motion-plan", path_params=paths)
        self.assertTrue(plan["shots"][0]["has_image"])
        for move in ("push_in", "pull_out", "pan_left", "pan_right", "pan_up", "pan_down"):
            revision = self.ctx.store.get_episode(self.episode.id).revision
            saved = self.payload(
                identifier,
                "patch-panel",
                path_params={**paths, "panel_id": self.panel.id},
                body={"changes": {"motion": {"move": move, "hold": 4.5}}, "revision": revision},
            )
            self.assertEqual(saved["panels"][0]["motion"]["move"], move)
        stale = self.ok(
            self.call(
                identifier,
                "patch-panel",
                path_params={**paths, "panel_id": self.panel.id},
                body={"changes": {"motion": {"move": "still", "hold": 2}}, "revision": revision},
            )
        )
        self.assertEqual(stale["status"], 409)
        image = self.ok(
            self.call(identifier, "take-image", path_params={**paths, "take_id": original.id})
        )
        self.assertEqual(image.headers["x-mio-panel-response"], "image")
        output = self.ok(
            self.call(
                identifier,
                "export-motion",
                body={"episode_id": self.episode.id, "lettered": False, "voice": False},
            )
        )
        self.assertIn("text/html", output.headers["content-type"])
        timeline = json.loads(
            re.search(r'id="mio-motion">(.*?)</script>', output.text, re.S).group(1)
        )
        self.assertEqual(timeline["shots"][0]["move"], "pan_down")
        self.assertEqual(timeline["shots"][0]["hold"], 4.5)
        self.assertTrue(timeline["shots"][0]["image"].startswith("data:image/"))
        self.assertIn("connect-src 'none'", output.text)
        revision = self.ctx.store.get_episode(self.episode.id).revision
        self.payload(
            identifier,
            "patch-panel",
            path_params={**paths, "panel_id": self.panel.id},
            body={"changes": {"motion": {"move": "auto", "hold": None}}, "revision": revision},
        )
        automatic = self.payload(identifier, "motion-plan", path_params=paths)["shots"][0]
        self.assertEqual(automatic["hold"], automatic["auto_hold"])
        self.assertFalse(automatic["move_overridden"])
        self.assertEqual(self.ctx.engine.list(), [])

    def test_read_tokens_cannot_generate_adopt_patch_or_download_through_panels(self):
        token = self.ok(
            self.client.post("/api/tokens", json={"name": "read-only", "scopes": ["read"]}), 201
        )["token"]
        for identifier, request_id, values in (
            (
                "variant-workshop",
                "render",
                {"path_params": {"episode_id": self.episode.id}, "body": {}},
            ),
            (
                "variant-workshop",
                "variants",
                {"path_params": {"series_id": self.series.id}, "body": {"variants": []}},
            ),
            (
                "variant-workshop",
                "adopt",
                {"path_params": {"episode_id": self.episode.id, "take_id": "none"}},
            ),
            (
                "motion-studio",
                "patch-panel",
                {
                    "path_params": {"episode_id": self.episode.id, "panel_id": self.panel.id},
                    "body": {"changes": {}},
                },
            ),
        ):
            with self.subTest(package=identifier, request=request_id):
                self.assertEqual(
                    self.ok(self.call(identifier, request_id, token=token, **values))["status"], 403
                )
        forbidden = self.call(
            "motion-studio", "export-motion", token=token, body={"episode_id": self.episode.id}
        )
        self.assertEqual(forbidden.status_code, 403)
        with patch.object(self.ctx.render, "render") as generate:
            self.assertEqual(self.call("variant-workshop", "not-declared").status_code, 403)
            generate.assert_not_called()
        self.assertEqual(self.ctx.engine.list(), [])
