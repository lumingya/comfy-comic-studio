"""P5: domain hooks, reviewed/pinned extensions, and themes."""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.context import AppContext
from mio_server.extensions.manifest import digest, inside
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
        self.assertEqual(bus.filter("prompt.compiled", []), ["b", "a"])
        self.assertEqual(bus.remove_source("x"), 1)
        self.assertEqual(bus.filter("prompt.compiled", []), ["a"])

    def test_equal_priority_hooks_keep_registration_order_and_priority_is_integer(self):
        bus = HookBus()
        bus.add("prompt.compiled", lambda value, **_: value + ["first"])
        bus.add("prompt.compiled", lambda value, **_: value + ["second"], priority=0)
        bus.add("prompt.compiled", lambda value, **_: value + ["high"], priority=10)
        self.assertEqual(bus.filter("prompt.compiled", []), ["high", "first", "second"])
        for priority in (True, 1.5, "3"):
            with self.subTest(priority=priority), self.assertRaises(HookError):
                bus.add("prompt.compiled", lambda value, **_: value, priority=priority)

    def test_unknown_hook_fails_loudly(self):
        with self.assertRaises(HookError):
            HookBus().add("prompt.compild", lambda v, **k: v)


class ExtensionApiTests(ApiCase):
    def root(self) -> Path:
        return self.ctx.extensions.root

    def enable(self, ext_id="demo", code=200):
        info = next(
            i for i in self.ok(self.client.get("/api/extensions"))["items"] if i["id"] == ext_id
        )
        return self.ok(
            self.client.post(f"/api/extensions/{ext_id}/enable", json={"digest": info["digest"]}),
            code,
        )

    def test_builtin_restart_keeps_reviewed_pin_and_refuses_changed_code(self):
        builtins = Path(self.tmp).parent / "test-builtins"
        folder = write_ext(builtins)
        with mock.patch("mio_server.extensions.manager.BUILTIN_ROOT", builtins):
            reviewed = self.enable()["digest"]
            data_dir = self.ctx.data_dir
            self.ctx.close()
            (folder / "main.py").write_text(
                MAIN + "\nraise AssertionError('unreviewed code executed')\n", encoding="utf-8"
            )
            restarted = AppContext.create(data_dir, autostart=False, seed_instance=False)
            try:
                state = restarted.settings().extensions["demo"]
                self.assertTrue(state.enabled)
                self.assertEqual(state.digest, reviewed)
                self.assertEqual(restarted.extensions.info("demo").status, "changed")
                self.assertNotIn("demo", restarted.extensions.loaded)
            finally:
                restarted.close()

    def test_builtin_restart_loads_only_unchanged_explicitly_enabled_packages(self):
        builtins = Path(self.tmp).parent / "test-builtins"
        write_ext(builtins)
        write_ext(builtins, "sleeping")
        with mock.patch("mio_server.extensions.manager.BUILTIN_ROOT", builtins):
            reviewed = self.enable()["digest"]
            data_dir = self.ctx.data_dir
            self.ctx.close()
            restarted = AppContext.create(data_dir, autostart=False, seed_instance=False)
            try:
                self.assertEqual(restarted.extensions.info("demo").status, "active")
                self.assertEqual(restarted.settings().extensions["demo"].digest, reviewed)
                self.assertEqual(restarted.extensions.info("sleeping").status, "disabled")
                self.assertNotIn("sleeping", restarted.settings().extensions)
                self.assertNotIn("sleeping", restarted.extensions.loaded)
            finally:
                restarted.close()

    def test_enable_requires_reviewed_digest_and_contributes_everything(self):
        write_ext(self.root())
        listing = self.ok(self.client.get("/api/extensions"))
        self.assertIn("prompt.compiled", {h["name"] for h in listing["hooks"]})
        item = next(i for i in listing["items"] if i["id"] == "demo")
        self.assertEqual((item["status"], item["runs_code"]), ("disabled", True))
        bad = self.client.post("/api/extensions/demo/enable", json={"digest": "0" * 64})
        self.assertEqual(bad.status_code, 400)
        info = self.enable()
        self.assertEqual(info["status"], "active")
        self.assertFalse(info["restart_required"])  # routes mount dynamically
        self.assertIn("forest", {t["id"] for t in self.ok(self.client.get("/api/themes"))})
        self.assertIn("boom", self.ok(self.client.get("/api/lettering/sfx-presets")))
        presets = {p["id"] for p in self.ok(self.client.get("/api/export/presets"))}
        self.assertIn("square", presets)

        _, ep = self.make_episode()
        # One rendered panel proves the prompt hook is active; the other eleven fixture
        # panels only add unrelated disk work to drain's deadline on slower Windows CI.
        trimmed = self.ctx.store.update_episode(
            ep["id"], lambda episode: setattr(episode, "panels", episode.ordered_panels()[:1])
        )
        self.adopt_all(trimmed.model_dump(mode="json"))
        self.assertEqual(len(FakeClient.graphs), 1)
        self.assertIn("ext_marker_tag", json.dumps(FakeClient.graphs, ensure_ascii=False))

        client = TestClient(create_app(self.ctx, serve_web=False), base_url=LOCAL)  # "restart"
        hello = self.ok(client.get("/api/ext/demo/hello"))
        self.assertEqual(hello, {"hi": "demo", "saved": {"count": 1}})

    def test_manifest_panels_sort_by_priority_and_surface_metadata_is_exposed(self):
        folder = write_ext(
            self.root(),
            main="def activate(mio):\n    pass\n",
            panels=[
                {"id": "normal", "slot": "settings", "title": "Normal", "entry": "normal.html"},
                {
                    "id": "high",
                    "slot": "settings",
                    "title": "High",
                    "entry": "high.html",
                    "priority": 50,
                },
                {
                    "id": "tied",
                    "slot": "settings",
                    "title": "Tied",
                    "entry": "tied.html",
                    "priority": 50,
                },
            ],
            floating_surfaces=[
                {
                    "id": "palette",
                    "title": "Palette",
                    "entry": "ui/index.html",
                    "global": True,
                    "transparent": False,
                    "default_position": {"x": 24, "y": 36},
                    "priority": 80,
                }
            ],
        )
        for entry in ("normal.html", "high.html", "tied.html"):
            (folder / entry).write_text("<html></html>", encoding="utf-8")
        (folder / "ui").mkdir()
        (folder / "ui" / "index.html").write_text("<html>palette</html>", encoding="utf-8")

        listed = next(
            item
            for item in self.ok(self.client.get("/api/extensions"))["items"]
            if item["id"] == "demo"
        )
        self.assertEqual([panel["id"] for panel in listed["panels"]], ["high", "tied", "normal"])
        self.enable()
        panels = self.ok(self.client.get("/api/extension-panels"))
        self.assertEqual([panel["id"] for panel in panels], ["high", "tied", "normal"])
        self.assertEqual([panel["priority"] for panel in panels], [50, 50, 0])

        surfaces = self.ok(self.client.get("/api/extension-surfaces"))["items"]
        surface = next(item for item in surfaces if item["id"] == "palette")
        self.assertEqual(
            surface["activation"], self.ctx.extensions.loaded["demo"].api.activation_id
        )
        self.assertEqual(surface["digest"], self.ctx.extensions.loaded["demo"].api.digest)
        old_activation = surface["activation"]
        self.assertEqual(
            {
                key: surface[key]
                for key in ("priority", "global", "transparent", "default_position", "mode")
            },
            {
                "priority": 80,
                "global": True,
                "transparent": False,
                "default_position": {"x": 24, "y": 36, "offset": [20, 20]},
                "mode": "floating",
            },
        )
        served = self.client.get(surface["url"])
        self.assertIn("<html>palette</html>", served.text)
        self.assertLess(served.text.index("workspace-bridge.js"), served.text.index("palette"))
        self.assertIn("Content-Security-Policy", served.headers)
        self.ctx.extensions.disable("demo")
        self.assertEqual(self.ok(self.client.get("/api/extension-surfaces"))["items"], [])
        self.enable()
        reloaded = self.ok(self.client.get("/api/extension-surfaces"))["items"][0]
        self.assertNotEqual(reloaded["activation"], old_activation)
        self.assertEqual(reloaded["digest"], surface["digest"])

    def test_workspace_bridge_injects_before_scripts_and_keeps_digest_guard(self):
        folder = write_ext(self.root(), main="def activate(mio):\n    pass\n")
        (folder / "ui").mkdir()
        (folder / "ui" / "index.html").write_text(
            '<!doctype html><html><head><script src="app.js"></script></head></html>',
            encoding="utf-8",
        )
        (folder / "ui" / "app.js").write_text("window.started = true;", encoding="utf-8")
        manifest_path = folder / "mio-extension.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["workspace"] = {"entry": "ui/index.html", "title": "Workspace"}
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.enable()

        page = self.client.get("/api/extensions/demo/workspace/ui/index.html")
        self.assertEqual(page.status_code, 200)
        self.assertLess(page.text.index("workspace-bridge.js"), page.text.index("app.js"))
        self.assertEqual(
            page.headers["content-security-policy"],
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
        )

        bridge = self.client.get("/api/extensions/demo/workspace-bridge.js")
        self.assertEqual(bridge.status_code, 200)
        for protocol in (
            "window, 'bridge'",
            "mio:workspace:resize",
            "mio:workspace:click-through",
            "mio:workspace:moved",
            "mio:workspace:lifecycle",
            "onLifecycle(handler)",
            "mio:workspace:listen",
            "send(protocol.types.listen, { event: type, enabled: true })",
            "send(protocol.types.listen, { event: type, enabled: false })",
            "session, ...payload",
            "mio:workspace:event-result",
            "eventId: message.eventId, action",
            "action = protocol.decisions.continue_",
            "action = protocol.decisions.handled",
            "stop_propagation",
        ):
            self.assertIn(protocol, bridge.text)

        (folder / "ui" / "app.js").write_text("window.changed = true;", encoding="utf-8")
        self.assertEqual(
            self.client.get("/api/extensions/demo/workspace/ui/index.html").status_code, 404
        )
        self.assertEqual(
            self.client.get("/api/extensions/demo/workspace-bridge.js").status_code, 404
        )

    def test_extension_preferences_are_isolated_and_keep_settings_unchanged(self):
        write_ext(self.root(), main="def activate(mio):\n    pass\n")
        self.assertEqual(self.ok(self.client.get("/api/ext/demo/preferences")), {})
        self.ok(self.client.put("/api/extensions/demo/settings", json={"legacy": 1}))
        self.assertEqual(
            self.ok(self.client.put("/api/ext/demo/preferences", json={"theme": "dark"})),
            {"theme": "dark"},
        )
        preferences_path = self.ctx.data_dir / "extensions_data" / "demo" / "preferences.json"
        settings_path = self.ctx.data_dir / "extensions_data" / "demo" / "settings.json"
        self.assertTrue(preferences_path.is_file())
        self.assertEqual(self.ok(self.client.get("/api/ext/demo/preferences")), {"theme": "dark"})
        self.assertEqual(json.loads(settings_path.read_text(encoding="utf-8")), {"legacy": 1})

        write_ext(self.root(), ext_id="other", main="def activate(mio):\n    pass\n")
        self.ok(self.client.put("/api/ext/other/preferences", json={"theme": "light"}))
        self.assertEqual(self.ok(self.client.get("/api/ext/demo/preferences")), {"theme": "dark"})
        for ext_id in ("../other", "demo/../../other", "DEMO"):
            with self.subTest(ext_id=ext_id):
                response = self.client.get(f"/api/ext/{ext_id}/preferences")
                self.assertNotEqual(response.status_code, 200)

        self.assertEqual(
            self.client.delete("/api/extensions/demo?delete_data=true").status_code, 204
        )
        self.assertFalse(preferences_path.exists())
        self.assertEqual(
            json.loads(
                (self.ctx.data_dir / "extensions_data" / "other" / "preferences.json").read_text(
                    encoding="utf-8"
                )
            ),
            {"theme": "light"},
        )

    def test_requirements_wait_for_reviewed_enable_and_are_announced(self):
        folder = write_ext(self.root())
        (folder / "requirements.txt").write_text(
            "mio-test-package-that-is-not-installed>=1\n", encoding="utf-8"
        )
        info = next(
            item
            for item in self.ok(self.client.get("/api/extensions"))["items"]
            if item["id"] == "demo"
        )
        self.assertTrue(info["has_requirements"])
        self.assertTrue(info["runs_code"])
        with (
            mock.patch(
                "mio_server.extensions.manager.ensure_requirements",
                return_value=("mio-test-package-that-is-not-installed>=1",),
            ) as install,
        ):
            install.assert_not_called()
            activated = self.enable()
        self.assertEqual(activated["status"], "active")
        install.assert_called_once_with(folder)

        self.ok(self.client.post("/api/extensions/demo/disable"))
        self.assertNotIn("forest", {t["id"] for t in self.ok(self.client.get("/api/themes"))})
        self.assertFalse(self.ctx.registry.hooks.handlers("prompt.compiled"))

    def test_requirements_change_during_preflight_blocks_extension_activation(self):
        folder = write_ext(self.root())
        (folder / "requirements.txt").write_text("first-package>=1\n", encoding="utf-8")

        def alter_requirements(extension_folder):
            (extension_folder / "requirements.txt").write_text(
                "different-package>=1\n", encoding="utf-8"
            )
            return ()

        with mock.patch(
            "mio_server.extensions.manager.ensure_requirements", side_effect=alter_requirements
        ):
            enabled = self.enable()
        self.assertEqual(enabled["status"], "error")
        self.assertFalse(self.ctx.registry.hooks.handlers("prompt.compiled"))

    def test_changed_files_block_loading_until_reviewed_again(self):
        folder = write_ext(self.root())
        self.enable()
        (folder / "main.py").write_text(MAIN + "\n# edited\n", encoding="utf-8")
        self.ctx.extensions.unload("demo")
        self.assertFalse(self.ctx.extensions.load("demo"))
        self.assertEqual(self.ctx.extensions.info("demo").status, "changed")
        self.assertEqual(self.enable()["status"], "active")

    def test_all_package_files_including_dot_directories_are_digest_covered(self):
        folder = write_ext(self.root())
        hidden = folder / ".git" / "unreviewed.py"
        hidden.parent.mkdir()
        hidden.write_text("value = 'before'\n", encoding="utf-8")
        cache = folder / "__pycache__" / "unreviewed.pyc"
        cache.parent.mkdir()
        cache.write_bytes(b"reviewed bytecode")
        before = digest(folder)
        hidden.write_text("value = 'after'\n", encoding="utf-8")
        self.assertNotEqual(digest(folder), before)
        cache_before = digest(folder)
        cache.write_bytes(b"modified bytecode")
        self.assertNotEqual(digest(folder), cache_before)
        self.assertEqual(inside(folder, "__pycache__/unreviewed.pyc"), cache)

    def test_python_entry_under_dot_directory_cannot_change_without_new_digest(self):
        folder = write_ext(self.root())
        hidden = folder / ".git" / "main.py"
        hidden.parent.mkdir()
        hidden.write_text("def activate(mio):\n    pass\n", encoding="utf-8")
        manifest_path = folder / "mio-extension.json"
        manifest = json.loads(manifest_path.read_text("utf-8"))
        manifest["main"] = ".git/main.py"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        approved = digest(folder)
        hidden.write_text(
            "def activate(mio):\n    @mio.router.get('/hidden')\n    def hidden(): return {'modified': True}\n",
            encoding="utf-8",
        )
        self.assertNotEqual(digest(folder), approved)
        response = self.client.post("/api/extensions/demo/enable", json={"digest": approved})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("demo", self.ctx.extensions.loaded)

    def test_extension_lazy_imports_do_not_create_unhashed_bytecode(self):
        original = sys.dont_write_bytecode
        self.addCleanup(setattr, sys, "dont_write_bytecode", original)
        folder = write_ext(
            self.root(),
            main=MAIN
            + "\n    @mio.router.get('/lazy')\n"
            + "    def lazy():\n"
            + "        from .helper import VALUE\n"
            + "        return {'value': VALUE}\n",
        )
        (folder / "helper.py").write_text("VALUE = 'approved'\n", encoding="utf-8")
        self.assertEqual(self.enable()["status"], "active")
        self.assertTrue(sys.dont_write_bytecode)
        self.assertEqual(self.ok(self.client.get("/api/ext/demo/lazy")), {"value": "approved"})
        self.assertFalse((folder / "__pycache__").exists())
        self.assertEqual(digest(folder), self.ctx.extensions.loaded["demo"].api.digest)

    def test_injected_extension_bytecode_invalidates_the_reviewed_route(self):
        folder = write_ext(self.root())
        self.enable()
        cache = folder / "__pycache__" / "helper.cpython-313.pyc"
        cache.parent.mkdir()
        cache.write_bytes(b"unreviewed bytecode")
        self.assertEqual(self.ctx.extensions.info("demo").status, "changed")
        self.assertEqual(self.client.get("/api/ext/demo/hello").status_code, 404)

    def test_modified_panel_assets_are_not_served_from_a_stale_activation(self):
        folder = write_ext(
            self.root(),
            panels=[
                {
                    "id": "demo-panel",
                    "slot": "episode",
                    "title": "Demo",
                    "entry": "panel.html",
                }
            ],
        )
        entry = folder / "panel.html"
        entry.write_text("<!doctype html><title>reviewed</title>", encoding="utf-8")
        self.enable()
        response = self.client.get("/api/extensions/demo/files/panel.html")
        self.assertEqual(response.status_code, 200)
        self.assertIn("form-action 'none'", response.headers["content-security-policy"])
        self.assertIn("frame-src 'none'", response.headers["content-security-policy"])
        entry.write_text("<!doctype html><script>unreviewed()</script>", encoding="utf-8")
        self.assertEqual(self.ctx.extensions.info("demo").status, "changed")
        self.assertEqual(self.client.get("/api/extensions/demo/files/panel.html").status_code, 404)

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
        info = self.ctx.extensions.info("demo")
        with mock.patch.dict(os.environ, {"MIO_SAFE_MODE": "1"}):
            self.ctx.extensions.load_all()
            self.assertTrue(self.ok(self.client.get("/api/extensions"))["safe_mode"])
            with self.assertRaises(ValueError):
                self.ctx.extensions.enable("demo", info.digest)
            self.assertFalse(self.ctx.extensions.load("demo"))
            denied = self.client.post("/api/extensions/demo/enable", json={"digest": info.digest})
            self.assertEqual(denied.status_code, 400)
        self.assertNotIn("demo", self.ctx.extensions.loaded)
        self.assertEqual(self.ctx.extensions.info("demo").status, "disabled")

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

        for traversal in ("../escape.txt", "..\\escape.txt", "\\absolute.txt"):
            with self.subTest(path=traversal):
                evil = io.BytesIO()
                with zipfile.ZipFile(evil, "w") as zf:
                    zf.writestr("mio-extension.json", json.dumps({"id": "evil", "name": "x"}))
                    zf.writestr(traversal, "x")
                self.assertEqual(
                    self.client.post("/api/extensions", content=evil.getvalue()).status_code, 400
                )
                self.assertFalse((self.root() / "escape.txt").exists())
                self.assertFalse((self.root() / ".staging-evil").exists())

        for alias in ("demo-1.0/./mio-extension.json", "demo-1.0//mio-extension.json"):
            with self.subTest(path=alias):
                evil = io.BytesIO()
                with zipfile.ZipFile(evil, "w") as zf:
                    zf.writestr(
                        "demo-1.0/mio-extension.json",
                        json.dumps({"id": "alias-demo", "name": "valid"}),
                    )
                    zf.writestr(alias, json.dumps({"id": "overwritten", "name": "evil"}))
                self.assertEqual(
                    self.client.post("/api/extensions", content=evil.getvalue()).status_code, 400
                )
                self.assertFalse((self.root() / "alias-demo").exists())
                self.assertFalse((self.root() / ".staging-alias-demo").exists())

        self.ok(self.client.delete("/api/extensions/demo"), 204)
        self.assertEqual(
            [i for i in self.ok(self.client.get("/api/extensions"))["items"] if not i["builtin"]],
            [],
        )

    def test_install_path_streams_archive_members(self):
        source = write_ext(Path(self.tmp) / "path-src", ext_id="path-demo")
        asset = source / "assets" / "nested" / "large.bin"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"extension-stream-test" * 100_000)
        archive = Path(self.tmp) / "path-demo.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for path in source.rglob("*"):
                if path.is_file():
                    output.write(path, f"path-demo-1.0/{path.relative_to(source).as_posix()}")

        with mock.patch.object(
            zipfile.ZipFile, "read", side_effect=AssertionError("ZipFile.read buffers a member")
        ):
            info = self.ctx.extensions.install_path(archive)

        self.assertEqual((info.id, info.status), ("path-demo", "disabled"))
        installed_asset = self.root() / "path-demo" / "assets" / "nested" / "large.bin"
        self.assertEqual(installed_asset.stat().st_size, asset.stat().st_size)

    def test_folder_upload_streams_multipart_files_to_install(self):
        source = write_ext(Path(self.tmp) / "folder-src", ext_id="folder-demo")
        asset = source / "assets" / "sample.bin"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"folder-stream-test" * 50_000)
        files = [
            (
                "files",
                (
                    f"folder-demo-1.0/{path.relative_to(source).as_posix()}",
                    path.read_bytes(),
                    "application/octet-stream",
                ),
            )
            for path in source.rglob("*")
            if path.is_file()
        ]

        response = self.client.post("/api/extensions/folder", files=files)

        info = self.ok(response, 201)
        self.assertEqual((info["id"], info["status"]), ("folder-demo", "disabled"))
        installed_asset = self.root() / "folder-demo" / "assets" / "sample.bin"
        self.assertEqual(installed_asset.read_bytes(), asset.read_bytes())

    def test_manager_install_keeps_bytes_compatibility(self):
        source = write_ext(Path(self.tmp) / "bytes-src", ext_id="bytes-demo")
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as output:
            for path in source.iterdir():
                output.write(path, f"bytes-demo-1.0/{path.name}")

        info = self.ctx.extensions.install(archive.getvalue())

        self.assertEqual((info.id, info.status), ("bytes-demo", "disabled"))

    def test_settings_patch_cannot_enable_extensions(self):
        write_ext(self.root())
        self.client.patch("/api/settings", json={"extensions": {"demo": {"enabled": True}}})
        self.assertNotIn("demo", self.ctx.settings().extensions)


