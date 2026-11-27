"""Extensions compose real typed operations without bypassing the HTTP contract."""

import io
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.exceptions import ResponseValidationError
from fastapi.testclient import TestClient
from PIL import Image
from starlette.requests import HTTPConnection

from mio_server.api import create_app
from mio_server.api.extension_routes import extension_guard
from mio_server.comfy import contracts
from mio_server.comfy.bindings import BindingError
from mio_server.comfy.compile import validate_plan
from mio_server.models import Episode, Panel, Series, Take
from mio_server.registry import Registry, RegistryError
from mio_server.storage import NotFound

from . import test_api_v2
from .api_harness import LOCAL, ApiCase
from .test_extensions import write_ext


class RegistryLayersTests(unittest.TestCase):
    def test_disabling_layers_and_updating_same_source_restores_original(self):
        reg = Registry()
        reg.register("layout", "default", "core")
        reg.register("layout", "default", "first", source="ext:first", replace=True)
        reg.register("layout", "default", "second", source="ext:second", replace=True)
        reg.register("layout", "default", "updated", source="ext:second", replace=True)
        self.assertEqual(len(reg.layers("layout", "default")), 3)
        reg.unregister_source("ext:first")
        self.assertEqual(reg.get("layout", "default"), "updated")
        reg.unregister_source("ext:second")
        self.assertEqual(reg.get("layout", "default"), "core")
        with self.assertRaises(RegistryError):
            reg.register("layout", "default", "duplicate")


