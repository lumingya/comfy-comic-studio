"""Portable identities, both ZIP adapters and media response contracts agree."""

import io
import mimetypes
import tempfile
from pathlib import Path
from unittest.mock import patch

from mio_server.theme_packages import ThemePackageError, _extract_zip_to_folder, _unpack

from .api_harness import ApiCase
from .test_theme_packages import THEME, archive, theme_files


class ThemePlatformContractTests(ApiCase):
    def test_logical_self_is_bound_in_full_and_card_css_after_two_round_trips(self):
        css = b'.theme-card[data-theme-id="self"] > .title { color: red; }'
        document = {**THEME, "style_file": "theme.css"}
        installed = self.ctx.theme_packages.install_package(
            archive(theme_files(document, resources={"theme.css": css}))
        )
        identifier = installed["id"]
        for _ in range(2):
            exported = self.ok(self.client.get(f"/api/themes/{identifier}/package")).content
            self.ok(self.client.delete(f"/api/themes/{identifier}"), 204)
            installed = self.ok(self.client.post("/api/themes/package", content=exported), 201)
            identifier = installed["id"]
            for endpoint in ("style", "card-style"):
                response = self.ok(self.client.get(f"/api/themes/{identifier}/{endpoint}"))
                self.assertIn(f'data-theme-id="{identifier}"', response.text)
                self.assertNotIn('data-theme-id="self"', response.text)

    def test_byte_and_file_zip_adapters_share_the_same_rejection_boundary(self):
        corpus = [
            {**theme_files(), "../outside.txt": b"bad"},
            {**theme_files(), "assets/../outside.png": b"bad"},
            {**theme_files(), "ASSETS/a.png": b"bad"},
            {**theme_files(), "THEME.JSON": b"{}"},
            {**theme_files(), "execute.py": b"pass"},
        ]
        for files in corpus:
            with self.subTest(extra=list(files)[-1]), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                payload = archive(files)
                path = root / "input.zip"
                path.write_bytes(payload)
                folder = root / "unpacked"
                folder.mkdir()
                with self.assertRaises(ThemePackageError):
                    _unpack(payload)
                with self.assertRaises(ThemePackageError):
                    _extract_zip_to_folder(path, folder)

    def test_media_descriptors_and_http_mime_do_not_use_the_system_registry(self):
        fixtures = (
            (
                "png",
                b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x00IDAT\x00\x00\x00\x00",
                "image/png",
                False,
            ),
            ("gif", b"GIF89a" + b"fixture", "image/gif", True),
            (
                "png",
                b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x08acTL\x00\x00\x00\x00",
                "image/png",
                True,
            ),
            ("webp", b"RIFF\x00\x00\x00\x00WEBPVP8X\x00\x00\x00\x00\x02", "image/webp", True),
            ("mp4", b"\x00\x00\x00\x18ftypisom", "video/mp4", False),
        )
        with patch.object(mimetypes, "guess_type", side_effect=AssertionError("system MIME")):
            for suffix, payload, mime, animated in fixtures:
                with self.subTest(suffix=suffix, animated=animated):
                    response = self.client.post(
                        "/api/themes/paper/wallpapers",
                        files={"file": (f"fixture.{suffix}", io.BytesIO(payload), mime)},
                    )
                    item = self.ok(response, 201)
                    self.assertEqual(item["mime_type"], mime)
                    self.assertIs(item["animated"], animated)
                    media = self.ok(self.client.get(item["url"]))
                    self.assertEqual(media.headers["content-type"], mime)
        # The installed theme asset path uses the same explicit MIME table.
        bg = b"RIFF\x00\x00\x00\x00WEBPVP8 "
        document = {**THEME, "background": {"kind": "image", "file": "assets/bg.webp"}}
        self.ctx.theme_packages.install_package(
            archive(theme_files(document, resources={"assets/bg.webp": bg}))
        )
        with patch.object(mimetypes, "guess_type", side_effect=AssertionError("system MIME")):
            catalog = self.ok(self.client.get("/api/themes"))
            descriptor = next(item for item in catalog if item["id"] == THEME["id"])["background"]
            self.assertEqual(descriptor["mime_type"], "image/webp")
            self.assertIn("animated", descriptor)
            media = self.ok(self.client.get(descriptor["url"]))
            self.assertEqual(media.headers["content-type"], "image/webp")
