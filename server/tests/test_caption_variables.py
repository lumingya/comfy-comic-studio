"""The workshop uses variables in captions as well as prompts; exports must agree."""

from __future__ import annotations

import unittest

from PIL import Image

from mio_server.album.build import caption
from mio_server.models import Dialogue, DialogueKind, Episode, Panel, Series
from mio_server.pipeline import strip as SP


class CaptionVariablesTests(unittest.TestCase):
    def project(self):
        series = Series(title="Caption regression", variables={"name": "Mio", "alias": "{name}"})
        panel = Panel(
            order=0,
            dialogues=[Dialogue(kind=DialogueKind.narration, text="Hello {alias}! {{literal}}")],
        )
        episode = Episode(series_id=series.id, title="One", order=0, panels=[panel])
        return series, episode, episode.panels[0]

    def test_album_caption_resolves_nested_variables_and_escapes(self):
        series, _, panel = self.project()
        self.assertEqual(caption(series, panel), "Hello Mio! {literal}")
        self.assertEqual(panel.dialogues[0].text, "Hello {alias}! {{literal}}")

    def test_panel_overrides_and_unknown_names_match_prompt_rules(self):
        series, _, panel = self.project()
        panel.overrides.values["$name"] = "Local"
        panel.dialogues[0].text = "{alias} / {unknown}"
        self.assertEqual(caption(series, panel), "Local / {unknown}")

    def test_strip_bubbles_use_resolved_text_without_mutating_storyboard(self):
        series, episode, panel = self.project()
        image = Image.new("RGB", (256, 384), "white")
        strip, _ = SP.layout(series, episode, {panel.id: image})
        self.assertEqual([layer.text for layer in strip.lettering], ["Hello Mio! {literal}"])
        self.assertEqual(panel.dialogues[0].text, "Hello {alias}! {{literal}}")
