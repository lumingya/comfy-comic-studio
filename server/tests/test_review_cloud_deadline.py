"""Real loopback regressions for absolute cloud transfer deadlines and shutdown."""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import ExitStack, contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from PIL import Image

from mio_server.llm import LLMError

PACKAGE = Path(__file__).resolve().parents[2] / "examples/extensions/standard-image-channels"
SPEC = importlib.util.spec_from_file_location(
    "review_cloud_channels_fixture", PACKAGE / "main.py", submodule_search_locations=[str(PACKAGE)]
)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
TRANSPORT = sys.modules[f"{MODULE.__name__}.transport"]
PRIVATE = "synthetic-cloud-deadline-credential"
OUTPUT = io.BytesIO()
Image.new("RGB", (8, 8), (21, 42, 63)).save(OUTPUT, "PNG")
PNG = OUTPUT.getvalue()
ENCODED = base64.b64encode(PNG).decode("ascii")


@contextmanager
def local_tls():
    """Create a loopback-only CA/cert/key in TEMP, remove all files afterwards."""
    openssl = shutil.which("openssl")
    if openssl is None and (git := shutil.which("git")):
        bundled = Path(git).resolve().parent.parent / "usr/bin/openssl.exe"
        openssl = str(bundled) if bundled.is_file() else None
    if openssl is None:
        raise unittest.SkipTest("HTTPS certificate fixture requires OpenSSL CLI")
    with tempfile.TemporaryDirectory(prefix="mio-cloud-tls-") as temp:
        certificate, private = Path(temp) / "cert.pem", Path(temp) / "key.pem"
        subprocess.run(
            [
                openssl,
                "req",
                "-x509",
                "-newkey",
                "ec",
                "-pkeyopt",
                "ec_paramgen_curve:prime256v1",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=IP:127.0.0.1",
                "-out",
                str(certificate),
                "-keyout",
                str(private),
            ],
            capture_output=True,
            check=True,
            timeout=10,
        )
        server = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server.load_cert_chain(str(certificate), str(private))
        yield server, ssl.create_default_context(cafile=str(certificate))


@contextmanager
def loopback(
    *, download=False, delay=0.65, tail_delay=None, headers_only=False, tls=False, https=False
):
    """An actual socket sends a short first block, then stalls until released."""
    state = {
        "seen": [],
        "first": threading.Event(),
        "release": threading.Event(),
        "healthy": threading.Event(),
        "healthy_release": threading.Event(),
    }

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def handle(self):
            try:
                if tls:
                    self.request.recv(4096)  # Receive ClientHello, never complete TLS.
                    state["first"].set()
                    state["release"].wait(5)
                    return
                super().handle()
            except OSError:
                pass  # The regression intentionally aborts a live client socket.

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["seen"].append(("POST", dict(self.headers)))
            fast = body["prompt"] == "fast"
            healthy = body["prompt"] == "healthy"
            payload = json.dumps(
                {"data": [{"url": "/image"}]}
                if download and not fast
                else {"data": [{"b64_json": ENCODED}]}
            ).encode()
            self.respond(payload, stall=not fast and not download and not healthy, healthy=healthy)

        def do_GET(self):
            state["seen"].append(("GET", dict(self.headers)))
            self.respond(PNG, stall=True)

        def respond(self, payload, *, stall, healthy=False):
            try:
                if stall and headers_only:
                    state["first"].set()
                    state["release"].wait(5)
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Set-Cookie", f"session={PRIVATE}; Path=/")
                self.end_headers()
                if healthy:
                    self.wfile.write(payload[:1])
                    self.wfile.flush()
                    state["healthy"].set()
                    state["healthy_release"].wait(5)
                    payload = payload[1:]
                if stall:
                    time.sleep(delay)
                    self.wfile.write(payload[:1])
                    self.wfile.flush()
                    state["first"].set()
                    state["release"].wait(5 if tail_delay is None else tail_delay)
                    payload = payload[1:]
                self.wfile.write(payload)
                self.wfile.flush()
            except OSError:
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    resources = ExitStack()
    if https:
        try:
            server_context, client_context = resources.enter_context(local_tls())
            server.socket = server_context.wrap_socket(server.socket, server_side=True)
            # Only this package's factory is replaced; httpx/ssl globals stay intact.
            resources.enter_context(
                mock.patch.object(TRANSPORT, "create_ssl_context", return_value=client_context)
            )
        except BaseException:
            server.server_close()
            resources.close()
            raise
    worker = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01))
    worker.start()
    config = SimpleNamespace(
        id="review-cloud",
        kind="compatible_images",
        base_url=f"{'https' if tls or https else 'http'}://127.0.0.1:{server.server_port}",
        model="neutral-loopback",
        api_key=PRIVATE,
        width=128,
        height=192,
        negative="",
        size="",
        quality="",
        extra_options={"min_interval": 0},
    )
    state["adapter"] = MODULE.ADAPTERS["compatible_images"][0](config)
    try:
        yield state
    finally:
        state["release"].set()
        state["healthy_release"].set()
        server.shutdown()
        server.server_close()
        worker.join(2)
        resources.close()


