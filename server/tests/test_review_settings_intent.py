"""Settings field intentions merge inside the write transaction, never a stale whole list."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from .api_harness import ApiCase


class SettingsIntentTests(ApiCase):
    def test_image_models_intent_preserves_llm_connection_and_assistant_models(self):
        before = self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "llm": {
                        "base_url": "https://offline-models.test/v1",
                        "api_key": "offline-models-key",
                        "text_models": ["offline-text"],
                        "vision_models": ["offline-vision"],
                        "image_models": ["offline-image"],
                    }
                },
            )
        )
        saved = self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "llm": {"image_models": ["offline-image", "offline-added-image"]},
                    "expected": {"llm": {"image_models": before["llm"]["image_models"]}},
                },
            )
        )
        for key in ("base_url", "api_key", "text_models", "vision_models", "timeout", "pace"):
            self.assertEqual(saved["llm"][key], before["llm"][key])
        self.assertEqual(self.ctx.settings().llm.api_key, "offline-models-key")
        self.assertEqual(saved["llm"]["image_models"], ["offline-image", "offline-added-image"])
        self.assertEqual(self.ok(self.client.get("/api/settings"))["llm"], saved["llm"])

    def test_restart_invalidates_a_masked_field_revision_without_writing(self):
        first = self.ok(
            self.client.patch("/api/settings", json={"llm": {"api_key": "offline-first"}})
        )
        request = {
            "llm": {"api_key": "offline-next"},
            "expected": {"llm": {"api_key": "••••••"}},
            "expected_revision": first["write_revision"],
        }
        with patch("mio_server.settings._WRITE_REVISION_KEY", b"test-restarted-process"):
            response = self.client.patch("/api/settings", json=request)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.ctx.settings().llm.api_key, "offline-first")
        request["expected_revision"] = "invalid-non-ascii-版本"
        self.assertEqual(self.client.patch("/api/settings", json=request).status_code, 409)

    def test_masked_api_key_requires_opaque_revision_and_detects_secret_changes(self):
        first = self.ok(
            self.client.patch("/api/settings", json={"llm": {"api_key": "offline-first"}})
        )
        self.assertEqual(first["llm"]["api_key"], "••••••")
        self.assertNotIn("offline-first", str(first))
        self.ok(self.client.patch("/api/settings", json={"llm": {"api_key": "offline-remote"}}))
        stale = {
            "llm": {"api_key": "offline-mine"},
            "expected": {"llm": {"api_key": "••••••"}},
            "expected_revision": first["write_revision"],
        }
        self.assertEqual(self.client.patch("/api/settings", json=stale).status_code, 409)
        self.assertEqual(self.ctx.settings().llm.api_key, "offline-remote")
        del stale["expected_revision"]
        self.assertEqual(self.client.patch("/api/settings", json=stale).status_code, 400)

    def test_untouched_channel_secrets_keep_the_latest_value_and_never_store_mask(self):
        self.ok(
            self.client.patch(
                "/api/settings",
                json={"image_channels": [{"id": "a", "label": "A", "api_key": "offline-first"}]},
            )
        )
        latest = self.ok(
            self.client.patch(
                "/api/settings",
                json={"image_channels": [{"id": "a", "label": "A", "api_key": "offline-remote"}]},
            )
        )
        saved = self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "image_channel_edits": [
                        {"id": "a", "before": {"label": "A"}, "after": {"label": "mine"}}
                    ]
                },
            )
        )
        self.assertEqual(self.ctx.settings().image_channels[0].api_key, "offline-remote")
        self.assertEqual(saved["image_channels"][0]["api_key"], "••••••")
        self.assertNotEqual(latest["write_revision"], saved["write_revision"])
        current = self.ok(self.client.get("/api/settings"))
        self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "image_channel_edits": [
                        {
                            "id": "a",
                            "before": {"api_key": "••••••"},
                            "after": {"api_key": "offline-local"},
                        }
                    ],
                    "expected_revision": current["write_revision"],
                },
            )
        )
        self.assertEqual(self.ctx.settings().image_channels[0].api_key, "offline-local")

    def test_original_unconditional_mask_and_round_trip_semantics_remain_supported(self):
        first = self.ok(
            self.client.patch("/api/settings", json={"llm": {"api_key": "offline-first"}})
        )
        self.ok(self.client.patch("/api/settings", json={"llm": {"api_key": "offline-remote"}}))
        self.ok(self.client.patch("/api/settings", json=first))
        self.assertEqual(self.ctx.settings().llm.api_key, "offline-remote")

    def test_general_intent_merges_the_latest_nested_settings(self):
        before = self.ok(self.client.get("/api/settings"))
        self.ok(
            self.client.patch(
                "/api/settings",
                json={"trash_days": 180, "guard_terms": ["remote"], "llm": {"timeout": 600}},
            )
        )
        saved = self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "llm": {"base_url": "https://offline.test/v1"},
                    "expected": {"llm": {"base_url": before["llm"]["base_url"]}},
                },
            )
        )
        self.assertEqual(saved["trash_days"], 180)
        self.assertEqual(saved["guard_terms"], ["remote"])
        self.assertEqual(saved["llm"]["timeout"], 600)

    def test_extra_option_field_comparison_detects_added_remote_keys(self):
        self.ok(
            self.client.patch(
                "/api/settings",
                json={"image_channels": [{"id": "a", "extra_options": {"old": 1, "remote": 2}}]},
            )
        )
        response = self.client.patch(
            "/api/settings",
            json={
                "image_channel_edits": [
                    {
                        "id": "a",
                        "before": {"extra_options": {"old": 1}},
                        "after": {"extra_options": {"old": 3}},
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(
            self.ctx.settings().image_channels[0].extra_options, {"old": 1, "remote": 2}
        )

    def test_rejected_multi_field_write_is_atomic(self):
        self.channels()
        response = self.client.patch(
            "/api/settings",
            json={
                "trash_days": 180,
                "image_channel_edits": [
                    {"id": "a", "before": {"label": "A"}, "after": {"label": "first"}},
                    {"id": "b", "before": {"model": "stale"}, "after": {"model": "bad"}},
                ],
            },
        )
        self.assertEqual(response.status_code, 409, response.text)
        settings = self.ctx.settings()
        self.assertEqual(settings.trash_days, 30)
        self.assertEqual(settings.image_channels[0].label, "A")

    def channels(self):
        return self.ok(
            self.client.patch(
                "/api/settings",
                json={"image_channels": [{"id": "a", "label": "A"}, {"id": "b", "model": "old"}]},
            )
        )

    def test_channel_field_intent_preserves_other_channel_and_remote_fields(self):
        self.channels()
        self.ok(self.client.patch("/api/settings", json={"trash_days": 180}))
        self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "image_channel_edits": [
                        {"id": "b", "before": {"model": "old"}, "after": {"model": "remote"}}
                    ]
                },
            )
        )
        saved = self.ok(
            self.client.patch(
                "/api/settings",
                json={
                    "image_channel_edits": [
                        {"id": "a", "before": {"label": "A"}, "after": {"label": "mine"}}
                    ]
                },
            )
        )
        self.assertEqual(saved["trash_days"], 180)
        self.assertEqual(saved["image_channels"][1]["model"], "remote")

    def test_same_field_stale_expected_value_is_a_conflict(self):
        self.ok(self.client.patch("/api/settings", json={"trash_days": 180}))
        response = self.client.patch(
            "/api/settings", json={"trash_days": 90, "expected": {"trash_days": 30}}
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.ctx.settings().trash_days, 180)

    def test_deleted_channel_is_not_resurrected_and_create_collision_conflicts(self):
        self.channels()
        self.ok(self.client.patch("/api/settings", json={"image_channels": []}))
        response = self.client.patch(
            "/api/settings",
            json={
                "image_channel_edits": [
                    {"id": "a", "before": {"label": "A"}, "after": {"label": "mine"}}
                ]
            },
        )
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.ctx.settings().image_channels, [])
        create = {
            "image_channel_edits": [
                {"id": "a", "before": None, "after": {"id": "a", "label": "new"}}
            ]
        }
        self.ok(self.client.patch("/api/settings", json=create))
        self.assertEqual(self.client.patch("/api/settings", json=create).status_code, 409)

    def test_parallel_same_field_expected_updates_have_one_winner(self):
        barrier = Barrier(2)

        def save(days):
            barrier.wait(timeout=3)
            return self.client.patch(
                "/api/settings", json={"trash_days": days, "expected": {"trash_days": 30}}
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(save, [90, 180]))
        self.assertEqual(sorted(statuses), [200, 409])
