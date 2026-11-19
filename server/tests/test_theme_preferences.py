"""Persistence, validation, and serving for per-theme preferences and wallpapers."""

import io
import json
import stat
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from .api_harness import ApiCase
from .test_theme_packages import archive as make_archive
from .test_theme_packages import theme_files

PNG = b"\x89PNG\r\n\x1a\n" + b"theme-wallpaper"


class ThemePreferenceTests(ApiCase):
    def test_preferences_persist_as_isolated_json_objects(self):
        self.assertEqual(self.ok(self.client.get("/api/themes/paper/preferences")), {})

        paper_preferences = {"wallpaper": "paper-one", "layout": {"fit": "cover"}}
        self.assertEqual(
            self.ok(self.client.put("/api/themes/paper/preferences", json=paper_preferences)),
            paper_preferences,
        )
        self.assertEqual(
            self.ok(self.client.put("/api/themes/sakura/preferences", json={"wallpaper": "pink"})),
            {"wallpaper": "pink"},
        )

        path = Path(self.tmp) / "theme_data" / "paper" / "preferences.json"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), paper_preferences)
        self.assertEqual(
            self.ok(self.client.get("/api/themes/paper/preferences")), paper_preferences
        )
        self.assertEqual(
            self.ok(self.client.get("/api/themes/sakura/preferences")), {"wallpaper": "pink"}
        )

    def test_preferences_reject_non_objects_invalid_json_and_oversized_bodies(self):
        url = "/api/themes/paper/preferences"
        headers = {"content-type": "application/json"}
        for payload in (b"[]", b'{"same":1,"same":2}', b'{"bad":NaN}', b"{"):
            with self.subTest(payload=payload):
                self.assertEqual(
                    self.client.put(url, content=payload, headers=headers).status_code, 400
                )

        with patch("mio_server.api.theme_preferences.MAX_PREFERENCES_BYTES", 16):
            response = self.client.put(url, content=b" " * 17, headers=headers)
        self.assertEqual(response.status_code, 400)

    def test_unregistered_theme_preferences_and_wallpapers_are_not_accessible(self):
        for method, path in (
            (self.client.get, "/api/themes/unregistered/preferences"),
            (self.client.get, "/api/themes/unregistered/wallpapers"),
        ):
            with self.subTest(path=path):
                self.assertEqual(method(path).status_code, 404)
        self.assertEqual(
            self.client.put("/api/themes/unregistered/preferences", json={"x": 1}).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                "/api/themes/unregistered/wallpapers",
                files={"file": ("wall.png", PNG, "image/png")},
            ).status_code,
            404,
        )

    def test_preferences_and_wallpaper_paths_reject_symlinks(self):
        preferences = Path(self.tmp) / "theme_data" / "paper" / "preferences.json"
        preferences.parent.mkdir(parents=True)
        preferences.write_text("{}", encoding="utf-8")
        wallpaper_folder = Path(self.tmp) / "themes" / "paper" / "user_wallpapers"
        wallpaper_folder.mkdir(parents=True)
        original_lstat = Path.lstat

        def linked(path, *args, **kwargs):
            if path in {preferences, wallpaper_folder}:
                return SimpleNamespace(st_mode=stat.S_IFLNK, st_file_attributes=0)
            return original_lstat(path, *args, **kwargs)

        with patch.object(Path, "lstat", new=linked):
            self.assertEqual(self.client.get("/api/themes/paper/preferences").status_code, 400)
            self.assertEqual(self.client.get("/api/themes/paper/wallpapers").status_code, 400)

    def test_wallpaper_upload_list_serve_and_delete(self):
        uploaded = self.client.post(
            "/api/themes/paper/wallpapers",
            files={"file": ("paper wall.png", PNG, "image/png")},
        )
        item = self.ok(uploaded, 201)
        self.assertEqual(set(item), {"id", "filename", "kind", "animated", "mime_type", "url"})
        self.assertRegex(item["id"], r"^wallpaper_[a-f0-9]{32}$")
        self.assertEqual(item["filename"], "paper wall.png")
        self.assertEqual(item["kind"], "image")
        self.assertEqual(item["url"], f"/api/themes/paper/wallpapers/{item['id']}/file")

        folder = Path(self.tmp) / "theme_data" / "paper" / "wallpapers"
        self.assertTrue((folder / f"{item['id']}.png").is_file())
        self.assertFalse((Path(self.tmp) / "themes" / "paper").exists())
        self.assertEqual(
            self.ok(self.client.get("/api/themes/paper/wallpapers")), {"items": [item]}
        )
        self.assertEqual(self.ok(self.client.get("/api/themes/sakura/wallpapers")), {"items": []})

        served = self.ok(self.client.get(item["url"]))
        self.assertEqual(served.content, PNG)
        self.assertEqual(served.headers["content-type"], "image/png")
        self.assertEqual(served.headers["x-content-type-options"], "nosniff")
        self.assertEqual(
            served.headers["content-disposition"], f'inline; filename="{item["id"]}.png"'
        )
        self.assertEqual(served.headers["content-security-policy"], "default-src 'none'; sandbox")
        self.assertEqual(served.headers["cross-origin-resource-policy"], "same-origin")
        self.assertIn("no-store", served.headers["cache-control"])

        deleted = self.client.delete(f"/api/themes/paper/wallpapers/{item['id']}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.ok(self.client.get("/api/themes/paper/wallpapers")), {"items": []})
        self.assertEqual(self.client.get(item["url"]).status_code, 404)
        self.assertFalse((folder / f"{item['id']}.png").exists())
        self.assertFalse((folder / f"{item['id']}.json").exists())

    def test_wallpaper_validation_checks_field_type_signature_and_size(self):
        url = "/api/themes/paper/wallpapers"
        invalid = self.client.post(url, files={"file": ("fake.png", b"not a png", "image/png")})
        self.assertEqual(invalid.status_code, 400)
        unsupported = self.client.post(url, files={"file": ("notes.txt", b"text", "text/plain")})
        self.assertEqual(unsupported.status_code, 400)
        wrong_field = self.client.post(url, files={"upload": ("wall.png", PNG, "image/png")})
        self.assertEqual(wrong_field.status_code, 400)

        with patch("mio_server.api.theme_preferences.MAX_WALLPAPER_BYTES", 8):
            oversized = self.client.post(url, files={"file": ("large.png", PNG, "image/png")})
        self.assertEqual(oversized.status_code, 400)
        self.assertEqual(self.ok(self.client.get(url)), {"items": []})

    def test_wallpaper_upload_uses_existing_video_media_checks(self):
        mp4 = b"\x00\x00\x00\x18ftypmp42" + b"theme-video"
        item = self.ok(
            self.client.post(
                "/api/themes/paper/wallpapers",
                files={"file": ("motion.mp4", mp4, "video/mp4")},
            ),
            201,
        )
        self.assertEqual(item["kind"], "video")
        self.assertIs(item["animated"], False)
        response = self.ok(self.client.get(item["url"]))
        self.assertEqual(response.content, mp4)
        self.assertEqual(response.headers["content-type"], "video/mp4")

    def test_wallpaper_upload_and_existing_records_report_animation(self):
        signature = b"\x89PNG\r\n\x1a\n"
        png = signature + b"\x00\x00\x00\x00IDAT\x00\x00\x00\x00"
        apng = signature + b"\x00\x00\x00\x08acTL" + b"\x00" * 12
        for filename, payload, animated in (
            ("still.png", png, False),
            ("motion.png", apng, True),
            ("motion.gif", b"GIF89a" + b"wallpaper", True),
            ("still.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00", False),
            ("motion.webp", b"RIFF\x00\x00\x00\x00WEBPANIM\x00\x00\x00\x00", True),
            ("still.jpg", b"\xff\xd8\xffwallpaper", False),
        ):
            with self.subTest(filename=filename):
                uploaded = self.ok(
                    self.client.post(
                        "/api/themes/paper/wallpapers", files={"file": (filename, payload)}
                    ),
                    201,
                )
                self.assertIs(uploaded["animated"], animated)
                folder = Path(self.tmp) / "theme_data" / "paper" / "wallpapers"
                record = json.loads((folder / f"{uploaded['id']}.json").read_text("utf-8"))
                self.assertEqual(set(record), {"id", "filename", "kind", "suffix"})
                listed = self.ok(self.client.get("/api/themes/paper/wallpapers"))["items"]
                self.assertEqual(
                    next(item for item in listed if item["id"] == uploaded["id"]), uploaded
                )

    def test_wallpaper_animation_detection_reads_a_bounded_prefix(self):
        from mio_server.theme_media import MAX_IMAGE_ANIMATION_PROBE, image_may_animate

        payload = b"GIF89a" + b"x" * (MAX_IMAGE_ANIMATION_PROBE + 1024)
        with patch("mio_server.theme_media.image_may_animate", wraps=image_may_animate) as probe:
            item = self.ok(
                self.client.post(
                    "/api/themes/paper/wallpapers", files={"file": ("motion.gif", payload)}
                ),
                201,
            )
        self.assertIs(item["animated"], True)
        self.assertEqual(len(probe.call_args.args[1]), MAX_IMAGE_ANIMATION_PROBE)

    def test_builtin_package_export_does_not_include_user_wallpapers(self):
        """New private uploads never become portable package files."""
        item = self.ok(
            self.client.post(
                "/api/themes/paper/wallpapers",
                files={"file": ("private.png", PNG, "image/png")},
            ),
            201,
        )
        package = self.ok(self.client.get("/api/themes/paper/package"))
        with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
            self.assertFalse(any("user_wallpapers" in name for name in archive.namelist()))
            self.assertFalse(any(item["id"] in name for name in archive.namelist()))

        package_theme = {
            "id": "wallpaper-theme",
            "name": "Wallpaper Theme",
            "mode": "light",
            "background": {"kind": "image", "file": "assets/background.png"},
        }
        package_files = theme_files(package_theme, resources={"assets/background.png": PNG})
        installed = self.ok(
            self.client.post("/api/themes/package", content=make_archive(package_files)), 201
        )
        theme_id = installed["id"]
        item = self.ok(
            self.client.post(
                f"/api/themes/{theme_id}/wallpapers",
                files={"file": ("private.png", PNG, "image/png")},
            ),
            201,
        )
        package = self.ok(self.client.get(f"/api/themes/{theme_id}/package"))
        with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
            self.assertFalse(any("user_wallpapers" in name for name in archive.namelist()))
            self.assertFalse(any(item["id"] in name for name in archive.namelist()))
            self.assertTrue(
                any(name.endswith("/assets/background.png") for name in archive.namelist())
            )

    def test_open_api_registers_preferences_and_wallpaper_routes(self):
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        for path in (
            "/themes/{theme_id}/preferences",
            "/themes/{theme_id}/wallpapers",
            "/themes/{theme_id}/wallpapers/{wallpaper_id}",
            "/themes/{theme_id}/wallpapers/{wallpaper_id}/file",
        ):
            self.assertIn(path, schema["paths"])
        self.assertEqual(
            schema["paths"]["/themes/{theme_id}/preferences"]["put"]["requestBody"]["content"][
                "application/json"
            ]["schema"]["type"],
            "object",
        )
        self.assertIn(
            "file",
            schema["paths"]["/themes/{theme_id}/wallpapers"]["post"]["requestBody"]["content"][
                "multipart/form-data"
            ]["schema"]["properties"],
        )
        self.assertEqual(
            self.client.get("/api/v2/themes/paper/preferences").status_code,
            401,
        )
