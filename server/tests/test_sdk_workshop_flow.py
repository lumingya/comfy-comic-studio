"""The generated standard-library SDK drives an isolated real FastAPI workspace."""

from __future__ import annotations

import io
import urllib.error
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit
from urllib.response import addinfourl

from PIL import Image

from mio_server.pipeline.render import RenderError

from .api_harness import ApiCase, zip_names
from .test_album import metadata
from .test_client_runtime import load_client


class SDKWorkshopFlowTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty"
        self.module = load_client()
        self.requests = []
        bridge = patch.object(self.module.urllib.request, "urlopen", side_effect=self.request)
        bridge.start()
        self.addCleanup(bridge.stop)
        self.mio = self.sdk("read", "write", "render")

    def sdk(self, *scopes):
        token = ""
        if scopes:
            issued = self.ok(
                self.client.post("/api/tokens", json={"name": "SDK test", "scopes": scopes}),
                201,
            )
            token = issued["token"]
        return self.module.MioClient("http://127.0.0.1", token=token)

    def request(self, request, *, timeout):
        """Replace only HTTP transport; use actual SDK encoding, routes and error decoding."""
        url = urlsplit(request.full_url)
        self.assertEqual((url.scheme, url.netloc), ("http", "127.0.0.1"))
        self.assertTrue(url.path.startswith("/api/v2/"))
        self.assertGreater(timeout, 0)
        self.requests.append((request.get_method(), url.path))
        # The fixture disables the automatic runner. Tick the real engine when the SDK polls,
        # retaining the SDK's actual wait_job deadline and polling behavior.
        if request.get_method() == "GET" and url.path.startswith("/api/v2/jobs/"):
            self.ctx.engine.tick()
        response = self.client.request(
            request.get_method(),
            request.full_url,
            headers=dict(request.header_items()),
            content=request.data,
        )
        stream = io.BytesIO(response.content)
        if response.status_code >= 400:
            raise urllib.error.HTTPError(
                request.full_url,
                response.status_code,
                response.reason_phrase,
                response.headers,
                stream,
            )
        return addinfourl(stream, response.headers, request.full_url, response.status_code)

    def board(self):
        return self.mio.create_storyboard(
            {
                "title": "Window light",
                "panels": [
                    {
                        "order": index,
                        "overrides": {"raw_prompt": "a {subject} by the {place}"},
                        "dialogues": [{"text": f"Morning {index + 1}"}],
                    }
                    for index in range(2)
                ],
            }
        )

    def assert_file(self, path, fmt):
        content = path.read_bytes()
        self.assertGreater(len(content), 50)
        if fmt == "html":
            html = content.decode("utf-8")
            self.assertIn('data-layout="gallery"', html)
            self.assertIn("default-src 'none'", html)
            self.assertEqual(metadata(html)["schema"], "mio.album-html.v1")
            self.assertIn("Morning 1", html)
            self.assertIn("Morning 2", html)
        elif fmt == "zip":
            names = zip_names(content)
            self.assertIn("manifest.json", names)
            self.assertTrue(any(name.endswith(".png") for name in names))
        elif fmt == "pdf":
            self.assertTrue(content.startswith(b"%PDF-"))
            self.assertIn(b"%%EOF", content[-1024:])
        else:
            self.assertTrue(content.startswith(b"\x89PNG"))
            with Image.open(io.BytesIO(content)) as image:
                self.assertEqual(image.format, "PNG")
                self.assertGreater(image.width, 0)
                self.assertGreater(image.height, 0)

    def test_sdk_creates_a_task_and_saves_all_sync_and_async_deliverables(self):
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
        workflow = self.mio.import_workflow({"name": "SDK ink", "graph": graph})
        board = self.board()
        preset = self.mio.create_preset(
            {"title": "Interior", "entries": [{"key": "subject", "value": "red chair"}]}
        )
        catalogs = self.mio.discover_studio(offset=0, limit=50)
        self.assertIn(board["id"], {row["id"] for row in catalogs["storyboards"]["items"]})
        self.assertIn(preset["id"], {row["id"] for row in catalogs["presets"]})
        self.assertIn(workflow["id"], {row["id"] for row in catalogs["workflows"]})
        self.assertIn("export-atelier", {row["id"] for row in catalogs["templates"]})
        self.assertTrue(catalogs["image_adapters"])
        self.assertEqual(self.mio.get_storyboard(board["id"])["title"], board["title"])
        self.assertEqual(self.mio.get_preset(preset["id"])["entries"], preset["entries"])
        controls = self.mio.workflow_loras(workflow["id"])
        group = controls["groups"][0]
        request = {
            "storyboard_id": board["id"],
            "preset_ids": [preset["id"]],
            "workflow_id": workflow["id"],
            "variables": {"place": "window"},
            "generation": {"candidates": 1},
            "adopt_first": True,
            "loras": [
                {
                    "group_key": group["key"],
                    "key": group["loras"][0]["key"],
                    "name": "ink.safetensors",
                    "enabled": False,
                }
            ],
        }
        task = self.mio.generate_workshop_task(
            request, idempotency_key="sdk-complete-book", timeout=15, poll=0.01
        )
        self.assertIsNone(task["start_error"])
        self.assertEqual(task["job"]["state"], "completed")
        self.assertEqual(len(task["job"]["items"]), 2)
        for item in task["job"]["items"]:
            self.assertEqual(item["state"], "complete")
            self.assertEqual(item["input"]["meta"]["prompt"], "a red chair by the window")
            inputs = item["input"]["stages"][0]["graph"]["2"]["inputs"]
            self.assertEqual((inputs["strength_model"], inputs["strength_clip"]), (0, 0))
        self.assertEqual(self.mio.get_workflow(workflow["id"])["graph"], graph)
        episode_id = task["episode"]["id"]
        ready = self.mio.get_episode_deliverables(episode_id)
        self.assertTrue(ready["ready"])
        self.assertEqual((ready["generated_panels"], ready["adopted_panels"]), (2, 2))
        replay = self.mio.generate_workshop_task(
            request, idempotency_key="sdk-complete-book", timeout=15, poll=0.01
        )
        self.assertEqual(replay["job_id"], task["job_id"])
        with self.assertRaises(self.module.MioError) as caught:
            self.mio.generate_workshop_task(
                {**request, "title": "Changed intent"},
                idempotency_key="sdk-complete-book",
                timeout=15,
                poll=0.01,
            )
        self.assertEqual((caught.exception.status, caught.exception.kind), (409, "conflict"))
        for background in (False, True):
            for fmt in ("html", "pdf", "zip", "png"):
                with self.subTest(background=background, format=fmt):
                    destination = Path(self.tmp) / f"book-{background}.{fmt}"
                    saved = self.mio.save_episode_deliverable(
                        episode_id,
                        destination,
                        format=fmt,
                        template_id="export-atelier" if fmt == "html" else None,
                        background=background,
                        idempotency_key=f"sdk-book-{fmt}" if background else None,
                        timeout=15,
                        poll=0.01,
                    )
                    self.assertEqual(saved, destination)
                    self.assert_file(destination, fmt)

    def test_sdk_preserves_401_and_scope_errors_without_creating_a_task(self):
        board = self.board()
        before = len(self.ctx.store.list_series())
        with self.assertRaises(self.module.MioError) as caught:
            self.sdk().discover_studio()
        self.assertEqual((caught.exception.status, caught.exception.kind), (401, "unauthorized"))
        with self.assertRaises(self.module.MioError) as caught:
            self.sdk("read").create_storyboard({"title": "Unauthorized", "panels": []})
        self.assertEqual((caught.exception.status, caught.exception.kind), (403, "forbidden"))
        for scopes in (("read",), ("write",), ("render",), ("admin",)):
            with self.subTest(scopes=scopes), self.assertRaises(self.module.MioError) as caught:
                self.sdk(*scopes).generate_workshop_task(
                    {"storyboard_id": board["id"], "workflow_id": "builtin_t2i_sdxl"},
                    idempotency_key="must-not-mutate",
                    timeout=15,
                    poll=0.01,
                )
            self.assertEqual((caught.exception.status, caught.exception.kind), (403, "forbidden"))
        self.assertEqual(len(self.ctx.store.list_series()), before)
        self.assertFalse(self.ctx.engine.list())

    def test_pending_or_invalid_exports_do_not_create_or_replace_local_files(self):
        board = self.board()
        task = self.mio.create_workshop_task(
            {
                "storyboard_id": board["id"],
                "workflow_id": "builtin_t2i_sdxl",
                "idempotency_key": "sdk-pending-book",
            }
        )
        self.assertIsNone(task["job_id"])
        episode_id = task["episode"]["id"]
        self.assertFalse(self.mio.get_episode_deliverables(episode_id)["ready"])
        destination = Path(self.tmp) / "must-not-exist.html"
        for background in (False, True):
            with self.subTest(background=background), self.assertRaises(self.module.MioError):
                self.mio.save_episode_deliverable(
                    episode_id, destination, background=background, timeout=15, poll=0.01
                )
            self.assertFalse(destination.exists())
        count = len(self.requests)
        for options in ({"format": "invalid"}, {"format": "pdf", "template_id": "export-atelier"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.mio.save_episode_deliverable(episode_id, destination, **options)
        destination.write_bytes(b"existing work")
        with self.assertRaises(FileExistsError):
            self.mio.save_episode_deliverable(episode_id, destination)
        self.assertEqual(destination.read_bytes(), b"existing work")
        self.assertEqual(len(self.requests), count)
        self.assertFalse(self.ctx.engine.list())

    def test_planning_failure_returns_the_frozen_task_for_explicit_same_key_retry(self):
        board = self.board()
        request = {
            "storyboard_id": board["id"],
            "workflow_id": "builtin_t2i_sdxl",
            "generation": {"candidates": 1},
            "adopt_first": True,
        }
        with patch.object(self.ctx.render, "render", side_effect=RenderError("source unavailable")):
            failed = self.mio.generate_workshop_task(
                request, idempotency_key="sdk-retry", timeout=15, poll=0.01
            )
        self.assertEqual(failed["start_error"], "source unavailable")
        self.assertIsNone(failed["job_id"])
        self.assertFalse(self.ctx.engine.list())
        recovered = self.mio.generate_workshop_task(
            request, idempotency_key="sdk-retry", timeout=15, poll=0.01
        )
        self.assertEqual(recovered["series"]["id"], failed["series"]["id"])
        self.assertEqual(recovered["episode"]["id"], failed["episode"]["id"])
        self.assertEqual(recovered["job"]["state"], "completed")
        self.assertTrue(self.mio.get_episode_deliverables(recovered["episode"]["id"])["ready"])
