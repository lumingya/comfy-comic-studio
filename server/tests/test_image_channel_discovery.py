from .api_harness import ApiCase


class ImageChannelDiscoveryTests(ApiCase):
    def test_read_catalog_exposes_selectable_ids_without_channel_credentials_or_options(self):
        self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "image_channel": "studio",
                    "image_channels": [
                        {
                            "id": "studio",
                            "label": "Studio images",
                            "kind": "openai_images",
                            "model": "fixture-model",
                            "base_url": "https://example.invalid/private-endpoint",
                            "api_key": "fixture-secret",
                            "extra_options": {"headers": {"Cookie": "fixture-cookie"}},
                        }
                    ],
                },
            )
        )
        route = "/api/v2/image-channels"
        self.assertEqual(self.client.get(route).status_code, 401)
        for scopes, status in (
            (["read"], 200),
            (["write"], 403),
            (["render"], 403),
            (["admin"], 403),
        ):
            issued = self.ok(
                self.client.post(
                    "/api/tokens", json={"name": "Discovery fixture", "scopes": scopes}
                ),
                201,
            )
            response = self.client.get(
                route, headers={"Authorization": f"Bearer {issued['token']}"}
            )
            self.assertEqual(response.status_code, status, response.text)
            if status == 200:
                rows = response.json()
                configured = next(row for row in rows if row["id"] == "studio")
                default_alias = next(row for row in rows if row["id"] == "")
                self.assertEqual(default_alias["kind"], configured["kind"])
                self.assertEqual(default_alias["model"], configured["model"])
                self.assertTrue(configured["default"])
                self.assertEqual(configured["model"], "fixture-model")
                for value in (
                    "fixture-secret",
                    "fixture-cookie",
                    "private-endpoint",
                    "extra_options",
                    "api_key",
                ):
                    self.assertNotIn(value, response.text)
