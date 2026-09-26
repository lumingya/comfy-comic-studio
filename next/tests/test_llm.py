import base64
import io
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from mio_next import llm as L

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


class FakeProxy(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, payload, raw=False):
        body = payload if raw else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/img.png":
            return self._send(200, PNG, raw=True)
        self._send(404, {})

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        server = self.server
        server.requests.append(payload)
        model = payload["model"]
        if model in ("bad", "max-broken"):
            return self._send(500, {"error": "boom"})
        if model == "empty":
            return self._send(200, {"choices": [{"message": {"content": ""}}]})
        if model == "fence":
            text = '好的：\n```json\n{"ok": 1}\n```'
        elif model == "repair":
            text = '{"ok": 0}' if len(server.requests) == 1 else '{"ok": 2}'
        elif model in ("img", "max"):
            url = f"http://127.0.0.1:{server.server_address[1]}/img.png"
            return self._send(200, {"choices": [{"message": {"content": f"![Generated Image]({url})",
                                                             "images": [{"image_url": {"url": url}}]}}]})
        else:
            text = '{"ok": 3}'
        self._send(200, {"model": model, "choices": [{"message": {"content": text}}]})


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeProxy)
        self.server.requests = []
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.client = L.Client(f"http://127.0.0.1:{self.server.server_address[1]}/v1", timeout=5, retries=0)

    def test_fallback_to_next_model_and_fenced_json(self):
        reply = self.client.chat([{"role": "user", "content": "hi"}], models=("bad", "empty", "fence"))
        self.assertEqual(reply.model, "fence")
        self.assertEqual(len(reply.attempts), 2)
        self.assertEqual(L.extract_json(reply.text), {"ok": 1})

    def test_chat_json_repairs_once(self):
        data, _ = self.client.chat_json([{"role": "user", "content": "x"}], models=("repair",),
                                        validate=lambda d: [] if d.get("ok") else ["ok 必须非零"])
        self.assertEqual(data, {"ok": 2})
        second = self.server.requests[1]["messages"]
        self.assertEqual(second[-1]["role"], "user")
        self.assertIn("ok 必须非零", second[-1]["content"])
        self.assertTrue(self.server.requests[0]["response_format"]["type"] == "json_object")

    def test_chat_json_gives_up_with_problems(self):
        with self.assertRaises(L.LLMError) as ctx:
            self.client.chat_json([{"role": "user", "content": "x"}], models=("plain",),
                                  validate=lambda d: ["永远不对"], repairs=1)
        self.assertIn("永远不对", str(ctx.exception))

    def test_generate_image_downloads_and_multi_ref_falls_back(self):
        data, reply = self.client.generate_image("apple", models=("img",))
        self.assertEqual(data, PNG)
        self.assertEqual(reply.model, "img")
        data, reply = self.client.generate_image("two", refs=[PNG, PNG], models=("max-broken", "img"))
        self.assertEqual(data, PNG)
        sent = self.server.requests[-1]["messages"][0]["content"]
        self.assertEqual(sum(1 for part in sent if part.get("type") == "image_url"), 1)  # single-ref fallback
        data, _ = self.client.generate_image("two", refs=[PNG, PNG], models=("max",))
        sent = self.server.requests[-1]["messages"][0]["content"]
        self.assertEqual(sum(1 for part in sent if part.get("type") == "image_url"), 2)

    def test_no_image_is_an_error(self):
        with self.assertRaises(L.LLMError):
            self.client.generate_image("apple", models=("plain",))


class HelperTests(unittest.TestCase):
    def test_extract_json_variants(self):
        self.assertEqual(L.extract_json('{"a": 1}'), {"a": 1})
        self.assertEqual(L.extract_json('结果如下 {"a": [1, 2]} 以上'), {"a": [1, 2]})
        self.assertEqual(L.extract_json("```\n[1, 2]\n```"), [1, 2])
        with self.assertRaises(L.LLMError):
            L.extract_json("没有 JSON")

    def test_image_urls_from_markdown_and_images_field(self):
        msg = {"content": "![a](http://x/1.png) and ![b](http://x/2.png)", "images": [{"image_url": {"url": "http://x/1.png"}}]}
        self.assertEqual(L.image_urls(msg), ["http://x/1.png", "http://x/2.png"])

    def test_image_part_downscales_to_jpeg(self):
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (2000, 1000), "red").save(buf, "PNG")
        part = L.image_part(buf.getvalue(), max_side=500)
        url = part["image_url"]["url"]
        self.assertTrue(url.startswith("data:image/jpeg;base64,"))
        im = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))
        self.assertEqual(im.size, (500, 250))


if __name__ == "__main__":
    unittest.main()
