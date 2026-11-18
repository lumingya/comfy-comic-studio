"""Independent data-only theme package lifecycle."""

import io
import json
import stat
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.theme_media import image_may_animate, validate_stylesheet
from mio_server.theme_packages import (
    MAX_FILE,
    ThemePackageError,
    ThemePackageManager,
    package_theme,
)
from mio_server.themes import Theme, parse_theme

from .api_harness import ApiCase

THEME = {
    "id": "my-theme",
    "name": "雨后纸页",
    "mode": "light",
    "author": "Studio",
    "tokens": {"accent": "#345678", "button-hover": "transparent", "radius-card": "12px"},
}


def theme_files(theme=None, *, manifest_id=None, name=None, resources=None):
    document = theme or THEME
    files = {
        "mio-theme.json": json.dumps(
            {
                "id": manifest_id or document["id"],
                "name": name or document["name"],
                "version": "1.0.0",
                "author": document.get("author", ""),
                "description": "",
                "theme_file": "theme.json",
            }
        ).encode(),
        "theme.json": json.dumps(document).encode(),
        "README.md": b"Independent theme data.",
    }
    files.update(resources or {})
    return files


def archive(files=None, *, prefix=""):
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as output:
        for name, data in (files or theme_files()).items():
            output.writestr(f"{prefix}{name}", data)
    return payload.getvalue()


