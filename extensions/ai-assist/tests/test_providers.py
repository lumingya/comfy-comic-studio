"""Protocol tests against an isolated HTTP stub; no real provider traffic."""

from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from mio_server.extensions.public import LLMError

from ..core import providers as P


def answer(content="回答", calls=None, **fields):
    return {
        "choices": [
            {
                "message": {"role": "assistant", "content": content, "tool_calls": calls, **fields},
                "finish_reason": "stop",
            }
        ]
    }


def call(call_id="c1", name="get_album", args='{"id":"a"}'):
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": args}}


class ProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.responses = []
        cls.requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.respond()

            def do_POST(self):
                self.respond()

            def respond(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                cls.requests.append(
                    {
                        "path": self.path,
                        "method": self.command,
                        "headers": self.headers,
                        "body": json.loads(raw) if raw else None,
                    }
                )
                response = cls.responses.pop(0) if cls.responses else (500, {}, {})
                status, data, headers = response
                body = data if isinstance(data, bytes) else json.dumps(data).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                for name, value in headers.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}/v1"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.responses.clear()
        self.requests.clear()
        self.channel = {
            "provider": "openai",
            "base_url": self.base,
            "model": "model-x",
            "api_key": "test-key",
        }
        self.messages = [{"role": "user", "content": "你好"}]
        self.tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_album",
                    "description": "画册",
                    "parameters": {
                        "type": "object",
                        "properties": {"id": {"type": "string"}},
                        "required": ["id"],
                    },
                },
            }
        ]

    def reply(self, data, status=200, headers=None):
        self.responses.append((status, data, headers or {}))

    def test_openai_parallel_calls_and_tool_results_round_trip(self):
        self.reply(answer(None, [call(), call("c2", "get_album", '{"id":"b"}')]))
        response = P.chat(self.channel, self.messages, self.tools)
        self.assertEqual([c["arguments"]["id"] for c in response["tool_calls"]], ["a", "b"])
        history = self.messages + [
            {"role": "assistant", **response},
            {"role": "tool", "tool_call_id": "c1", "content": '{"title":"甲"}'},
            {"role": "tool", "tool_call_id": "c2", "content": '{"title":"乙"}'},
        ]
        self.reply(answer())
        self.assertEqual(P.chat(self.channel, history, self.tools)["content"], "回答")
        req = self.requests[-1]
        self.assertEqual(req["path"], "/v1/chat/completions")
        self.assertEqual(req["headers"]["Authorization"], "Bearer test-key")
        self.assertFalse(req["body"]["stream"])
        sent = req["body"]["messages"]
        replayed = sent[1]["tool_calls"][0]
        self.assertEqual(replayed["id"], "c1")
        self.assertEqual(replayed["function"]["name"], "get_album")
        self.assertEqual(json.loads(replayed["function"]["arguments"]), {"id": "a"})
        self.assertEqual(sent[3]["tool_call_id"], "c2")

    def test_keyless_proxy_does_not_send_dummy_authorization(self):
        self.channel["api_key"] = ""
        self.channel["base_url"] += "/chat/completions/"
        self.reply(answer())
        P.chat(self.channel, self.messages, [])
        self.assertNotIn("Authorization", self.requests[0]["headers"])
        self.assertNotIn("tools", self.requests[0]["body"])
        self.assertEqual(self.requests[0]["path"], "/v1/chat/completions")

    def test_deepseek_preserves_reasoning_only_for_same_channel_and_model(self):
        self.channel["provider"] = "deepseek"
        self.reply(answer(None, [call()], reasoning_content="opaque continuation"))
        response = P.chat(self.channel, self.messages, self.tools)
        self.assertEqual(response["content"], "")
        history = self.messages + [
            {"role": "assistant", **response},
            {"role": "tool", "tool_call_id": "c1", "content": "ok"},
        ]
        self.reply(answer())
        P.chat(self.channel, history, self.tools)
        self.assertEqual(
            self.requests[-1]["body"]["messages"][1]["reasoning_content"], "opaque continuation"
        )
        self.reply(answer())
        P.chat({**self.channel, "model": "other"}, history, self.tools)
        self.assertNotIn("reasoning_content", self.requests[-1]["body"]["messages"][1])

    def test_gemini_signature_parallel_results_and_image_round_trip(self):
        self.channel.update(provider="gemini", model="models/gemini-test")
        parts = [
            {"text": "hidden", "thought": True},
            {
                "functionCall": {"id": "remote1", "name": "get_album", "args": {"id": "a"}},
                "thoughtSignature": "signature",
            },
            {"functionCall": {"name": "get_album", "args": {"id": "b"}}},
        ]
        self.reply({"candidates": [{"content": {"parts": parts}, "finishReason": "STOP"}]})
        messages = [
            {"role": "system", "content": "Be helpful"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请看图"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,aGk="}},
                ],
            },
        ]
        response = P.chat(self.channel, messages, self.tools)
        self.assertEqual(response["content"], "")
        request = self.requests[-1]
        self.assertEqual(request["path"], "/v1/models/gemini-test:generateContent")
        self.assertEqual(request["headers"]["x-goog-api-key"], "test-key")
        self.assertNotIn("Authorization", request["headers"])
        self.assertEqual(request["body"]["systemInstruction"], {"parts": [{"text": "Be helpful"}]})
        self.assertEqual(
            request["body"]["contents"][0]["parts"][1],
            {"inlineData": {"mimeType": "image/png", "data": "aGk="}},
        )
        self.assertEqual(
            request["body"]["tools"][0]["functionDeclarations"][0]["parametersJsonSchema"],
            self.tools[0]["function"]["parameters"],
        )
        history = messages + [{"role": "assistant", **response}]
        for c in response["tool_calls"]:
            history.append({"role": "tool", "tool_call_id": c["id"], "content": '["ok"]'})
        self.reply({"candidates": [{"content": {"parts": [{"text": "已读取"}]}}]})
        self.assertEqual(P.chat(self.channel, history, self.tools)["content"], "已读取")
        contents = self.requests[-1]["body"]["contents"]
        self.assertEqual(contents[1]["parts"], parts)
        self.assertEqual(len(contents[2]["parts"]), 2)
        first, second = [p["functionResponse"] for p in contents[2]["parts"]]
        self.assertEqual(
            first, {"name": "get_album", "id": "remote1", "response": {"result": ["ok"]}}
        )
        self.assertNotIn("id", second)

    def test_openai_image_is_inline_and_metadata_is_not_sent(self):
        self.reply(answer([{"type": "text", "text": "识别成功"}]))
        self.messages[0].update(
            content=[{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,aGk="}}],
            attachment_ids=["a"],
            id="message-id",
        )
        result = P.chat(self.channel, self.messages, [])
        self.assertEqual(result["content"], "识别成功")
        self.assertNotIn("attachment_ids", self.requests[0]["body"]["messages"][0])

    def test_remote_or_malformed_attachment_rejected_before_request(self):
        for url in (
            "https://private.example/image?token=secret",
            "file:///secret",
            "data:image/png;base64,===",
            "data:text/html;base64,aGk=",
        ):
            with self.subTest(url=url), self.assertRaises(LLMError) as raised:
                P.chat(
                    self.channel,
                    [
                        {
                            "role": "user",
                            "content": [{"type": "image_url", "image_url": {"url": url}}],
                        }
                    ],
                    [],
                )
            self.assertFalse(raised.exception.sent)
            self.assertNotIn("secret", str(raised.exception))
        self.assertEqual(self.requests, [])

    def test_bad_tool_arguments_or_duplicate_ids_fail_before_execution(self):
        for calls in (
            [call(args="not-json")],
            [call(args="[]")],
            [call(), call()],
            [call(name="../../x")],
            [call(args='{"value":NaN}')],
        ):
            self.reply(answer(None, calls))
            with self.assertRaises(LLMError):
                P.chat(self.channel, self.messages, self.tools)
        self.assertEqual(len(self.requests), 5)

    def test_truncated_tool_response_never_executes(self):
        body = answer(None, [call()])
        body["choices"][0]["finish_reason"] = "length"
        self.reply(body)
        with self.assertRaisesRegex(LLMError, "未完整结束"):
            P.chat(self.channel, self.messages, self.tools)

    def test_error_body_secrets_are_never_exposed_or_retried(self):
        self.reply({"error": {"message": "key=test-key signed-url=https://secret.example/"}}, 401)
        with self.assertRaises(LLMError) as raised:
            P.chat(self.channel, self.messages, [])
        self.assertEqual(raised.exception.status, 401)
        self.assertNotIn("test-key", str(raised.exception))
        self.assertNotIn("secret.example", str(raised.exception))
        self.assertEqual(len(self.requests), 1)

    def test_redirect_cannot_forward_credentials(self):
        self.reply({}, 307, {"Location": self.base + "/stolen"})
        with self.assertRaisesRegex(LLMError, "跳转"):
            P.chat(self.channel, self.messages, [])
        self.assertEqual(len(self.requests), 1)

    def test_invalid_json_and_empty_reply_have_actionable_errors(self):
        for data in (b"<html>test-key</html>", [], answer(""), {"error": "test-key"}):
            self.reply(data)
            with self.assertRaises(LLMError) as raised:
                P.chat(self.channel, self.messages, [])
            self.assertNotIn("test-key", str(raised.exception))

    def test_response_size_bound(self):
        self.reply(answer("oversize reply"))
        with patch.object(P, "MAX_RESPONSE", 10), self.assertRaisesRegex(LLMError, "大小限制"):
            P.chat(self.channel, self.messages, [])

    def test_malformed_reply_shapes_raise_protocol_error(self):
        for provider, data in (
            ("openai", {"choices": {"unexpected": "object"}}),
            ("openai", {"choices": [None]}),
            ("openai", {"choices": [{"message": "text"}]}),
            ("gemini", {"candidates": {"unexpected": "object"}}),
            ("gemini", {"candidates": [{"content": None}]}),
            ("gemini", {"candidates": [{"content": {"parts": [None]}}]}),
            ("gemini", {"candidates": [{"content": {"parts": [{"functionCall": None}]}}]}),
        ):
            with self.subTest(provider=provider, data=data):
                self.reply(data)
                with self.assertRaises(LLMError):
                    P.chat({**self.channel, "provider": provider}, self.messages, [])

    def test_invalid_endpoint_or_key_never_makes_request(self):
        for field, value in (
            ("base_url", "https://user:secret@example.com"),
            ("base_url", "https://example.com?key=secret"),
            ("base_url", "file:///etc/passwd"),
            ("api_key", "foo\nbar"),
            ("timeout", float("inf")),
            ("provider", "unknown"),
        ):
            with self.subTest(field=field), self.assertRaises(LLMError):
                P.chat({**self.channel, field: value}, self.messages, [])
        self.assertFalse(self.requests)

    def test_stop_before_send_and_after_response_never_retries(self):
        with self.assertRaises(LLMError) as raised:
            P.chat(self.channel, self.messages, [], cancel=lambda: True)
        self.assertFalse(raised.exception.sent)
        self.assertFalse(self.requests)
        self.reply(answer())
        with self.assertRaises(LLMError) as raised:
            P.chat(self.channel, self.messages, [], cancel=lambda: bool(self.requests))
        self.assertTrue(raised.exception.sent)
        self.assertEqual(len(self.requests), 1)

    def test_openai_model_discovery_paginates_and_deduplicates(self):
        self.reply({"data": [{"id": "a"}], "has_more": True, "last_id": "a"})
        self.reply({"data": [{"id": "a"}, {"id": "b", "name": "Model B"}]})
        self.assertEqual(
            P.discover_models(self.channel),
            [{"id": "a", "name": "a"}, {"id": "b", "name": "Model B"}],
        )
        self.assertEqual(self.requests[-1]["path"], "/v1/models?after=a")
        self.assertTrue(all(r["method"] == "GET" for r in self.requests))

    def test_gemini_models_filter_embedding_and_handle_paging_token(self):
        self.channel["provider"] = "gemini"
        self.reply(
            {
                "models": [
                    {
                        "name": "models/chat",
                        "displayName": "Chat",
                        "supportedGenerationMethods": ["generateContent"],
                    },
                    {"name": "models/embed", "supportedGenerationMethods": ["embedContent"]},
                ],
                "nextPageToken": "page/2",
            }
        )
        self.reply({"models": [{"name": "models/other"}]})
        self.assertEqual(
            P.discover_models(self.channel),
            [{"id": "chat", "name": "Chat"}, {"id": "other", "name": "models/other"}],
        )
        self.assertEqual(self.requests[-1]["path"], "/v1/models?pageSize=1000&pageToken=page%2F2")

    def test_model_paging_loop_does_not_run_forever(self):
        for _ in range(2):
            self.reply({"data": [{"id": "a"}], "has_more": True, "last_id": "a"})
        with self.assertRaisesRegex(LLMError, "分页重复"):
            P.discover_models(self.channel)
        self.assertEqual(len(self.requests), 2)

    def test_structured_client_parses_fenced_json_ignores_fallback_list(self):
        self.reply(answer('结果如下：\n```json\n{"title":"借阅室"}\n```'))
        value, reply = P.Client(self.channel).chat_json(self.messages, models=["unused"], repairs=4)
        self.assertEqual(value, {"title": "借阅室"})
        self.assertEqual(reply.model, "model-x")
        self.assertEqual(self.requests[0]["body"]["model"], "model-x")

    def test_structured_client_validation_does_not_issue_repair_request(self):
        self.reply(answer('{"unexpected":1}'))
        with self.assertRaisesRegex(LLMError, "未通过格式校验"):
            P.Client(self.channel).chat_json(
                self.messages, repairs=3, validate=lambda data: ["invalid"]
            )
        self.assertEqual(len(self.requests), 1)

    def test_vision_bridge_uses_channel_protocol(self):
        self.reply(answer('{"caption":"a"}'))
        value, _ = P.Client(self.channel).vision_json("describe", [b"not-a-real-image"])
        self.assertEqual(value, {"caption": "a"})
        content = self.requests[0]["body"]["messages"][0]["content"]
        self.assertEqual(content[0]["text"], "describe")
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))


if __name__ == "__main__":
    unittest.main()
