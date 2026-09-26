"""P5: domain hooks, reviewed/pinned extensions, and themes."""

from __future__ import annotations

import io
import json
import os
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.hooks import HookBus, HookError

from .api_harness import LOCAL, ApiCase
from .test_compile_executor import FakeClient

THEME = {
    "id": "forest",
    "name": "森林",
    "mode": "dark",
    "tokens": {"bg": "#10201a", "accent": "#6fcf97", "shadow": "0 8px 24px rgba(0,0,0,.4)"},
}

MAIN = """
def activate(mio):
    @mio.hook("prompt.compiled")
    def tag(value, **ctx):
        value["positive"] = value["positive"] + ", ext_marker_tag"
        return value

    @mio.router.get("/hello")
    def hello():
        return {"hi": mio.id, "saved": mio.load_settings()}

    mio.save_settings({"count": 1})
"""


def write_ext(root: Path, ext_id="demo", main=MAIN, **contributes) -> Path:
    folder = root / ext_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "theme.json").write_text(json.dumps(THEME), encoding="utf-8")
    (folder / "main.py").write_text(main, encoding="utf-8")
    manifest = {
        "id": ext_id,
        "name": "演示扩展",
        "main": "main.py",
        "contributes": {
            "themes": ["theme.json"],
            "sfx_presets": {"boom": {"fill": "#ff3300", "effect": "shake"}},
            "slice_presets": [{"id": "square", "label": "方图", "width": 1080, "max_height": 1080}],
            **contributes,
        },
    }
    (folder / "mio-extension.json").write_text(json.dumps(manifest), encoding="utf-8")
    return folder


class HookBusTests(unittest.TestCase):
    def test_filters_run_by_priority_and_failures_are_skipped(self):
        bus = HookBus()
        bus.add("prompt.compiled", lambda v, **k: v + ["b"], priority=200, source="x")
        bus.add("prompt.compiled", lambda v, **k: v + ["a"], priority=10, source="y")
        bus.add("prompt.compiled", lambda v, **k: 1 / 0, source="z")
        self.assertEqual(bus.filter("prompt.compiled", []), ["a", "b"])
        self.assertEqual(bus.remove_source("x"), 1)
        self.assertEqual(bus.filter("prompt.compiled", []), ["a"])

    def test_unknown_hook_fails_loudly(self):
        with self.assertRaises(HookError):
            HookBus().add("prompt.compild", lambda v, **k: v)


