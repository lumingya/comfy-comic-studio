from mio_server.render_models import CloudRecipe

from .api_harness import ApiCase


class CloudRecipePrivacyTests(ApiCase):
    def test_portable_profile_rejects_nested_credentials_before_readers_or_exporters_can_see_them(
        self,
    ):
        for key in ("api_key", "Cookie", "X-Session-Key", "auth", "authorization"):
            with self.subTest(key=key):
                response = self.client.post(
                    "/api/profiles",
                    json={
                        "id": "recipe-fixture",
                        "name": "Portable recipe",
                        "cloud_shape": True,
                        "cloud_recipe": {
                            "kind": "example",
                            "options": {"extra_options": {"accounts": [{key: "fixture-secret"}]}},
                        },
                    },
                )
                self.assertEqual(response.status_code, 422)
                self.assertNotIn("fixture-secret", response.text)
                self.assertTrue(
                    all(set(error) <= {"loc", "msg", "type"} for error in response.json()["detail"])
                )
                self.assertNotIn("recipe-fixture", self.client.get("/api/profiles").text)

    def test_current_channel_secrets_can_be_used_without_entering_a_portable_recipe(self):
        from mio_server.generation import capture_channels
        from mio_server.models import GenerationSnapshot
        from mio_server.render_models import RenderProfile
        from mio_server.settings import AppSettings, ImageChannel

        profile = RenderProfile(
            id="portable", name="Portable", cloud_shape=True, cloud_channel="c1"
        )
        snapshot = GenerationSnapshot(
            profile=profile.model_dump(), profiles={profile.id: profile.model_dump()}
        )
        settings = AppSettings(
            image_channels=[
                ImageChannel(
                    id="c1",
                    kind="example",
                    extra_options={
                        "quality": "draft",
                        "accounts": [{"token": "fixture-secret", "limit": 2}],
                    },
                )
            ]
        )
        capture_channels(settings, snapshot)
        recipe = CloudRecipe.model_validate(snapshot.profile["cloud_recipe"])
        self.assertEqual(
            recipe.options["extra_options"], {"quality": "draft", "accounts": [{"limit": 2}]}
        )
        self.assertNotIn("fixture-secret", str(snapshot.model_dump()))
