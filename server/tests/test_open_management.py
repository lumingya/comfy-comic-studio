"""Every documented local operation is reachable through a scoped open API."""

import io
import json
import zipfile

from . import test_api_v2
from .api_harness import ApiCase


class OpenManagementTests(ApiCase):
    token = test_api_v2.ApiV2Tests.token
    v2 = test_api_v2.ApiV2Tests.v2

    def test_documented_local_operations_have_secured_open_equivalents(self):
        local = self.ok(self.client.get("/openapi.json"))["paths"]
        opened = self.ok(self.client.get("/api/v2/openapi.json"))["paths"]
        methods = {"get", "post", "put", "patch", "delete", "head", "options"}
        for path, operations in local.items():
            if not path.startswith("/api/"):
                continue
            target = path.removeprefix("/api")
            self.assertIn(target, opened, path)
            for method in methods.intersection(operations):
                self.assertIn(method, opened[target], (method, path))
                self.assertEqual(opened[target][method]["security"], [{"bearer": []}])

    def test_admin_can_manage_tokens_without_disclosing_stored_secrets(self):
        admin = self.token("admin")
        for scopes in (("read",), ("write",), ("render",)):
            denied = self.v2("POST", "/tokens", self.token(*scopes), json={"name": "denied"})
            self.assertEqual(denied.status_code, 403)
        issued = self.ok(
            self.v2("POST", "/tokens", admin, json={"name": "reader", "scopes": ["read"]}),
            201,
        )
        self.assertEqual(self.v2("GET", "/series", issued["token"]).status_code, 200)
        listing = self.ok(self.v2("GET", "/tokens", admin))
        self.assertNotIn(issued["token"], json.dumps(listing))
        self.assertNotIn("secret_hash", json.dumps(listing))
        self.ok(self.v2("DELETE", f"/tokens/{issued['id']}", admin), 204)
        self.assertEqual(self.v2("GET", "/series", issued["token"]).status_code, 401)

    def test_extension_lifecycle_retains_digest_review_and_theme_cleanup(self):
        admin = self.token("admin")
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as zf:
            zf.writestr(
                "mio-extension.json",
                json.dumps(
                    {
                        "id": "open-demo",
                        "name": "Open demo",
                        "contributes": {"themes": ["theme.json"]},
                    }
                ),
            )
            zf.writestr(
                "theme.json",
                json.dumps(
                    {"id": "open-theme", "name": "Open theme", "mode": "light", "tokens": {}}
                ),
            )
        for token in (None, self.token("read", "write", "render")):
            self.assertIn(
                self.v2("POST", "/extensions", token, content=data.getvalue()).status_code,
                (401, 403),
            )
        installed = self.ok(self.v2("POST", "/extensions", admin, content=data.getvalue()), 201)
        self.assertEqual(installed["status"], "disabled")
        path = "/extensions/open-demo"
        wrong = self.v2("POST", path + "/enable", admin, json={"digest": "0" * 64})
        self.assertEqual(wrong.status_code, 400)
        active = self.ok(
            self.v2("POST", path + "/enable", admin, json={"digest": installed["digest"]})
        )
        self.assertEqual(active["status"], "active")
        read = self.token("read")
        self.assertIn("open-theme", {t["id"] for t in self.ok(self.v2("GET", "/themes", read))})
        self.ok(self.v2("POST", path + "/disable", admin))
        self.assertNotIn("open-theme", {t["id"] for t in self.ok(self.v2("GET", "/themes", read))})
        self.ok(self.v2("DELETE", path, admin), 204)
        self.assertEqual(self.ok(self.v2("GET", "/extensions", admin))["items"], [])