class ExtensionApiTests(ApiCase):
    def root(self) -> Path:
        return self.ctx.extensions.root

    def enable(self, ext_id="demo", code=200):
        info = next(i for i in self.ok(self.client.get("/api/extensions"))["items"])
        return self.ok(
            self.client.post(f"/api/extensions/{ext_id}/enable", json={"digest": info["digest"]}),
            code,
        )

    def test_enable_requires_reviewed_digest_and_contributes_everything(self):
        write_ext(self.root())
        listing = self.ok(self.client.get("/api/extensions"))
        self.assertIn("prompt.compiled", {h["name"] for h in listing["hooks"]})
        (item,) = listing["items"]
        self.assertEqual((item["status"], item["runs_code"]), ("disabled", True))
        bad = self.client.post("/api/extensions/demo/enable", json={"digest": "0" * 64})
        self.assertEqual(bad.status_code, 400)
        info = self.enable()
        self.assertEqual(info["status"], "active")
        self.assertTrue(info["restart_required"])  # routes appear after a restart
        self.assertIn("forest", {t["id"] for t in self.ok(self.client.get("/api/themes"))})
        self.assertIn("boom", self.ok(self.client.get("/api/lettering/sfx-presets")))
        presets = {p["id"] for p in self.ok(self.client.get("/api/export/presets"))}
        self.assertIn("square", presets)

        _, ep = self.make_episode()
        self.adopt_all(ep)
        self.assertIn("ext_marker_tag", json.dumps(FakeClient.graphs, ensure_ascii=False))

        client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)  # "restart"
        hello = self.ok(client.get("/api/ext/demo/hello"))
        self.assertEqual(hello, {"hi": "demo", "saved": {"count": 1}})

        self.ok(self.client.post("/api/extensions/demo/disable"))
        self.assertNotIn("forest", {t["id"] for t in self.ok(self.client.get("/api/themes"))})
        self.assertFalse(self.ctx.registry.hooks.handlers("prompt.compiled"))

    def test_changed_files_block_loading_until_reviewed_again(self):
        folder = write_ext(self.root())
        self.enable()
        (folder / "main.py").write_text(MAIN + "\n# edited\n", encoding="utf-8")
        self.ctx.extensions.unload("demo")
        self.assertFalse(self.ctx.extensions.load("demo"))
        self.assertEqual(self.ctx.extensions.info("demo").status, "changed")
        self.assertEqual(self.enable()["status"], "active")

    def test_failing_activate_rolls_back_contributions(self):
        write_ext(self.root(), main="def activate(mio):\n    raise RuntimeError('boom')\n")
        info = self.enable()
        self.assertEqual(info["status"], "error")
        self.assertIn("boom", info["error"])
        self.assertNotIn("forest", {t["id"] for t in self.ok(self.client.get("/api/themes"))})

    def test_safe_mode_skips_loading(self):
        write_ext(self.root())
        self.enable()
        self.ctx.extensions.unload("demo")
        with mock.patch.dict(os.environ, {"MIO_SAFE_MODE": "1"}):
            self.ctx.extensions.load_all()
            self.assertTrue(self.ok(self.client.get("/api/extensions"))["safe_mode"])
        self.assertNotIn("demo", self.ctx.extensions.loaded)

    def test_install_zip_and_reject_traversal(self):
        src = write_ext(Path(self.tmp) / "src")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for path in src.iterdir():
                zf.write(path, f"demo-1.0/{path.name}")
        info = self.ok(self.client.post("/api/extensions", content=buf.getvalue()), 201)
        self.assertEqual((info["id"], info["status"]), ("demo", "disabled"))
        again = self.client.post("/api/extensions", content=buf.getvalue())
        self.assertEqual(again.status_code, 400)  # needs ?replace=true

        evil = io.BytesIO()
        with zipfile.ZipFile(evil, "w") as zf:
            zf.writestr("mio-extension.json", json.dumps({"id": "evil", "name": "x"}))
            zf.writestr("../escape.txt", "x")
        self.assertEqual(
            self.client.post("/api/extensions", content=evil.getvalue()).status_code, 400
        )
        self.assertFalse((self.root().parent / "escape.txt").exists())

        self.ok(self.client.delete("/api/extensions/demo"), 204)
        self.assertEqual(self.ok(self.client.get("/api/extensions"))["items"], [])

    def test_settings_patch_cannot_enable_extensions(self):
        write_ext(self.root())
        self.client.patch("/api/settings", json={"extensions": {"demo": {"enabled": True}}})
        self.assertNotIn("demo", self.ctx.settings().extensions)


class ThemeApiTests(ApiCase):
    def test_builtins_import_and_delete(self):
        themes = {t["id"]: t for t in self.ok(self.client.get("/api/themes"))}
        self.assertTrue({"ink", "paper"} <= set(themes))
        self.assertEqual(themes["paper"]["mode"], "light")
        self.assertIn("bg", themes["ink"]["tokens"])

        created = self.ok(self.client.post("/api/themes", json=THEME), 201)
        self.assertEqual(created["source"], "user")
        self.assertEqual(self.ctx.store.get_doc("theme", "forest").name, "森林")

        bad = {**THEME, "id": "bad", "tokens": {"bg": "url(http://x)"}}
        self.assertEqual(self.client.post("/api/themes", json=bad).status_code, 400)
        unknown = {**THEME, "id": "bad", "tokens": {"nope": "#fff"}}
        self.assertEqual(self.client.post("/api/themes", json=unknown).status_code, 400)
        self.assertEqual(
            self.client.post("/api/themes", json={**THEME, "id": "ink"}).status_code, 400
        )
        self.assertEqual(self.client.delete("/api/themes/ink").status_code, 400)
        self.ok(self.client.delete("/api/themes/forest"), 204)
        self.assertNotIn("forest", {t["id"] for t in self.ok(self.client.get("/api/themes"))})


if __name__ == "__main__":
    unittest.main()
