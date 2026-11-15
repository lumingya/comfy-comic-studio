"""Imported resources remain editable and can preview presets without a default-workshop leak."""

import base64
from unittest.mock import patch

from mio_server.auth import issue
from mio_server.models import (
    Bible,
    Character,
    Episode,
    Panel,
    PanelOverrides,
    Preset,
    PresetEntry,
    Series,
)

from .api_harness import ApiCase


class KitEditingTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.kit = self.ctx.store.create_series(
            Series(
                title="独立套装",
                kind="kit",
                variables={"setting": "quiet studio", "color": "base"},
                presets=[
                    Preset(
                        id="warm", title="暖色", entries=[PresetEntry(key="color", value="warm")]
                    ),
                    Preset(
                        id="cool", title="冷色", entries=[PresetEntry(key="color", value="cool")]
                    ),
                ],
                bible=Bible(characters=[Character(id="artist", name="画家", age=30)]),
            )
        )
        self.board = self.ctx.store.create_episode(
            Episode(
                series_id=self.kit.id,
                title="一幕",
                order=0,
                panels=[Panel(order=0, overrides=PanelOverrides(raw_prompt="{color} {setting}"))],
            )
        )

    def preview(self, source=None, **body):
        return self.client.post(
            f"/api/creation-kits/{source or self.kit.id}/preview-preset",
            json={"preset_ids": ["warm", "cool"], "prompt": "{color} {setting}", **body},
        )

    def test_preview_uses_ordered_kit_values_and_keeps_a_frozen_standby_album(self):
        made = self.ok(self.preview(), 201)
        album, episode = made["series"], made["episode"]
        self.assertEqual(album["kind"], "album")
        self.assertEqual(album["variables"], {"setting": "quiet studio", "color": "cool"})
        self.assertEqual(album["bible"]["characters"][0]["name"], "画家")
        self.assertEqual(len(episode["panels"]), 1)
        self.assertEqual(episode["panels"][0]["overrides"]["seed"], 1)
        self.assertEqual(episode["takes"], [])
        self.assertFalse(self.ctx.engine.list())
        self.assertFalse(any(s.kind == "workshop" for s in self.ctx.store.list_series()))
        self.ok(
            self.client.patch(
                f"/api/series/{self.kit.id}",
                json={"variables": {"setting": "changed"}, "presets": []},
            )
        )
        frozen = self.ok(self.client.get(f"/api/series/{album['id']}"))
        self.assertEqual(frozen["variables"], album["variables"])
        self.assertEqual(frozen["presets"], album["presets"])

    def test_invalid_source_or_foreign_presets_cannot_fall_back_to_default_workshop(self):
        ordinary = self.ctx.store.create_series(Series(title="普通作品"))
        before = [s.model_dump() for s in self.ctx.store.list_series()]
        self.ok(self.preview(ordinary.id), 404)
        self.ok(self.preview("missing"), 404)
        self.ok(self.preview(preset_ids=["other-source-preset"]), 404)
        self.ok(self.preview(profile_id="missing-profile"), 404)
        self.assertEqual(before, [s.model_dump() for s in self.ctx.store.list_series()])
        self.assertFalse(self.ctx.engine.list())

    def test_album_and_episode_roll_back_together_when_preview_storage_fails(self):
        original = self.ctx.store._insert_episode
        before = [s.id for s in self.ctx.store.list_series()]

        def fail_after_insert(db, episode):
            original(db, episode)
            raise RuntimeError("interrupted storage")

        with patch.object(self.ctx.store, "_insert_episode", side_effect=fail_after_insert):
            with self.assertRaisesRegex(RuntimeError, "interrupted storage"):
                self.preview()
        self.assertEqual(before, [s.id for s in self.ctx.store.list_series()])
        self.assertEqual(self.ctx.store.episode_summaries(self.kit.id, 0, 20)[1], 1)

    def test_open_api_requires_write_and_does_not_generate(self):
        for scope in ("read", "render", "write"):
            token, raw = issue("Kit editor", [scope])
            self.ctx.store.put_doc(token)
            reply = self.client.post(
                f"/api/v2/creation-kits/{self.kit.id}/preview-preset",
                json={"preset_ids": ["warm"], "prompt": "A quiet studio"},
                headers={"Authorization": f"Bearer {raw}"},
            )
            self.ok(reply, 201 if scope == "write" else 403)
        self.assertFalse(self.ctx.engine.list())

    def test_import_edit_export_and_assemble_use_latest_source_without_changing_older_albums(self):
        archive = self.ok(
            self.client.post(
                "/api/creation-kits/export",
                json={
                    "series_id": self.kit.id,
                    "episode_ids": [self.board.id],
                    "preset_ids": ["warm"],
                },
            )
        )
        imported = self.ok(
            self.client.post(
                "/api/creation-kits/import",
                json={
                    "archive_base64": base64.b64encode(archive.content).decode(),
                    "idempotency_key": "edit-import",
                    "profiles": {"profile_default": {"unbound": True}},
                },
            ),
            201,
        )
        source = self.ok(self.client.get(f"/api/series/{imported['series_id']}"))
        board_id = imported["episode_ids"][0]
        body = {
            "episode_id": board_id,
            "preset_ids": imported["preset_ids"],
            "idempotency_key": "before-edit",
        }
        url = f"/api/creation-kits/{source['id']}/assemble"
        old = self.ok(self.client.post(url, json=body), 201)
        source["presets"][0]["entries"][0]["value"] = "edited"
        self.ok(
            self.client.patch(f"/api/series/{source['id']}", json={"presets": source["presets"]})
        )
        self.ok(self.client.patch(f"/api/episodes/{board_id}", json={"title": "编辑后的分镜"}))
        fresh = self.ok(self.client.post(url, json={**body, "idempotency_key": "after-edit"}), 201)
        self.assertEqual(fresh["series"]["variables"]["color"], "edited")
        self.assertEqual(fresh["episode"]["title"], "编辑后的分镜")
        frozen = self.ok(self.client.get(f"/api/series/{old['series']['id']}"))
        self.assertEqual(frozen["variables"]["color"], "warm")
        exported = self.ok(
            self.client.post(
                "/api/creation-kits/export",
                json={
                    "series_id": source["id"],
                    "episode_ids": [board_id],
                    "preset_ids": imported["preset_ids"],
                },
            )
        )
        inspected = self.ok(
            self.client.post("/api/creation-kits/inspect", content=exported.content)
        )
        self.assertEqual(inspected["episodes"][0]["title"], "编辑后的分镜")
        self.assertFalse(self.ctx.engine.list())
