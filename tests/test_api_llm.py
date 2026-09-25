"""Public API: chat and vision critic through a local fake model server (no network)."""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tests.api_support import PNG_DATA_URL, ApiServerCase

RECEIVED = []


class FakeModel(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        RECEIVED.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
        if body.get("model") == "broken":
            self.send_response(401)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")
            return
        vision = isinstance(body["messages"][-1].get("content"), list)
        content = json.dumps({"score": 8.5, "passed": True, "summary": "good"}) if vision else "你好，" + body["messages"][-1]["content"]
        raw = json.dumps({"model": body.get("model"), "choices": [{"message": {"role": "assistant", "content": content}}],
                          "usage": {"total_tokens": 7}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class LlmApiTests(ApiServerCase):
    @classmethod
    def seed(cls):
        cls.model = ThreadingHTTPServer(("127.0.0.1", 0), FakeModel)
        threading.Thread(target=cls.model.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d/v1" % cls.model.server_port
        cls.store().apply(
            [{"kind": "collections", "id": "c1", "document": {"id": "c1", "title": "C"}, "expected": None},
             {"kind": "albums", "id": "b1", "expected": None, "document": {
                 "id": "b1", "title": "B", "projectId": "c1", "totalSteps": 1,
                 "steps": [{"stepIndex": 0, "caption": "海边", "prompt": "sea", "image": PNG_DATA_URL}]}}],
            settings_changes=[
                {"name": "llm", "expected": None, "document": {"baseUrl": base, "key": "sk-llm-secret", "model": "text-model"}},
                {"name": "xml", "expected": None, "document": {"separate": False, "baseUrl": base, "key": "", "model": "unused"}},
                {"name": "workspace", "expected": None, "document": {"ui": {"comfyStudio": {"settings": {"critic": {
                    "connection": "independent", "baseUrl": base, "key": "sk-vision-secret", "model": "vision-model"}}}}}}])

    @classmethod
    def tearDownClass(cls):
        cls.model.shutdown()
        cls.model.server_close()
        super().tearDownClass()

    def setUp(self):
        RECEIVED.clear()

    def test_chat_uses_saved_connection_and_key(self):
        response = self.post("/api/v1/llm/chat", {"messages": [{"role": "user", "content": "世界"}], "temperature": 0.3})
        data = self.ok(response)
        self.assertEqual((data["content"], data["scope"], data["usage"]["total_tokens"]), ("你好，世界", "llm", 7))
        self.assertEqual(RECEIVED[-1]["auth"], "Bearer sk-llm-secret")
        self.assertEqual(RECEIVED[-1]["path"], "/v1/chat/completions")
        self.assertEqual((RECEIVED[-1]["body"]["model"], RECEIVED[-1]["body"]["temperature"]), ("text-model", 0.3))
        self.assertNotIn("sk-llm-secret", response.raw.decode())
        xml = self.ok(self.post("/api/v1/llm/chat", {"scope": "xml", "messages": [{"role": "user", "content": "x"}]}))
        self.assertEqual(xml["scope"], "llm")  # xml without `separate` shares the llm connection

    def test_chat_errors(self):
        self.assertEqual(self.post("/api/v1/llm/chat", {"messages": []}).status, 400)
        self.assertEqual(self.post("/api/v1/llm/chat", {"scope": "nope", "messages": [{"role": "user", "content": "x"}]}).error["code"], "invalid_scope")
        failed = self.post("/api/v1/llm/chat", {"model": "broken", "messages": [{"role": "user", "content": "x"}]})
        self.assertEqual((failed.status, failed.error["details"]["upstreamStatus"]), (502, 401))

    def test_vision_audit_and_saved_page_critique(self):
        critique = self.ok(self.post("/api/v1/vision/audit", {"image": PNG_DATA_URL, "promptText": "看看"}))
        self.assertEqual(critique["score"], 8.5)
        self.assertEqual(RECEIVED[-1]["auth"], "Bearer sk-vision-secret")
        self.assertEqual(RECEIVED[-1]["body"]["model"], "vision-model")
        self.assertEqual(self.post("/api/v1/vision/audit", {"image": "https://evil.example/a.png"}).status, 400)

        saved = self.ok(self.post("/api/v1/albums/b1/steps/0/critique"))
        self.assertTrue(saved["critique"]["passed"])
        self.assertIn("海边", RECEIVED[-1]["body"]["messages"][-1]["content"][0]["text"])
        page = self.ok(self.get("/api/v1/albums/b1/steps/0"))
        self.assertEqual(page["critique"]["score"], 8.5)
        self.assertEqual(self.post("/api/v1/albums/b1/steps/3/critique").status, 404)


if __name__ == "__main__":
    unittest.main()
