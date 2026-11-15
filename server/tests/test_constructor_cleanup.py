"""A failed database bootstrap must release the files needed for a corrected restart."""

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mio_server.jobs import ItemSpec, JobEngine
from mio_server.storage import SQLiteStore


class ConstructorCleanupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def reopen_engine(self, path):
        engine = JobEngine(path, autostart=False)
        try:
            self.assertEqual(engine.submit("test", [ItemSpec({})])["state"], "blocked")
        finally:
            engine.close()

    def test_engine_connect_failure_releases_previously_acquired_file_lease(self):
        path = self.root / "jobs.sqlite3"
        with patch(
            "mio_server.jobs.engine.sqlite3.connect",
            side_effect=sqlite3.OperationalError("connect failed"),
        ):
            with self.assertRaisesRegex(sqlite3.OperationalError, "connect failed"):
                JobEngine(path, autostart=False)
        self.reopen_engine(path)

    def test_engine_recovery_failure_closes_connection_pool_and_lease(self):
        path, captured = self.root / "jobs.sqlite3", []

        def failed(engine):
            captured.append(engine)
            raise RuntimeError("recovery failed")

        with patch.object(JobEngine, "_recover", new=failed):
            with self.assertRaisesRegex(RuntimeError, "recovery failed"):
                JobEngine(path, autostart=False)
        broken = captured[0]
        self.assertTrue(broken.closed)
        with self.assertRaises(sqlite3.ProgrammingError):
            broken.db.execute("SELECT 1")
        with self.assertRaises(RuntimeError):
            broken.workers.submit(lambda: None)
        self.reopen_engine(path)

    def test_store_migration_failure_closes_connection_before_reopening_same_path(self):
        path, captured = self.root / "mio.sqlite3", []

        def failed(store):
            captured.append(store)
            raise RuntimeError("migration failed")

        with patch.object(SQLiteStore, "migrate", new=failed):
            with self.assertRaisesRegex(RuntimeError, "migration failed"):
                SQLiteStore(path)
        with self.assertRaises(sqlite3.ProgrammingError):
            captured[0]._rows("SELECT 1")
        store = SQLiteStore(path)
        try:
            self.assertEqual(store._rows("PRAGMA quick_check")[0][0], "ok")
        finally:
            store.close()

    def test_store_invalid_database_releases_file_for_replacement(self):
        path = self.root / "mio.sqlite3"
        path.write_bytes(b"not a sqlite database")
        with self.assertRaises(sqlite3.DatabaseError):
            SQLiteStore(path)
        path.rename(self.root / "invalid.sqlite3")
        store = SQLiteStore(path)
        store.close()
