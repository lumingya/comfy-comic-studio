"""The saved-strip report compares captions with the same text used by lettering."""

from PIL import Image

from mio_server.models import Dialogue, DialogueKind, Episode, Panel, PanelOverrides, Series
from mio_server.pipeline import strip as SP

from .api_harness import ApiCase


class ReadabilityVariablesTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.series = self.ctx.store.create_series(
            Series(title="Caption checks", variables={"name": "Mio", "alias": "{name}"})
        )
        self.panel = Panel(
            order=0,
            overrides=PanelOverrides(values={"$name": "Local"}),
            dialogues=[Dialogue(kind=DialogueKind.narration, text="Hello {alias}! {{name}}")],
        )
        self.episode = self.ctx.store.create_episode(
            Episode(series_id=self.series.id, title="One", order=0, panels=[self.panel])
        )
        with Image.new("RGB", (256, 384), "white") as image:
            self.episode.strip, scaled = SP.layout(
                self.series, self.episode, {self.panel.id: image}
            )
        for image in scaled.values():
            image.close()
        self.ctx.store.save_episode(self.episode)
        self.path = f"/api/episodes/{self.episode.id}/strip/report"

    def test_automatically_lettered_variables_are_not_missing_and_reads_do_not_mutate(self):
        self.assertEqual(self.episode.strip.lettering[0].text, "Hello Local! {name}")
        before = self.ctx.store.get_episode(self.episode.id).model_dump()
        report = self.ok(self.client.get(self.path))
        self.assertEqual(report["missing"], [])
        self.assertTrue(report["readable"], report)
        self.assertEqual(self.ctx.store.get_episode(self.episode.id).model_dump(), before)
        self.assertEqual(self.ctx.store.get_series(self.series.id), self.series)

    def test_missing_layer_reports_the_expanded_caption(self):
        self.episode.strip.lettering = []
        self.ctx.store.save_episode(self.episode)
        report = self.ok(self.client.get(self.path))
        self.assertEqual(
            report["missing"], [{"panel_id": self.panel.id, "text": "Hello Local! {name}"}]
        )
        self.assertFalse(report["readable"])

    def test_literal_saved_text_is_not_expanded_again_and_duplicate_lines_still_count(self):
        self.episode.strip.lettering[0].text = self.panel.dialogues[0].text
        self.ctx.store.save_episode(self.episode)
        report = self.ok(self.client.get(self.path))
        self.assertEqual(len(report["missing"]), 1)
        self.episode.strip.lettering[0].text = "Hello Local! {name}"
        self.episode.panels[0].dialogues.append(self.panel.dialogues[0].model_copy(deep=True))
        self.ctx.store.save_episode(self.episode)
        report = self.ok(self.client.get(self.path))
        self.assertEqual(
            report["missing"], [{"panel_id": self.panel.id, "text": "Hello Local! {name}"}]
        )

    def test_unknown_variable_that_renders_empty_does_not_require_a_layer(self):
        self.episode.panels[0].dialogues = [Dialogue(text="{unknown}")]
        self.episode.strip.lettering = []
        self.ctx.store.save_episode(self.episode)
        report = self.ok(self.client.get(self.path))
        self.assertEqual(report["missing"], [])
        self.assertTrue(report["readable"], report)
