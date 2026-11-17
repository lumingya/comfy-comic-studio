"""Market selection, cache isolation and verified portable-package installation."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from unittest.mock import patch

import httpx

from mio_server.extensions.marketplace import CATALOG_LIMIT, MAX_ZIP, _download, web_url

from .api_harness import ApiCase


def package(ext_id="market-demo", version="1.0.0", *, prefix="portable/"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            prefix + "mio-extension.json",
            json.dumps({"id": ext_id, "name": "演示工具", "version": version}),
        )
        archive.writestr(prefix + "README.md", "An independent portable folder.")
    return output.getvalue()


def directory(payload, ext_id="market-demo", version="1.0.0"):
    return json.dumps(
        {
            "format_version": 1,
            "items": [
                {
                    "id": ext_id,
                    "name": "演示工具",
                    "version": version,
                    "package_url": "https://market.example/demo.zip",
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            ],
        }
    ).encode()


class ExtensionMarketTests(ApiCase):
    def configure(self, catalog):
        with patch("mio_server.extensions.marketplace._download", return_value=catalog) as fetch:
            result = self.ok(
                self.client.put(
                    "/api/extension-market/source",
                    json={"url": "https://market.example/catalog.json#ignored"},
                )
            )
        fetch.assert_called_once_with("https://market.example/catalog.json", CATALOG_LIMIT)
        return result

    def install(self, listing, payload, ext_id="market-demo", **changes):
        item = next(item for item in listing["items"] if item["id"] == ext_id)
        body = {
            "expected_catalog_digest": listing["catalog_digest"],
            "expected_sha256": item["sha256"],
            **changes,
        }
        with patch("mio_server.extensions.marketplace._download", return_value=payload) as fetch:
            result = self.client.post(f"/api/extension-market/{ext_id}/install", json=body)
        return result, fetch

    def test_default_directory_only_lists_real_bundled_packages(self):
        with patch("mio_server.extensions.marketplace._download") as fetch:
            result = self.ok(self.client.get("/api/extension-market?refresh=true"))
        fetch.assert_not_called()
        self.assertTrue(result["source"]["builtin"])
        self.assertEqual({i["id"] for i in result["items"]}, {"ai-assist"})
        for item in result["items"]:
            self.assertEqual(item["source"], "bundled")
            self.assertTrue(item["installed"]["builtin"])
            self.assertEqual(item["action"], "enable")

    def test_download_installs_disabled_then_can_be_enabled_and_updated(self):
        first = package()
        listing = self.configure(directory(first))
        self.assertFalse(listing["source"]["builtin"])
        self.assertEqual(listing["items"][-1]["action"], "install")
        response, fetch = self.install(listing, first)
        info = self.ok(response, 201)
        fetch.assert_called_once_with("https://market.example/demo.zip", MAX_ZIP)
        self.assertEqual(info["status"], "disabled")
        self.assertFalse(info["builtin"])
        updated = self.ok(self.client.get("/api/extension-market"))
        self.assertEqual(updated["items"][-1]["action"], "enable")
        self.assertEqual(updated["catalog_digest"], listing["catalog_digest"])
        self.ok(
            self.client.post("/api/extensions/market-demo/enable", json={"digest": info["digest"]})
        )
        self.assertEqual(
            self.ok(self.client.get("/api/extension-market"))["items"][-1]["action"],
            "installed",
        )
        second = package(version="2.0.0", prefix="")
        listing = self.configure(directory(second, version="2.0.0"))
        self.assertEqual(listing["items"][-1]["action"], "update")
        response, _ = self.install(listing, second)
        updated_info = self.ok(response, 201)
        self.assertEqual((updated_info["version"], updated_info["status"]), ("2.0.0", "disabled"))

    def test_directory_cache_retains_same_source_on_error(self):
        listing = self.configure(directory(package()))
        with patch("mio_server.extensions.marketplace._download") as fetch:
            cached = self.ok(self.client.get("/api/extension-market"))
        fetch.assert_not_called()
        self.assertEqual(cached["catalog_digest"], listing["catalog_digest"])
        with patch(
            "mio_server.extensions.marketplace._download", side_effect=httpx.ConnectError("x")
        ):
            stale = self.ok(self.client.get("/api/extension-market?refresh=true"))
        self.assertTrue(stale["source"]["error"])
        self.assertEqual(stale["catalog_digest"], listing["catalog_digest"])

    def test_changing_source_discards_old_remote_packages_even_when_new_source_fails(self):
        listing = self.configure(directory(package()))
        with patch(
            "mio_server.extensions.marketplace._download", side_effect=httpx.ConnectError("x")
        ):
            changed = self.ok(
                self.client.put(
                    "/api/extension-market/source", json={"url": "https://other.example/feed"}
                )
            )
        self.assertNotEqual(changed["catalog_digest"], listing["catalog_digest"])
        self.assertNotIn("market-demo", {item["id"] for item in changed["items"]})
        self.assertTrue(changed["source"]["error"])
        reset = self.ok(self.client.put("/api/extension-market/source", json={"url": ""}))
        self.assertTrue(reset["source"]["builtin"])
        self.assertFalse(reset["source"]["error"])

    def test_stale_selection_and_changed_checksum_rejected_before_download(self):
        payload = package()
        listing = self.configure(directory(payload))
        for changes in (
            {"expected_catalog_digest": "0" * 64},
            {"expected_sha256": "0" * 64},
        ):
            response, fetch = self.install(listing, payload, **changes)
            self.ok(response, 409)
            fetch.assert_not_called()
        self.assertFalse((self.ctx.extensions.root / "market-demo").exists())

    def test_wrong_download_and_manifest_identity_never_install(self):
        valid = package()
        listing = self.configure(directory(valid))
        response, _ = self.install(listing, b"changed during download")
        self.ok(response, 400)
        for payload in (package(ext_id="other-package"), package(version="9.9.9"), b"not a ZIP"):
            listing = self.configure(directory(payload))
            response, _ = self.install(listing, payload)
            self.ok(response, 400)
        self.assertFalse((self.ctx.extensions.root / "market-demo").exists())
        self.assertFalse((self.ctx.extensions.root / "other-package").exists())

    def test_invalid_remote_directory_cannot_replace_last_good_directory(self):
        listing = self.configure(directory(package()))
        invalid = json.loads(directory(package()))
        for mutate in (
            lambda item: item.pop("sha256"),
            lambda item: item.update(package_url="file:///C:/bad.zip"),
        ):
            bad = json.loads(json.dumps(invalid))
            mutate(bad["items"][0])
            with patch(
                "mio_server.extensions.marketplace._download", return_value=json.dumps(bad).encode()
            ):
                response = self.ok(self.client.get("/api/extension-market?refresh=true"))
            self.assertTrue(response["source"]["error"])
            self.assertEqual(response["catalog_digest"], listing["catalog_digest"])

    def test_source_requires_http_without_credentials(self):
        for url in ("file:///C:/feed", "https://user:password@example.org/feed", "http://bad:port"):
            with patch("mio_server.extensions.marketplace._download") as fetch:
                self.ok(self.client.put("/api/extension-market/source", json={"url": url}), 400)
            fetch.assert_not_called()
        self.assertEqual(web_url(" https://example.org/feed#part "), "https://example.org/feed")

    def test_v2_market_management_requires_admin_and_publishes_routes(self):
        self.ok(self.client.get("/api/v2/extension-market"), 401)
        read = self.ok(
            self.client.post("/api/tokens", json={"name": "reader", "scopes": ["read"]}), 201
        )["token"]
        admin = self.ok(
            self.client.post("/api/tokens", json={"name": "manager", "scopes": ["admin"]}), 201
        )["token"]
        self.ok(
            self.client.get(
                "/api/v2/extension-market", headers={"Authorization": f"Bearer {read}"}
            ),
            403,
        )
        self.ok(
            self.client.get(
                "/api/v2/extension-market", headers={"Authorization": f"Bearer {admin}"}
            )
        )
        schema = self.ok(self.client.get("/api/v2/openapi.json"))
        self.assertIn("/extension-market/{ext_id}/install", schema["paths"])

    def test_download_size_limits_are_enforced_without_real_network(self):
        original_client = httpx.Client
        for headers in ({"content-length": "100"}, {"content-length": ""}):
            transport = httpx.MockTransport(
                lambda request: httpx.Response(200, headers=headers, content=b"12345")
            )
            client = original_client(transport=transport)
            with (
                patch("mio_server.extensions.marketplace.httpx.Client", return_value=client),
                self.assertRaisesRegex(ValueError, "大小限制"),
            ):
                _download("https://market.example/file", 4)