class OperationExtensionTests(ApiCase):
    token = test_api_v2.ApiV2Tests.token
    v2 = test_api_v2.ApiV2Tests.v2

    def activate(self, code, ext="operations"):
        write_ext(self.ctx.extensions.root, ext, code, themes=[], sfx_presets={}, slice_presets=[])
        info = self.ctx.extensions.info(ext)
        return self.ctx.extensions.enable(ext, info.digest)

    def test_local_and_v2_share_wrappers_auth_validation_and_disable(self):
        self.activate("""
def activate(mio):
    @mio.operation("POST /series")
    async def prefix(next, ctx, payload):
        payload = payload.model_copy(update={"title": "Wrapped " + payload.title})
        return await next(payload=payload)
""")
        local = self.ok(self.client.post("/api/series", json={"title": "Local"}), 201)
        self.assertEqual(local["title"], "Wrapped Local")
        token = self.token("read", "write")
        opened = self.ok(self.v2("POST", "/series", token, json={"title": "Open"}), 201)
        self.assertEqual(opened["title"], "Wrapped Open")
        before = len(self.ctx.store.list_series())
        self.assertEqual(self.v2("POST", "/series", json={"title": "No token"}).status_code, 401)
        self.assertEqual(self.v2("POST", "/series", token, json={"title": []}).status_code, 422)
        self.assertEqual(len(self.ctx.store.list_series()), before)
        operations = self.ok(self.v2("GET", "/operations", token))
        operation = next(op for op in operations if op["id"] == "POST /series")
        self.assertEqual(operation["wrappers"], ["ext:operations"])
        self.assertEqual(operation["scope"], "write")
        self.ctx.extensions.disable("operations")
        plain = self.ok(self.client.post("/api/series", json={"title": "Plain"}), 201)
        self.assertEqual(plain["title"], "Plain")

    def test_wrapper_is_rechecked_after_operation_snapshot(self):
        folder = self.activate(
            """
calls = []
def activate(mio):
    @mio.operation("POST /series")
    async def prefix(next, ctx, payload):
        calls.append("called")
        result = await next(payload=payload)
        return result.model_copy(update={"title": "Wrapped " + result.title})
"""
        ).folder
        loaded = self.ctx.extensions.loaded["operations"]
        original_check = self.ctx.registry.activation_check

        def change_then_check(contribution):
            if contribution.point == "operation":
                (folder / "main.py").write_text("# changed after snapshot\n", encoding="utf-8")
            return original_check(contribution)

        with patch.object(self.ctx.registry, "activation_check", side_effect=change_then_check):
            result = self.ok(self.client.post("/api/series", json={"title": "Plain"}), 201)

        self.assertEqual(result["title"], "Plain")
        self.assertEqual(loaded.module.calls, [])

    def test_wrappers_compose_and_failure_does_not_retry_core(self):
        calls = []

        async def first(next, **arguments):
            calls.append("first")
            return await next()

        async def second(next, **arguments):
            calls.append("second")
            await next()
            raise ValueError("postprocessing failed")

        reg = self.ctx.registry
        reg.register("operation", "POST /series", first, source="test:first")
        reg.register("operation", "POST /series", second, source="test:second", replace=True)
        self.assertEqual(self.client.post("/api/series", json={"title": "Once"}).status_code, 400)
        self.assertEqual(calls, ["second", "first"])
        self.assertEqual(len(self.ctx.store.list_series()), 1)

        async def twice(next, **arguments):
            await next()
            return await next()

        reg.unregister_source("test:second")
        reg.register("operation", "POST /series", twice, source="test:twice", replace=True)
        self.assertEqual(
            self.client.post("/api/series", json={"title": "Still once"}).status_code, 400
        )
        self.assertEqual(len(self.ctx.store.list_series()), 2)

    def test_stale_lazy_import_callbacks_are_skipped_until_reenabled(self):
        folder = self.ctx.extensions.root / "operations"
        folder.mkdir(parents=True)
        (folder / "helper.py").write_text('MARKER = "approved"\n', encoding="utf-8")
        self.activate(
            """
def activate(mio):
    @mio.operation("POST /series")
    async def tag_series(next, **arguments):
        from .helper import MARKER
        result = await next()
        return result.model_copy(update={"title": result.title + "-" + MARKER})

    @mio.hook("prompt.compiled")
    def tag_prompt(value, **context):
        from .helper import MARKER
        return {**value, "positive": value["positive"] + "-" + MARKER}

    @mio.hook("take.created")
    def tag_action(payload):
        from .helper import MARKER
        payload["markers"].append(MARKER)
"""
        )

        def create_series(title):
            response = self.client.post("/api/series", json={"title": title})
            self.assertEqual(response.status_code, 201)
            return response.json()["title"]

        def compiled_prompt():
            return self.ctx.hooks.filter("prompt.compiled", {"positive": "base"})

        def action_markers():
            payload = {"markers": []}
            self.ctx.hooks.action("take.created", payload)
            return payload["markers"]

        old_operation = next(
            item
            for item in self.ctx.extensions.operation_layers("POST /series")
            if item.source == "ext:operations"
        )
        old_hook = next(
            handler
            for handler in self.ctx.hooks.handlers("prompt.compiled")
            if handler.source == "ext:operations"
        )
        old_action = next(
            handler
            for handler in self.ctx.hooks.handlers("take.created")
            if handler.source == "ext:operations"
        )
        self.assertEqual(create_series("First"), "First-approved")
        self.assertEqual(compiled_prompt(), {"positive": "base-approved"})
        self.assertEqual(action_markers(), ["approved"])

        (folder / "helper.py").write_text('MARKER = "changed"\n', encoding="utf-8")
        self.assertEqual(self.ctx.extensions.info("operations").status, "changed")
        self.assertFalse(self.ctx.extensions.is_live_activation(old_operation))
        self.assertFalse(self.ctx.extensions.is_live_activation(old_hook))
        self.assertFalse(self.ctx.extensions.is_live_activation(old_action))
        self.assertEqual(create_series("Changed"), "Changed")
        self.assertEqual(compiled_prompt(), {"positive": "base"})
        self.assertEqual(action_markers(), [])

        info = self.ctx.extensions.info("operations")
        reviewed_digest = info.digest
        self.assertEqual(self.ctx.extensions.enable("operations", info.digest).status, "active")
        self.assertFalse(self.ctx.extensions.is_live_activation(old_operation))
        self.assertFalse(self.ctx.extensions.is_live_activation(old_hook))
        self.assertFalse(self.ctx.extensions.is_live_activation(old_action))
        new_operation = next(
            item
            for item in self.ctx.extensions.operation_layers("POST /series")
            if item.source == "ext:operations"
        )
        new_hook = next(
            handler
            for handler in self.ctx.hooks.handlers("prompt.compiled")
            if handler.source == "ext:operations"
        )
        new_action = next(
            handler
            for handler in self.ctx.hooks.handlers("take.created")
            if handler.source == "ext:operations"
        )
        self.assertTrue(self.ctx.extensions.is_live_activation(new_operation))
        self.assertTrue(self.ctx.extensions.is_live_activation(new_hook))
        self.assertTrue(self.ctx.extensions.is_live_activation(new_action))
        self.assertEqual(create_series("Reviewed"), "Reviewed-changed")
        self.assertEqual(compiled_prompt(), {"positive": "base-changed"})
        self.assertEqual(action_markers(), ["changed"])

        self.ctx.extensions.disable("operations")
        self.assertFalse(self.ctx.extensions.is_live_activation(new_operation))
        self.assertFalse(self.ctx.extensions.is_live_activation(new_hook))
        self.assertFalse(self.ctx.extensions.is_live_activation(new_action))
        self.assertEqual(create_series("Disabled"), "Disabled")
        self.assertEqual(compiled_prompt(), {"positive": "base"})
        self.assertEqual(action_markers(), [])

        self.ctx.extensions.enable("operations", reviewed_digest)
        self.assertFalse(self.ctx.extensions.is_live_activation(new_operation))
        self.assertFalse(self.ctx.extensions.is_live_activation(new_hook))
        self.assertFalse(self.ctx.extensions.is_live_activation(new_action))
        self.assertEqual(create_series("Reenabled"), "Reenabled-changed")
        self.assertEqual(compiled_prompt(), {"positive": "base-changed"})
        self.assertEqual(action_markers(), ["changed"])

    def test_live_guard_fails_closed_when_extension_files_cannot_be_hashed(self):
        self.activate(
            """
def activate(mio):
    @mio.operation("POST /series")
    async def tag_series(next, **arguments):
        return await next()
"""
        )
        operation = next(
            item
            for item in self.ctx.extensions.operation_layers("POST /series")
            if item.source == "ext:operations"
        )

        with patch("mio_server.extensions.manager.digest", side_effect=OSError("unreadable")):
            self.assertFalse(self.ctx.extensions.is_live_activation(operation))

    def test_cached_layout_callback_is_rejected_after_extension_files_change(self):
        folder = self.activate(
            """
calls = []
def layout(*args, **kwargs):
    calls.append("ran")
    return "layout", {}
def activate(mio):
    mio.contribute("layout", "test.live-layout", layout)
""",
            ext="live-layout",
        ).folder
        contribution = self.ctx.registry.contribution("layout", "test.live-layout")
        self.assertEqual(contribution.invoke(contribution.value), ("layout", {}))
        calls = contribution.value.__globals__["calls"]
        self.assertEqual(calls, ["ran"])

        (folder / "main.py").write_text("# changed after approval\n", encoding="utf-8")
        with self.assertRaises(RegistryError):
            contribution.invoke(contribution.value)
        self.assertEqual(calls, ["ran"])

    def test_cached_job_executor_is_rejected_after_extension_files_change(self):
        from mio_server.jobs import ItemSpec

        from .test_jobs import drain

        folder = self.activate(
            """
lookups = []
class Executor:
    @property
    def execute(self):
        lookups.append("execute")
        return lambda ctx: {"ok": True}

def activate(mio):
    mio.job_executor("test.live-executor", Executor())
""",
            ext="live-executor",
        ).folder
        module = self.ctx.extensions.loaded["live-executor"].module
        job = self.ctx.engine.submit("test.live-executor", [ItemSpec(input={})])
        lookups_before_dispatch = list(module.lookups)

        (folder / "main.py").write_text("# changed after approval\n", encoding="utf-8")
        done = drain(self.ctx.engine, job["id"])

        self.assertEqual(done["state"], "failed")
        self.assertEqual(module.lookups, lookups_before_dispatch)

    def test_stale_comfy_state_adapter_becomes_a_binding_error(self):
        folder = self.activate(
            """
calls = []
class Adapter:
    def validate(self, state, *, nonempty=False):
        calls.append("validate")
        if not isinstance(state, dict) or (nonempty and not state):
            raise ValueError("expected object")

    def change(self, state, changes):
        return {**state, **changes}

    def capture(self, client, node):
        return {}

    def push(self, client, node, state):
        pass

def activate(mio):
    mio.contribute("comfy_state_adapter", "test.live-state", Adapter())
""",
            ext="live-state",
        ).folder
        ref = contracts.select(self.ctx.registry, "comfy_state_adapter", "test.live-state")
        graph = {"1": {"class_type": "CustomNode", "inputs": {}}}
        plan = {
            "1": {
                "adapter": ref,
                "class_type": "CustomNode",
                "saved": {"old": True},
                "changes": {"new": True},
                "desired": {"old": True, "new": True},
            }
        }
        validate_plan(graph, plan, self.ctx.registry)
        calls = self.ctx.extensions.loaded["live-state"].module.calls
        self.assertEqual(calls, ["validate", "validate"])
        (folder / "main.py").write_text("# changed after approval\n", encoding="utf-8")

        with self.assertRaises(BindingError):
            validate_plan(graph, plan, self.ctx.registry)
        self.assertEqual(calls, ["validate", "validate"])

    def test_replacement_responses_are_validated_and_failed_activation_restores_core(self):
        self.ctx.registry.register("operation", "GET /series", lambda next, **kw: "wrong")
        with self.assertRaises(ResponseValidationError):
            self.client.get("/api/series")
        self.ctx.registry.unregister("operation", "GET /series")
        original = self.ctx.registry.get("layout", "strip.default")
        result = self.activate("""
def activate(mio):
    mio.contribute("layout", "strip.default", lambda *a, **k: None, replace=True)
    raise ValueError("activation failed")
""")
        self.assertEqual(result.status, "error")
        self.assertIs(self.ctx.registry.get("layout", "strip.default"), original)

    def test_extension_routes_are_open_scoped_and_bound_to_reviewed_activation(self):
        code = """
from pydantic import BaseModel
class Input(BaseModel):
    value: int
def activate(mio):
    @mio.route("POST", "/double", scope="read")
    def double(body: Input) -> dict:
        return {"value": body.value * 2}
    @mio.router.get("/private")
    def private() -> dict:
        return {"ok": True}
"""
        self.activate(code)
        self.client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)
        read, admin = self.token("read"), self.token("admin")
        self.assertEqual(
            self.v2("POST", "/ext/operations/double", json={"value": 2}).status_code, 401
        )
        result = self.ok(self.v2("POST", "/ext/operations/double", read, json={"value": 3}))
        self.assertEqual(result, {"value": 6})
        self.assertEqual(self.v2("GET", "/ext/operations/private", read).status_code, 403)
        self.assertEqual(self.v2("GET", "/ext/operations/private", admin).status_code, 200)
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        spec = schema["paths"]["/ext/operations/double"]["post"]
        self.assertEqual(spec["security"], [{"bearer": []}])
        self.assertEqual(spec["x-mio-scope"], "read")
        old = self.ctx.extensions.loaded["operations"]
        old_guard = extension_guard(self.ctx.extensions, "operations", old, old.api.digest)
        self.ctx.extensions.disable("operations")
        self.assertEqual(
            self.v2("POST", "/ext/operations/double", read, json={"value": 3}).status_code, 404
        )
        self.ctx.extensions.enable("operations", self.ctx.extensions.info("operations").digest)
        with self.assertRaises(NotFound):
            old_guard(HTTPConnection({"type": "http", "headers": []}))
        self.assertEqual(
            self.v2("POST", "/ext/operations/double", read, json={"value": 3}).status_code, 200
        )
        path = self.ctx.extensions.root / "operations" / "main.py"
        path.write_text(code + "\n# changed", encoding="utf-8")
        self.assertEqual(
            self.v2("POST", "/ext/operations/double", read, json={"value": 3}).status_code, 404
        )

    def test_all_core_http_routes_advertise_the_same_operation_id(self):
        local = self.ok(self.client.get("/openapi.json"))["paths"]
        opened = self.ok(self.client.get("/api/v2/openapi.json"))["paths"]
        for path, methods in local.items():
            if not path.startswith("/api/"):
                continue
            for method, spec in methods.items():
                operation = f"{method.upper()} {path.removeprefix('/api')}"
                self.assertEqual(spec["x-mio-operation"], operation)
                self.assertEqual(
                    opened[path.removeprefix("/api")][method]["x-mio-operation"], operation
                )

    def test_example_exporter_and_layout_are_executed_and_restored_on_disable(self):
        source = Path(__file__).parents[2] / "examples/extensions/page-notes"
        shutil.copytree(source, self.ctx.extensions.root / "page-notes")
        info = self.ctx.extensions.info("page-notes")
        self.ctx.extensions.enable("page-notes", info.digest)
        series = self.ctx.store.create_series(Series(title="Export"))
        data = io.BytesIO()
        Image.new("RGB", (32, 32), "white").save(data, "PNG")
        asset = self.ctx.assets.put(data.getvalue())
        episode = self.ctx.store.create_episode(
            Episode(
                title="Page",
                series_id=series.id,
                order=0,
                panels=[Panel(id="p", order=0)],
                takes=[Take(panel_id="p", asset_id=asset.id, status="adopted")],
            )
        )
        original = self.ctx.registry.get("layout", "strip.default")
        calls = []

        def layout(*args, **kwargs):
            calls.append(True)
            return original(*args, **kwargs)

        self.ctx.registry.register(
            "layout", "strip.default", layout, source="ext:page-notes", replace=True
        )
        path = f"/api/episodes/{episode.id}/export?fmt=page-jpeg"
        result = self.ok(self.client.get(path))
        self.assertEqual(result.headers["content-type"], "image/jpeg")
        self.assertEqual(len(calls), 1)
        with Image.open(io.BytesIO(result.content)) as image:
            image.verify()
        self.ctx.extensions.disable("page-notes")
        self.assertIs(self.ctx.registry.get("layout", "strip.default"), original)
        self.assertEqual(self.client.get(path).status_code, 400)
