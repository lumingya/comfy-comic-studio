"""Focused validation and storage tests for extension backend contracts."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from mio_server.extension_preferences import (
    MAX_PREFERENCES_JSON,
    load_preferences,
    save_preferences,
)
from mio_server.extensions.manifest import ManifestError, read_manifest


class FloatingSurfaceManifestTests(unittest.TestCase):
    def test_surface_specs_are_strict_and_entries_stay_inside_extension(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / "ui").mkdir()
            (folder / "ui" / "index.html").write_text("<html></html>", encoding="utf-8")
            manifest = {
                "id": "demo",
                "name": "Demo",
                "contributes": {
                    "floating_surfaces": [
                        {
                            "id": "palette",
                            "title": "Palette",
                            "entry": "ui/index.html",
                            "global": True,
                            "default_position": {
                                "x": "right",
                                "y": "bottom",
                                "offset": [20, 20],
                            },
                        }
                    ]
                },
            }
            path = folder / "mio-extension.json"

            def write_and_read(value):
                path.write_text(json.dumps(value), encoding="utf-8")
                return read_manifest(folder)

            parsed = write_and_read(manifest)
            self.assertEqual(parsed.contributes.floating_surfaces[0].priority, 0)
            self.assertTrue(parsed.contributes.floating_surfaces[0].global_)
            self.assertTrue(parsed.contributes.floating_surfaces[0].transparent)

            invalid_specs = []
            missing_global = json.loads(json.dumps(manifest))
            del missing_global["contributes"]["floating_surfaces"][0]["global"]
            invalid_specs.append(missing_global)

            non_integer_priority = json.loads(json.dumps(manifest))
            non_integer_priority["contributes"]["floating_surfaces"][0]["priority"] = True
            invalid_specs.append(non_integer_priority)

            unknown_field = json.loads(json.dumps(manifest))
            unknown_field["contributes"]["floating_surfaces"][0]["handler"] = "click"
            invalid_specs.append(unknown_field)

            escaped_entry = json.loads(json.dumps(manifest))
            escaped_entry["contributes"]["floating_surfaces"][0]["entry"] = "../outside.html"
            invalid_specs.append(escaped_entry)

            for invalid in invalid_specs:
                with self.subTest(spec=invalid), self.assertRaises(ManifestError):
                    write_and_read(invalid)


class ExtensionPreferencesStorageTests(unittest.TestCase):
    def test_preferences_are_bounded_per_identifier_and_separate_from_settings(self):
        with tempfile.TemporaryDirectory() as temporary:
            data_dir = Path(temporary)
            self.assertEqual(load_preferences(data_dir, "demo"), {})
            save_preferences(data_dir, "demo", {"theme": "dark"})
            save_preferences(data_dir, "other", {"theme": "light"})

            self.assertEqual(load_preferences(data_dir, "demo"), {"theme": "dark"})
            self.assertEqual(load_preferences(data_dir, "other"), {"theme": "light"})
            self.assertTrue((data_dir / "extension_data" / "demo" / "preferences.json").is_file())

            for identifier in ("../other", "demo/../../other", "DEMO"):
                with self.subTest(identifier=identifier), self.assertRaises(ValueError):
                    load_preferences(data_dir, identifier)

            with self.assertRaises(ValueError):
                save_preferences(data_dir, "demo", {"value": "x" * MAX_PREFERENCES_JSON})


if __name__ == "__main__":
    unittest.main()
