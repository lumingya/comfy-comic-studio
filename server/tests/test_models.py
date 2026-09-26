import unittest

from pydantic import ValidationError

from mio_server.models import Character, Dialogue, Episode, Panel, PanelCharacter, Series


class DomainModelTests(unittest.TestCase):
    def test_series_uses_new_vocabulary_and_strict_fields(self):
        series = Series(title="雨夜连载")
        self.assertTrue(series.id.startswith("series_"))
        self.assertEqual(series.bible.characters, [])
        with self.assertRaises(ValidationError):
            Series(title="x", books=[])

    def test_character_is_adult_and_has_identity_checklist(self):
        character = Character(
            name="苏晚", age=24, appearance=["short black hair"], signature=["red scarf"]
        )
        self.assertIn("red scarf", character.signature)
        with self.assertRaises(ValidationError):
            Character(name="未成年", age=17)

    def test_episode_rejects_duplicate_panel_order(self):
        panel_a = Panel(id="p01", order=0, characters=[PanelCharacter(character_id="char_su")])
        panel_b = Panel(id="p02", order=0, dialogues=[Dialogue(text="你好")])
        with self.assertRaises(ValidationError):
            Episode(series_id="series_x", title="第一话", order=0, panels=[panel_a, panel_b])


if __name__ == "__main__":
    unittest.main()
