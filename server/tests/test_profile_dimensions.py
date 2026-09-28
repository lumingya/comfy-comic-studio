"""A render profile's base width must reach the submitted graph, not just its UI form."""

from mio_server.models import Episode, Panel, Series

from .api_harness import ApiCase
from .test_render_qa import Harness


class ProfileDimensionsTests(Harness):
    def plan(self, width=640, override=None):
        profile = self.render.profile(None, self.series)
        profile.base_width = width
        self.store.put_doc(profile)
        panel = self.episode.panels[0]
        panel.aspect_ratio = "1:1"
        if override:
            panel.overrides.width, panel.overrides.height = override
        self.store.save_episode(self.episode)
        return self.render.render(self.episode.id, [panel.id], candidates=1)["items"][0]["input"]

    def test_profile_width_reaches_frozen_metadata_and_workflow_inputs(self):
        planned = self.plan()
        self.assertEqual((planned["meta"]["width"], planned["meta"]["height"]), (640, 640))
        graph = planned["stages"][0]["graph"]
        size = next(n["inputs"] for n in graph.values() if n["class_type"] == "EmptyLatentImage")
        self.assertEqual((size["width"], size["height"]), (640, 640))

    def test_explicit_panel_dimensions_win_over_the_profile(self):
        meta = self.plan(640, (960, 512))["meta"]
        self.assertEqual((meta["width"], meta["height"]), (960, 512))

    def test_small_width_allowed_by_the_profile_model_is_not_ignored(self):
        meta = self.plan(256)["meta"]
        self.assertEqual((meta["width"], meta["height"]), (256, 256))


class ProfilePreviewTests(ApiCase):
    def test_prompt_preview_uses_profile_dimensions_and_prompt_defaults(self):
        profile = self.ctx.render.profile(None)
        profile.base_width = 640
        profile.quality_tags = ["profile_quality"]
        self.ctx.store.put_doc(profile)
        series = self.ctx.store.create_series(Series(title="Preview"))
        panel = Panel(order=0, aspect_ratio="1:1")
        episode = self.ctx.store.create_episode(
            Episode(series_id=series.id, title="Preview", order=0, panels=[panel])
        )
        response = self.ok(self.client.get(f"/api/episodes/{episode.id}/panels/{panel.id}/prompt"))
        self.assertEqual(response["tags"]["width"], 640)
        self.assertEqual(response["natural"]["height"], 640)
        self.assertIn("profile_quality", response["tags"]["positive"])
