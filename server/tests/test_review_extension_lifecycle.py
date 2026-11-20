"""R3-LIFE-04/05: failed extension publication retains the prior usable lifecycle."""

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from mio_server.backups.extension_data import load_settings, save_settings
from mio_server.context import AppContext
from mio_server.extensions.manager import ExtensionError
from mio_server.extensions.manifest import digest
from mio_server.extensions.sdk import ExtensionAPI
from mio_server.extensions.trust import reviewed_packages, trust_root

MAIN = """
class Service:
    busy = False
    closed = False

    def close(self):
        self.closed = True

def activate(mio):
    service = mio.service(Service())
    mio.contribute("text_provider", "lifecycle", lambda: service)
    @mio.hook("prompt.compiled")
    def original(value, **kwargs):
        return value
    @mio.router.get("/alive")
    def alive():
        return {"alive": not service.closed}
"""


class ExtensionLifecycleReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.temporary = Path(temporary.name)
        self.ctx = AppContext.create(
            self.temporary / "workspace", autostart=False, seed_instance=False
        )
        self.addCleanup(self.ctx.close)
        self.manager = self.ctx.extensions

    def package(self, version="1.0.0"):
        folder = self.manager.root / "lifecycle"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "mio-extension.json").write_text(
            json.dumps(
                {"id": "lifecycle", "name": "Lifecycle", "version": version, "main": "main.py"}
            ),
            encoding="utf-8",
        )
        (folder / "main.py").write_text(MAIN, encoding="utf-8")
        (folder / "custom-original.txt").write_bytes(b"the only customized original")
        return folder

    def replacement(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr(
                "mio-extension.json",
                json.dumps(
                    {
                        "id": "lifecycle",
                        "name": "Lifecycle",
                        "version": "2.0.0",
                        "main": "main.py",
                    }
                ),
            )
            output.writestr("main.py", "def activate(mio): pass\n")
        return archive.getvalue()

    def enable(self):
        return self.manager.enable("lifecycle", self.manager.info("lifecycle").digest)

    def test_failed_replace_publication_preserves_original_package_and_activation(self):
        folder = self.package()
        self.assertEqual(self.enable().status, "active")
        loaded = self.manager.loaded["lifecycle"]
        service = self.ctx.extension_services["lifecycle"]
        state = self.ctx.settings().extensions["lifecycle"]
        original = self.ctx.registry.get("text_provider", "lifecycle")
        save_settings(self.ctx.data_dir, "lifecycle", {"private": "retained"})
        rename = Path.rename

        def denied(source, target):
            if Path(target) == folder and source.name in {"package", ".staging-lifecycle"}:
                raise OSError("publication denied")
            return rename(source, target)

        with (
            patch.object(Path, "rename", denied),
            self.assertRaisesRegex(OSError, "publication denied"),
        ):
            self.manager.install(self.replacement(), replace=True)

        self.assertTrue((folder / "custom-original.txt").is_file())
        self.assertEqual(self.manager.info("lifecycle").manifest.version, "1.0.0")
        self.assertIs(self.manager.loaded.get("lifecycle"), loaded)
        self.assertTrue(loaded.api.active)
        self.assertIs(self.ctx.extension_services.get("lifecycle"), service)
        self.assertFalse(service.closed)
        self.assertIs(self.ctx.registry.get("text_provider", "lifecycle"), original)
        self.assertEqual(self.ctx.settings().extensions["lifecycle"], state)
        self.assertEqual(load_settings(self.ctx.data_dir, "lifecycle"), {"private": "retained"})
        self.assertEqual(self.manager._catalog_transitions, 0)

    def test_failed_trust_publication_rolls_back_new_activation(self):
        self.package()
        created = []
        service = ExtensionAPI.service

        def capture(api, value):
            created.append(value)
            return service(api, value)

        with (
            patch.object(ExtensionAPI, "service", capture),
            patch("mio_server.extensions.trust.remember_package", side_effect=OSError("disk full")),
        ):
            try:
                self.enable()
            except OSError:
                pass

        self.assertNotIn("lifecycle", self.manager.loaded)
        self.assertNotIn("lifecycle", self.ctx.settings().extensions)
        self.assertNotIn("lifecycle", self.ctx.extension_services)
        self.assertFalse(self.ctx.registry.all("text_provider"))
        self.assertFalse(self.ctx.registry.hooks.handlers("prompt.compiled"))
        self.assertTrue(all(value.closed for value in created))
        self.assertEqual(list(self.manager.routers()), [])
        self.assertEqual(self.manager._catalog_transitions, 0)

    def test_failed_trust_reactivation_preserves_prior_service_registry_and_review(self):
        folder = self.package()
        self.assertEqual(self.enable().status, "active")
        loaded = self.manager.loaded["lifecycle"]
        previous_service = self.ctx.extension_services["lifecycle"]
        previous_state = self.ctx.settings().extensions["lifecycle"]
        original = self.ctx.registry.get("text_provider", "lifecycle")
        hooks = self.ctx.registry.hooks.handlers("prompt.compiled")
        trusted = reviewed_packages(self.ctx.data_dir)
        (folder / "main.py").write_text(MAIN + "\n# reviewed new code\n", encoding="utf-8")
        created = []
        service = ExtensionAPI.service

        def capture(api, value):
            created.append(value)
            return service(api, value)

        with (
            patch.object(ExtensionAPI, "service", capture),
            patch("mio_server.extensions.trust.remember_package", side_effect=OSError("disk full")),
        ):
            info = self.enable()

        self.assertEqual(info.status, "active")
        self.assertIn("disk full", info.error)
        self.assertEqual(len(created), 1)
        self.assertTrue(created[0].closed)
        self.assertIs(self.manager.loaded["lifecycle"], loaded)
        self.assertTrue(loaded.api.active)
        self.assertIs(self.ctx.extension_services["lifecycle"], previous_service)
        self.assertFalse(previous_service.closed)
        self.assertIs(self.ctx.registry.get("text_provider", "lifecycle"), original)
        self.assertEqual(self.ctx.registry.hooks.handlers("prompt.compiled"), hooks)
        self.assertEqual(self.ctx.settings().extensions["lifecycle"], previous_state)
        self.assertEqual(reviewed_packages(self.ctx.data_dir), trusted)
        self.assertEqual(self.manager._catalog_transitions, 0)

    def test_ordinary_activation_failure_does_not_advance_trusted_package(self):
        folder = self.package()
        self.assertEqual(self.enable().status, "active")
        trusted = reviewed_packages(self.ctx.data_dir)
        previous_state = self.ctx.settings().extensions["lifecycle"]
        (folder / "main.py").write_text(
            MAIN + "\n    raise RuntimeError('activation rejected')\n", encoding="utf-8"
        )

        with patch("mio_server.extensions.trust.remember_package") as remember:
            self.assertEqual(self.enable().status, "active")

        remember.assert_not_called()
        self.assertEqual(self.ctx.settings().extensions["lifecycle"], previous_state)
        self.assertEqual(reviewed_packages(self.ctx.data_dir), trusted)

    def test_failed_replace_state_save_restores_files_state_and_original_instance(self):
        folder = self.package()
        self.assertEqual(self.enable().status, "active")
        state = self.ctx.settings().extensions["lifecycle"]
        loaded = self.manager.loaded["lifecycle"]
        service = self.ctx.extension_services["lifecycle"]
        save = self.manager._save_state

        def fail_after_save(*args):
            save(*args)
            raise OSError("state save interrupted")

        with patch.object(self.manager, "_save_state", side_effect=fail_after_save):
            with self.assertRaisesRegex(OSError, "state save interrupted"):
                self.manager.install(self.replacement(), replace=True)

        self.assertEqual(self.manager.info("lifecycle").manifest.version, "1.0.0")
        self.assertEqual(
            (folder / "custom-original.txt").read_bytes(), b"the only customized original"
        )
        self.assertEqual(self.ctx.settings().extensions["lifecycle"], state)
        self.assertIs(self.manager.loaded["lifecycle"], loaded)
        self.assertIs(self.ctx.extension_services["lifecycle"], service)
        self.assertFalse(service.closed)
        self.assertFalse(list(self.manager.root.glob(".install-*")))

    def test_successful_replace_retires_prior_instance_and_keeps_private_and_unknown_paths(self):
        folder = self.package()
        self.assertEqual(self.enable().status, "active")
        service = self.ctx.extension_services["lifecycle"]
        save_settings(self.ctx.data_dir, "lifecycle", {"private": "retained"})
        unknown = self.manager.root / ".staging-lifecycle"
        unknown.mkdir()
        (unknown / "unrelated.txt").write_bytes(b"not owned by this install")

        info = self.manager.install(self.replacement(), replace=True)

        self.assertEqual((info.status, info.manifest.version), ("disabled", "2.0.0"))
        self.assertNotIn("lifecycle", self.manager.loaded)
        self.assertTrue(service.closed)
        self.assertFalse(self.ctx.settings().extensions["lifecycle"].enabled)
        self.assertEqual(load_settings(self.ctx.data_dir, "lifecycle"), {"private": "retained"})
        self.assertEqual((unknown / "unrelated.txt").read_bytes(), b"not owned by this install")
        self.assertFalse((folder / "custom-original.txt").exists())
        self.assertFalse(list(self.manager.root.glob(".install-*")))

    def test_replace_refuses_an_unknown_target_directory(self):
        folder = self.manager.root / "lifecycle"
        folder.mkdir(parents=True)
        original = folder / "unrelated.txt"
        original.write_bytes(b"not an extension")

        with self.assertRaises(ExtensionError):
            self.manager.install(self.replacement(), replace=True)

        self.assertEqual(original.read_bytes(), b"not an extension")
        self.assertNotIn("lifecycle", self.ctx.settings().extensions)

    def test_failed_rollback_retains_original_in_unique_transaction(self):
        folder = self.package()
        self.assertEqual(self.enable().status, "active")
        loaded = self.manager.loaded["lifecycle"]
        rename = Path.rename

        def denied(source, target):
            if Path(target) == folder and source != folder:
                raise OSError("target directory locked")
            return rename(source, target)

        with (
            patch.object(Path, "rename", denied),
            self.assertRaisesRegex(OSError, "target directory locked"),
        ):
            self.manager.install(self.replacement(), replace=True)

        retained = list(self.manager.root.glob(".install-*/previous/custom-original.txt"))
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0].read_bytes(), b"the only customized original")
        journal = json.loads((retained[0].parents[1] / "transaction.json").read_text("utf-8"))
        self.assertEqual(journal["extension_id"], "lifecycle")
        self.assertTrue(journal["previous_state"]["enabled"])
        self.assertIs(self.manager.loaded["lifecycle"], loaded)
        self.assertTrue(loaded.api.active)
        self.assertTrue(self.ctx.settings().extensions["lifecycle"].enabled)

    def test_partial_snapshot_copy_failure_is_retryable_without_partial_trust(self):
        folder = self.package()
        pinned = digest(folder)
        destination = trust_root(self.ctx.data_dir) / "trusted-extensions" / "lifecycle" / pinned

        def interrupted(source, target, **kwargs):
            (Path(target) / "main.py").write_bytes(b"partial copy")
            raise OSError("snapshot disk full")

        with patch("mio_server.extensions.trust.shutil.copytree", side_effect=interrupted):
            self.assertEqual(self.enable().status, "error")

        self.assertFalse(destination.exists())
        self.assertEqual(reviewed_packages(self.ctx.data_dir), [])
        self.assertNotIn("lifecycle", self.manager.loaded)
        self.assertNotIn("lifecycle", self.ctx.extension_services)
        self.assertFalse(self.ctx.registry.all("text_provider"))
        self.assertNotIn("lifecycle", self.ctx.settings().extensions)
        self.assertEqual(self.enable().status, "active")
        self.assertEqual([digest(path) for path in reviewed_packages(self.ctx.data_dir)], [pinned])

    def test_real_trust_index_failure_preserves_old_review_and_allows_retry(self):
        folder = self.package()
        self.assertEqual(self.enable().status, "active")
        loaded = self.manager.loaded["lifecycle"]
        service = self.ctx.extension_services["lifecycle"]
        state = self.ctx.settings().extensions["lifecycle"]
        trusted = reviewed_packages(self.ctx.data_dir)
        (folder / "main.py").write_text(MAIN + "\n# next reviewed package\n", encoding="utf-8")
        replace = Path.replace

        def denied(source, target):
            if source.name == "extension-trust.tmp":
                raise OSError("trust index disk full")
            return replace(source, target)

        with patch.object(Path, "replace", denied):
            failed = self.enable()

        self.assertEqual(failed.status, "active")
        self.assertIn("trust index disk full", failed.error)
        self.assertIs(self.manager.loaded["lifecycle"], loaded)
        self.assertIs(self.ctx.extension_services["lifecycle"], service)
        self.assertFalse(service.closed)
        self.assertEqual(self.ctx.settings().extensions["lifecycle"], state)
        self.assertEqual(reviewed_packages(self.ctx.data_dir), trusted)
        self.assertEqual(self.enable().status, "active")
        self.assertIsNot(self.manager.loaded["lifecycle"], loaded)
        self.assertTrue(service.closed)
        self.assertEqual(
            [digest(path) for path in reviewed_packages(self.ctx.data_dir)], [digest(folder)]
        )

    def test_obsolete_package_cleanup_failure_keeps_success_and_recovery_record(self):
        self.package()
        self.assertEqual(self.enable().status, "active")
        import shutil

        remove = shutil.rmtree

        def denied(path, *args, **kwargs):
            if Path(path).name == "previous":
                raise OSError("obsolete file locked")
            return remove(path, *args, **kwargs)

        with patch("mio_server.extensions.manager.shutil.rmtree", side_effect=denied):
            info = self.manager.install(self.replacement(), replace=True)

        self.assertEqual((info.status, info.manifest.version), ("disabled", "2.0.0"))
        journals = list(self.manager.root.glob(".install-*/transaction.json"))
        self.assertEqual(len(journals), 1)
        self.assertEqual(json.loads(journals[0].read_text("utf-8"))["phase"], "committed")
        self.assertTrue((journals[0].parent / "previous" / "custom-original.txt").is_file())


if __name__ == "__main__":
    unittest.main()
