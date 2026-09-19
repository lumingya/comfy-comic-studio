import hashlib
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from PIL import Image
from backend.mio_media import MediaStore, link_asset
from backend.mio_export import portable_zip, pdf
from backend.providers.reliability import retry_delay, failure_summary
from backend.providers.comfyui import generate
from backend.mio_jobs import Jobs
from backend.production.queue import ProductionQueue


class ReviewReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_retry_after_numeric_date_and_backoff(self):
        from email.utils import formatdate

        self.assertEqual(retry_delay({"Retry-After": "12"}), 12)
        self.assertGreater(
            retry_delay({"Retry-After": formatdate(time.time() + 60, usegmt=True)}), 58
        )
        self.assertGreaterEqual(retry_delay({}, 3, 2), 8)
        self.assertEqual(retry_delay({"Retry-After": "999999999"}), 3600)

    def test_429_waits_without_failure_streak_even_in_continue_mode(self):
        class RateLimit(Exception):
            status = 429
            headers = {"Retry-After": "30"}

        jobs = Jobs(
            self.root, lambda _: (_ for _ in ()).throw(RateLimit("HTTP 429 test"))
        )
        self.addCleanup(jobs.close)
        jobs.control("scheduler", "pause")
        jobs.control(
            "scheduler",
            "policy",
            policy={"mode": "continue", "maxConsecutiveFailures": 1},
        )
        task = jobs.submit(
            {
                "hold": True,
                "frames": [
                    {"config": {"provider": "openai"}, "prompt": "test", "images": []}
                ],
            },
            "rate",
        )
        jobs.control(
            task["id"],
            "start",
            recovery={
                "expectedCursor": task["cursor"],
                "expectedUpdated": task["updated"],
            },
        )
        with jobs.connect() as db:
            db.execute("UPDATE settings SET value='false' WHERE key='paused'")
        before = time.time()
        jobs.step()
        for _ in range(250):
            result = jobs.get(task["id"])
            if result["ready_at"] > 0:
                break
            time.sleep(0.01)
        self.assertEqual(result["frameStates"][0]["state"], "pending")
        self.assertEqual(result["consecutive_failures"], 0)
        self.assertEqual(result["failure_limit_reached"], 0)
        self.assertGreaterEqual(result["ready_at"], before + 29)
        self.assertIn("限流", jobs.get(task["id"], False)["error"]["message"])

    def test_comfy_cancel_is_scoped_and_reaches_remote_server(self):
        cancel = threading.Event()
        reports = []
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                requests.append((self.path, body))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {"prompt_id": "owned-prompt"}
                        if self.path == "/prompt"
                        else {"cancelled": True}
                    ).encode()
                )

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"{}")

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        host = SimpleNamespace(
            MAX_IMAGE_BYTES=50 * 1024 * 1024,
            read_limited_response=lambda r, *_: r.read(),
            ProviderHTTPError=RuntimeError,
        )
        body = {
            "config": {"baseUrl": f"http://127.0.0.1:{server.server_port}"},
            "workflow": {"1": {"inputs": {}, "class_type": "Test"}},
            "_isCanceled": lambda: cancel.is_set(),
            "_checkpoint": lambda _: cancel.set(),
            "_onCancelResult": reports.append,
        }
        with self.assertRaises(InterruptedError):
            generate(body, host)
        self.assertEqual(requests[-1], ("/api/jobs/owned-prompt/cancel", {}))
        self.assertFalse(any(p == "/interrupt" for p, _ in requests))
        self.assertEqual(reports[0]["state"], "cancel_dispatched")

    def test_stream_ingest_deduplicates_and_links_without_second_write(self):
        data = io.BytesIO()
        Image.new("RGB", (1600, 900), "red").save(data, "PNG")
        raw = data.getvalue()

        class Bounded(io.BytesIO):
            def read(self, n=-1):
                if not 0 < n <= 256 * 1024:
                    raise AssertionError("unbounded read")
                return super().read(n)

        media = MediaStore(self.root)
        one = media.ingest(Bounded(raw))
        two = media.put(raw)
        self.assertEqual(one, two)
        source = self.root / "assets/images" / Path(one["url"]).name
        target = self.root / "album/images" / source.name
        link_asset(source, target)
        self.assertEqual(
            hashlib.sha256(target.read_bytes()).hexdigest(), Path(one["url"]).stem
        )
        if hasattr(source.stat(), "st_ino"):
            self.assertEqual(source.stat().st_ino, target.stat().st_ino)
        self.assertEqual(len(list(source.parent.iterdir())), 1)

    def test_webp_thumbnail_dimensions_cache_and_invalid_requests(self):
        raw = io.BytesIO()
        Image.new("RGB", (2000, 1000), "blue").save(raw, "PNG")
        media = MediaStore(self.root)
        stored = media.put(raw.getvalue())
        source = self.root / "assets/images" / Path(stored["url"]).name
        thumb = media.thumbnail(source, "300x200")
        mtime = thumb.stat().st_mtime_ns
        with Image.open(thumb) as image:
            self.assertEqual(image.format, "WEBP")
            self.assertLessEqual(image.width, 320)
            self.assertLessEqual(image.height, 256)
        from unittest.mock import patch

        with patch(
            "PIL.Image.open",
            side_effect=AssertionError("cached thumbnail must not decode again"),
        ):
            cached = media.thumbnail(source, "300x200")
        self.assertGreaterEqual(
            cached.stat().st_mtime_ns, mtime
        )  # Cache hit updates LRU time.
        for size in ["1x1", "9999x9999", "../../x"]:
            with self.assertRaises(ValueError):
                media.thumbnail(source, size)

    def test_zip_above_inline_budget_keeps_binary_originals(self):
        source = self.root / "big.png"
        Image.new("RGB", (20, 20), "green").save(source)
        with source.open("ab") as f:
            f.truncate(5 * 1024 * 1024)
        book = {"title": "<script>not executable</script>"}
        frames = [({"name": str(i), "caption": "台词"}, source) for i in range(27)]
        target = self.root / "large.zip"
        portable_zip([(book, frames)], target)
        self.assertGreater(target.stat().st_size, 128 * 1024 * 1024)
        with zipfile.ZipFile(target) as z:
            text = z.read("index.html").decode()
            self.assertNotIn("data:image", text)
            self.assertIn("&lt;script&gt;", text)
            self.assertEqual(
                len([n for n in z.namelist() if n.startswith("images/")]), 27
            )
            self.assertEqual(z.read("images/001-0001.png"), source.read_bytes())
            self.assertIsNone(z.testzip())

    def test_pdf_is_multipage_with_valid_cross_reference_offsets(self):
        source = self.root / "image.png"
        Image.new("RGB", (80, 120), "yellow").save(source)
        target = self.root / "album.pdf"
        pdf([({}, [({}, source), ({}, source)])], target)
        raw = target.read_bytes()
        self.assertTrue(raw.startswith(b"%PDF-1.4"))
        self.assertIn(b"/Count 2", raw)
        start = int(raw.split(b"startxref\n")[-1].splitlines()[0])
        self.assertEqual(raw[start : start + 4], b"xref")
        lines = raw[start:].splitlines()
        count = int(lines[1].split()[1])
        self.assertEqual(count, 9)
        for number, line in enumerate(lines[3 : 3 + count - 1], 1):
            self.assertTrue(
                raw[int(line[:10]) :].startswith(f"{number} 0 obj".encode())
            )

    def test_error_summaries_distinguish_oom_and_missing_models(self):
        self.assertIn("显存不足", failure_summary("CUDA out of memory"))
        self.assertIn("缺少模型", failure_summary("Checkpoint model not found"))

    def test_restart_preserves_safe_batch_but_excludes_inflight(self):
        calls = []
        q = ProductionQueue(self.root, lambda *_: {}, lambda *_: calls.append(1))
        a = q.assemble({"story": {"frames": [{"id": "one"}]}, "presets": []}, "a", "a")
        b = q.assemble({"story": {"frames": [{"id": "two"}]}, "presets": []}, "b", "b")
        q.close()
        a.update(status="running", selection=[0])
        a["pages"][0]["state"] = "running"
        b.update(status="ready", selection=[0])
        q.tasks.set(a["id"], a)
        q.tasks.set(b["id"], b)
        q.control.update(batch=[a["id"], b["id"]], paused=False)
        q.state.set("queue", q.control)
        q = ProductionQueue(self.root, lambda *_: {}, lambda *_: calls.append(1))
        self.addCleanup(q.close)
        self.assertEqual(q.list()["batch"], [b["id"]])
        self.assertEqual(q.get(a["id"])["pages"][0]["state"], "uncertain")
        self.assertTrue(q.list()["paused"])
        self.assertEqual(calls, [])

    def test_production_checkpoint_and_sanitized_details_survive_final_commit(self):
        called = threading.Event()

        def render(task, index, cancel):
            q.report_attempt(
                task["id"],
                index,
                {
                    "upstream": "owned-id",
                    "cancelReport": {"state": "cancel_dispatched"},
                },
            )
            self.assertEqual(
                q.get(task["id"])["pages"][0]["attempts"][-1]["upstream"], "owned-id"
            )
            called.set()
            raise RuntimeError("CUDA out of memory; Authorization: Bearer top-secret")

        q = ProductionQueue(self.root, lambda *_: {}, render)
        self.addCleanup(q.close)
        task = q.assemble({"story": {"frames": [{"prompt": "x"}]}}, "Report", "report")
        q.start(task["id"], trusted=True)
        self.assertTrue(called.wait(2))
        q.close()
        task = q.get(task["id"])
        attempt = task["pages"][0]["attempts"][-1]
        self.assertEqual(attempt["upstream"], "owned-id")
        self.assertEqual(task["cancelReport"]["state"], "cancel_dispatched")
        self.assertIn("显存不足", task["error"])
        self.assertNotIn("top-secret", attempt["rawError"])
        self.assertNotIn("rawError", q.list()["tasks"][0]["pages"][0]["attempts"][-1])

    def comfy_fixture(self, exhausted=False, blocked=False):
        from backend.server import ProviderHTTPError
        from collections import Counter

        calls = Counter()
        entered = threading.Event()
        release = threading.Event()
        data = io.BytesIO()
        Image.new("RGB", (64, 64), "red").save(data, "PNG")
        raw = data.getvalue()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                calls[self.path] += 1
                self.send_response(200)
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {"prompt_id": "owned"}
                        if self.path == "/prompt"
                        else {"cancelled": True}
                    ).encode()
                )

            def do_GET(self):
                path = self.path.split("?")[0]
                calls[path] += 1
                if blocked:
                    self.send_response(200)
                    self.end_headers()
                    entered.set()
                    release.wait(5)
                    return
                if exhausted or calls[path] == 1:
                    self.send_response(429)
                    self.send_header("Retry-After", "0")
                    self.end_headers()
                    self.wfile.write(b"rate limited")
                    return
                self.send_response(200)
                self.end_headers()
                if path == "/view":
                    self.wfile.write(raw)
                else:
                    self.wfile.write(
                        json.dumps(
                            {
                                "owned": {
                                    "status": {"completed": True},
                                    "outputs": {
                                        "1": {"images": [{"filename": "x.png"}]}
                                    },
                                }
                            }
                        ).encode()
                    )

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(release.set)
        media = MediaStore(self.root)
        host = SimpleNamespace(
            MAX_IMAGE_BYTES=50 * 1024 * 1024,
            read_limited_response=lambda r, *_: r.read(),
            ProviderHTTPError=ProviderHTTPError,
            store_image_stream=media.ingest,
        )
        payload = {
            "config": {"baseUrl": f"http://127.0.0.1:{server.server_port}"},
            "workflow": {"1": {"inputs": {}, "class_type": "Test"}},
        }
        return payload, host, calls, entered

    def test_comfy_poll_and_view_429_never_resubmit_and_stream_original(self):
        payload, host, calls, _ = self.comfy_fixture()
        result = generate(payload, host)
        self.assertTrue(result["image"].startswith("/images/"))
        self.assertEqual(calls["/prompt"], 1)
        self.assertEqual(calls["/history/owned"], 2)
        self.assertEqual(calls["/view"], 2)
        self.assertEqual(
            len(list((self.root / "assets/images").glob("*.png"))), 1
        )

    def test_exhausted_comfy_poll_is_uncertain_not_new_generation(self):
        from backend.providers.comfyui import ResultUnconfirmed

        payload, host, calls, _ = self.comfy_fixture(exhausted=True)
        with self.assertRaises(ResultUnconfirmed) as caught:
            generate(payload, host)
        self.assertTrue(caught.exception.rate_limited)
        self.assertIsNone(getattr(caught.exception, "status", None))
        self.assertEqual(calls["/prompt"], 1)
        self.assertEqual(calls["/history/owned"], 6)

    def test_comfy_cancel_closes_blocked_local_read_after_scoped_interrupt(self):
        payload, host, calls, entered = self.comfy_fixture(blocked=True)
        cancel = threading.Event()
        finished = threading.Event()
        reports = []
        payload.update(_isCanceled=cancel.is_set, _onCancelResult=reports.append)

        def run():
            try:
                generate(payload, host)
            except Exception:
                pass
            finally:
                finished.set()

        threading.Thread(target=run, daemon=True).start()
        self.assertTrue(entered.wait(2))
        cancel.set()
        self.assertTrue(
            finished.wait(2), "cancel must not wait for the 600-second read timeout"
        )
        self.assertEqual(calls["/api/jobs/owned/cancel"], 1)
        self.assertEqual(reports[-1]["state"], "cancel_dispatched")
        self.assertEqual(calls["/interrupt"], 0)

    def test_thumbnail_disk_budget_evicts_old_cache_not_originals(self):
        from unittest.mock import patch
        from backend.mio_media import prune_thumbnails

        folder = self.root / "runtime/thumbnails"
        folder.mkdir(parents=True)
        files = [folder / f"{i}.webp" for i in range(4)]
        for file in files:
            file.write_bytes(b"x" * 80)
        original = self.root / "original.png"
        original.write_bytes(b"original")
        with patch("backend.mio_media.THUMB_CACHE_BYTES", 170), patch(
            "backend.mio_media.THUMB_CACHE_FILES", 2
        ):
            prune_thumbnails(folder, files[-1])
        self.assertLessEqual(sum(p.stat().st_size for p in folder.glob("*.webp")), 170)
        self.assertLessEqual(len(list(folder.glob("*.webp"))), 2)
        self.assertTrue(files[-1].exists())
        self.assertEqual(original.read_bytes(), b"original")

    def test_export_disconnect_never_appends_json_and_releases_slot(self):
        from backend.mio_export import stream_export, _export_slot
        from backend.mio_library import LibraryError

        source = self.root / "original.png"
        Image.new("RGB", (32, 32)).save(source)
        store = SimpleNamespace(
            entity=lambda *_: {
                "document": {
                    "title": "test",
                    "totalSteps": 1,
                    "steps": [{"stepIndex": 0, "image": "/images/x.png"}],
                }
            },
            image_path=lambda _: source,
        )
        handler = SimpleNamespace(
            send_response=lambda *_: None,
            send_header=lambda *_: None,
            end_headers=lambda: (_ for _ in ()).throw(BrokenPipeError()),
            send_json=lambda *_: self.fail("JSON after binary headers"),
        )
        stream_export(handler, store, {"format": "zip", "albumIds": ["book"]})
        self.assertTrue(handler.close_connection)
        self.assertTrue(_export_slot.acquire(blocking=False))
        try:
            with self.assertRaises(LibraryError):
                stream_export(handler, store, {"format": "zip", "albumIds": ["book"]})
        finally:
            _export_slot.release()

    def test_http_services_has_store_image_bytes(self):
        from backend.server import http_services
        services = http_services()
        self.assertTrue(hasattr(services, "store_image_bytes"))
        self.assertTrue(callable(services.store_image_bytes))

    def test_cloud_download_429_does_not_resubmit_paid_generation(self):
        from backend.providers.cloud import generate, ResultUnconfirmed
        from unittest.mock import patch, MagicMock
        import os

        # Upstream generation returns a URL
        post_calls = []
        download_calls = []

        class DummyResponse:
            def __init__(self, data):
                self.data = data
                self.status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass

        def fake_open(req, *args, **kwargs):
            post_calls.append(req.full_url)
            return DummyResponse(json.dumps({"data": [{"url": "https://cdn.example/gen.png"}]}).encode())

        class HTTP429(Exception):
            status = 429
            code = 429
            headers = {"Retry-After": "0"}

        def fake_fetch(url, *args, **kwargs):
            download_calls.append(url)
            raise HTTP429("Rate limit")

        services = SimpleNamespace(
            DATA_DIR=str(self.root),
            MAX_IMAGE_BYTES=50 * 1024 * 1024,
            provider_image_input=lambda src: (src, b""),
            detect_image_mime_type=lambda raw, default: "image/png",
            read_limited_response=lambda resp, *_: resp.data,
            ProviderHTTPError=Exception,
            fetch_remote_image=fake_fetch,
            store_image_bytes=lambda raw, album: "/images/saved.png",
        )

        mock_opener = MagicMock()
        mock_opener.open.side_effect = fake_open

        with patch("backend.providers.transport.opener", return_value=mock_opener):
            with self.assertRaises(ResultUnconfirmed) as caught:
                generate(
                    {
                        "config": {
                            "provider": "openai",
                            "model": "dall-e-3",
                            "baseUrl": "https://api.openai.com/v1",
                        },
                        "prompt": "a comic girl",
                        "_requestTimeout": 10,
                    },
                    services,
                )
            self.assertTrue(caught.exception.rate_limited)
            self.assertIsNone(getattr(caught.exception, "status", None))
            # Upstream generation called only ONCE!
            self.assertEqual(len(post_calls), 1)
            # Download attempted 6 times locally with backoff!
            self.assertEqual(len(download_calls), 6)

    def test_prune_thumbnails_cleans_orphan_temp_files(self):
        from backend.mio_media import prune_thumbnails
        import os

        folder = self.root / "runtime/thumbnails"
        folder.mkdir(parents=True, exist_ok=True)
        old_thumb = folder / ".thumb-12345"
        old_thumb.write_bytes(b"temp")
        old_media = folder / ".media-67890"
        old_media.write_bytes(b"temp")
        new_thumb = folder / ".thumb-recent"
        new_thumb.write_bytes(b"temp")

        # Set mtime to 15 minutes ago
        fifteen_min_ago = time.time() - 900
        os.utime(old_thumb, (fifteen_min_ago, fifteen_min_ago))
        os.utime(old_media, (fifteen_min_ago, fifteen_min_ago))

        prune_thumbnails(folder, None)

        self.assertFalse(old_thumb.exists())
        self.assertFalse(old_media.exists())
        self.assertTrue(new_thumb.exists())

    def test_restart_preserves_batch_order_and_resets_independent_ready_tasks(self):
        q = ProductionQueue(self.root, lambda *_: {}, lambda *_: {})
        t_a = q.assemble({"story": {"frames": [{"id": "a"}]}, "presets": []}, "A", "A")
        t_b = q.assemble({"story": {"frames": [{"id": "b"}]}, "presets": []}, "B", "B")
        t_c = q.assemble({"story": {"frames": [{"id": "c"}]}, "presets": []}, "C", "C")
        t_d = q.assemble({"story": {"frames": [{"id": "d"}]}, "presets": []}, "D", "D")
        q.close()

        # order is [t_a, t_b, t_c, t_d]
        # set saved_batch to reverse order [t_c, t_b]
        t_b.update(status="ready", selection=[0])
        t_c.update(status="ready", selection=[0])
        # t_a is independent ready task (not in batch, unstarted)
        t_a.update(status="ready", selection=[0])
        # t_d had started (running frame)
        t_d.update(status="ready", selection=[0])
        t_d["pages"][0]["state"] = "running"

        q.tasks.set(t_a["id"], t_a)
        q.tasks.set(t_b["id"], t_b)
        q.tasks.set(t_c["id"], t_c)
        q.tasks.set(t_d["id"], t_d)
        q.control.update(batch=[t_c["id"], t_b["id"]], paused=False)
        q.state.set("queue", q.control)

        q2 = ProductionQueue(self.root, lambda *_: {}, lambda *_: {})
        self.addCleanup(q2.close)

        # Batch order must preserve saved_batch order [t_c, t_b]!
        self.assertEqual(q2.list()["batch"], [t_c["id"], t_b["id"]])
        # Independent ready task t_a reset to standby (not interrupted!)
        self.assertEqual(q2.get(t_a["id"])["status"], "standby")
        self.assertIsNone(q2.get(t_a["id"]).get("error"))
        # Started task t_d marked as interrupted
        self.assertEqual(q2.get(t_d["id"])["status"], "interrupted")
        self.assertEqual(q2.get(t_d["id"])["pages"][0]["state"], "uncertain")
