"""Publication manifests participate in existing workspace backup safety checks."""

from types import SimpleNamespace

from mio_server.backups import Backups
from mio_server.backups.models import BackupOptions
from mio_server.jobs import ItemSpec, JobConflict

from .test_compile_executor import png
from .test_result_delivery import DeliveryCase


class PublicationBackupTests(DeliveryCase):
    def completed_publication(self):
        data = png()
        asset = self.ctx.assets.describe(data)
        executor = SimpleNamespace(
            execute=lambda ctx: ctx.publish_result({"ok": True}, [(asset, data)]),
            on_complete=lambda *args: None,
            replay_safe=True,
        )
        self.ctx.engine.register("publication.backup", executor)
        job = self.ctx.engine.submit("publication.backup", [ItemSpec({})])
        ctx = self.claim(job)
        self.ctx.engine._run(ctx, "local", None)
        self.assertEqual(self.ctx.engine.get(job["id"])["state"], "completed")
        return asset

    def test_completed_generic_publication_is_included_in_a_valid_backup(self):
        self.completed_publication()
        backup = Backups(self.ctx).export(BackupOptions())
        self.assertEqual(backup.inspection.asset_count, 1)

    def test_backup_rejects_missing_metadata_for_generic_manifest_only_assets(self):
        asset = self.completed_publication()
        self.ctx.store.forget_asset(asset.id)
        with self.assertRaisesRegex(ValueError, "missing asset metadata"):
            Backups(self.ctx).export(BackupOptions())

    def test_publishing_journal_blocks_backup_even_if_item_is_no_longer_running(self):
        from unittest import mock

        from .test_result_delivery import ProcessLost

        job = self.render_job()
        ctx = self.claim(job)
        original = self.ctx.engine._prepare_publication

        def crash(*args):
            original(*args)
            raise ProcessLost()

        data = png()
        with (
            mock.patch.object(self.ctx.engine, "_prepare_publication", side_effect=crash),
            self.assertRaises(ProcessLost),
        ):
            ctx.publish_result({"ok": True}, [(self.ctx.assets.describe(data), data)])
        with self.ctx.engine.db:
            self.ctx.engine.db.execute(
                "UPDATE job_items SET state = 'failed' WHERE job_id = ?", (job["id"],)
            )
        self.ctx.engine.running.clear()
        with self.assertRaises(JobConflict):
            Backups(self.ctx).export(BackupOptions())
