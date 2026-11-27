"""Panel directories verify their candidates without hashing unrelated extension packages."""

import json
import os
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.extensions.manifest import ManifestError, digest, read_manifest

from .api_harness import ApiCase


class SurfaceDigestTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.builtins = Path(self.tmp).parent / "bundled-extensions"
        self.builtins.mkdir()
        builtin_root = patch("mio_server.extensions.manager.BUILTIN_ROOT", self.builtins)
        builtin_root.start()
        self.addCleanup(builtin_root.stop)

    def package(self, identifier, *, root=None, panels=True, workspace=False, enabled=False):
        folder = (root or self.ctx.extensions.root) / identifier
        folder.mkdir(parents=True)
        manifest = {"id": identifier, "name": identifier, "contributes": {}}
        if panels:
            manifest["contributes"] = {
                "panels": [
                    {
                        "id": "review",
                        "slot": "episode",
                        "title": "Reviewed panel",
                        "entry": "panel.html",
                    }
                ],
                "host_slots": [
                    {
                        "id": "open-review",
                        "slot": "command_palette",
                        "title": "Reviewed slot",
                        "action": {"kind": "open_panel", "panel_id": "review"},
                    }
                ],
            }
            (folder / "panel.html").write_text("<html>Reviewed panel</html>", encoding="utf-8")
            (folder / "panel.js").write_text("window.reviewed = true;", encoding="utf-8")
        if workspace:
            manifest["workspace"] = {"entry": "workspace.html", "title": "Workspace"}
            (folder / "workspace.html").write_text("<html>Workspace</html>", encoding="utf-8")
        dependencies = folder / "node_modules"
        dependencies.mkdir()
        (dependencies / "reviewed.js").write_text("export const reviewed = true;", encoding="utf-8")
        (folder / "mio-extension.json").write_text(json.dumps(manifest), encoding="utf-8")
        if enabled:
            info = self.ctx.extensions.enable(identifier, digest(folder))
            self.assertEqual(info.status, "active", info.error)
        return folder

    def directories(self):
        return (
            self.ok(self.client.get("/api/extension-panels")),
            self.ok(self.client.get("/api/extension-host-slots")),
        )

    def test_directories_do_not_hash_disabled_or_workspace_only_packages(self):
        self.package("ai-assist", root=self.builtins, panels=False, workspace=True)
        self.package("disabled-panel")
        self.package("workspace-only", panels=False, workspace=True, enabled=True)
        folder = self.package("review-panel", enabled=True)
        with (
            patch("mio_server.extensions.manager.digest", wraps=digest) as manager_digest,
            patch("mio_server.extensions.panel_bridge.digest", wraps=digest) as panel_digest,
        ):
            panels, slots = self.directories()

        self.assertEqual([panel["extension"] for panel in panels], ["review-panel"])
        self.assertEqual([slot["extension"] for slot in slots], ["review-panel"])
        loaded = self.ctx.extensions.loaded["review-panel"]
        self.assertEqual(panels[0]["activation"], loaded.api.activation_id)
        self.assertEqual(panels[0]["digest"], loaded.api.digest)
        self.assertEqual(slots[0]["panel"]["activation"], loaded.api.activation_id)
        self.assertEqual(slots[0]["panel"]["digest"], loaded.api.digest)
        for spy in (manager_digest, panel_digest):
            self.assertTrue(spy.called)
            self.assertEqual({call.args[0] for call in spy.call_args_list}, {folder})

    def test_prefilter_metadata_cannot_authorize_panel_or_host_slot_output(self):
        folder = self.package("review-panel", enabled=True)
        unreviewed = read_manifest(folder).model_copy(deep=True)
        unreviewed.contributes.panels[0].title = "Unreviewed panel"
        unreviewed.contributes.panels[0].entry = "unreviewed.html"
        unreviewed.contributes.host_slots[0].title = "Unreviewed slot"
        unreviewed.contributes.host_slots[0].priority = 100
        with (
            patch("mio_server.api.extension_surfaces.read_manifest", return_value=unreviewed),
            patch("mio_server.api.extension_host_slots.read_manifest", return_value=unreviewed),
        ):
            panels, slots = self.directories()

        self.assertEqual(panels[0]["title"], "Reviewed panel")
        self.assertEqual(panels[0]["url"], "/api/extensions/review-panel/files/panel.html")
        self.assertEqual(slots[0]["title"], "Reviewed slot")
        self.assertEqual(slots[0]["priority"], 0)
        self.assertEqual(slots[0]["panel"]["entry"], "panel.html")
        self.assertEqual(slots[0]["panel"]["title"], "Reviewed panel")

    def test_changed_assets_dependencies_and_manifest_are_omitted_immediately(self):
        folder = self.package("review-panel", enabled=True)
        for relative in ("panel.js", "node_modules/reviewed.js", "mio-extension.json"):
            target = folder / relative
            original = target.read_bytes()
            with self.subTest(relative=relative):
                try:
                    target.write_bytes(b"unreviewed content")
                    self.assertEqual(self.directories(), ([], []))
                finally:
                    target.write_bytes(original)

    def test_workspace_surface_callback_rechecks_digest_before_execution(self):
        folder = self.package("workspace-panel", panels=False, workspace=True, enabled=True)
        called = []

        def surface():
            called.append(True)
            return {"entry": "workspace.html", "title": "Workspace"}

        self.ctx.registry.register(
            "workspace_surface",
            "workspace-panel-surface",
            surface,
            source="ext:workspace-panel",
            digest=self.ctx.extensions.loaded["workspace-panel"].api.digest,
        )
        original_check = self.ctx.registry.activation_check

        def modify_then_check(contribution):
            if contribution.point == "workspace_surface":
                (folder / "workspace.html").write_text("changed after review", encoding="utf-8")
            return original_check(contribution)

        with patch.object(self.ctx.registry, "activation_check", modify_then_check):
            result = self.ok(self.client.get("/api/extension-surfaces"))

        self.assertEqual(result, {"items": []})
        self.assertEqual(called, [])

    def test_symlinked_child_module_cannot_keep_the_reviewed_digest(self):
        folder = self.package("review-panel", panels=False)
        reviewed = digest(folder)
        target = Path(self.tmp) / "linked-extension-module"
        target.mkdir()
        module = target / "child.py"
        module.write_text("VALUE = 'reviewed'\n", encoding="utf-8")
        link = folder / "modules"
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            # Some Windows hosts disallow creating symlinks without elevated privileges.
            # Keep the regression active by simulating the filesystem's symlink report.
            link.mkdir()
        original_lstat = Path.lstat

        def report_symlink(path):
            if path.name == link.name:
                return SimpleNamespace(st_mode=stat.S_IFLNK | 0o777)
            return original_lstat(path)

        with patch.object(Path, "lstat", report_symlink):
            with self.assertRaisesRegex(ManifestError, "symlinked directory"):
                read_manifest(folder)
            with self.assertRaisesRegex(OSError, "symlinked directory"):
                digest(folder)
            module.write_text("VALUE = 'unreviewed'\n", encoding="utf-8")
            with self.assertRaisesRegex(OSError, "symlinked directory"):
                digest(folder)
        self.assertEqual(len(reviewed), 64)

    def test_reparse_point_directory_cannot_escape_the_reviewed_digest(self):
        folder = self.package("reparse-package", panels=False)
        target = Path(self.tmp) / "external-extension-module"
        target.mkdir()
        (target / "helper.py").write_text("VALUE = 'outside'\n", encoding="utf-8")
        link = folder / "linked-module"
        if os.name == "nt":
            subprocess.run(
                ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
                check=True,
                capture_output=True,
            )
            try:
                with self.assertRaisesRegex(OSError, "symlinked directory or junction"):
                    digest(folder)
            finally:
                link.rmdir()
        else:
            link.mkdir()
            original_lstat = Path.lstat

            def report_reparse_point(path):
                if path == link:
                    return SimpleNamespace(
                        st_mode=original_lstat(path).st_mode,
                        st_file_attributes=0x400,
                    )
                return original_lstat(path)

            with patch.object(Path, "lstat", report_reparse_point):
                with self.assertRaisesRegex(OSError, "symlinked directory or junction"):
                    digest(folder)

    def test_changed_host_slot_declaration_cannot_pollute_output(self):
        folder = self.package("review-panel", enabled=True)
        target = folder / "mio-extension.json"
        manifest = json.loads(target.read_text(encoding="utf-8"))
        manifest["contributes"]["host_slots"][0]["title"] = "Unreviewed slot"
        target.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertEqual(self.directories(), ([], []))