class ThemePackageTests(ApiCase):
    def test_bundled_theme_loads_from_top_level_themes_not_extensions(self):
        result = self.ok(self.client.get("/api/themes"))
        themes = {item["id"]: item for item in result}
        self.assertEqual(themes["theme-linen"]["source"], "builtin")
        self.assertEqual(themes["theme-linen"]["name"], "素纸")
        self.assertNotIn("theme-linen", {item.id for item in self.ctx.extensions.list()})
        self.assertTrue(
            (Path(__file__).resolve().parents[2] / "themes/theme-linen/mio-theme.json").is_file()
        )

    def test_export_creates_independent_theme_zip_and_it_can_be_installed_and_removed(self):
        self.ok(self.client.post("/api/themes", json=THEME), 201)
        response = self.ok(self.client.get("/api/themes/my-theme/package"))
        self.assertEqual(response.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as package:
            root = package.namelist()[0].split("/")[0]
            names = set(package.namelist())
            self.assertEqual(
                names,
                {f"{root}/{name}" for name in ("mio-theme.json", "theme.json", "README.md")},
            )
            self.assertNotIn(f"{root}/mio-extension.json", names)
            manifest = json.loads(package.read(f"{root}/mio-theme.json"))
            theme = json.loads(package.read(f"{root}/theme.json"))
        self.assertEqual(manifest["id"], root)
        self.assertEqual(manifest["theme_file"], "theme.json")
        self.assertEqual(theme["tokens"]["button-hover"], "transparent")
        self.assertEqual(theme["id"], root)

        installed = self.ok(self.client.post("/api/themes/package", content=response.content), 201)
        self.assertEqual(installed["source"], "theme-package")
        self.assertNotEqual(root, "my-theme")
        stored = Path(self.tmp) / "themes" / root
        self.assertTrue((stored / "mio-theme.json").is_file())
        registered = {item["id"]: item for item in self.ok(self.client.get("/api/themes"))}
        self.assertEqual(registered[root]["tokens"], installed["tokens"])
        self.assertEqual(registered[root]["source"], "theme-package")
        self.assertEqual(registered["my-theme"]["source"], "user")
        self.ok(self.client.delete(f"/api/themes/{root}"), 204)
        self.assertFalse(stored.exists())
        self.assertNotIn(root, {item["id"] for item in self.ok(self.client.get("/api/themes"))})

    def test_folder_import_is_independent_and_api_data_is_selectable(self):
        uploaded = theme_files()
        files = [
            ("files", (f"my-theme/{name}", data, "application/octet-stream"))
            for name, data in uploaded.items()
        ]
        installed = self.ok(self.client.post("/api/themes/folder", files=files), 201)
        self.assertEqual(installed["id"], "my-theme")
        self.assertEqual(installed["mode"], "light")
        theme = self.ctx.registry.get("theme", "my-theme")
        self.assertEqual(theme.tokens["accent"], "#345678")
        self.assertEqual(
            (Path(self.tmp) / "themes/my-theme/theme.json").read_bytes(), uploaded["theme.json"]
        )

    def test_video_theme_round_trips_resources_and_serves_script_as_inert_text(self):
        document = {
            **THEME,
            "background": {
                "kind": "video",
                "file": "assets/wallpaper.mp4",
                "opacity": 0.42,
            },
            "script_file": "theme.js",
        }
        video = b"\x00\x00\x00\x18ftypisom" + b"theme-video-fixture"
        script = b"theme.setColor('accent', '#123456');"
        uploaded = theme_files(
            document,
            resources={"assets/wallpaper.mp4": video, "theme.js": script},
        )
        installed = self.ok(self.client.post("/api/themes/package", content=archive(uploaded)), 201)
        theme_id = installed["id"]
        entry = next(
            item for item in self.ok(self.client.get("/api/themes")) if item["id"] == theme_id
        )
        self.assertEqual(
            entry["background"],
            {
                "kind": "video",
                "url": f"/api/themes/{theme_id}/assets/wallpaper.mp4",
                "opacity": 0.42,
            },
        )
        self.assertEqual(entry["script_url"], f"/api/themes/{theme_id}/script")
        self.assertRegex(entry["script_digest"], r"^[a-f0-9]{64}$")
        media = self.client.get(entry["background"]["url"], headers={"Range": "bytes=4-11"})
        self.assertEqual(media.status_code, 206)
        self.assertEqual(media.content, video[4:12])
        self.assertEqual(media.headers["content-type"], "video/mp4")
        self.assertEqual(media.headers["cache-control"], "no-cache")
        self.assertEqual(
            self.client.get(f"/api/themes/{theme_id}/assets/theme.js").status_code, 404
        )
        script_response = self.client.get(entry["script_url"])
        self.assertEqual(script_response.text, script.decode())
        self.assertTrue(script_response.headers["content-type"].startswith("text/plain"))
        self.assertEqual(script_response.headers["x-content-type-options"], "nosniff")
        self.assertIn("sandbox", script_response.headers["content-security-policy"])
        self.assertEqual(script_response.headers["content-disposition"], "attachment")

        exported = self.ok(self.client.get(f"/api/themes/{theme_id}/package"))
        with zipfile.ZipFile(io.BytesIO(exported.content)) as package:
            root = package.namelist()[0].split("/")[0]
            self.assertEqual(package.read(f"{root}/assets/wallpaper.mp4"), video)
            self.assertEqual(package.read(f"{root}/theme.js"), script)

    def test_theme_css_uses_nested_local_assets_and_round_trips(self):
        document = {
            **THEME,
            "id": "theme-css",
            "style_file": "theme.css",
            "background": {
                "kind": "image",
                "file": "assets/wallpapers/paper.png",
                "opacity": 0.35,
            },
        }
        stylesheet = (
            b'body #root { display: grid; background-image: url("assets/wallpapers/paper.png"); }'
            b'@font-face { font-family: "Theme Ink"; src: url(assets/fonts/ink.woff2); }'
        )
        image = b"\x89PNG\r\n\x1a\n" + b"portable-theme-image"
        font = b"wOF2" + b"portable-theme-font"
        uploaded = theme_files(
            document,
            resources={
                "theme.css": stylesheet,
                "assets/wallpapers/paper.png": image,
                "assets/fonts/ink.woff2": font,
            },
        )
        imported = self.ok(self.client.post("/api/themes/package", content=archive(uploaded)), 201)
        theme_id = imported["id"]
        entry = next(
            item for item in self.ok(self.client.get("/api/themes")) if item["id"] == theme_id
        )
        self.assertEqual(entry["style_url"], f"/api/themes/{theme_id}/style")
        self.assertEqual(
            entry["background"]["url"], f"/api/themes/{theme_id}/assets/wallpapers/paper.png"
        )
        self.assertEqual(self.client.get(entry["style_url"]).content, stylesheet)
        self.assertEqual(self.client.get(entry["background"]["url"]).content, image)
        self.assertEqual(
            self.client.get(f"/api/themes/{theme_id}/assets/fonts/ink.woff2").content, font
        )

        exported = self.ok(self.client.get(f"/api/themes/{theme_id}/package"))
        with zipfile.ZipFile(io.BytesIO(exported.content)) as package:
            root = package.namelist()[0].split("/")[0]
            self.assertEqual(package.read(f"{root}/theme.css"), stylesheet)
            self.assertEqual(package.read(f"{root}/assets/wallpapers/paper.png"), image)
            self.assertEqual(package.read(f"{root}/assets/fonts/ink.woff2"), font)

    def test_theme_css_rejects_external_urls_imports_and_unused_assets(self):
        document = {**THEME, "id": "theme-css", "style_file": "theme.css"}
        rejected_styles = (
            b'@import "https://example.invalid/theme.css";',
            b'/* @ */ @/**/import "https://example.invalid/theme.css";',
            b"body { background: url(../wallpaper.png); }",
            b'body { background: url("https://example.invalid/image.png"); }',
        )
        for stylesheet in rejected_styles:
            with self.subTest(stylesheet=stylesheet):
                package = archive(theme_files(document, resources={"theme.css": stylesheet}))
                self.assertEqual(
                    self.client.post("/api/themes/package", content=package).status_code, 400
                )
        package = archive(
            theme_files(
                document,
                resources={
                    "theme.css": b"body { color: var(--text); }",
                    "assets/unused.png": b"\x89PNG\r\n\x1a\nfixture",
                },
            )
        )
        self.assertEqual(self.client.post("/api/themes/package", content=package).status_code, 400)

    def test_stylesheet_accepts_non_ascii_selectors_without_external_resources(self):
        self.assertEqual(validate_stylesheet(".主题卡 { color: red; }", set()), set())

    def test_animated_image_probe_detects_common_containers(self):
        apng = b"\x89PNG\r\n\x1a\n" + (0).to_bytes(4, "big") + b"acTL" + b"\0" * 8
        webp = b"RIFF\x20\0\0\0WEBP" + b"ANIM\0\0\0\0"
        static_webp = b"RIFF\x20\0\0\0WEBP" + b"VP8 " + b"\0\0\0\0"
        self.assertTrue(image_may_animate("assets/paper.gif", b"GIF89a"))
        self.assertTrue(image_may_animate("assets/paper.png", apng))
        self.assertTrue(image_may_animate("assets/paper.webp", webp))
        self.assertFalse(image_may_animate("assets/paper.webp", static_webp))

    def test_theme_list_marks_animated_image_backgrounds(self):
        document = {
            **THEME,
            "id": "animated-image",
            "background": {
                "kind": "image",
                "file": "assets/wallpaper.webp",
                "opacity": 0.25,
            },
        }
        animated = b"RIFF\x20\0\0\0WEBP" + b"ANIM\0\0\0\0"
        files = theme_files(document, resources={"assets/wallpaper.webp": animated})
        installed = self.ok(self.client.post("/api/themes/package", content=archive(files)), 201)
        listed = next(
            item
            for item in self.ok(self.client.get("/api/themes"))
            if item["id"] == installed["id"]
        )
        self.assertTrue(listed["background"]["animated"])

    def test_folder_import_preserves_nested_theme_resources(self):
        document = {**THEME, "id": "nested-theme", "style_file": "theme.css"}
        css = b"body { background-image: url(assets/images/paper.png); }"
        image = b"\x89PNG\r\n\x1a\nfolder-theme-image"
        uploaded = theme_files(
            document,
            resources={"theme.css": css, "assets/images/paper.png": image},
        )
        files = [
            ("files", (f"nested-theme/{name}", data, "application/octet-stream"))
            for name, data in uploaded.items()
        ]
        result = self.ok(self.client.post("/api/themes/folder", files=files), 201)
        self.assertEqual(
            (Path(self.tmp) / "themes/nested-theme/assets/images/paper.png").read_bytes(), image
        )
        entry = next(
            item for item in self.ok(self.client.get("/api/themes")) if item["id"] == result["id"]
        )
        self.assertEqual(self.client.get(entry["style_url"]).content, css)

    def test_media_theme_rejects_missing_assets_unsupported_files_and_mime_mismatch(self):
        document = {
            **THEME,
            "background": {
                "kind": "video",
                "file": "assets/wallpaper.mp4",
                "opacity": 0.5,
            },
        }
        invalid = (
            theme_files(document),
            theme_files(document, resources={"assets/wallpaper.mp4": b"not a video"}),
            theme_files(
                document,
                resources={
                    "assets/wallpaper.mp4": b"\x00\x00\x00\x18ftypisom",
                    "assets/unused.png": b"unused",
                },
            ),
        )
        for files in invalid:
            with self.subTest(files=sorted(files)):
                self.assertEqual(
                    self.client.post("/api/themes/package", content=archive(files)).status_code,
                    400,
                )

    def test_packages_reload_from_runtime_folder_without_extension_activation(self):
        self.ok(self.client.post("/api/themes/package", content=archive()), 201)
        self.ctx.registry.unregister("theme", "my-theme")
        reloaded = ThemePackageManager(self.ctx)
        reloaded.load_all()
        installed = next(item for item in self.ctx.registry.all("theme") if item.id == "my-theme")
        self.assertEqual(installed.source, "theme-package")
        self.assertEqual(installed.value.tokens, THEME["tokens"])
        reloaded.remove("my-theme")
        self.assertFalse((Path(self.tmp) / "themes/my-theme").exists())

    def test_json_roundtrip_and_user_theme_replacement_remain_available(self):
        imported = self.ok(self.client.post("/api/themes", json=THEME), 201)
        document = self.ok(self.client.get("/api/themes/my-theme"))
        self.assertEqual(document["tokens"]["accent"], "#345678")
        document["tokens"]["accent"] = "#654321"
        replaced = self.ok(self.client.post("/api/themes", json=document), 201)
        self.assertEqual(imported["source"], "user")
        self.assertEqual(replaced["tokens"]["accent"], "#654321")
        package_id, payload = package_theme(parse_theme(THEME))
        package_id2, _ = package_theme(parse_theme(document))
        self.assertNotEqual(package_id2, package_id)
        copied = {**THEME, "id": "a-different-id"}
        self.assertEqual(package_theme(parse_theme(copied))[0], package_id)
        self.assertIsInstance(payload, bytes)

    def test_builtin_and_extension_theme_ids_cannot_be_replaced_or_deleted(self):
        conflict = {**THEME, "id": "paper"}
        self.assertEqual(self.client.post("/api/themes", json=conflict).status_code, 400)
        self.assertEqual(
            self.client.post(
                "/api/themes/package", content=archive(theme_files(conflict))
            ).status_code,
            400,
        )
        extension_theme = Theme(**{**THEME, "id": "extension-theme"})
        self.ctx.registry.register(
            "theme", extension_theme.id, extension_theme, source="demo-extension"
        )
        self.assertEqual(self.client.delete("/api/themes/extension-theme").status_code, 400)
        self.assertEqual(
            self.client.post(
                "/api/themes/package",
                content=archive(theme_files({**THEME, "id": extension_theme.id})),
            ).status_code,
            400,
        )

    def test_package_rejects_paths_duplicates_extra_files_and_identity_mismatch(self):
        safe = theme_files()
        for payload in (
            archive(prefix="../"),
            archive(prefix="my-theme//"),
            archive(prefix="my-theme/./"),
            archive({**safe, "entry.py": b"print('no')"}),
            archive({**safe, "mio-theme.json": b"{}"}),
            archive(theme_files({**THEME, "id": "con"})),
            archive({**safe, "README.md": b"x" * (MAX_FILE + 1)}),
        ):
            self.assertEqual(
                self.client.post("/api/themes/package", content=payload).status_code, 400
            )
        duplicated = io.BytesIO()
        with zipfile.ZipFile(duplicated, "w") as output:
            output.writestr("mio-theme.json", safe["mio-theme.json"])
            output.writestr("mio-theme.json", safe["mio-theme.json"])
            output.writestr("theme.json", safe["theme.json"])
        self.assertEqual(
            self.client.post("/api/themes/package", content=duplicated.getvalue()).status_code, 400
        )
        mismatched = theme_files(manifest_id="other-theme")
        self.assertEqual(
            self.client.post("/api/themes/package", content=archive(mismatched)).status_code, 400
        )
        linked = io.BytesIO()
        with zipfile.ZipFile(linked, "w") as output:
            link = zipfile.ZipInfo("theme.json")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            output.writestr(link, b"../elsewhere.json")
            output.writestr("mio-theme.json", safe["mio-theme.json"])
        self.assertEqual(
            self.client.post("/api/themes/package", content=linked.getvalue()).status_code, 400
        )

    def test_folder_import_rejects_mixed_roots_and_unsafe_paths(self):
        body = theme_files()
        mixed = [
            ("files", (f"root-{index}/{name}", data, "application/octet-stream"))
            for index, (name, data) in enumerate(body.items())
        ]
        self.assertEqual(self.client.post("/api/themes/folder", files=mixed).status_code, 400)
        unsafe = [("files", ("../theme.json", body["theme.json"], "application/json"))]
        self.assertEqual(self.client.post("/api/themes/folder", files=unsafe).status_code, 400)

    def test_open_api_documents_import_export_and_removal(self):
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        for path in (
            "/themes/{theme_id}",
            "/themes/{theme_id}/package",
            "/themes/package",
            "/themes/folder",
        ):
            self.assertIn(path, schema["paths"])
        self.assertEqual(
            self.client.get("/api/v2/themes/paper/package").status_code,
            401,
        )

    def test_install_rejects_linked_root_or_target_before_writing(self):
        root = Path(self.tmp) / "themes"
        root.mkdir()
        original = Path.lstat
        for target in (root, root / "my-theme"):
            for attributes, mode in (
                (stat.FILE_ATTRIBUTE_REPARSE_POINT, stat.S_IFDIR),
                (0, stat.S_IFLNK),
            ):
                with self.subTest(target=target.name, mode=mode):

                    def linked(path, *args, **kwargs):
                        if path == target:
                            return SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
                        return original(path, *args, **kwargs)

                    with patch.object(Path, "lstat", new=linked):
                        with self.assertRaises(ThemePackageError):
                            self.ctx.theme_packages.install_package(archive())
                    self.assertEqual(list(root.iterdir()), [])
                    self.assertNotIn(
                        "my-theme", {item.id for item in self.ctx.registry.all("theme")}
                    )

    def test_load_and_remove_reject_links_or_reparse_points_without_touching_data(self):
        self.ctx.theme_packages.install_package(archive())
        root = Path(self.tmp) / "themes"
        folder = root / "my-theme"
        file = folder / "theme.json"
        saved = {item.name: item.read_bytes() for item in folder.iterdir()}
        original = Path.lstat
        for target in (root, folder, file):
            for attributes, mode in (
                (
                    stat.FILE_ATTRIBUTE_REPARSE_POINT,
                    stat.S_IFREG if target == file else stat.S_IFDIR,
                ),
                (0, stat.S_IFLNK),
            ):
                with self.subTest(target=target.name, mode=mode):

                    def linked(path, *args, **kwargs):
                        if path == target:
                            return SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
                        return original(path, *args, **kwargs)

                    self.ctx.registry.unregister("theme", "my-theme")
                    with patch.object(Path, "lstat", new=linked):
                        with self.assertLogs("mio.themes", level="WARNING"):
                            ThemePackageManager(self.ctx).load_all()
                        self.assertNotIn(
                            "my-theme", {item.id for item in self.ctx.registry.all("theme")}
                        )
                        with self.assertRaises(ThemePackageError):
                            self.ctx.theme_packages.remove("my-theme")
                    self.assertEqual(
                        {item.name: item.read_bytes() for item in folder.iterdir()}, saved
                    )

    def test_install_does_not_create_missing_root_through_linked_parent(self):
        root = Path(self.tmp) / "themes"
        outside = Path(self.tmp) / "outside"
        original = Path.resolve

        def redirected(path, *args, **kwargs):
            if path == root:
                return outside / "themes"
            return original(path, *args, **kwargs)

        with patch.object(Path, "resolve", new=redirected):
            with self.assertRaises(ThemePackageError):
                self.ctx.theme_packages.install_package(archive())
        self.assertFalse(root.exists())
        self.assertFalse(outside.exists())
