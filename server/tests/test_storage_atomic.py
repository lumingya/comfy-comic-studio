"""Transactions compose real store calls, and delivery receipts commit with their edits."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mio_server.models import Episode, Series
from mio_server.storage import Conflict, NotFound, SQLiteStore


class AtomicStoreTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "mio.sqlite3"
        self.store = SQLiteStore(self.path)
        self.addCleanup(self.store.close)
        self.series = self.store.create_series(Series(title="Story"))
        self.ep = self.store.create_episode(Episode(series_id=self.series.id, title="One", order=0))

    def test_outer_failure_rolls_back_nested_writes_and_snapshots(self):
        with self.assertRaisesRegex(RuntimeError, "interrupt"):
            with self.store.tx():
                self.store.update_episode(self.ep.id, lambda e: setattr(e, "title", "Changed"))
                self.store.update_series(self.series.id, lambda s: setattr(s, "title", "Changed"))
                other = self.store.create_episode(
                    Episode(series_id=self.series.id, title="Two", order=1)
                )
                raise RuntimeError("interrupt")
        self.assertEqual(self.store.get_episode(self.ep.id).title, "One")
        self.assertEqual(self.store.get_series(self.series.id).title, "Story")
        self.assertEqual(self.store.episode_snapshots(self.ep.id), [])
        with self.assertRaises(NotFound):
            self.store.get_episode(other.id)

    def test_inner_failure_can_be_caught_without_losing_outer_work(self):
        with self.store.tx():
            self.store.update_series(self.series.id, lambda s: setattr(s, "title", "Kept"))
            try:
                with self.store.tx():
                    self.store.update_episode(self.ep.id, lambda e: setattr(e, "title", "Lost"))
                    raise ValueError("inner")
            except ValueError:
                pass
        reopened = SQLiteStore(self.path)
        try:
            self.assertEqual(reopened.get_series(self.series.id).title, "Kept")
            self.assertEqual(reopened.get_episode(self.ep.id).title, "One")
        finally:
            reopened.close()

    def test_restoring_an_old_document_keeps_revision_monotonic(self):
        self.store.update_episode(self.ep.id, lambda e: setattr(e, "title", "Two"))
        self.store.update_episode(self.ep.id, lambda e: setattr(e, "title", "Three"))
        restored = self.store.save_episode(self.ep.model_copy(deep=True), expected_revision=2)
        self.assertEqual((restored.title, restored.revision), ("One", 3))

    def test_delivery_replay_survives_reopen_and_does_not_reapply_edits(self):
        def apply(ep):
            ep.title = "Result"
            return ["take-original"]

        self.assertEqual(
            self.store.apply_episode_delivery(self.ep.id, "job:0:1", "sha", apply),
            (["take-original"], True),
        )
        self.store.update_episode(self.ep.id, lambda e: setattr(e, "title", "User edit"))
        reopened = SQLiteStore(self.path)
        try:
            with patch.object(reopened, "save_episode", side_effect=AssertionError("reapplied")):
                self.assertEqual(
                    reopened.apply_episode_delivery(self.ep.id, "job:0:1", "sha", apply),
                    (["take-original"], False),
                )
            self.assertEqual(reopened.get_episode(self.ep.id).title, "User edit")
            with self.assertRaises(Conflict):
                reopened.apply_episode_delivery(self.ep.id, "job:0:1", "different", apply)
            reopened.delete_episode(self.ep.id)
            self.assertEqual(
                reopened.apply_episode_delivery(self.ep.id, "job:0:1", "sha", apply),
                (["take-original"], False),
            )
        finally:
            reopened.close()

    def test_receipt_failure_rolls_back_saved_episode(self):
        with self.store.tx() as db:
            db.execute(
                "CREATE TRIGGER fail_receipt BEFORE INSERT ON delivery_receipts BEGIN SELECT RAISE(ABORT, 'receipt failed'); END"
            )

        def apply(ep):
            ep.title = "Must roll back"
            return []

        with self.assertRaisesRegex(Exception, "receipt failed"):
            self.store.apply_episode_delivery(self.ep.id, "job:0:1", "sha", apply)
        self.assertEqual(
            (self.store.get_episode(self.ep.id).title, self.store.get_episode(self.ep.id).revision),
            ("One", 0),
        )
        self.assertEqual(self.store.episode_snapshots(self.ep.id), [])