class ThemeApiTests(ApiCase):
    def test_semantic_theme_tokens_round_trip_through_user_import(self):
        tokens = {
            "button-border": "transparent",
            "button-primary": "#448866",
            "control-height": "2.5rem",
            "radius-control": "0",
            "space-panel": "24px",
            "shadow-sm": "none",
        }
        created = self.ok(self.client.post("/api/themes", json={**THEME, "tokens": tokens}), 201)
        stored = self.ctx.store.get_doc("theme", "forest")
        listed = next(t for t in self.ok(self.client.get("/api/themes")) if t["id"] == "forest")
        self.assertEqual(stored.tokens, tokens)
        for name, value in tokens.items():
            self.assertEqual(created["tokens"][name], value)
            self.assertEqual(listed["tokens"][name], value)
        self.assertEqual(created["source"], "user")
        self.assertNotIn("surface-panel", created["tokens"])
        invalid = {**THEME, "id": "invalid-css", "tokens": {"control-height": "calc(1rem)"}}
        self.assertEqual(self.client.post("/api/themes", json=invalid).status_code, 400)
        self.assertNotIn("invalid-css", {t["id"] for t in self.ok(self.client.get("/api/themes"))})

    def test_extension_themes_share_the_typed_token_validation(self):
        folder = write_ext(self.ctx.extensions.root, main="def activate(mio):\n    pass\n")
        (folder / "theme.css").write_text(
            "@font-face { font-family: ThemeInk; src: url(assets/fonts/ink.woff2); }",
            encoding="utf-8",
        )
        (folder / "theme.js").write_text("theme.setColor('accent', '#123456');", encoding="utf-8")
        (folder / "assets" / "fonts").mkdir(parents=True)
        (folder / "assets" / "fonts" / "ink.woff2").write_bytes(b"wOF2extension-font")
        tokens = {
            "control-surface": "transparent",
            "radius-card": "12px",
            "space-control": ".5rem",
            "shadow-sm": "0 2px 8px rgb(0 0 0 / .2)",
        }
        (folder / "theme.json").write_text(
            json.dumps(
                {
                    **THEME,
                    "tokens": tokens,
                    "style_file": "theme.css",
                    "script_file": "theme.js",
                }
            ),
            encoding="utf-8",
        )
        info = next(
            i for i in self.ok(self.client.get("/api/extensions"))["items"] if i["id"] == "demo"
        )
        enabled = self.ok(
            self.client.post("/api/extensions/demo/enable", json={"digest": info["digest"]})
        )
        self.assertEqual(enabled["status"], "active")
        imported = next(t for t in self.ok(self.client.get("/api/themes")) if t["id"] == "forest")
        self.assertRegex(imported["script_digest"], r"^[a-f0-9]{64}$")
        self.assertEqual(
            self.client.get(imported["script_url"]).text,
            "theme.setColor('accent', '#123456');",
        )
        for name, value in tokens.items():
            self.assertEqual(imported["tokens"][name], value)
        self.assertEqual(
            self.client.get(imported["style_url"]).status_code,
            200,
        )
        package = self.ok(self.client.get("/api/themes/forest/package"))
        with zipfile.ZipFile(io.BytesIO(package.content)) as archive:
            root = archive.namelist()[0].split("/")[0]
            self.assertEqual(archive.read(f"{root}/assets/fonts/ink.woff2"), b"wOF2extension-font")
            self.assertIn(b"font-face", archive.read(f"{root}/theme.css"))
            self.assertEqual(
                archive.read(f"{root}/theme.js"), b"theme.setColor('accent', '#123456');"
            )

        self.ok(self.client.post("/api/extensions/demo/disable"))
        bad = {**THEME, "tokens": {"shadow-sm": "0 0 0 var(--unsafe)"}}
        (folder / "theme.json").write_text(json.dumps(bad), encoding="utf-8")
        info = next(
            i for i in self.ok(self.client.get("/api/extensions"))["items"] if i["id"] == "demo"
        )
        enabled = self.ok(
            self.client.post("/api/extensions/demo/enable", json={"digest": info["digest"]})
        )
        self.assertEqual(enabled["status"], "error")
        self.assertNotIn("forest", {t["id"] for t in self.ok(self.client.get("/api/themes"))})

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
