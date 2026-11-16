"""Frozen export jobs, cancellation, file cleanup, and the existing binary API."""

import io
import json
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.context import AppContext
from mio_server.jobs import Canceled

from .api_harness import LOCAL, ApiCase, FakeComfy, FakeLLM
from .test_album import adopt_two_frames
from .test_jobs import drain


class ExportJobTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series, ep = self.make_episode()
        self.ep = adopt_two_frames(self, ep)

    def submit(self, kind="portable", **extra):
        body = {"episode_ids": [self.ep["id"]], "format": "zip", **extra}
        response = self.client.post(f"/api/export/jobs/{kind}", json=body)
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def restart(self):
        self.ctx.close()
        self.ctx = AppContext.create(
            self.tmp,
            autostart=False,
            llm_factory=FakeLLM,
            comfy_client_factory=FakeComfy,
            seed_instance=False,
        )
        self.addCleanup(self.ctx.close)
        self.client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)

    def test_documents_are_frozen_and_completed_download_is_reusable(self):
        job = self.submit(title="Frozen book", idempotency_key="export-once")
        self.assertEqual(job["owner"], self.ep["id"])
        self.ctx.store.update_episode(self.ep["id"], lambda ep: setattr(ep, "takes", []))
        again = self.submit(title="Frozen book", idempotency_key="export-once")
        self.assertEqual(job["id"], again["id"])
        changed = self.client.post(
            "/api/export/jobs/portable",
            json={
                "episode_ids": [self.ep["id"]],
                "format": "pdf",
                "title": "Frozen book",
                "idempotency_key": "export-once",
            },
        )
        self.assertEqual(changed.status_code, 409, changed.text)
        done = self.drain(job)
        self.assertEqual(done["state"], "completed", done)
        download = self.client.get(f"/api/export/jobs/{job['id']}/file")
        self.assertEqual(download.status_code, 200, download.text[:100])
        self.assertEqual(download.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["title"], "Frozen book")
            self.assertEqual(len(manifest["books"][0]["files"]), 2)
        self.assertEqual(
            self.client.get(f"/api/export/jobs/{job['id']}/file").content, download.content
        )
        folder = self.ctx.exports.root / job["id"]
        self.assertTrue(folder.exists())
        self.assertEqual(self.client.delete(f"/api/jobs/{job['id']}").status_code, 204)
        self.assertFalse(folder.exists())

    def test_simultaneous_same_key_freezes_only_once(self):
        barrier = threading.Barrier(2)
        options = {"episode_ids": [self.ep["id"]], "format": "zip"}

        def submit():
            barrier.wait(timeout=3)
            return self.ctx.exports.submit("portable", options, "concurrent-export")

        with patch.object(self.ctx.exports, "freeze", wraps=self.ctx.exports.freeze) as freeze:
            with ThreadPoolExecutor(max_workers=2) as workers:
                futures = [workers.submit(submit) for _ in range(2)]
                jobs = [future.result(timeout=5) for future in futures]
        self.assertEqual(jobs[0]["id"], jobs[1]["id"])
        self.assertEqual(freeze.call_count, 1)

    def test_public_export_permissions_and_chinese_download(self):
        def token_headers(scope):
            response = self.ok(
                self.client.post("/api/tokens", json={"name": "export", "scopes": [scope]}),
                201,
            )
            return {"Authorization": f"Bearer {response['token']}"}

        read = token_headers("read")
        write = token_headers("write")
        url = "/api/v2/export/jobs/portable"
        body = {
            "episode_ids": [self.ep["id"]],
            "format": "zip",
            "title": "雨后书店",
            "idempotency_key": "public-export",
        }
        before = len(self.ctx.engine.list())
        self.assertEqual(self.client.post(url, json=body).status_code, 401)
        self.assertEqual(self.client.post(url, json=body, headers=read).status_code, 403)
        self.assertEqual(len(self.ctx.engine.list()), before)
        job = self.ok(self.client.post(url, json=body, headers=write), 202)
        job_url = f"/api/v2/jobs/{job['id']}"
        export_url = f"/api/v2/export/jobs/{job['id']}"
        self.assertEqual(self.client.get(job_url).status_code, 401)
        self.assertEqual(self.client.get(export_url + "/file").status_code, 401)
        self.assertEqual(self.ok(self.client.get(job_url, headers=read))["state"], "queued")
        self.drain(job)
        self.assertEqual(self.ok(self.client.get(job_url, headers=read))["state"], "completed")
        download = self.client.get(export_url + "/file", headers=read)
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.headers["content-type"], "application/zip")
        disposition = unquote(download.headers["content-disposition"])
        self.assertIn("filename*=utf-8''雨后书店.zip", disposition)
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["title"], "雨后书店")
            self.assertEqual(len(manifest["books"][0]["files"]), 2)
            self.assertIn("雨后书店", archive.read("index.html").decode("utf-8"))
            for page in manifest["books"][0]["files"]:
                self.assertTrue(archive.read(page["name"]))
        self.assertEqual(self.client.delete(export_url, headers=read).status_code, 403)
        self.assertEqual(self.client.delete(job_url, headers=read).status_code, 403)
        self.assertEqual(
            self.client.get(export_url + "/file", headers=read).content, download.content
        )

    def test_restart_recovers_export_and_removes_only_unreferenced_files(self):
        completed = self.drain(self.submit(title="Finished"))
        completed_path, _ = self.ctx.exports.result(completed["id"])
        completed_bytes = completed_path.read_bytes()
        job = self.submit(title="Interrupted")
        folder = self.ctx.exports.root / job["id"]
        folder.mkdir()
        for name in ("1-1.partial", "1-1.bin", "0-0.partial"):
            (folder / name).write_bytes(b"crash residue")
        temporary = self.ctx.exports.root / "download-interrupted"
        temporary.mkdir()
        (temporary / "file").write_bytes(b"sync residue")
        with self.ctx.engine.lock, self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_items SET state = 'running', epoch = 1, attempts = 1 WHERE job_id = ?",
                (job["id"],),
            )
        self.restart()
        recovered = self.ctx.engine.get(job["id"])
        self.assertEqual(recovered["state"], "queued", recovered)
        self.assertFalse(recovered["blocked"])
        self.assertEqual(list(folder.iterdir()), [])
        self.assertFalse(temporary.exists())
        self.assertEqual(completed_path.read_bytes(), completed_bytes)
        self.drain(recovered)
        self.assertEqual(len(list(folder.iterdir())), 1)

    def test_restart_preserves_result_awaiting_delivery(self):
        job = self.submit()
        folder = self.ctx.exports.root / job["id"]
        folder.mkdir()
        received = folder / "7-1.bin"
        received.write_bytes(b"received result")
        (folder / "6-0.bin").write_bytes(b"unrecorded result")
        engine = self.ctx.engine
        with engine.lock, engine.db:
            engine.db.execute(
                "UPDATE job_items SET state = 'uncertain', epoch = 7, attempts = 1 "
                "WHERE job_id = ?",
                (job["id"],),
            )
            engine._record_delivery(engine._item_row(job["id"], 0), {"file": received.name})
        self.restart()
        self.assertEqual(received.read_bytes(), b"received result")
        self.assertEqual([p.name for p in folder.iterdir()], [received.name])

    def test_failed_attempt_cleans_partial_and_retry_keeps_snapshot(self):
        job = self.submit()
        original = self.ctx.exports.write

        def fail(snapshot, path, **kwargs):
            Path(path).write_bytes(b"partial")
            raise OSError("disk unavailable")

        with patch.object(self.ctx.exports, "write", side_effect=fail):
            drain(self.ctx.engine, job["id"])
        failed = self.ctx.engine.get(job["id"])
        self.assertEqual(failed["state"], "failed")
        self.assertEqual(list((self.ctx.exports.root / job["id"]).iterdir()), [])
        self.assertEqual(self.client.get(f"/api/export/jobs/{job['id']}/file").status_code, 409)
        folder = self.ctx.exports.root / job["id"]
        for name in ("0-0.partial", "0-0.bin"):
            (folder / name).write_bytes(b"left from a previous crash")
        self.ctx.store.update_episode(self.ep["id"], lambda ep: setattr(ep, "takes", []))
        retried = self.ok(self.client.post(f"/api/jobs/{job['id']}/retry", json={}))
        with patch.object(self.ctx.exports, "write", wraps=original):
            self.drain(retried)
        self.assertEqual(self.ctx.engine.get(job["id"])["state"], "completed")
        self.assertEqual(len(list(folder.iterdir())), 1)

    def test_cancellation_during_write_has_no_download_or_partial_file(self):
        entered, release = threading.Event(), threading.Event()

        def slow(snapshot, path, *, checkpoint, **kwargs):
            Path(path).write_bytes(b"partial")
            entered.set()
            release.wait(5)
            checkpoint()
            raise AssertionError("cancel must stop export")

        job = self.submit()
        with patch.object(self.ctx.exports, "write", side_effect=slow):
            self.ctx.engine.tick()
            self.assertTrue(entered.wait(3))
            self.ctx.exports._cleanup_job(job["id"])
            self.assertTrue(list((self.ctx.exports.root / job["id"]).glob("*.partial")))
            self.ctx.engine.cancel(job["id"])
            release.set()
            deadline = time.monotonic() + 3
            while self.ctx.engine.running and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertFalse(self.ctx.engine.running)
        self.assertEqual(self.ctx.engine.get(job["id"])["state"], "canceled")
        self.assertEqual(list((self.ctx.exports.root / job["id"]).iterdir()), [])

    def test_portable_reader_groups_chapters_with_escaped_headings(self):
        first = self.ctx.store.get_episode(self.ep["id"])
        second = first.model_copy(
            deep=True, update={"id": "ep_second", "order": first.order + 1, "title": "第二话 <雨>"}
        )
        self.ctx.store.create_episode(second)
        job = self.drain(self.submit(episode_ids=[first.id, second.id], title="两话画册"))
        path, _ = self.ctx.exports.result(job["id"])
        with zipfile.ZipFile(path) as archive:
            reader = archive.read("index.html").decode("utf-8")
            self.assertEqual(reader.count("<h2>"), 2)
            self.assertIn("<h2>第二话 &lt;雨&gt;</h2>", reader)
            self.assertLess(reader.index("images/01/"), reader.index("<h2>第二话"))
            self.assertLess(reader.index("<h2>第二话"), reader.index("images/02/"))

    def test_strip_file_writer_and_legacy_override_both_receive_expected_contract(self):
        ep = self.ep["id"]
        png = self.client.get(f"/api/episodes/{ep}/export?fmt=long")
        self.assertEqual(png.content[:8], b"\x89PNG\r\n\x1a\n")
        seen = []

        def legacy(image, strip, fmt, **kwargs):
            seen.append(image.size)
            return b"custom", "text/plain", "custom.txt"

        self.ctx.registry.register(
            "exporter",
            "long",
            legacy,
            replace=True,
            source="local",
            interface="strip",
            digest="a" * 64,
            contract=1,
        )
        response = self.client.get(f"/api/episodes/{ep}/export?fmt=long")
        self.assertEqual(response.content, b"custom")
        self.assertEqual(len(seen), 1)
        self.assertFalse(list(self.ctx.exports.root.glob("download-*")))

    def test_write_cancellation_cleans_output(self):
        snapshot = self.ctx.exports.freeze(
            "portable", {"episode_ids": [self.ep["id"]], "format": "pdf"}
        )
        path = self.ctx.exports.root / "cancel.pdf"
        checks = 0

        def checkpoint():
            nonlocal checks
            checks += 1
            if checks > 4:
                raise Canceled()

        with self.assertRaises(Canceled):
            self.ctx.exports.write(snapshot, path, checkpoint=checkpoint)
        self.assertFalse(path.exists())
