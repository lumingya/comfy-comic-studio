import base64
import hashlib
import json
import struct
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from mio_server.comfy.client import ComfyClient, ComfyError, describe_prompt_error, parse_preview
from mio_server.comfy.ws import (
    GUID,
    OP_BINARY,
    OP_CLOSE,
    OP_CONT,
    OP_PING,
    OP_PONG,
    OP_TEXT,
    encode_frame,
)


class FakeComfy(BaseHTTPRequestHandler):
    """Tiny ComfyUI stand-in. ``scenario`` on the server selects ok / error / no-ws."""

    def log_message(self, *args):
        pass

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        server = self.server
        if self.path == "/prompt":
            payload = json.loads(body)
            if any(n.get("class_type") == "Broken" for n in payload["prompt"].values()):
                return self._json(
                    400,
                    {
                        "error": {"message": "Prompt outputs failed validation", "details": ""},
                        "node_errors": {
                            "5": {
                                "class_type": "Broken",
                                "errors": [
                                    {
                                        "message": "Value not in list",
                                        "details": "ckpt_name: 'x' not in []",
                                    }
                                ],
                            }
                        },
                    },
                )
            server.submitted.append(payload)
            server.queued.set()
            return self._json(200, {"prompt_id": "p1", "number": 1})
        if self.path == "/upload/image":
            server.uploads.append(body)
            return self._json(200, {"name": "ref.png", "subfolder": "mio", "type": "input"})
        if self.path == "/interrupt":
            return self._json(200, {})
        if self.path == "/danbooru_gallery/pcp/save_config":
            payload = json.loads(body)
            server.pcp[str(payload["node_id"])] = payload["parameters"]
            server.pcp_log.append((str(payload["node_id"]), payload["parameters"]))
            return self._json(200, {"status": "success"})
        self._json(404, {})

    def do_GET(self):
        server = self.server
        if self.path.startswith("/ws"):
            if server.scenario == "no-ws":
                return self._json(404, {})
            return self._websocket()
        if self.path.startswith("/danbooru_gallery/pcp/load_config"):
            node_id = self.path.split("node_id=", 1)[1]
            return self._json(200, {"status": "success", "parameters": server.pcp.get(node_id, [])})
        if self.path.startswith("/history/p1") and getattr(server, "history_delay", 0):
            server.history_calls = getattr(server, "history_calls", 0) + 1
            if server.history_calls <= server.history_delay:
                return self._json(200, {})
        if self.path.startswith("/history/p1"):
            status = {
                "status_str": "error" if server.scenario == "error" else "success",
                "completed": True,
            }
            outputs = getattr(server, "history_outputs", None) or {
                "9": {"images": [{"filename": "a.png", "subfolder": "", "type": "output"}]},
                "50": {"images": [{"filename": "draft.png", "subfolder": "", "type": "temp"}]},
                "70": {"text": ["1girl, adult, seaside"]},
            }
            return self._json(200, {"p1": {"status": status, "outputs": outputs}})
        if self.path.startswith("/view"):
            data = getattr(server, "view_bytes", None) or b"PNG:" + self.path.encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._json(404, {})

    def _websocket(self):
        key = self.headers["Sec-WebSocket-Key"]
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()
        sock = self.connection

        def send(op, data, fin=True):
            sock.sendall(encode_frame(op, data, mask=False, fin=fin))

        def text(obj):
            send(OP_TEXT, json.dumps(obj).encode())

        text({"type": "status", "data": {"status": {"exec_info": {"queue_remaining": 0}}}})
        self.server.queued.wait(5)
        text({"type": "execution_start", "data": {"prompt_id": "p1"}})
        text({"type": "execution_cached", "data": {"prompt_id": "p1", "nodes": ["4"]}})
        text({"type": "executing", "data": {"prompt_id": "p1", "node": "3"}})
        send(OP_PING, b"hi")
        text({"type": "progress", "data": {"prompt_id": "p1", "node": "3", "value": 1, "max": 2}})
        send(OP_BINARY, struct.pack(">II", 1, 1) + b"\xff\xd8jpeg")
        if self.server.scenario == "error":
            text(
                {
                    "type": "execution_error",
                    "data": {
                        "prompt_id": "p1",
                        "node_id": "3",
                        "node_type": "KSampler",
                        "exception_message": "CUDA out of memory\n",
                    },
                }
            )
        else:
            half = json.dumps(
                {"type": "executing", "data": {"prompt_id": "p1", "node": "8"}}
            ).encode()
            send(OP_TEXT, half[:10], fin=False)
            send(OP_CONT, half[10:], fin=True)
            text({"type": "executing", "data": {"prompt_id": "p1", "node": None}})
        # read client frames (pong + close) and record them to check masking
        try:
            sock.settimeout(5)
            buf = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                buf += chunk
                if len(buf) >= 2 and self._has_close(buf):
                    break
            self.server.client_frames = buf
        except OSError:
            pass
        self.close_connection = True

    @staticmethod
    def _has_close(buf):
        i = 0
        while i + 2 <= len(buf):
            op, length = buf[i] & 0x0F, buf[i + 1] & 0x7F
            if op == OP_CLOSE:
                return True
            i += 2 + 4 + length
        return False


