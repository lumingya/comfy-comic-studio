"""Independent storage lifecycle regressions in temporary workspaces."""

from mio_server.models import Episode, Panel, PanelOverrides, Series

from .api_harness import ApiCase


class OtherStorageReviewTests(ApiCase):
    def test_trash_rejects_episode_deletion_while_render_result_is_still_owed(self):
        series = self.ctx.store.create_series(Series(title="Storage review"))
        panel = Panel(order=0, overrides=PanelOverrides(raw_prompt="a blue ceramic cup"))
        episode = self.ctx.store.create_episode(
            Episode(series_id=series.id, title="One frame", order=0, panels=[panel])
        )
        job = self.ctx.render.render(episode.id, candidates=1)
        self.assertEqual(self.ctx.engine.get(job["id"])["state"], "queued")

        response = self.client.delete(f"/api/episodes/{episode.id}")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.ctx.store.get_episode(episode.id).id, episode.id)

    def test_trash_rejects_purging_a_series_with_an_outstanding_render(self):
        series = self.ctx.store.create_series(Series(title="Storage review"))
        panel = Panel(order=0, overrides=PanelOverrides(raw_prompt="a blue ceramic cup"))
        episode = self.ctx.store.create_episode(
            Episode(series_id=series.id, title="One frame", order=0, panels=[panel])
        )
        self.ctx.render.render(episode.id, candidates=1)
        # Preserve a legacy trashed series fixture without invoking the guarded HTTP delete.
        self.ctx.store.update_series(
            series.id, lambda value: setattr(value, "deleted_at", "2020-01-01T00:00:00+00:00")
        )

        response = self.client.delete(f"/api/trash/series/{series.id}")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.ctx.store.get_episode(episode.id).id, episode.id)
