"""Shared fixture: a real AppContext (temp dir) with fake LLM / ComfyUI behind the HTTP API."""

from __future__ import annotations

import copy
import io
import json
import tempfile
import unittest
from types import SimpleNamespace

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.context import AppContext
from mio_server.render_models import ComfyInstance

from .story_fixture import make_story
from .test_compile_executor import FakeClient
from .test_jobs import drain
from .test_render_qa import FakeVLM


class FakeComfy(FakeClient):
    def system_stats(self):
        return {"system": {"os": "fake"}, "devices": []}

    def object_info(self, node_class=None):
        return {"KSampler": {"input": {"required": {}}}}


class FakeLLM:
    """Script generation, revision and QA in one object (like the real OpenAI-compatible client)."""

    edit = None  # optional callable(story) -> story for the revise prompt

    def chat_json(self, messages, models=None, validate=None, repairs=0, **kw):
        text = messages[-1]["content"]
        if "当前剧本：\n" in text:
            story = json.loads(text.split("当前剧本：\n", 1)[1].split("\n\n修改要求：", 1)[0])
            story = (FakeLLM.edit or (lambda s: s))(copy.deepcopy(story))
        else:
            story = make_story(12)
        if validate:
            problems = validate(story)
            assert not problems, problems
        return story, SimpleNamespace(model="fake", seconds=0)

    def vision_json(self, text, images, models=None, timeout=None):
        return FakeVLM().vision_json(text, images)


class ApiCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.ctx = AppContext.create(
            tmp.name,
            autostart=False,
            llm_factory=FakeLLM,
            comfy_client_factory=FakeComfy,
            seed_instance=False,
        )
        self.addCleanup(self.ctx.close)  # runs before tmp.cleanup (LIFO) — Windows file locks
        self.ctx.store.put_doc(ComfyInstance(id="c1", base_url="http://fake", capacity=2))
        self.ctx.refresh_instances()
        FakeClient.uploads, FakeClient.graphs, FakeClient.mode = [], [], "ok"
        FakeLLM.edit = None
        self.client = TestClient(create_app(self.ctx, serve_web=False))
        self.tmp = tmp.name

    # ------------------------------------------------------------ helpers
    def ok(self, response, code=200):
        self.assertEqual(response.status_code, code, response.text)
        return (
            response.json()
            if response.content and "json" in response.headers.get("content-type", "")
            else response
        )

    def drain(self, job):
        done = drain(self.ctx.engine, job["id"])
        self.assertEqual(done["state"], "completed", done)
        return done

    def make_episode(self):
        series = self.ok(self.client.post("/api/series", json={"title": "雨夜便利店"}), 201)
        ep = self.ok(
            self.client.post(
                f"/api/series/{series['id']}/episodes/generate", json={"sentence": "雨夜的便利店"}
            ),
            201,
        )
        return series, ep

    def adopt_all(self, ep: dict) -> dict:
        """Render one candidate per panel and adopt every take."""
        eid = ep["id"]
        self.drain(self.ok(self.client.post(f"/api/episodes/{eid}/render", json={"candidates": 1})))
        ep = self.ok(self.client.get(f"/api/episodes/{eid}"))
        for take in ep["takes"]:
            ep = self.ok(self.client.post(f"/api/episodes/{eid}/takes/{take['id']}/adopt"))
        return ep


def zip_names(data: bytes) -> list[str]:
    import zipfile

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return zf.namelist()