class ClientTests(unittest.TestCase):
    def start(self, scenario):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeComfy)
        server.scenario, server.submitted, server.uploads = scenario, [], []
        server.queued, server.client_frames = threading.Event(), b""
        server.pcp, server.pcp_log = {}, []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, ComfyClient(f"http://127.0.0.1:{server.server_address[1]}", timeout=5)

    def test_run_follows_websocket_events_and_collects_outputs(self):
        server, client = self.start("ok")
        events = []
        result = client.run(
            {"9": {"class_type": "SaveImage", "inputs": {}}},
            output_nodes=["9"],
            on_event=events.append,
            timeout=20,
        )
        self.assertEqual(result.prompt_id, "p1")
        self.assertTrue(result.live)
        self.assertEqual([i.filename for i in result.images], ["a.png"])
        self.assertTrue(result.images[0].data.startswith(b"PNG:/view?filename=a.png"))
        self.assertEqual(result.cached, ["4"])
        self.assertEqual(result.previews, 1)
        self.assertEqual(set(result.node_seconds), {"3", "8"})
        self.assertEqual(result.texts["70"], ["1girl, adult, seaside"])
        kinds = [e["type"] for e in events]
        self.assertIn("progress", kinds)
        preview = next(e for e in events if e["type"] == "preview")
        self.assertEqual((preview["format"], preview["data"]), ("jpeg", b"\xff\xd8jpeg"))
        self.assertEqual(server.submitted[0]["client_id"], client.client_id)
        # client frames must be masked (pong for the ping, then close)
        frames = server.client_frames
        self.assertEqual(frames[0] & 0x0F, OP_PONG)
        self.assertTrue(frames[1] & 0x80)

    def test_waits_for_history_written_after_the_success_event(self):
        server, client = self.start("ok")
        server.history_delay = 3  # first three reads: not stored yet
        result = client.run(
            {"9": {"class_type": "SaveImage", "inputs": {}}}, output_nodes=["9"], timeout=20
        )
        self.assertEqual([i.filename for i in result.images], ["a.png"])
        self.assertGreaterEqual(server.history_calls, 4)

    def test_all_outputs_when_no_filter(self):
        _, client = self.start("ok")
        result = client.run({}, timeout=20)
        self.assertEqual(sorted(i.filename for i in result.images), ["a.png", "draft.png"])

    def test_execution_error_is_reported_with_node(self):
        _, client = self.start("error")
        with self.assertRaises(ComfyError) as ctx:
            client.run({}, timeout=20)
        self.assertIn("KSampler", str(ctx.exception))
        self.assertIn("CUDA out of memory", str(ctx.exception))

    def test_falls_back_to_polling_without_websocket(self):
        _, client = self.start("no-ws")
        events = []
        result = client.run({}, output_nodes=["9"], on_event=events.append, timeout=20)
        self.assertFalse(result.live)
        self.assertEqual([i.filename for i in result.images], ["a.png"])
        self.assertTrue(any(e["type"] == "warning" for e in events))

    def test_validation_errors_are_readable(self):
        _, client = self.start("ok")
        with self.assertRaises(ComfyError) as ctx:
            client.queue_prompt({"5": {"class_type": "Broken", "inputs": {}}})
        self.assertIn("节点 5（Broken）", str(ctx.exception))
        self.assertIn("not in", str(ctx.exception))

    def test_upload_returns_loadimage_value(self):
        server, client = self.start("ok")
        self.assertEqual(client.upload_image(b"\x89PNG", "ref.png"), "mio/ref.png")
        self.assertIn(b'name="image"; filename="ref.png"', server.uploads[0])


