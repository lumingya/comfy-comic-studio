"""Export and restored-database paths stay inside disposable owned directories."""

import json
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from mio_server.backups.database import validate_databases
from mio_server.exporting import ExportService
from mio_server.jobs import Canceled, JobEngine
from mio_server.jobs.types import SCHEMA as JOB_SCHEMA
from mio_server.storage import NotFound, SQLiteStore


class ExportPathTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        workspace = self.base / "workspace"
        workspace.mkdir()
        self.engine = JobEngine(":memory:", autostart=False)
        self.addCleanup(self.engine.close)
        self.service = ExportService(SimpleNamespace(data_dir=workspace, engine=self.engine))
        self.outside = self.base / "neutral"
        self.outside.mkdir()
        self.sentinel = self.outside / "1-1.bin"
        self.sentinel.write_bytes(b"temporary neutral sentinel")

    def item(self, job_id="job_a1"):
        return SimpleNamespace(
            job_id=job_id,
            epoch=1,
            attempt=1,
            snapshot={},
            on_abort=Mock(),
            raise_if_cancelled=Mock(),
            progress=Mock(),
        )

    def link(self, path, target, *, directory=False):
        try:
            path.symlink_to(target, target_is_directory=directory)
        except (OSError, NotImplementedError):
            self.skipTest("this host cannot create a temporary symbolic link")

    def test_absolute_and_relative_job_ids_are_rejected_before_lookup_or_writes(self):
        bad_ids = (
            str(self.outside),
            "../neutral",
            "..\\neutral",
            "C:\\neutral",
            "job_a1/../neutral",
            "job_a1.",
            "job_" + "a" * 61,
        )
        with patch.object(self.engine, "get") as get, patch.object(self.service, "write") as write:
            for identifier in bad_ids:
                for operation in (
                    lambda: self.service.result(identifier),
                    lambda: self.service.execute(self.item(identifier)),
                    lambda: self.service._cleanup_job(identifier),
                    lambda: self.service.remove(identifier),
                ):
                    with self.subTest(identifier=identifier), self.assertRaises(NotFound):
                        operation()
            get.assert_not_called()
            write.assert_not_called()
        self.assertEqual(self.sentinel.read_bytes(), b"temporary neutral sentinel")
        self.assertEqual(list(self.service.root.iterdir()), [])

    def test_completed_export_accepts_only_a_bounded_regular_result_leaf(self):
        folder = self.service.root / "job_a1"
        folder.mkdir()
        result_file = folder / "1-1.bin"
        result_file.write_bytes(b"owned result")
        job = {"kind": "export.render", "state": "completed", "items": [{"result": {}}]}
        with patch.object(self.engine, "get", return_value=job):
            for name in ("../1-1.bin", "1-1.bin:stream", "/1-1.bin", "1" * 20 + "-1.bin"):
                job["items"][0]["result"] = {"file": name}
                with self.subTest(name=name), self.assertRaises(NotFound):
                    self.service.result("job_a1")
            job["items"][0]["result"] = {"file": "1-1.bin"}
            path, _ = self.service.result("job_a1")
            self.assertEqual(path, result_file)

    def test_job_directory_link_is_never_read_written_or_removed(self):
        folder = self.service.root / "job_a1"
        self.link(folder, self.outside, directory=True)
        with patch.object(self.service, "write") as write:
            for operation in (
                lambda: self.service.result("job_a1"),
                lambda: self.service.execute(self.item()),
                lambda: self.service._cleanup_job("job_a1"),
                lambda: self.service.remove("job_a1"),
            ):
                with self.assertRaises(ValueError):
                    operation()
            write.assert_not_called()
        self.service.cleanup_startup()
        self.assertEqual(self.sentinel.read_bytes(), b"temporary neutral sentinel")

    def test_result_and_write_targets_reject_a_linked_output_leaf(self):
        folder = self.service.root / "job_a1"
        folder.mkdir()
        self.link(folder / "1-1.bin", self.sentinel)
        job = {
            "kind": "export.render",
            "state": "completed",
            "items": [{"result": {"file": "1-1.bin"}}],
        }
        with patch.object(self.engine, "get", return_value=job):
            with self.assertRaises(ValueError):
                self.service.result("job_a1")
        with patch.object(self.service, "write") as write:
            with self.assertRaises(ValueError):
                self.service.execute(self.item())
            write.assert_not_called()
        self.assertEqual(self.sentinel.read_bytes(), b"temporary neutral sentinel")

    def test_reparse_ancestor_is_rejected_even_for_a_missing_job_directory(self):
        original = Path.lstat

        def reparse(path, *args, **kwargs):
            if path == self.service.root:
                return SimpleNamespace(
                    st_mode=stat.S_IFDIR,
                    st_file_attributes=getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400),
                )
            return original(path, *args, **kwargs)

        with patch.object(Path, "lstat", reparse), patch.object(self.service, "write") as write:
            with self.assertRaisesRegex(ValueError, "reparse"):
                self.service.execute(self.item())
            write.assert_not_called()
        self.assertFalse((self.service.root / "job_a1").exists())

    def test_ordinary_expanded_alias_spelling_does_not_reject_owned_files(self):
        folder = self.service.root / "job_a1"
        folder.mkdir()
        (folder / "1-1.bin").write_bytes(b"owned result")
        original = Path.resolve

        def expanded(path, *args, **kwargs):
            resolved = original(path, *args, **kwargs)
            if resolved.is_relative_to(self.service.root):
                return self.base / "expanded-root" / resolved.relative_to(self.service.root)
            return resolved

        job = {
            "kind": "export.render",
            "state": "completed",
            "items": [{"result": {"file": "1-1.bin"}}],
        }
        with (
            patch.object(Path, "resolve", expanded),
            patch.object(self.engine, "get", return_value=job),
        ):
            self.assertTrue(self.service._owned_directory(folder))
            path, _ = self.service.result("job_a1")
            self.assertEqual(path.read_bytes(), b"owned result")

    def test_abort_and_rollback_recheck_directory_after_writer_replaces_it(self):
        item = self.item()
        folder = self.service.root / item.job_id
        aborts = []
        item.on_abort = aborts.append
        probe = self.base / "link-check"
        self.link(probe, self.outside, directory=True)
        probe.unlink()

        def replace_directory(_snapshot, path, **_kwargs):
            path.write_bytes(b"owned partial")
            folder.rename(self.service.root / "retained-original")
            folder.symlink_to(self.outside, target_is_directory=True)
            raise Canceled()

        with patch.object(self.service, "write", side_effect=replace_directory):
            with self.assertRaises(Canceled):
                self.service.execute(item)
        aborts[0]()
        self.assertFalse(self.service._writing)
        self.assertEqual(self.sentinel.read_bytes(), b"temporary neutral sentinel")

    def test_temporary_download_finalizer_skips_a_replaced_directory(self):
        folder = self.service.root / "download-review"
        self.link(folder, self.outside, directory=True)
        self.service._remove_download(folder)
        self.assertEqual(self.sentinel.read_bytes(), b"temporary neutral sentinel")