class CloudDeadlineReviewTests(unittest.TestCase):
    def tearDown(self):
        self.assertFalse(
            [thread for thread in threading.enumerate() if thread.name == "mio-image-deadline"],
            "a completed or interrupted request left its watchdog running",
        )

    def test_short_json_block_then_stall_obeys_absolute_deadline(self):
        self.assert_stall_deadline(download=False)

    def test_short_download_block_then_stall_obeys_same_absolute_deadline(self):
        self.assert_stall_deadline(download=True)

    def test_https_json_and_download_stalls_obey_absolute_deadline(self):
        for download in (False, True):
            with self.subTest(download=download):
                self.assert_stall_deadline(download=download, https=True)

    def assert_stall_deadline(self, *, download, https=False):
        with loopback(download=download, https=https) as state:
            started = time.monotonic()
            with self.assertRaises(LLMError) as caught:
                state["adapter"].generate_image("slow", timeout=2, retries=9)
            elapsed = time.monotonic() - started
            self.assertLess(elapsed, 2.35, f"2s deadline took {elapsed:.3f}s")
            self.assertTrue(state["first"].is_set())
            self.assertTrue(caught.exception.sent)
            self.assertIn("deadline", str(caught.exception))
            self.assertEqual([method for method, _ in state["seen"]].count("POST"), 1)
            if download:
                self.assertEqual([method for method, _ in state["seen"]], ["POST", "GET"])
                headers = {key.lower(): value for key, value in state["seen"][1][1].items()}
                self.assertNotIn("authorization", headers)
                self.assertNotIn("cookie", headers)

    def test_cancel_and_scope_close_interrupt_blocked_json_download_and_headers(self):
        for stop in ("cancel", "close", "scope"):
            for phase in ("json", "download", "headers"):
                with (
                    self.subTest(stop=stop, phase=phase),
                    loopback(
                        download=phase == "download",
                        headers_only=phase == "headers",
                        delay=0,
                    ) as state,
                ):
                    current = state["adapter"]
                    result = []

                    def generate():
                        try:
                            result.append(current.generate_image("slow", timeout=3))
                        except Exception as exc:
                            result.append(exc)

                    worker = threading.Thread(target=generate)
                    worker.start()
                    self.assertTrue(state["first"].wait(1))
                    started = time.monotonic()
                    if stop == "scope":
                        current.scope.close()
                    else:
                        getattr(current, stop)()
                    worker.join(0.4)
                    returned = not worker.is_alive()
                    state["release"].set()
                    worker.join(4)
                    self.assertTrue(returned, "stop left the actual socket read blocked")
                    self.assertLess(time.monotonic() - started, 0.5)
                    self.assertIsInstance(result[0], LLMError)
                    self.assertTrue(result[0].sent)
                    self.assertIn("cancelled", str(result[0]))
                    self.assertEqual(sum(method == "POST" for method, _ in state["seen"]), 1)

    def test_timely_completion_disarms_watchdog_and_leaves_no_threads(self):
        baseline = {thread.ident for thread in threading.enumerate()}
        with loopback(delay=0.02, tail_delay=0.02) as state:
            self.assertEqual(state["adapter"].generate_image("slow", timeout=1)[0], PNG)
            # A late timer must not survive successful cleanup and affect subsequent work.
            time.sleep(1.05)
            self.assertEqual(state["adapter"].generate_image("fast", timeout=1)[0], PNG)
            self.assertEqual(sum(method == "POST" for method, _ in state["seen"]), 2)
            self.assertFalse(
                [
                    thread
                    for thread in threading.enumerate()
                    if thread.ident not in baseline and thread.name == "mio-image-deadline"
                ]
            )

    def test_tls_handshake_stall_obeys_deadline(self):
        with loopback(tls=True) as state:
            started = time.monotonic()
            with self.assertRaises(LLMError) as caught:
                state["adapter"].generate_image("slow", timeout=1.2)
            self.assertTrue(state["first"].is_set())
            self.assertLess(time.monotonic() - started, 1.5)
            self.assertIn("deadline", str(caught.exception))

    def test_tls_handshake_stall_is_interrupted_by_cancel_and_scope_close(self):
        for stop in ("cancel", "scope"):
            with self.subTest(stop=stop), loopback(tls=True) as state:
                current = state["adapter"]
                result = []

                def generate():
                    try:
                        result.append(current.generate_image("slow", timeout=3))
                    except Exception as exc:
                        result.append(exc)

                worker = threading.Thread(target=generate)
                worker.start()
                try:
                    self.assertTrue(state["first"].wait(2))
                    current.cancel() if stop == "cancel" else current.scope.close()
                    worker.join(0.4)
                    self.assertFalse(worker.is_alive(), "TLS handshake remained blocked")
                    self.assertIsInstance(result[0], LLMError)
                    self.assertIn("cancelled", str(result[0]))
                finally:
                    state["release"].set()
                    worker.join(4)

    def test_https_body_stall_is_interrupted_by_cancel_and_scope_close(self):
        for stop in ("cancel", "scope"):
            for download in (False, True):
                with (
                    self.subTest(stop=stop, download=download),
                    loopback(https=True, download=download, delay=0) as state,
                ):
                    current, result = state["adapter"], []

                    def generate():
                        try:
                            result.append(current.generate_image("slow", timeout=3))
                        except Exception as exc:
                            result.append(exc)

                    worker = threading.Thread(target=generate)
                    worker.start()
                    try:
                        self.assertTrue(state["first"].wait(2))
                        current.cancel() if stop == "cancel" else current.scope.close()
                        worker.join(0.4)
                        self.assertFalse(worker.is_alive(), "HTTPS body remained blocked")
                        self.assertIsInstance(result[0], LLMError)
                        self.assertIn("cancelled", str(result[0]))
                    finally:
                        state["release"].set()
                        worker.join(4)

    def test_concurrent_transfers_share_scope_but_not_cancelled_sockets(self):
        for stop in ("cancel", "deadline"):
            with self.subTest(stop=stop), loopback(delay=0) as state:
                slow = state["adapter"]
                healthy = type(slow)(slow.channel, scope=slow.scope)
                result, healthy_result = [], []

                def generate(current, prompt, output, timeout):
                    try:
                        output.append(current.generate_image(prompt, timeout=timeout))
                    except Exception as exc:
                        output.append(exc)

                worker = threading.Thread(target=generate, args=(slow, "slow", result, 2))
                other = threading.Thread(
                    target=generate, args=(healthy, "healthy", healthy_result, 4)
                )
                worker.start()
                other.start()
                try:
                    self.assertTrue(state["first"].wait(2))
                    self.assertTrue(state["healthy"].wait(2))
                    if stop == "cancel":
                        slow.cancel()
                    worker.join(0.4 if stop == "cancel" else 2.4)
                    self.assertFalse(worker.is_alive())
                    self.assertIsInstance(result[0], LLMError)
                    self.assertIn("cancelled" if stop == "cancel" else "deadline", str(result[0]))
                    self.assertTrue(other.is_alive(), "another transfer's socket was closed")
                    state["healthy_release"].set()
                    other.join(1)
                    self.assertFalse(other.is_alive())
                    self.assertIsInstance(healthy_result[0], tuple)
                    self.assertEqual(healthy_result[0][0], PNG)
                finally:
                    state["release"].set()
                    state["healthy_release"].set()
                    worker.join(3)
                    other.join(4)


if __name__ == "__main__":
    unittest.main()
