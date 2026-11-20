"""Offline integration of public storyboard tasks and their finished books."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urljoin

from mio_server.pipeline.render import RenderError

from .api_harness import ApiCase, zip_names
from .test_album import metadata


class WorkshopFlowTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty"
        self.headers = self.token("read", "write", "render")
        self.board = self.ok(
            self.client.post(
                "/api/v2/workshop/storyboards",
                headers=self.headers,
                json={
                    "title": "Window light",
                    "panels": [
                        {
                            "order": 8,
                            "overrides": {"raw_prompt": "a {subject}"},
                            "dialogues": [{"text": "Good morning"}],
                        }
                    ],
                },
            ),
            201,
        )
        self.request = {
            "storyboard_id": self.board["id"],
            "workflow_id": "builtin_t2i_sdxl",
            "auto_start": True,
            "adopt_first": True,
            "idempotency_key": "my-workshop-task",
        }

    def token(self, *scopes):
        issued = self.ok(
            self.client.post("/api/tokens", json={"name": "Test operator", "scopes": scopes}),
            201,
        )
        return {"Authorization": f"Bearer {issued['token']}"}

    def submit(self, **options):
        return self.client.post(
            "/api/v2/workshop/tasks", headers=self.headers, json={**self.request, **options}
        )

    def test_create_render_adopt_and_download_every_format(self):
        graph = {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": "base.safetensors"},
            },
            "2": {
                "class_type": "LoraLoader",
                "inputs": {
                    "model": ["1", 0],
                    "clip": ["1", 1],
                    "lora_name": "ink.safetensors",
                    "strength_model": 0.7,
                    "strength_clip": 0.5,
                },
            },
            "3": {"class_type": "KSampler", "inputs": {"model": ["2", 0]}},
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": "", "clip": ["2", 1]},
                "_meta": {"title": "[mio:prompt]"},
            },
            "9": {"class_type": "SaveImage", "inputs": {"images": ["3", 0]}},
        }
        workflow = self.ok(
            self.client.post(
                "/api/v2/workflows", headers=self.headers, json={"name": "Ink", "graph": graph}
            ),
            201,
        )
        workflows = self.ok(self.client.get("/api/v2/workflows", headers=self.headers))
        self.assertIn(workflow["id"], {item["id"] for item in workflows})
        controls = self.ok(
            self.client.get(f"/api/v2/workflows/{workflow['id']}/loras", headers=self.headers)
        )
        group = controls["groups"][0]
        preset = self.ok(
            self.client.post(
                "/api/v2/workshop/presets",
                headers=self.headers,
                json={"title": "Interior", "entries": [{"key": "subject", "value": "red chair"}]},
            ),
            201,
        )
        discovered = self.ok(self.client.get("/api/v2/workshop/presets", headers=self.headers))
        self.assertIn(preset["id"], {item["id"] for item in discovered})
        boards = self.ok(self.client.get("/api/v2/workshop/storyboards", headers=self.headers))
        boards = boards["items"] if isinstance(boards, dict) else boards
        self.assertIn(self.board["id"], {item["id"] for item in boards})
        self.assertEqual(
            self.ok(
                self.client.get(
                    f"/api/v2/workshop/storyboards/{self.board['id']}", headers=self.headers
                )
            )["panels"][0]["dialogues"][0]["text"],
            "Good morning",
        )
        adapters = self.ok(self.client.get("/api/v2/image-adapters", headers=self.headers))
        self.assertTrue(adapters)
        templates = self.ok(self.client.get("/api/v2/album-templates", headers=self.headers))
        self.assertIn("export-monograph", {item["id"] for item in templates})
        task_options = {
            "workflow_id": workflow["id"],
            "preset_ids": [preset["id"]],
            "generation": {"candidates": 1},
            "loras": [
                {
                    "group_key": group["key"],
                    "key": group["loras"][0]["key"],
                    "name": "ink.safetensors",
                    "enabled": False,
                }
            ],
        }
        task = self.ok(self.submit(**task_options), 201)
        job = task["job"]
        self.assertEqual(task["job_id"], job["id"])
        self.assertEqual(job["items"][0]["input"]["meta"]["prompt"], "a red chair")
        compiled = job["items"][0]["input"]["stages"][0]["graph"]["2"]["inputs"]
        self.assertEqual(compiled["strength_model"], 0)
        self.assertEqual(compiled["strength_clip"], 0)
        self.assertEqual(self.ctx.store.get_doc("workflow", workflow["id"]).graph, graph)

        route = f"/api/v2/episodes/{task['episode']['id']}/deliverables"
        reader = self.token("read")
        writer = self.token("write")
        self.assertEqual(self.client.get(route).status_code, 401)
        self.assertEqual(self.client.get(route, headers=writer).status_code, 403)
        pending = self.ok(self.client.get(route, headers=reader))
        self.assertEqual(pending["jobs"][0]["id"], job["id"])
        self.assertFalse(pending["ready"])
        self.assertEqual(
            self.client.post(route + "/export", headers=writer, json={}).status_code, 409
        )
        self.drain(job)
        ready = self.ok(self.client.get(route, headers=reader))
        self.assertTrue(ready["ready"])
        self.assertEqual((ready["generated_panels"], ready["adopted_panels"]), (1, 1))
        self.assertEqual(ready["jobs"][0]["done"], 1)
        self.assertEqual(set(ready["formats"]), {"html", "pdf", "zip", "png"})
        self.assertEqual(
            self.client.post(route + "/export", headers=reader, json={}).status_code, 403
        )
        for fmt, mime in (
            ("html", "text/html"),
            ("pdf", "application/pdf"),
            ("zip", "application/zip"),
            ("png", "image/png"),
        ):
            with self.subTest(fmt=fmt):
                body = {"format": fmt, "idempotency_key": f"book-{fmt}"}
                if fmt == "html":
                    body["template_id"] = "export-monograph"
                response = self.client.post(route + "/export", headers=writer, json=body)
                export = self.ok(response, 202)
                job_id = export["job_id"]
                self.assertTrue(
                    urljoin(str(response.url), response.headers["Location"]).endswith(
                        f"/api/v2/jobs/{job_id}"
                    )
                )
                self.drain({"id": job_id})
                replay = self.ok(
                    self.client.post(route + "/export", headers=writer, json=body), 202
                )
                self.assertEqual(replay["job_id"], job_id)
                file_url = f"/api/v2/export/jobs/{job_id}/file"
                self.assertEqual(self.client.get(file_url).status_code, 401)
                file = self.ok(self.client.get(file_url, headers=reader))
                self.assertTrue(file.headers["content-type"].startswith(mime))
                if fmt == "html":
                    self.assertIn('data-layout="gallery"', file.text)
                    self.assertEqual(metadata(file.text)["schema"], "mio.album-html.v1")
                elif fmt == "zip":
                    self.assertIn("manifest.json", zip_names(file.content))
                else:
                    self.assertTrue(
                        file.content.startswith(b"%PDF-" if fmt == "pdf" else b"\x89PNG")
                    )

    def test_auto_start_requires_both_write_and_render_before_creating_anything(self):
        route = "/api/v2/workshop/tasks"
        before = len(self.ctx.store.list_series())
        self.assertEqual(self.client.post(route, json=self.request).status_code, 401)
        for scopes in (("read",), ("render",), ("write",), ("admin",)):
            with self.subTest(scopes=scopes):
                response = self.client.post(route, headers=self.token(*scopes), json=self.request)
                self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(len(self.ctx.store.list_series()), before)
        self.assertFalse(self.ctx.engine.list())
        standby = self.ok(
            self.client.post(
                route,
                headers=self.token("write"),
                json={**self.request, "auto_start": False, "adopt_first": False},
            ),
            201,
        )
        self.assertIsNone(standby["job"])
        self.assertFalse(self.ctx.engine.list())
        self.assertEqual(self.submit().status_code, 409)

    def test_concurrent_replay_survives_source_edits_without_submitting_again(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(self.submit) for _ in range(2)]
            results = [self.ok(future.result(timeout=10), 201) for future in futures]
        task = results[0]
        self.assertEqual(results[1]["series"]["id"], task["series"]["id"])
        self.assertEqual(results[1]["job_id"], task["job_id"])
        self.assertEqual(len(self.ctx.engine.list()), 1)
        self.ctx.store.update_episode(
            task["episode"]["id"], lambda episode: setattr(episode, "panels", [])
        )
        again = self.ok(self.submit(), 201)
        self.assertEqual(again["job_id"], task["job_id"])
        self.assertEqual(self.submit(generation={"width": 1024}).status_code, 409)
        self.assertEqual(self.submit(adopt_first=False).status_code, 409)
        self.ctx.engine.delete(task["job_id"])
        self.assertEqual(self.submit().status_code, 404)
        self.assertFalse(self.ctx.engine.list())

    def test_retry_after_planning_error_uses_the_same_assembly(self):
        with patch.object(self.ctx.render, "render", side_effect=RenderError("source unavailable")):
            first = self.ok(self.submit(), 201)
        self.assertEqual(first["start_error"], "source unavailable")
        self.assertIsNone(first["job_id"])
        self.assertFalse(self.ctx.engine.list())
        again = self.ok(self.submit(), 201)
        self.assertEqual(first["series"]["id"], again["series"]["id"])
        self.assertEqual(first["episode"]["id"], again["episode"]["id"])
        self.assertIsNotNone(again["job_id"])
        self.assertIsNone(again["start_error"])
