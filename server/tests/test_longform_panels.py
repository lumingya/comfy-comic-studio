from unittest.mock import patch

from mio_server.jobs import ItemSpec, JobConflict
from mio_server.longform import copy_episode, reorder_episodes, transfer_panels
from mio_server.longform.models import EpisodeCopy, EpisodeReorder
from mio_server.models import ControlInput, Episode, Series, Take
from mio_server.storage import Conflict, NotFound

from .longform_fixture import LongformFixture


class LongformPanelTests(LongformFixture):
    def test_copy_remaps_closed_artwork_and_preserves_canvas_spacing(self):
        before = self.source.model_dump()
        result = transfer_panels(self.ctx, self.series.id, self.transfer(panel_ids=["b", "a"]))
        self.assertEqual(self.store.get_episode("source").model_dump(), before)
        self.assertEqual(
            [p.id for p in result.target.ordered_panels()],
            ["d", result.panel_ids["a"], result.panel_ids["b"]],
        )
        copied = result.target.panel(result.panel_ids["b"])
        self.assertEqual(copied.controls[0].take_id, result.take_ids["ta"])
        self.assertEqual(
            result.target.take(result.take_ids["tb"]).parent_take_id, result.take_ids["ta"]
        )
        self.assertIsNone(result.target.take(result.take_ids["ta"]).job_id)
        self.assertEqual(result.target.take(result.take_ids["ta"]).asset_id, "art-a")
        self.assertEqual(result.target.take(result.take_ids["ta"]).status, "adopted")
        self.assertNotEqual(result.panel_ids["a"], "a")
        self.assertNotEqual(result.lettering_ids["la"], "la")
        self.assertEqual(result.layout_offset_y, 394)
        self.assertEqual(result.target.strip.panel_boxes["d"], self.target.strip.panel_boxes["d"])
        self.assertEqual(result.target.strip.panel_boxes[result.panel_ids["b"]][1], 694)
        self.assertEqual(
            result.target.strip.crops[result.panel_ids["a"]], self.source.strip.crops["a"]
        )
        self.assertEqual(result.target.strip.lettering[0].bridge_to, result.panel_ids["b"])
        self.assertEqual(result.target.strip.lettering[0].tail_to, (45, 584))
        self.assertTrue(result.target.strip.manual)
        self.assertEqual(result.target.revision, 1)
        self.assertEqual(len(self.ctx.engine.list()), 0)

    def test_move_preserves_ids_and_source_whitespace_without_orphans(self):
        result = transfer_panels(self.ctx, self.series.id, self.transfer(mode="move"))
        self.assertEqual(result.panel_ids, {"a": "a", "b": "b"})
        self.assertEqual(result.take_ids, {"ta": "ta", "tb": "tb"})
        self.assertEqual([p.id for p in result.source.panels], ["c"])
        self.assertEqual([t.id for t in result.source.takes], ["tc"])
        self.assertEqual(result.source.strip.panel_boxes["c"], (24, 600, 300, 800))
        self.assertEqual(result.source.strip.height, 1000)
        self.assertEqual([x.id for x in result.source.strip.lettering], ["lc", "global"])
        self.assertEqual(result.source.revision, 1)
        self.assertEqual(result.target.revision, 1)

    def test_revision_missing_cross_series_and_duplicate_selection_are_atomic(self):
        before = self.documents()
        for command, error in [
            (self.transfer(source_revision=17), Conflict),
            (self.transfer(target_revision=17), Conflict),
            (self.transfer(panel_ids=["a", "a"]), ValueError),
            (self.transfer(panel_ids=["missing"]), NotFound),
        ]:
            with self.subTest(command=command):
                with self.assertRaises(error):
                    transfer_panels(self.ctx, self.series.id, command)
                self.assertEqual(self.documents(), before)
        other = self.store.create_series(Series(title="Other"))
        foreign = self.store.create_episode(Episode(series_id=other.id, title="Foreign", order=0))
        with self.assertRaisesRegex(ValueError, "cross-series"):
            transfer_panels(self.ctx, self.series.id, self.transfer(target_episode_id=foreign.id))
        self.assertEqual(self.documents(), before)

    def test_broken_and_external_take_references_reject_without_silent_detachment(self):
        before = self.documents()
        with self.assertRaisesRegex(Conflict, "parent"):
            transfer_panels(
                self.ctx, self.series.id, self.transfer(panel_ids=["b"], break_bridges=True)
            )
        self.assertEqual(self.documents(), before)
        self.source.takes[1].parent_take_id = "missing"
        self.store.save_episode(self.source)
        with self.assertRaisesRegex(ValueError, "missing parent"):
            transfer_panels(self.ctx, self.series.id, self.transfer())

    def test_incoming_control_blocks_move_but_not_independent_copy(self):
        self.source.panel("c").controls = [ControlInput(source="take", take_id="ta")]
        self.store.save_episode(self.source)
        before = self.documents()
        with self.assertRaisesRegex(Conflict, "remaining panel control"):
            transfer_panels(self.ctx, self.series.id, self.transfer(mode="move"))
        self.assertEqual(self.documents(), before)
        result = transfer_panels(self.ctx, self.series.id, self.transfer())
        self.assertEqual(result.source.panel("c").controls[0].take_id, "ta")

    def test_split_bubbles_require_explicit_break_and_respect_incoming_locks(self):
        self.source.panel("b").controls = []
        self.source.takes = [take for take in self.source.takes if take.id != "tb"]
        self.store.save_episode(self.source)
        before = self.documents()
        with self.assertRaisesRegex(Conflict, "bubbles"):
            transfer_panels(self.ctx, self.series.id, self.transfer(panel_ids=["b"], mode="move"))
        self.assertEqual(self.documents(), before)
        self.source.panel("a").locked = True
        self.store.save_episode(self.source)
        with self.assertRaisesRegex(Conflict, "locked"):
            transfer_panels(
                self.ctx,
                self.series.id,
                self.transfer(panel_ids=["b"], mode="move", break_bridges=True),
            )
        result = transfer_panels(
            self.ctx,
            self.series.id,
            self.transfer(panel_ids=["b"], mode="move", break_bridges=True, include_locked=True),
        )
        self.assertFalse(result.source.panel("a").dialogues[0].bridge)
        self.assertIsNone(result.source.strip.lettering[0].bridge_to)
        self.assertTrue(any("disconnected" in note for note in result.notes))

    def test_locked_selection_and_different_canvas_width_fail_before_writes(self):
        self.source.panel("a").locked = True
        self.store.save_episode(self.source)
        with self.assertRaisesRegex(Conflict, "locked"):
            transfer_panels(self.ctx, self.series.id, self.transfer())
        self.target.strip.width = 1000
        self.store.save_episode(self.target)
        before = self.documents()
        with self.assertRaisesRegex(Conflict, "widths"):
            transfer_panels(
                self.ctx, self.series.id, self.transfer(mode="move", include_locked=True)
            )
        self.assertEqual(self.documents(), before)

    def test_second_save_failure_rolls_back_both_documents_and_history(self):
        before = self.documents()
        save = self.store.save_episode

        def fail_target(ep, *args, **kwargs):
            if ep.id == "target":
                raise RuntimeError("injected write failure")
            return save(ep, *args, **kwargs)

        with patch.object(self.store, "save_episode", side_effect=fail_target):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                transfer_panels(self.ctx, self.series.id, self.transfer(mode="move"))
        self.assertEqual(self.documents(), before)
        self.assertEqual(self.store.episode_snapshots("source"), [])

    def test_episode_copy_remaps_global_lettering_and_keeps_source_history(self):
        self.source.takes.append(Take(id="orphan", panel_id="deleted", asset_id="recoverable"))
        self.source.strip.lettering[-1].bridge_to = "a"
        self.store.save_episode(self.source)
        before = self.source.model_dump()
        copied = copy_episode(self.ctx, "source", EpisodeCopy(revision=self.source.revision))
        self.assertEqual(self.store.get_episode("source").model_dump(), before)
        self.assertEqual(copied.episode.order, 2)
        self.assertEqual(copied.episode.revision, 0)
        self.assertEqual(copied.episode.strip.height, 1000)
        self.assertEqual(
            copied.episode.strip.panel_boxes[copied.panel_ids["a"]], (24, 30, 300, 230)
        )
        self.assertEqual(copied.episode.strip.lettering[-1].bridge_to, copied.panel_ids["a"])
        self.assertEqual(len(copied.episode.takes), 3)
        self.assertEqual(copied.episode.takes[1].parent_take_id, copied.take_ids["ta"])
        self.assertIsNone(copied.episode.takes[0].job_id)
        with self.assertRaises(Conflict):
            copy_episode(self.ctx, "source", EpisodeCopy(revision=0))

    def test_episode_reorder_is_atomic_has_one_revision_and_excludes_trash(self):
        trash = self.store.create_episode(
            Episode(series_id=self.series.id, title="Trash", order=3, deleted_at="2026-01-01")
        )
        result = reorder_episodes(
            self.ctx,
            self.series.id,
            EpisodeReorder(
                order=["target", "source"],
                revisions={"source": 0, "target": 0},
            ),
        )
        self.assertEqual(
            [(ep.id, ep.order, ep.revision) for ep in result], [("target", 0, 1), ("source", 1, 1)]
        )
        self.assertEqual(self.store.get_episode(trash.id, include_deleted=True).order, 3)
        self.assertEqual(len(self.store.episode_snapshots("source")), 2)
        before = self.documents()
        with self.assertRaises(Conflict):
            reorder_episodes(
                self.ctx,
                self.series.id,
                EpisodeReorder(order=["source", "target"], revisions={"source": 0, "target": 1}),
            )
        self.assertEqual(self.documents(), before)
        save = self.store.save_episode
        with patch.object(
            self.store,
            "save_episode",
            side_effect=lambda ep: (
                (_ for _ in ()).throw(RuntimeError("failure")) if ep.id == "target" else save(ep)
            ),
        ):
            with self.assertRaises(RuntimeError):
                reorder_episodes(
                    self.ctx,
                    self.series.id,
                    EpisodeReorder(
                        order=["source", "target"], revisions={"source": 1, "target": 1}
                    ),
                )
        self.assertEqual(self.documents(), before)
        self.assertEqual(
            [
                row["episode_order"]
                for row in self.store._rows(
                    "SELECT episode_order FROM episodes WHERE deleted_at IS NULL ORDER BY episode_order"
                )
            ],
            [0, 1],
        )

    def test_active_jobs_block_move_reorder_but_allow_independent_copies(self):
        self.ctx.engine.submit("test", [ItemSpec(input={})], owner="source")
        before = self.documents()
        with self.assertRaises(JobConflict):
            transfer_panels(self.ctx, self.series.id, self.transfer(mode="move"))
        with self.assertRaises(JobConflict):
            reorder_episodes(
                self.ctx,
                self.series.id,
                EpisodeReorder(order=["target", "source"], revisions={"source": 0, "target": 0}),
            )
        self.assertEqual(self.documents(), before)
        result = transfer_panels(self.ctx, self.series.id, self.transfer())
        self.assertEqual(len(result.target.panels), 3)
        self.assertEqual(len(self.ctx.engine.list()), 1)

    def test_move_id_collisions_and_missing_controls_leave_both_episodes_unchanged(self):
        self.target.panel("d").id = "a"
        self.target.strip.panel_boxes = {"a": (24, 24, 300, 224)}
        self.store.save_episode(self.target)
        before = self.documents()
        with self.assertRaisesRegex(Conflict, "panel id"):
            transfer_panels(self.ctx, self.series.id, self.transfer(mode="move"))
        self.assertEqual(self.documents(), before)
        self.source.panel("b").controls[0].take_id = "missing"
        self.store.save_episode(self.source)
        before = self.documents()
        with self.assertRaisesRegex(ValueError, "missing control"):
            transfer_panels(self.ctx, self.series.id, self.transfer())
        self.assertEqual(self.documents(), before)

    def test_reorder_rejects_missing_and_duplicate_ids_and_locked_panels(self):
        for order, revisions in [
            (["source"], {"source": 0}),
            (["source", "source"], {"source": 0, "target": 0}),
            (["target", "source"], {"source": 0}),
        ]:
            with self.subTest(order=order), self.assertRaises(ValueError):
                reorder_episodes(
                    self.ctx, self.series.id, EpisodeReorder(order=order, revisions=revisions)
                )
        self.source.panel("c").locked = True
        self.store.save_episode(self.source)
        before = self.documents()
        with self.assertRaisesRegex(Conflict, "locked"):
            reorder_episodes(
                self.ctx,
                self.series.id,
                EpisodeReorder(
                    order=["target", "source"],
                    revisions={"source": 1, "target": 0},
                ),
            )
        self.assertEqual(self.documents(), before)
