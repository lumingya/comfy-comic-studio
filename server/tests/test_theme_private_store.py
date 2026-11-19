"""Canonical theme media and explicit read-only legacy sources."""

import json
from pathlib import Path

from .api_harness import ApiCase

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x00IDAT\x00\x00\x00\x00"
GIF = b"GIF89a" + b"legacy image"
IDENTIFIER = "wallpaper_" + "a" * 32
OTHER_IDENTIFIER = "wallpaper_" + "b" * 32


class ThemePrivateStoreTests(ApiCase):
    def _folder(self, *, legacy: bool) -> Path:
        if legacy:
            return Path(self.tmp) / "themes" / "paper" / "user_wallpapers"
        return Path(self.tmp) / "theme_data" / "paper" / "wallpapers"

    def _record(
        self,
        *,
        legacy: bool,
        identifier: str = IDENTIFIER,
        filename: str = "still.png",
        payload: bytes = PNG,
    ) -> tuple[Path, Path]:
        folder = self._folder(legacy=legacy)
        folder.mkdir(parents=True, exist_ok=True)
        suffix = Path(filename).suffix.removeprefix(".")
        record = {"id": identifier, "filename": filename, "kind": "image", "suffix": suffix}
        metadata = folder / f"{identifier}.json"
        metadata.write_text(json.dumps(record), encoding="utf-8")
        media = folder / f"{identifier}.{suffix}"
        media.write_bytes(payload)
        return metadata, media

    def test_legacy_wallpaper_fallback_does_not_migrate_or_create_canonical_state(self):
        metadata, media = self._record(legacy=True, filename="legacy.gif", payload=GIF)
        original = (metadata.read_bytes(), media.read_bytes())
        listed = self.ok(self.client.get("/api/themes/paper/wallpapers"))["items"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["filename"], "legacy.gif")
        self.assertIs(listed[0]["animated"], True)
        served = self.ok(self.client.get(listed[0]["url"]))
        self.assertEqual(served.content, GIF)
        self.assertEqual(served.headers["content-type"], "image/gif")
        self.assertEqual((metadata.read_bytes(), media.read_bytes()), original)
        self.assertFalse((Path(self.tmp) / "theme_data" / "paper").exists())

    def test_canonical_media_wins_conflicts_and_merges_unique_legacy_records(self):
        legacy_metadata, legacy_media = self._record(
            legacy=True, filename="legacy.gif", payload=GIF
        )
        legacy_contents = (legacy_metadata.read_bytes(), legacy_media.read_bytes())
        self._record(legacy=False, filename="canonical.png")
        self._record(legacy=True, identifier=OTHER_IDENTIFIER, filename="other.png")
        listed = self.ok(self.client.get("/api/themes/paper/wallpapers"))["items"]
        self.assertEqual([item["id"] for item in listed], [IDENTIFIER, OTHER_IDENTIFIER])
        self.assertEqual(listed[0]["filename"], "canonical.png")
        self.assertIs(listed[0]["animated"], False)
        self.assertEqual(self.ok(self.client.get(listed[0]["url"])).content, PNG)
        self.assertEqual((legacy_metadata.read_bytes(), legacy_media.read_bytes()), legacy_contents)

    def test_new_upload_keeps_legacy_source_untouched(self):
        metadata, media = self._record(legacy=True)
        original = {path.name: path.read_bytes() for path in metadata.parent.iterdir()}
        uploaded = self.ok(
            self.client.post("/api/themes/paper/wallpapers", files={"file": ("new.png", PNG)}),
            201,
        )
        self.assertTrue((self._folder(legacy=False) / f"{uploaded['id']}.png").is_file())
        self.assertEqual(
            {path.name: path.read_bytes() for path in metadata.parent.iterdir()}, original
        )
        self.assertEqual(media.read_bytes(), PNG)
        listed = self.ok(self.client.get("/api/themes/paper/wallpapers"))["items"]
        self.assertEqual({item["id"] for item in listed}, {IDENTIFIER, uploaded["id"]})

    def test_delete_removes_all_known_copies_with_different_suffixes(self):
        paths = (*self._record(legacy=True, filename="old.gif", payload=GIF),)
        paths += self._record(legacy=False, filename="current.png")
        other = self._record(legacy=True, identifier=OTHER_IDENTIFIER)
        response = self.client.delete(f"/api/themes/paper/wallpapers/{IDENTIFIER}")
        self.assertEqual(response.status_code, 204, response.text)
        self.assertTrue(all(not path.exists() for path in paths))
        self.assertTrue(all(path.exists() for path in other))
        listed = self.ok(self.client.get("/api/themes/paper/wallpapers"))["items"]
        self.assertEqual([item["id"] for item in listed], [OTHER_IDENTIFIER])
        self.assertEqual(
            self.client.get(f"/api/themes/paper/wallpapers/{IDENTIFIER}/file").status_code,
            404,
        )

    def test_invalid_canonical_state_is_not_hidden_by_legacy_fallback(self):
        self._record(legacy=True)
        metadata, _media = self._record(legacy=False)
        metadata.write_bytes(b'{"id":"duplicate","id":"duplicate"}')
        self.assertEqual(self.client.get("/api/themes/paper/wallpapers").status_code, 400)
        self.assertEqual(
            self.client.get(f"/api/themes/paper/wallpapers/{IDENTIFIER}/file").status_code,
            400,
        )
        self.assertEqual(
            self.client.delete(f"/api/themes/paper/wallpapers/{IDENTIFIER}").status_code,
            400,
        )
        self.assertTrue(all(path.exists() for path in self._folder(legacy=True).iterdir()))

    def test_shared_validation_rejects_tampered_media_and_record_fields(self):
        metadata, media = self._record(legacy=False)
        original = metadata.read_bytes()
        record = json.loads(original)
        for changes in (
            {"animated": False},
            {"filename": "../outside.png"},
            {"kind": "video"},
            {"suffix": "gif"},
        ):
            with self.subTest(changes=changes):
                metadata.write_text(json.dumps({**record, **changes}), encoding="utf-8")
                self.assertEqual(self.client.get("/api/themes/paper/wallpapers").status_code, 400)
        metadata.write_bytes(original)
        media.write_bytes(b"not a PNG")
        self.assertEqual(self.client.get("/api/themes/paper/wallpapers").status_code, 400)
        self.assertEqual(
            self.client.get(f"/api/themes/paper/wallpapers/{IDENTIFIER}/file").status_code,
            400,
        )
