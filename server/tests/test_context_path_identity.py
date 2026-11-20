import os
import stat
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from mio_server.context import AppContext
from mio_server.private_store import PrivateStore


class ContextPathIdentityTests(TestCase):
    def test_workspace_identity_matches_private_sources_through_a_real_windows_short_alias(self):
        with tempfile.TemporaryDirectory(prefix="mio-context-long-directory-") as temporary:
            canonical = Path(temporary).resolve()
            supplied = canonical
            if os.name == "nt":
                import ctypes

                buffer = ctypes.create_unicode_buffer(32768)
                size = ctypes.windll.kernel32.GetShortPathNameW(str(canonical), buffer, len(buffer))
                if size and size < len(buffer):
                    supplied = Path(buffer.value)
            ctx = AppContext.create(supplied, autostart=False, seed_instance=False)
            try:
                self.assertEqual(ctx.data_dir, canonical)
                private = PrivateStore(ctx.data_dir, "extension", "fixture")
                self.assertEqual(private.root, ctx.data_dir / "extensions_data" / "fixture")
                self.assertEqual(ctx.extensions.root, ctx.data_dir / "extensions")
            finally:
                ctx.close()

    def test_workspace_ancestors_are_checked_before_canonicalization_can_hide_a_redirect(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).absolute()
            original = Path.lstat

            def reparse(path, *args, **kwargs):
                if path == root:
                    return SimpleNamespace(
                        st_mode=stat.S_IFDIR,
                        st_file_attributes=getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400),
                    )
                return original(path, *args, **kwargs)

            with (
                patch.object(Path, "lstat", new=reparse),
                self.assertRaisesRegex(ValueError, "reparse"),
            ):
                AppContext.create(root / "new-workspace", autostart=False)
            self.assertFalse((root / "new-workspace").exists())