class RestoredJobIdentityTests(unittest.TestCase):
    def setUp(self):
        self.store = SQLiteStore(":memory:")
        self.addCleanup(self.store.close)
        self.jobs = sqlite3.connect(":memory:")
        self.addCleanup(self.jobs.close)
        self.jobs.row_factory = sqlite3.Row
        self.jobs.executescript(JOB_SCHEMA)

    def add_job(self, identifier="job_a1", filename="1-1.bin", **extra):
        self.jobs.execute(
            "INSERT INTO jobs(id,kind,state,snapshot_json,snapshot_sha,created,updated) "
            "VALUES (?, 'export.render', 'completed', ?, 'sha', 0, 0)",
            (identifier, json.dumps(extra)),
        )
        self.jobs.execute(
            "INSERT INTO job_items(job_id,idx,state,resource,input_json,result_json,updated) "
            "VALUES (?,0,'complete','local','{}',?,0)",
            (identifier, json.dumps({"file": filename})),
        )
        self.jobs.commit()

    def test_valid_completed_export_metadata_is_accepted(self):
        self.add_job()
        counts, _ = validate_databases(self.store._conn, self.jobs)
        self.assertEqual(counts["job_count"], 1)

    def test_restored_absolute_job_id_is_rejected_without_filesystem_side_effects(self):
        with tempfile.TemporaryDirectory() as folder:
            sentinel = Path(folder) / "1-1.bin"
            sentinel.write_bytes(b"temporary neutral sentinel")
            self.add_job(str(Path(folder).resolve()))
            with self.assertRaisesRegex(ValueError, "job identifier"):
                validate_databases(self.store._conn, self.jobs)
            self.assertEqual(sentinel.read_bytes(), b"temporary neutral sentinel")

    def test_unlinked_event_and_workshop_job_references_are_validated(self):
        self.add_job()
        self.jobs.execute(
            "INSERT INTO job_events(job_id,type,at) VALUES ('../neutral', 'complete', 0)"
        )
        self.jobs.commit()
        with self.assertRaisesRegex(ValueError, "job identifier"):
            validate_databases(self.store._conn, self.jobs)
        self.jobs.execute("DELETE FROM job_events")
        self.jobs.commit()
        self.store._conn.execute(
            "INSERT INTO workshop_launch_receipts VALUES ('episode-review', '../neutral')"
        )
        self.store._conn.commit()
        with self.assertRaisesRegex(ValueError, "job identifier"):
            validate_databases(self.store._conn, self.jobs)

    def test_restored_export_leaf_is_validated_without_interpreting_opaque_payload_keys(self):
        self.add_job(filename="../neutral.bin", job_id="../neutral")
        with self.assertRaisesRegex(ValueError, "export result filename"):
            validate_databases(self.store._conn, self.jobs)
        self.jobs.execute('UPDATE job_items SET result_json = \'{"file":"1-1.bin"}\'')
        self.jobs.commit()
        counts, _ = validate_databases(self.store._conn, self.jobs)
        self.assertEqual(counts["job_count"], 1)
