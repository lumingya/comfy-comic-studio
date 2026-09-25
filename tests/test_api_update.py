"""Public API: update center (network and restart are always patched)."""
import unittest
from unittest.mock import patch

from backend import mio_update
from tests.api_support import ApiServerCase


class UpdateApiTests(ApiServerCase):
    def test_status_and_confirmation_rules(self):
        status = self.ok(self.get("/api/v1/update/status"))
        self.assertIsInstance(status, dict)
        for route, body in (("apply", {"version": "9.9.9"}), ("rollback", {}), ("restart", {})):
            refused = self.post("/api/v1/update/" + route, body)
            self.assertEqual((refused.status, refused.error["code"]), (403, "confirmation_required"), route)
        unchecked = self.post("/api/v1/update/apply", {"version": "9.9.9", "confirm": True})
        self.assertGreaterEqual(unchecked.status, 400)
        self.assertIn("message", unchecked.error)

    def test_check_and_restart_are_delegated(self):
        with patch.object(mio_update.UpdateService, "check", return_value={"available": False, "latest": None}) as check:
            self.assertEqual(self.ok(self.post("/api/v1/update/check", {"prerelease": True}))["available"], False)
        check.assert_called_once_with(True)
        with patch.object(mio_update.UpdateService, "request_restart") as restart:
            self.assertTrue(self.ok(self.post("/api/v1/update/restart", {"confirm": True}))["restarting"])
        restart.assert_called_once()
        with patch.object(mio_update.UpdateService, "check", side_effect=mio_update.UpdateError("无法连接更新源", 502)):
            failed = self.post("/api/v1/update/check")
        self.assertEqual((failed.status, failed.error["message"]), (502, "无法连接更新源"))


if __name__ == "__main__":
    unittest.main()
