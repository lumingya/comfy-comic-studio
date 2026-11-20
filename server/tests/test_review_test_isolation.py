"""API fixtures must not import the checkout's local legacy data implicitly."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .api_harness import ApiCase


class ApiHarnessIsolationTests(unittest.TestCase):
    def assert_workshop_isolated(self, path: str, *, scoped: bool = False):
        with tempfile.TemporaryDirectory(prefix="mio-fixture-boundary-") as temporary:
            sentinel = Path(temporary) / "sentinel-legacy"
            sentinel.mkdir()
            # Redirect the production fallback before setUp, and intercept its reader. A
            # regression therefore fails safely without ever opening the checkout's data/.
            with (
                patch("mio_server.importer.LEGACY_ROOT", sentinel),
                patch("mio_server.importer._load_dir", return_value=[]) as loader,
            ):
                case = ApiCase(methodName="runTest")
                try:
                    case.setUp()
                    headers = {}
                    if scoped:
                        issued = case.ok(
                            case.client.post(
                                "/api/tokens", json={"name": "isolation", "scopes": ["read"]}
                            ),
                            201,
                        )
                        headers["Authorization"] = "Bearer " + issued["token"]
                    response = case.client.get(path, headers=headers)
                    self.assertEqual(response.status_code, 200)
                    loader.assert_not_called()
                    self.assertEqual(case.ctx.legacy_root, Path(case.tmp) / "empty-legacy")
                    self.assertFalse(case.ctx.legacy_root.exists())
                finally:
                    case.doCleanups()

    def test_local_workshop_does_not_read_the_default_legacy_root(self):
        self.assert_workshop_isolated("/api/workshop")

    def test_scoped_storyboards_do_not_read_the_default_legacy_root(self):
        self.assert_workshop_isolated("/api/v2/workshop/storyboards", scoped=True)
