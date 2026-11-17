"""Theme packages use the same install, review, enable and uninstall flow as any extension."""

import io
import json
import zipfile
from pathlib import Path

from mio_server.theme_packages import package_theme
from mio_server.themes import parse_theme

from .api_harness import ApiCase

THEME = {
    "id": "my-theme",
    "name": "雨后纸页",
    "mode": "light",
    "author": "Studio",
    "tokens": {"accent": "#345678", "button-hover": "transparent", "radius-card": "12px"},
}


class ThemePackageTests(ApiCase):
    def test_export_installs_disabled_without_code_and_does_not_replace_original(self):
        self.ok(self.client.post("/api/themes", json=THEME), 201)
        response = self.ok(self.client.get("/api/themes/my-theme/package"))
        self.assertEqual(response.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            root = archive.namelist()[0].split("/")[0]
            self.assertEqual(
                set(archive.namelist()),
                {f"{root}/{name}" for name in ("mio-extension.json", "theme.json", "README.md")},
            )
            manifest = json.loads(archive.read(f"{root}/mio-extension.json"))
            theme = json.loads(archive.read(f"{root}/theme.json"))
        self.assertNotIn("main", manifest)
        self.assertEqual(manifest["contributes"], {"themes": ["theme.json"]})
        self.assertEqual(theme["tokens"]["button-hover"], "transparent")
        self.assertEqual(theme["id"], root)
        installed = self.ok(self.client.post("/api/extensions", content=response.content), 201)
        self.assertEqual((installed["status"], installed["runs_code"]), ("disabled", False))
        self.assertNotIn(root, {item["id"] for item in self.ok(self.client.get("/api/themes"))})
        self.ok(
            self.client.post(f"/api/extensions/{root}/enable", json={"digest": installed["digest"]})
        )
        themes = {item["id"]: item for item in self.ok(self.client.get("/api/themes"))}
        self.assertEqual(themes[root]["tokens"], themes["my-theme"]["tokens"])
        self.assertEqual(themes["my-theme"]["source"], "user")
        self.ok(self.client.post(f"/api/extensions/{root}/disable"))
        self.ok(self.client.delete(f"/api/extensions/{root}"), 204)
        remaining = {item["id"] for item in self.ok(self.client.get("/api/themes"))}
        self.assertIn("my-theme", remaining)
        self.assertNotIn(root, remaining)

    def test_json_roundtrip_and_package_identity_ignore_import_id_or_timestamp(self):
        self.ok(self.client.post("/api/themes", json=THEME), 201)
        document = self.ok(self.client.get("/api/themes/my-theme"))
        self.assertEqual(document["tokens"], THEME["tokens"])
        document["id"] = "new-theme"
        self.ok(self.client.post("/api/themes", json=document), 201)
        original_id, _ = package_theme(parse_theme(THEME))
        copy_id, _ = package_theme(parse_theme(document))
        self.assertEqual(original_id, copy_id)
        document["tokens"]["accent"] = "#654321"
        changed_id, _ = package_theme(parse_theme(document))
        self.assertNotEqual(original_id, changed_id)
        response = self.ok(self.client.get("/api/themes/my-theme/package"))
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            exported = parse_theme(json.loads(archive.read(f"{original_id}/theme.json")))
        self.assertEqual(package_theme(exported)[0], original_id)

    def test_missing_theme_is_not_found_and_open_api_lists_both_operations(self):
        for suffix in ("", "/package"):
            self.assertEqual(self.client.get(f"/api/themes/missing{suffix}").status_code, 404)
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        for path in ("/themes/{theme_id}", "/themes/{theme_id}/package"):
            self.assertIn(path, schema["paths"])
        self.assertEqual(
            self.client.get("/api/v2/themes/paper/package").status_code,
            401,
        )

    def test_shipped_theme_is_a_standalone_disabled_extension(self):
        source = Path(__file__).resolve().parents[2] / "extensions" / "theme-linen"
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            for path in source.iterdir():
                if path.is_file():
                    archive.write(path, path.name)
        installed = self.ok(self.client.post("/api/extensions", content=payload.getvalue()), 201)
        self.assertEqual((installed["status"], installed["runs_code"]), ("disabled", False))
        self.assertEqual(installed["id"], "theme-linen")
        active = self.ok(
            self.client.post(
                "/api/extensions/theme-linen/enable", json={"digest": installed["digest"]}
            )
        )
        self.assertEqual(active["status"], "active")
        themes = self.ok(self.client.get("/api/themes"))
        self.assertIn("theme-linen", {item["id"] for item in themes})
