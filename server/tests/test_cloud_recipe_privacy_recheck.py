"""Independent privacy checks for portable cloud recipes and current channel secrets."""

import json
from types import SimpleNamespace

from mio_server.auth import issue
from mio_server.generation import capture_channels
from mio_server.models import GenerationSnapshot
from mio_server.pipeline.cloud_request import bind_request
from mio_server.render_models import CloudRecipe, RenderProfile
from mio_server.settings import AppSettings, ImageChannel

from .api_harness import ApiCase


class CloudRecipePrivacyRecheckTests(ApiCase):
    def authorization(self, scopes):
        token, raw = issue("Recipe privacy recheck", scopes)
        self.ctx.store.put_doc(token)
        return {"Authorization": f"Bearer {raw}"}

    def test_nested_array_credentials_are_rejected_without_echo_or_partial_profile(self):
        secret = "fixture-request-credential-only"
        body = {
            "id": "privacy-array-profile",
            "name": "Portable cloud recipe",
            "cloud_shape": True,
            "cloud_recipe": {
                "kind": "example",
                "options": {
                    "extra_options": {
                        "quality": "draft",
                        "accounts": [[{"metadata": {"X-Session-Key": secret}}]],
                    }
                },
            },
        }
        for prefix, headers in (("/api", {}), ("/api/v2", self.authorization(["write"]))):
            with self.subTest(prefix=prefix):
                response = self.client.post(prefix + "/profiles", headers=headers, json=body)
                self.assertEqual(response.status_code, 422)
                self.assertNotIn(secret, response.text)
                self.assertFalse(
                    self.ctx.store._rows("SELECT id FROM documents WHERE id = ?", (body["id"],))
                )

    def test_historical_invalid_profile_reads_fail_without_revealing_stored_credentials(self):
        secret = "fixture-stored-credential-only"
        body = {
            "id": "privacy-historical-profile",
            "name": "Historical cloud recipe",
            "cloud_recipe": {"kind": "example", "options": {"auth": secret}},
        }
        # Represent an older on-disk record rather than bypassing current HTTP validation.
        with self.ctx.store.tx() as db:
            db.execute(
                "INSERT INTO documents(kind, id, name, updated_at, payload_json) VALUES (?,?,?,?,?)",
                ("profile", body["id"], body["name"], "2026-11-20", json.dumps(body)),
            )
        headers = self.authorization(["read"])
        for path in ("/profiles", "/profiles/" + body["id"]):
            with self.subTest(path=path):
                response = self.client.get("/api/v2" + path, headers=headers)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["kind"], "invalid")
                self.assertNotIn(secret, response.text)
                self.assertNotIn("input_value", response.text)

    def test_portable_recipe_binds_current_credentials_and_keeps_frozen_ordinary_values(self):
        original_channel = ImageChannel(
            id="privacy-channel",
            kind="example",
            model="original-model",
            extra_options={
                "quality": "draft",
                "accounts": [{"limit": 2, "Cookie": "fixture-original-cookie"}],
            },
        )
        profile = RenderProfile(
            id="privacy-profile",
            name="Portable",
            cloud_shape=True,
            cloud_channel=original_channel.id,
        )
        snapshot = GenerationSnapshot(
            profile=profile.model_dump(), profiles={profile.id: profile.model_dump()}
        )
        capture_channels(AppSettings(image_channels=[original_channel]), snapshot)
        recipe = CloudRecipe.model_validate(snapshot.profile["cloud_recipe"])
        self.assertEqual(
            recipe.options["extra_options"], {"quality": "draft", "accounts": [{"limit": 2}]}
        )
        current_channel = original_channel.model_copy(
            update={
                "model": "changed-model",
                "extra_options": {
                    "quality": "changed",
                    "accounts": [{"limit": 99, "Cookie": "fixture-current-cookie"}],
                },
            },
            deep=True,
        )
        request = {
            "channel_id": current_channel.id,
            "kind": recipe.kind,
            "model": recipe.model,
            "options": recipe.options,
        }
        current = SimpleNamespace(channel=current_channel, image_models=(current_channel.model,))
        bound = bind_request(current, request)
        self.assertEqual(bound.channel.model, "original-model")
        self.assertEqual(
            bound.channel.extra_options,
            {
                "quality": "draft",
                "accounts": [{"limit": 2, "Cookie": "fixture-current-cookie"}],
            },
        )
        self.assertEqual(current.channel.extra_options["quality"], "changed")
        self.assertNotIn("fixture-original-cookie", str(snapshot.model_dump()))
        self.assertNotIn("fixture-current-cookie", str(snapshot.model_dump()))
        self.assertNotIn("Cookie", str(recipe.model_dump()))
