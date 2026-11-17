"""Real HTTP, file persistence and mocked model boundaries; never invoke paid services."""

import asyncio
import io
import json
import os
import threading
import time
from unittest.mock import patch

from mio_server.api import create_app
from mio_server.auth import issue
from mio_server.context import AppContext
from PIL import Image
from tests.api_harness import ApiCase

from ..core.storage import ConversationStore


class AssistTests(ApiCase):
    def enable(self):
        info = next(
            item
            for item in self.ok(self.client.get("/api/extensions"))["items"]
            if item["id"] == "ai-assist"
        )
        self.assertTrue(info["builtin"])
        self.ok(
            self.client.post("/api/extensions/ai-assist/enable", json={"digest": info["digest"]})
        )
        self.config()

    def config(self, scopes=None, confirm=True):
        return self.ok(
            self.client.put(
                "/api/ext/ai-assist/settings",
                json={
                    "active_channel_id": "fake",
                    "channels": [
                        {
                            "id": "fake",
                            "provider": "openai",
                            "base_url": "http://fake/v1",
                            "api_key": "test-secret",
                            "model": "test",
                        }
                    ],
                    "permissions": {
                        "scopes": scopes or ["read", "write"],
                        "confirm_mutations": confirm,
                    },
                },
            )
        )

    def conversation(self):
        return self.ok(self.client.post("/api/ext/ai-assist/conversations", json={}), 201)["id"]

    def send(self, cid, key="one"):
        return self.ok(
            self.client.post(
                f"/api/ext/ai-assist/conversations/{cid}/messages",
                json={"content": "创建一本画册", "idempotency_key": key},
            ),
            202,
        )

    def settled(self, cid):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            data = self.ctx.extension_services["ai-assist"].get(cid)
            if (
                data["run"]["status"] != "running"
                and cid not in self.ctx.extension_services["ai-assist"].workers
            ):
                return data
            time.sleep(0.01)
        self.fail("AI run did not settle")

    @staticmethod
    def call(operation="POST /series", body=None):
        return {
            "content": "",
            "tool_calls": [
                {
                    "id": "function-1",
                    "name": "mio_call_operation",
                    "arguments": {
                        "operation": operation,
                        "body": body if body is not None else {"title": "测试画册"},
                    },
                }
            ],
        }

    def test_builtin_disabled_masked_and_cannot_uninstall(self):
        self.ok(self.client.get("/api/ext/ai-assist/status"), 404)
        self.ok(self.client.post("/api/ext/ai-assist/conversations", json={}), 404)
        self.enable()
        config = self.ok(self.client.get("/api/ext/ai-assist/settings"))
        self.assertNotIn("test-secret", json.dumps(config))
        self.assertIn("conversations", config["storage_path"])
        self.assertNotIn("test-secret", self.client.get("/api/extensions/ai-assist/settings").text)
        self.ok(self.client.put("/api/extensions/ai-assist/settings", json={}))
        self.ok(self.client.delete("/api/extensions/ai-assist"), 400)
        config.pop("storage_path")
        config["channels"][0]["base_url"] = "http://different/v1"
        self.ok(self.client.put("/api/ext/ai-assist/settings", json=config), 400)

    def test_chat_idempotency_and_persistence(self):
        self.enable()
        calls = []

        def chat(*args, **kwargs):
            calls.append(args)
            return {"content": "你好 test-secret", "tool_calls": []}

        self.ctx.extension_services["ai-assist"].chat = chat
        cid = self.conversation()
        first = self.send(cid)
        self.assertEqual(first["run"]["request_key"], "one")
        done = self.settled(cid)
        self.assertEqual(done["run"]["status"], "completed")
        self.assertEqual(done["messages"][-1]["content"], "你好 [redacted]")
        self.send(cid)
        self.assertEqual(len(calls), 1)
        reopened = ConversationStore(self.ctx.extension_services["ai-assist"].store.root)
        self.assertEqual(len(reopened.get(cid)["messages"]), 2)
        self.ok(
            self.client.patch(f"/api/ext/ai-assist/conversations/{cid}", json={"title": "新名称"})
        )
        receipt = self.ok(self.client.get(f"/api/ext/ai-assist/conversations/{cid}/requests/one"))
        self.assertEqual((receipt["found"], receipt["status"]), (True, "completed"))
        missing = self.ok(
            self.client.get(f"/api/ext/ai-assist/conversations/{cid}/requests/missing")
        )
        self.assertEqual((missing["found"], missing["status"]), (False, "not_found"))
        self.assertNotIn("requests", receipt["conversation"])
        self.ok(self.client.delete(f"/api/ext/ai-assist/conversations/{cid}"), 204)
        self.ok(self.client.get(f"/api/ext/ai-assist/conversations/{cid}"), 404)

    def test_real_operation_confirmation_and_no_duplicate_approval(self):
        self.enable()
        replies = iter([self.call(), {"content": "创建完成", "tool_calls": []}])
        self.ctx.extension_services["ai-assist"].chat = lambda *a, **kw: next(replies)
        cid = self.conversation()
        self.send(cid)
        waiting = self.settled(cid)
        self.assertEqual(waiting["run"]["status"], "waiting_approval")
        self.assertEqual(self.ctx.store.list_series(), [])
        call = waiting["run"]["pending_calls"][0]
        endpoint = f"/api/ext/ai-assist/conversations/{cid}/approval"
        self.ok(
            self.client.post(endpoint, json={"call_id": call["id"], "approved": True}),
            202,
        )
        done = self.settled(cid)
        self.assertEqual(done["run"]["status"], "completed", done)
        self.assertEqual(len(self.ctx.store.list_series()), 1)
        self.ok(
            self.client.post(endpoint, json={"call_id": call["id"], "approved": True}),
            202,
        )
        self.assertEqual(len(self.ctx.store.list_series()), 1)

    def test_deny_and_http_request_validation(self):
        self.enable()
        self.config(confirm=False)
        replies = iter([self.call(body={"title": 42}), {"content": "输入无效", "tool_calls": []}])
        self.ctx.extension_services["ai-assist"].chat = lambda *a, **kw: next(replies)
        cid = self.conversation()
        self.send(cid)
        done = self.settled(cid)
        receipt = done["run"]["pending_calls"][0]
        self.assertEqual(receipt["result"]["status"], 422)
        self.assertEqual(self.ctx.store.list_series(), [])

    def test_model_cannot_escalate_grants_or_read_credentials(self):
        self.enable()
        self.config(scopes=["read", "write", "render", "admin"], confirm=False)
        replies = iter(
            [
                self.call("PUT /ext/ai-assist/settings", {}),
                {"content": "未获授权", "tool_calls": []},
            ]
        )
        self.ctx.extension_services["ai-assist"].chat = lambda *a, **kw: next(replies)
        cid = self.conversation()
        self.send(cid)
        done = self.settled(cid)
        self.assertIn("未获授权", done["run"]["pending_calls"][0]["result"]["error"])
        catalog = self.ok(self.client.get("/api/ext/ai-assist/tools"))["items"]
        for item in catalog:
            if item["path"].startswith("/tokens") or (
                item["path"] == "/settings" and item["method"] != "GET"
            ):
                self.assertFalse(item["allowed"])
                self.assertFalse(item["configurable"])
                self.assertTrue(item["reason"])

    def test_receipt_survives_reopen_without_replaying_a_request(self):
        self.enable()
        service = self.ctx.extension_services["ai-assist"]
        calls = []

        def chat(*args, **kwargs):
            calls.append(1)
            return {"content": "完成", "tool_calls": []}

        service.chat = chat
        cid = self.conversation()
        self.send(cid, "first")
        self.settled(cid)
        self.send(cid, "second")
        self.settled(cid)
        service.store = ConversationStore(service.store.root)
        old = self.ok(self.client.get(f"/api/ext/ai-assist/conversations/{cid}/requests/first"))
        self.assertEqual((old["found"], old["status"]), (True, "accepted"))
        recent = self.ok(self.client.get(f"/api/ext/ai-assist/conversations/{cid}/requests/second"))
        self.assertEqual(recent["status"], "completed")
        self.send(cid, "first")
        self.assertEqual(calls, [1, 1])
        self.assertEqual(len(old["conversation"]["messages"]), 4)

    def test_safe_system_reads_remain_sanitized_and_self_disable_cannot_be_indirect(self):
        self.enable()
        self.config(scopes=["read", "write", "admin"], confirm=False)
        bridge = self.ctx.extension_services["ai-assist"].bridge
        response = asyncio.run(bridge.execute({"operation": "GET /settings"}, ["admin"]))
        self.assertEqual(response["status"], 200)
        self.assertNotIn("test-secret", json.dumps(response))
        with self.assertRaisesRegex(ValueError, "用户直接"):
            asyncio.run(
                bridge.execute(
                    {
                        "operation": "POST /extensions/{ext_id}/disable",
                        "path_parameters": {"ext_id": "ai-assist"},
                    },
                    ["admin"],
                )
            )

    def test_catalog_reads_are_available_but_code_and_secret_operations_are_human_owned(self):
        self.enable()
        service = self.ctx.extension_services["ai-assist"]
        settings = service.store.settings()
        settings.permissions.scopes = ["read", "write", "render", "admin"]
        forbidden = (
            ("POST", "/extension-market/package/install"),
            ("PUT", "/extension-market/source"),
            ("POST", "/extensions/package/enable"),
            ("PATCH", "/settings"),
            ("POST", "/tokens"),
            ("POST", "/update/download"),
            ("POST", "/backups/restore-plans/package/apply"),
        )
        settings.permissions.allow_operations = [f"{method} {path}" for method, path in forbidden]
        service.store.save_settings(settings)
        for method, path in forbidden:
            with self.subTest(path=path):
                operation = {
                    "id": f"{method} {path}",
                    "method": method,
                    "path": path,
                    "scope": "admin",
                }
                self.assertTrue(service.bridge.restriction(operation))
                self.assertFalse(service.bridge.allowed(operation))

        for method, path in (
            ("GET", "/settings"),
            ("GET", "/extension-market"),
            ("GET", "/extension-market/package"),
            ("GET", "/extensions"),
            ("GET", "/backups"),
            ("POST", "/update/check"),
            ("POST", "/backups"),
        ):
            with self.subTest(path=path):
                operation = {
                    "id": f"{method} {path}",
                    "method": method,
                    "path": path,
                    "scope": "admin",
                }
                self.assertFalse(service.bridge.restriction(operation))
                self.assertTrue(service.bridge.allowed(operation))

    def test_disabled_stops_inflight_and_keeps_images_independent(self):
        self.enable()
        entered, release = threading.Event(), threading.Event()

        def chat(*args, **kwargs):
            entered.set()
            release.wait(3)
            return self.call()

        service = self.ctx.extension_services["ai-assist"]
        service.chat = chat
        cid = self.conversation()
        self.send(cid)
        self.assertTrue(entered.wait(2))
        self.ok(self.client.delete(f"/api/ext/ai-assist/conversations/{cid}"), 409)
        self.ok(self.client.post("/api/extensions/ai-assist/disable"))
        release.set()
        release.set()
        time.sleep(0.05)
        done = service.get(cid)
        self.assertEqual(done["run"]["status"], "stopped")
        self.assertEqual(self.ctx.store.list_series(), [])
        self.assertIsNotNone(self.ctx.image_backend())

    def test_upload_and_model_image_content(self):
        self.enable()
        data = io.BytesIO()
        Image.new("RGB", (16, 16)).save(data, format="PNG")
        attachment = self.ok(
            self.client.post(
                "/api/ext/ai-assist/attachments",
                files={"file": ("image.png", data.getvalue(), "image/png")},
            ),
            201,
        )
        self.assertEqual(self.client.get(attachment["url"]).content, data.getvalue())
        messages = []

        def chat(channel, history, tools, **kwargs):
            messages.extend(history)
            return {"content": "图片已收到", "tool_calls": []}

        self.ctx.extension_services["ai-assist"].chat = chat
        cid = self.conversation()
        self.ok(
            self.client.post(
                f"/api/ext/ai-assist/conversations/{cid}/messages",
                json={
                    "content": "",
                    "attachment_ids": [attachment["id"]],
                    "idempotency_key": "image",
                },
            ),
            202,
        )
        self.settled(cid)
        self.assertTrue(
            messages[-1]["content"][-1]["image_url"]["url"].startswith("data:image/png;base64,")
        )
        self.ok(
            self.client.post(
                "/api/ext/ai-assist/attachments",
                files={"file": ("bad.png", b"not png", "image/png")},
            ),
            400,
        )

    def test_v2_scope_cannot_expand_through_chat(self):
        self.enable()
        self.config(scopes=["read", "write", "render", "admin"], confirm=False)
        token, raw = issue("limited", ["read", "write", "render"])
        self.ctx.store.put_doc(token)
        headers = {"Authorization": "Bearer " + raw}
        self.ok(self.client.get("/api/v2/ext/ai-assist/settings", headers=headers), 403)
        replies = iter(
            [
                self.call("POST /instances", {"name": "should not exist"}),
                {"content": "无权限", "tool_calls": []},
            ]
        )
        self.ctx.extension_services["ai-assist"].chat = lambda *a, **kw: next(replies)
        cid = self.conversation()
        self.ok(
            self.client.post(
                f"/api/v2/ext/ai-assist/conversations/{cid}/messages",
                headers=headers,
                json={"content": "添加服务", "idempotency_key": "remote"},
            ),
            202,
        )
        done = self.settled(cid)
        self.assertIn("未获授权", done["run"]["pending_calls"][0]["result"]["error"])

    def test_interrupted_receipt_is_not_replayed(self):
        self.enable()
        cid = self.conversation()
        data = self.ctx.extension_services["ai-assist"].store.get(cid)
        data["run"] = {"status": "running", "pending_calls": [{"status": "executing"}]}
        self.ctx.extension_services["ai-assist"].store.put(data)
        reopened = ConversationStore(self.ctx.extension_services["ai-assist"].store.root)
        restored = reopened.get(cid)
        self.assertEqual(restored["run"]["status"], "interrupted")
        self.assertEqual(restored["run"]["pending_calls"][0]["status"], "unknown")

    def test_safe_mode_skips_enabled_builtin(self):
        self.enable()
        self.ctx.extensions.unload("ai-assist")
        with patch.dict(os.environ, {"MIO_SAFE_MODE": "1"}):
            self.ctx.extensions.load_all()
        self.assertNotIn("ai-assist", self.ctx.extension_services)

    def test_rejected_call_does_not_run_or_repeat(self):
        self.enable()
        replies = iter([self.call(), {"content": "已取消", "tool_calls": []}])
        self.ctx.extension_services["ai-assist"].chat = lambda *a, **kw: next(replies)
        cid = self.conversation()
        self.send(cid)
        call = self.settled(cid)["run"]["pending_calls"][0]
        self.ok(
            self.client.post(
                f"/api/ext/ai-assist/conversations/{cid}/approval",
                json={"call_id": call["id"], "approved": False},
            ),
            202,
        )
        done = self.settled(cid)
        self.assertEqual(done["run"]["status"], "completed")
        self.assertEqual(done["run"]["pending_calls"][0]["status"], "rejected")
        self.assertEqual(self.ctx.store.list_series(), [])

    def test_one_operation_override_preserves_default_scope_and_token_ceiling(self):
        self.enable()
        cfg = self.ctx.extension_services["ai-assist"].store.settings()
        cfg.permissions.scopes = ["read"]
        cfg.permissions.allow_operations = ["POST /series"]
        self.ctx.extension_services["ai-assist"].store.save_settings(cfg)
        bridge = self.ctx.extension_services["ai-assist"].bridge
        self.assertTrue(bridge.allowed(bridge.operation("GET /series")))
        self.assertTrue(bridge.allowed(bridge.operation("POST /series")))
        self.assertFalse(bridge.allowed(bridge.operation("POST /series"), ["read"]))
        cfg.permissions.deny_operations = ["POST /series"]
        self.ctx.extension_services["ai-assist"].store.save_settings(cfg)
        self.assertFalse(bridge.allowed(bridge.operation("POST /series")))

    def test_uploaded_image_reaches_real_asset_api(self):
        self.enable()
        payload = io.BytesIO()
        Image.new("RGB", (16, 16)).save(payload, format="PNG")
        attachment = self.ctx.extension_services["ai-assist"].upload(
            payload.getvalue(), "original.png"
        )
        bridge = self.ctx.extension_services["ai-assist"].bridge
        result = asyncio.run(
            bridge.execute(
                {
                    "operation": "POST /assets",
                    "attachment_id": attachment["id"],
                    "query": {"filename": "original.png"},
                },
                ["write"],
            )
        )
        self.assertEqual(result["status"], 201)
        asset_id = result["result"]["id"]
        self.assertEqual(self.ctx.assets.read(asset_id), payload.getvalue())
        download = asyncio.run(
            bridge.execute(
                {
                    "operation": "GET /assets/{asset_id}",
                    "path_parameters": {"asset_id": asset_id},
                },
                ["read"],
            )
        )
        self.assertEqual(download["content_type"], "image/png")
        self.assertEqual(download["download_path"], f"/api/assets/{asset_id}")

    def test_unknown_mutation_result_stops_without_retry(self):
        self.enable()
        self.config(confirm=False)
        count = []

        def chat(*args, **kwargs):
            count.append(1)
            return self.call()

        self.ctx.extension_services["ai-assist"].chat = chat
        original = self.ctx.extension_services["ai-assist"].bridge.execute

        async def lost_response(args, scopes):
            await original(args, scopes)
            raise RuntimeError("response lost")

        self.ctx.extension_services["ai-assist"].bridge.execute = lost_response
        cid = self.conversation()
        self.send(cid)
        done = self.settled(cid)
        self.assertEqual(done["run"]["status"], "failed")
        self.assertEqual(done["run"]["pending_calls"][0]["status"], "unknown")
        self.assertEqual(len(self.ctx.store.list_series()), 1)
        self.assertEqual(len(count), 1)
        self.send(cid)
        self.assertEqual(len(self.ctx.store.list_series()), 1)

    def test_actual_operation_wrapper_runs_once(self):
        self.enable()
        calls = []

        async def wrap(next_operation, **arguments):
            calls.append(arguments["payload"].title)
            return await next_operation()

        self.ctx.registry.register("operation", "POST /series", wrap, source="test")
        result = asyncio.run(
            self.ctx.extension_services["ai-assist"].bridge.execute(
                {"operation": "POST /series", "body": {"title": "wrapped"}}, ["write"]
            )
        )
        self.assertEqual(result["status"], 201)
        self.assertEqual(calls, ["wrapped"])

    def test_permissions_rechecked_after_approval(self):
        self.enable()
        replies = iter([self.call(), {"content": "无权限", "tool_calls": []}])
        self.ctx.extension_services["ai-assist"].chat = lambda *a, **kw: next(replies)
        cid = self.conversation()
        self.send(cid)
        call = self.settled(cid)["run"]["pending_calls"][0]
        self.config(scopes=["read"])
        self.ok(
            self.client.post(
                f"/api/ext/ai-assist/conversations/{cid}/approval",
                json={"call_id": call["id"], "approved": True},
            ),
            202,
        )
        self.assertEqual(self.settled(cid)["run"]["pending_calls"][0]["status"], "failed")
        self.assertEqual(self.ctx.store.list_series(), [])

    def test_extension_operation_is_discovered_and_requires_exact_grant(self):
        from tests.test_extensions import write_ext

        self.enable()
        write_ext(self.ctx.extensions.root)
        info = self.ctx.extensions.info("demo")
        self.ctx.extensions.enable("demo", info.digest)
        create_app(self.ctx, serve_web=False)
        bridge = self.ctx.extension_services["ai-assist"].bridge
        operation = bridge.operation("GET /ext/demo/hello")
        self.assertFalse(bridge.allowed(operation))
        config = self.ctx.extension_services["ai-assist"].store.settings()
        config.permissions.allow_operations = [operation["id"]]
        self.ctx.extension_services["ai-assist"].store.save_settings(config)
        response = asyncio.run(bridge.execute({"operation": operation["id"]}, ["admin"]))
        self.assertEqual(response["result"]["hi"], "demo")
        self.ctx.extensions.disable("demo")
        with self.assertRaises(ValueError):
            asyncio.run(bridge.execute({"operation": operation["id"]}, ["admin"]))

    def test_default_text_client_is_gated_but_image_client_is_not(self):
        import tempfile

        with tempfile.TemporaryDirectory() as root:
            ctx = AppContext.create(root, autostart=False, seed_instance=False)
            try:
                with self.assertRaisesRegex(Exception, "文本模型"):
                    ctx.llm_factory()
                self.assertIsNotNone(ctx.image_backend())
                executor = ctx.registry.get("job_executor", "cloud.render")
                self.assertIsNotNone(executor.llm_factory())
                info = ctx.extensions.info("ai-assist")
                ctx.extensions.enable("ai-assist", info.digest)
                self.assertTrue(ctx.extension_services["ai-assist"].enabled)
            finally:
                ctx.close()

    def test_server_error_after_mutation_does_not_continue_model_loop(self):
        self.enable()
        self.config(confirm=False)
        replies = []

        def chat(*args, **kwargs):
            replies.append(1)
            return self.call()

        self.ctx.extension_services["ai-assist"].chat = chat

        async def server_error(args, scopes):
            return {"status": 500, "result": {"detail": "unknown outcome"}}

        self.ctx.extension_services["ai-assist"].bridge.execute = server_error
        cid = self.conversation()
        self.send(cid)
        done = self.settled(cid)
        self.assertEqual(done["run"]["status"], "failed")
        self.assertEqual(done["run"]["pending_calls"][0]["status"], "unknown")
        self.assertEqual(len(replies), 1)
