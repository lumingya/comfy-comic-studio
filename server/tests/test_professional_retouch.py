"""Two portable professional panels exercise only declared, scoped production operations."""

import io
import json
import re
import subprocess
import zipfile
from pathlib import Path
from unittest.mock import patch

from mio_server.extensions.ctk import check_package
from mio_server.models import Episode, Panel, Series, Take, TakeStatus
from mio_server.render_models import RenderStage

from .api_harness import ApiCase
from .test_compile_executor import png

EXAMPLES = Path(__file__).resolve().parents[2] / "examples" / "extensions"
PANELS = {"panel-retouch": "retouch", "finalize-studio": "finalize"}


class ProfessionalPanelTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.info = {}
        self.panels = {}
        for identifier in PANELS:
            package = io.BytesIO()
            with zipfile.ZipFile(package, "w") as archive:
                for path in sorted((EXAMPLES / identifier).iterdir()):
                    if path.is_file():
                        archive.write(path, identifier + "/" + path.name)
            self.info[identifier] = self.ok(
                self.client.post("/api/extensions", content=package.getvalue()), 201
            )
        series = self.ctx.store.create_series(Series(title="A quiet room"))
        self.original_asset = self.ctx.assets.put(png(), source="professional-panel-test")
        frames = [Panel(order=i, description=f"Quiet scene {i}") for i in range(2)]
        self.episode = self.ctx.store.create_episode(
            Episode(
                series_id=series.id,
                title="Retouch and finalize",
                order=0,
                panels=frames,
                takes=[
                    Take(
                        panel_id=frame.id,
                        asset_id=self.original_asset.id,
                        status=TakeStatus.adopted,
                        width=64,
                        height=96,
                        parameter_snapshot={"prompt": "A quiet room", "negative": ""},
                    )
                    for frame in frames
                ],
            )
        )
        profile = self.ctx.store.get_doc("profile", "profile_default").model_copy(deep=True)
        profile.id, profile.name = "professional-test", "Two-stage test profile"
        profile.edits["edit"] = RenderStage(
            id="instruction", kind="edit", workflow_id="builtin_i2i_tile"
        )
        profile.final.append(
            RenderStage(id="details", kind="refine", workflow_id="builtin_i2i_tile")
        )
        self.ctx.store.put_doc(profile)

    def enable(self, identifier):
        info = self.ctx.extensions.info(identifier)
        self.ok(
            self.client.post(f"/api/extensions/{identifier}/enable", json={"digest": info.digest})
        )
        self.panels[identifier] = next(
            panel
            for panel in self.ok(self.client.get("/api/extension-panels"))
            if panel["extension"] == identifier
        )

    def call(self, identifier, request_id, *, token=None, **payload):
        panel = self.panels[identifier]
        prefix = "/api/v2" if token else "/api"
        return self.client.post(
            f"{prefix}/extension-panels/{identifier}/{PANELS[identifier]}/requests",
            json={
                "activation": panel["activation"],
                "digest": panel["digest"],
                "request_id": request_id,
                "context": {
                    "episode_id": self.episode.id,
                    "series_id": self.episode.series_id,
                },
                **payload,
            },
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )

    def read_episode(self, identifier):
        return self.ok(
            self.call(identifier, "episode", path_params={"episode_id": self.episode.id})
        )["data"]

    def edit_body(self, kind="inpaint"):
        return {
            "take_id": self.episode.takes[0].id,
            "kind": kind,
            "profile_id": "professional-test",
            "params": {
                "inpaint": {
                    "boxes": [[0.1, 0.2, 0.6, 0.8]],
                    "polygons": [[[0.2, 0.2], [0.4, 0.2], [0.3, 0.4]]],
                    "feather": 4,
                },
                "outpaint": {"pads": [8, 0, 8, 0]},
                "edit": {"instruction": "Keep the quiet room and brighten the window"},
            }[kind],
            "idempotency_key": "professional-edit-" + kind,
        }

    def test_packages_install_inert_enable_serve_assets_and_pass_ctk(self):
        self.assertEqual(self.ok(self.client.get("/api/extension-panels")), [])
        self.assertEqual(self.ctx.engine.list(), [])
        for identifier in PANELS:
            with self.subTest(package=identifier):
                report = check_package(EXAMPLES / identifier, "extension")
                self.assertTrue(report.valid, report)
                self.assertFalse([item for item in report.findings if item.severity == "error"])
                self.enable(identifier)
                panel = self.panels[identifier]
                manifest = json.loads(
                    (EXAMPLES / identifier / "mio-extension.json").read_text(encoding="utf-8")
                )
                self.assertNotIn("main", manifest)
                self.assertEqual(len(panel["requests"]), 7)
                page = self.ok(self.client.get(panel["url"]))
                self.assertIn("connect-src 'none'", page.headers["content-security-policy"])
                for relative in re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', page.text):
                    asset = self.ok(
                        self.client.get(f"/api/extensions/{identifier}/files/{relative}")
                    )
                    self.assertTrue(asset.content)
                episode = self.read_episode(identifier)
                self.assertEqual(episode["id"], self.episode.id)
                self.assertEqual(self.ctx.engine.list(), [])
                self.assertTrue(self.ok(self.call(identifier, "profiles"))["data"])

    def test_three_edit_modes_return_new_candidates_and_preserve_adopted_sources(self):
        identifier = "panel-retouch"
        self.enable(identifier)
        for kind in ("inpaint", "outpaint", "edit"):
            with self.subTest(kind=kind):
                body = self.edit_body(kind)
                with patch.object(self.ctx.render, "edit", wraps=self.ctx.render.edit) as edit:
                    result = self.ok(
                        self.call(
                            identifier,
                            "edit",
                            path_params={"episode_id": self.episode.id},
                            body=body,
                        )
                    )
                self.assertEqual(result["status"], 200, result)
                job = result["data"]
                self.assertEqual(edit.call_args.args[1:4], (body["take_id"], kind, body["params"]))
                repeated = self.ok(
                    self.call(
                        identifier,
                        "edit",
                        path_params={"episode_id": self.episode.id},
                        body=body,
                    )
                )["data"]
                self.assertEqual(repeated["id"], job["id"])
                self.drain(job)
                episode = self.read_episode(identifier)
                original = next(t for t in episode["takes"] if t["id"] == body["take_id"])
                self.assertEqual(original["status"], "adopted")
                children = [t for t in episode["takes"] if t["job_id"] == job["id"]]
                self.assertEqual(len(children), 1)
                self.assertEqual(children[0]["status"], "candidate")
                self.assertEqual(children[0]["parent_take_id"], body["take_id"])
                self.assertEqual(children[0]["edits"][-1]["kind"], kind)

    def test_finalize_freezes_two_stages_tracks_progress_and_retains_original(self):
        identifier = "finalize-studio"
        self.enable(identifier)
        original = self.episode.takes[0]
        job = self.ok(
            self.call(
                identifier,
                "finalize",
                path_params={"episode_id": self.episode.id},
                body={
                    "take_ids": [original.id],
                    "profile_id": "professional-test",
                    "idempotency_key": "professional-final",
                },
            )
        )["data"]
        self.assertEqual(len(job["items"]), 1)
        self.assertEqual(len(job["items"][0]["input"]["stages"]), 2)
        self.assertEqual(job["snapshot"]["purpose"], "final")
        self.drain(job)
        done = self.ok(self.call(identifier, "job", path_params={"job_id": job["id"]}))["data"]
        self.assertEqual(done["state"], "completed")
        episode = self.read_episode(identifier)
        old = next(t for t in episode["takes"] if t["id"] == original.id)
        final = next(t for t in episode["takes"] if t["job_id"] == job["id"])
        self.assertEqual(old["status"], "candidate")
        self.assertEqual(old["asset_id"], self.original_asset.id)
        self.assertEqual((final["stage"], final["status"]), ("final", "adopted"))
        self.assertEqual(final["parent_take_id"], original.id)
        unselected = next(t for t in episode["takes"] if t["id"] == self.episode.takes[1].id)
        self.assertEqual(unselected["status"], "adopted")
        recent = self.ok(self.call(identifier, "jobs", query={"owner": self.episode.id}))["data"]
        self.assertEqual(recent[0]["id"], job["id"])
        for take in (old, final):
            image = self.call(
                identifier,
                "image",
                path_params={"episode_id": self.episode.id, "take_id": take["id"]},
            )
            self.assertEqual(image.status_code, 200)
            self.assertEqual(image.headers["x-mio-panel-response"], "image")
            self.assertTrue(image.content.startswith(b"\x89PNG"))

    def test_disabled_edit_stages_are_refused_before_compile_submit_or_cloud_fallback(self):
        self.enable("panel-retouch")
        profile = self.ctx.store.get_doc("profile", "professional-test")
        for stage in profile.edits.values():
            stage.enabled = False
        self.ctx.store.put_doc(profile)
        with (
            patch.object(self.ctx.render, "_compile_stage") as compile_stage,
            patch.object(self.ctx.render, "_cloud_edit") as cloud_edit,
            patch.object(self.ctx.engine, "submit") as submit,
        ):
            for kind in ("inpaint", "outpaint", "edit"):
                with self.subTest(kind=kind):
                    body = self.edit_body(kind)
                    direct = self.ok(
                        self.client.post(f"/api/episodes/{self.episode.id}/edit", json=body),
                        400,
                    )
                    self.assertIn("已停用", direct["detail"])
                    bridged = self.ok(
                        self.call(
                            "panel-retouch",
                            "edit",
                            path_params={"episode_id": self.episode.id},
                            body=body,
                        )
                    )
                    self.assertEqual(bridged["status"], 400)
                    self.assertIn("已停用", bridged["data"]["detail"])
            compile_stage.assert_not_called()
            cloud_edit.assert_not_called()
            submit.assert_not_called()
        self.assertEqual(self.ctx.engine.list(), [])

    def test_absent_local_instruction_stage_preserves_cloud_fallback(self):
        profile = self.ctx.store.get_doc("profile", "professional-test")
        del profile.edits["edit"]
        self.ctx.store.put_doc(profile)
        body = self.edit_body("edit")
        with (
            patch.object(
                self.ctx.render, "_cloud_edit", return_value={"id": "cloud-fallback"}
            ) as cloud_edit,
            patch.object(self.ctx.render, "_compile_stage") as compile_stage,
        ):
            result = self.ok(self.client.post(f"/api/episodes/{self.episode.id}/edit", json=body))
            self.assertEqual(result["id"], "cloud-fallback")
            self.assertEqual(cloud_edit.call_count, 1)
            episode, take, params, key = cloud_edit.call_args.args
            self.assertEqual((episode.id, take.id), (self.episode.id, body["take_id"]))
            self.assertEqual((params, key), (body["params"], body["idempotency_key"]))
            compile_stage.assert_not_called()

    def test_read_token_cannot_edit_or_finalize_and_disable_uninstall_revoke_panels(self):
        token = self.ok(
            self.client.post(
                "/api/tokens", json={"name": "Professional reader", "scopes": ["read"]}
            ),
            201,
        )["token"]
        for identifier, request_id in (("panel-retouch", "edit"), ("finalize-studio", "finalize")):
            self.enable(identifier)
            body = (
                self.edit_body()
                if request_id == "edit"
                else {
                    "take_ids": [self.episode.takes[0].id],
                    "profile_id": "professional-test",
                }
            )
            denied = self.ok(
                self.call(
                    identifier,
                    request_id,
                    token=token,
                    path_params={"episode_id": self.episode.id},
                    body=body,
                )
            )
            self.assertEqual(denied["status"], 403)
            self.assertEqual(self.ctx.engine.list(), [])
            self.ok(self.client.post(f"/api/extensions/{identifier}/disable"))
            self.assertEqual(
                self.call(
                    identifier, "episode", path_params={"episode_id": self.episode.id}
                ).status_code,
                404,
            )
            self.assertFalse(
                [
                    p
                    for p in self.ok(self.client.get("/api/extension-panels"))
                    if p["extension"] == identifier
                ]
            )
            self.ok(self.client.delete(f"/api/extensions/{identifier}"), 204)
            self.assertEqual(self.ctx.store.get_episode(self.episode.id).takes, self.episode.takes)

    def test_browser_request_logic_is_offline_and_inert(self):
        for identifier in PANELS:
            for script in ("logic.test.cjs", "bridge.test.cjs"):
                result = subprocess.run(
                    ["node", str(EXAMPLES / identifier / script)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=15,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            for path in (EXAMPLES / identifier).glob("*.js"):
                code = path.read_text(encoding="utf-8")
                for forbidden in ("fetch(", "XMLHttpRequest", "localStorage", "ctx.internal"):
                    self.assertNotIn(forbidden, code, str(path))
