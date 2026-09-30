"""The workshop uses variables in captions as well as prompts; exports must agree."""

from __future__ import annotations

import unittest

from PIL import Image

from mio_server.album.build import caption
from mio_server.models import Dialogue, DialogueKind, Episode, Panel, Series
from mio_server.pipeline import strip as SP
from mio_server.pipeline import variables as V


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

    def test_panel_overrides_apply_and_unknown_names_are_blanked_for_readers(self):
        """Readers never see a raw ``{name}``: an unknown one is blanked with its separator, as the
        legacy books did (prompts keep unknown names verbatim)."""
        series, _, panel = self.project()
        panel.overrides.values["$name"] = "Local"
        panel.dialogues[0].text = "{alias} / {unknown}"
        self.assertEqual(caption(series, panel), "Local")

    def test_display_text_blanks_unresolved_names_and_their_separators(self):
        values = {"style": "水彩", "character_display_name": "七海", "empty": ""}
        cases = {
            "已规范内置 {female_name}、{female_lead}、{male_name}、{male_lead} 及 {style} 变量接口。": (
                "已规范内置 及 水彩 变量接口。"
            ),
            "{character_display_name}在海边停下脚步。": "七海在海边停下脚步。",
            "七海、{a}、{b}": "七海",
            "{a}、七海": "七海",
            "{empty}，你好": "你好",
            "{{literal}} 与 {a|b} 和 { x }": "{literal} 与 {a|b} 和 { x }",
            "没有变量": "没有变量",
        }
        for text, shown in cases.items():
            with self.subTest(text=text):
                self.assertEqual(V.display(text, values), shown)
        self.assertEqual(V.expand("{a}、七海", values), "{a}、七海")  # prompts are untouched

    def test_strip_bubbles_use_resolved_text_without_mutating_storyboard(self):
        series, episode, panel = self.project()
        image = Image.new("RGB", (256, 384), "white")
        strip, _ = SP.layout(series, episode, {panel.id: image})
        self.assertEqual([layer.text for layer in strip.lettering], ["Hello Mio! {literal}"])
        self.assertEqual(panel.dialogues[0].text, "Hello {alias}! {{literal}}")
