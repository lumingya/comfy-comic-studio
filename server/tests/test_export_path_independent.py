"""Independent restore guards validate Mio identities without reserving opaque JSON keys."""

import json
import os
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from mio_server.backups.database import validate_databases
from mio_server.exporting import ExportService
from mio_server.jobs import JobEngine
from mio_server.jobs.types import SCHEMA as JOB_SCHEMA
from mio_server.pipeline.providers import ImageChannel
from mio_server.render_models import WorkflowDoc
from mio_server.settings import AppSettings
from mio_server.storage import SQLiteStore


class IndependentRestoredIdentityTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore(":memory:")
        self.addCleanup(self.store.close)
        self.jobs = sqlite3.connect(":memory:")
        self.jobs.row_factory = sqlite3.Row
        self.jobs.executescript(JOB_SCHEMA)
        self.addCleanup(self.jobs.close)

    def insert_job(self, identifier):
        self.jobs.execute("DELETE FROM jobs")
        self.jobs.execute(
            "INSERT INTO jobs(id,kind,state,snapshot_json,snapshot_sha,created,updated) "
            "VALUES (?, 'export.render', 'completed', '{}', 'sha', 0, 0)",
            (identifier,),
        )
        self.jobs.commit()

    def test_opaque_workflow_and_cloud_options_do_not_reserve_mio_identity_keys(self):
        opaque = {
            "job_id": "external-request-123",
            "active_job": "external-session",
            "job_ids": ["provider-batch-a", "provider-batch-b"],
        }
        self.store.put_doc(
            WorkflowDoc(
                id="wf_external",
                name="External request source",
                graph={"1": {"class_type": "ExternalImageJob", "inputs": opaque}},
            )
        )
        self.store.put_doc(
            AppSettings(
                image_channels=[ImageChannel(id="external", kind="example", extra_options=opaque)]
            )
        )
        counts, _ = validate_databases(self.store._conn, self.jobs)
        self.assertEqual(counts["job_count"], 0)
        self.assertEqual(self.store.get_doc("workflow", "wf_external").graph["1"]["inputs"], opaque)
        self.assertEqual(
            self.store.get_doc("settings", "app").image_channels[0].extra_options, opaque
        )

    def test_actual_job_identifiers_reject_path_forms_and_accept_generated_legacy_shapes(self):
        for identifier in ("job_1", "job_a1", "job_0123456789abcdef", "job_" + "f" * 60):
            self.insert_job(identifier)
            with self.subTest(identifier=identifier):
                counts, _ = validate_databases(self.store._conn, self.jobs)
                self.assertEqual(counts["job_count"], 1)
        for identifier in ("../neutral", "C:\\neutral", "/neutral", "job_a/../neutral", "job_a."):
            self.insert_job(identifier)
            with (
                self.subTest(identifier=identifier),
                self.assertRaisesRegex(ValueError, "job identifier"),
            ):
                validate_databases(self.store._conn, self.jobs)

    def test_opaque_executor_payload_job_id_does_not_become_a_filesystem_reference(self):
        self.insert_job("job_a1")
        self.jobs.execute(
            "UPDATE jobs SET kind = 'example.render', snapshot_json = ?",
            (json.dumps({"custom_provider": {"job_id": "upstream-request"}}),),
        )
        self.jobs.commit()
        self.assertEqual(validate_databases(self.store._conn, self.jobs)[0]["job_count"], 1)


class IndependentExportHardlinkTests(unittest.TestCase):
    def test_reparse_directory_metadata_blocks_all_job_path_operations(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary).resolve()
            engine = JobEngine(":memory:", autostart=False)
            self.addCleanup(engine.close)
            service = ExportService(SimpleNamespace(data_dir=workspace, engine=engine))
            folder = service.root / "job_a1"
            folder.mkdir()
            leaf = folder / "1-1.bin"
            leaf.write_bytes(b"retained neutral content")
            original = Path.lstat

            def reparse(path, *args, **kwargs):
                attrs = original(path, *args, **kwargs)
                if path == folder:
                    return SimpleNamespace(
                        st_mode=attrs.st_mode,
                        st_nlink=attrs.st_nlink,
                        st_file_attributes=stat.FILE_ATTRIBUTE_REPARSE_POINT,
                    )
                return attrs

            item = SimpleNamespace(job_id="job_a1", epoch=1, attempt=1, on_abort=Mock())
            with (
                patch.object(Path, "lstat", new=reparse),
                patch.object(engine, "get") as get,
                patch.object(service, "write") as write,
            ):
                for operation in (
                    lambda: service.result("job_a1"),
                    lambda: service.execute(item),
                    lambda: service._cleanup_job("job_a1"),
                    lambda: service.remove("job_a1"),
                ):
                    with self.assertRaises(ValueError):
                        operation()
                service._unlink_output(leaf)
                service.cleanup_startup()
                get.assert_not_called()
                write.assert_not_called()
            self.assertEqual(leaf.read_bytes(), b"retained neutral content")

    def test_output_hardlink_is_rejected_before_read_write_and_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary).resolve()
            workspace = base / "workspace"
            workspace.mkdir()
            sentinel = base / "neutral.bin"
            sentinel.write_bytes(b"temporary neutral content")
            engine = JobEngine(":memory:", autostart=False)
            self.addCleanup(engine.close)
            service = ExportService(SimpleNamespace(data_dir=workspace, engine=engine))
            folder = service.root / "job_a1"
            folder.mkdir()
            leaf = folder / "1-1.bin"
            try:
                os.link(sentinel, leaf)
            except (OSError, NotImplementedError):
                self.skipTest("this host cannot create a temporary hard link")
            result = {
                "kind": "export.render",
                "state": "completed",
                "items": [{"result": {"file": leaf.name}}],
            }
            item = SimpleNamespace(job_id="job_a1", epoch=1, attempt=1, on_abort=Mock())
            with (
                patch.object(engine, "get", return_value=result),
                patch.object(service, "write") as write,
            ):
                with self.assertRaises(ValueError):
                    service.result("job_a1")
                with self.assertRaises(ValueError):
                    service.execute(item)
                write.assert_not_called()
            service._unlink_output(leaf)
            self.assertTrue(leaf.exists())
            self.assertEqual(sentinel.read_bytes(), b"temporary neutral content")