class WebSocketTimeoutTests(unittest.TestCase):
    """A timeout in the middle of a frame (or between fragments) must not desync the stream."""

    def test_recv_survives_timeouts_mid_frame_and_between_fragments(self):
        import socket
        import time

        from mio_server.comfy.ws import WebSocket

        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        self.addCleanup(listener.close)
        port = listener.getsockname()[1]
        go = threading.Event()

        def serve():
            conn, _ = listener.accept()
            with conn:
                request = b""
                while b"\r\n\r\n" not in request:
                    request += conn.recv(4096)
                key = [
                    l.split(b":", 1)[1].strip()
                    for l in request.split(b"\r\n")
                    if l.lower().startswith(b"sec-websocket-key")
                ][0]
                accept = base64.b64encode(hashlib.sha1(key + GUID.encode()).digest())
                conn.sendall(
                    b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                    b"Sec-WebSocket-Accept: " + accept + b"\r\n\r\n"
                )
                whole = encode_frame(OP_TEXT, b'{"type": "progress"}', mask=False)
                conn.sendall(whole[:5])  # half a frame, then a pause
                go.wait(5)
                go.clear()
                conn.sendall(whole[5:])
                conn.sendall(encode_frame(OP_TEXT, b"part1-", mask=False, fin=False))
                go.wait(5)  # pause between fragments
                conn.sendall(encode_frame(OP_CONT, b"part2", mask=False, fin=True))
                time.sleep(0.2)

        threading.Thread(target=serve, daemon=True).start()
        ws = WebSocket(f"ws://127.0.0.1:{port}/ws", timeout=5)
        ws.settimeout(0.2)
        with self.assertRaises(TimeoutError):
            ws.recv()
        go.set()
        ws.settimeout(5)
        self.assertEqual(ws.recv(), '{"type": "progress"}')
        ws.settimeout(0.2)
        with self.assertRaises(TimeoutError):
            ws.recv()
        go.set()
        ws.settimeout(5)
        self.assertEqual(ws.recv(), "part1-part2")
        ws.sock.close()


class ParsingTests(unittest.TestCase):
    def test_parse_preview_variants(self):
        self.assertEqual(parse_preview(struct.pack(">II", 1, 2) + b"x")["format"], "png")
        meta = json.dumps({"image_type": "image/webp", "node_id": "3"}).encode()
        parsed = parse_preview(struct.pack(">II", 4, len(meta)) + meta + b"img")
        self.assertEqual(
            (parsed["format"], parsed["data"], parsed["meta"]["node_id"]), ("webp", b"img", "3")
        )
        self.assertEqual(parse_preview(b"abc")["type"], "binary")

    def test_describe_prompt_error_handles_garbage(self):
        self.assertIsNone(describe_prompt_error("oops"))
        self.assertIsNone(describe_prompt_error({}))


if __name__ == "__main__":
    unittest.main()
