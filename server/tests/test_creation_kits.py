"""Portable creative resources keep references and commit atomically without model calls."""

import base64
import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from mio_server.api import create_app
from mio_server.context import AppContext
from mio_server.creation_kits import assemble_kit, export_kit, import_kit, inspect_kit, preview_kit
from mio_server.creation_kits.models import KitAssembly, KitImport, KitSelection
from mio_server.models import (
    AssetRef,
    Bible,
    Character,
    ControlInput,
    Dialogue,
    Episode,
    LetteringLayer,
    Panel,
    PanelCharacter,
    PanelOverrides,
    Preset,
    PresetEntry,
    PresetGroup,
    Series,
    Strip,
    Style,
    Take,
    VariantSet,
)
from mio_server.pipeline.providers import ImageChannel
from mio_server.render_models import ComfyInstance, RenderProfile
from mio_server.settings import AppSettings
from mio_server.storage import Conflict, NotFound


def rewrite(data, mutate=None, extra=None):
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        files = {name: zf.read(name) for name in zf.namelist()}
    if mutate:
        payload = json.loads(files["kit.json"])
        mutate(payload)
        files["kit.json"] = json.dumps(payload).encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        for name, blob in files.items():
            zf.writestr(name, blob)
        if extra:
            zf.writestr(*extra)
    return out.getvalue()


class CreationKitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = AppContext.create(
            Path(self.tmp.name) / "source", autostart=False, seed_instance=False
        )
        self.target = AppContext.create(
            Path(self.tmp.name) / "target", autostart=False, seed_instance=False
        )
        self.addCleanup(self.source.close)
        self.addCleanup(self.target.close)
        for ctx in (self.source, self.target):
            ctx.store.put_doc(ComfyInstance(id="local", base_url="http://127.0.0.1:1"))
        buf = io.BytesIO()
        Image.new("RGB", (8, 8), "#ff8899").save(buf, "PNG")
        self.asset = self.source.assets.put(buf.getvalue())
        self.series = self.source.store.create_series(
            Series(
                title="Portable resource",
                kind="workshop",
                default_profile_id="profile_default",
                bible=Bible(
                    characters=[
                        Character(
                            id="alice",
                            name="Alice",
                            age=28,
                            references=[AssetRef(asset_id=self.asset.id)],
                        )
                    ],
                    styles=[Style(id="paper", tag_description=["watercolor"])],
                ),
                presets=[
                    Preset(
                        id="red",
                        title="Red",
                        groups=[PresetGroup(id="g", title="Cast")],
                        entries=[PresetEntry(key="color", value="red", group_id="g")],
                    ),
                    Preset(
                        id="blue", title="Blue", entries=[PresetEntry(key="color", value="blue")]
                    ),
                ],
                variants=[
                    VariantSet(
                        id="v",
                        name="Reference",
                        characters={"alice": {"references": [{"asset_id": self.asset.id}]}},
                        style_id="paper",
                    )
                ],
            )
        )
        self.episode = self.source.store.create_episode(
            Episode(
                series_id=self.series.id,
                title="Rain",
                order=0,
                panels=[
                    Panel(
                        id="p",
                        order=0,
                        characters=[PanelCharacter(character_id="alice")],
                        dialogues=[Dialogue(speaker_id="alice", text="{color}")],
                        controls=[ControlInput(source="take", take_id="take")],
                        overrides=PanelOverrides(raw_prompt="{alice} {color} {{alice}}"),
                    )
                ],
                takes=[Take(id="take", panel_id="p", asset_id=self.asset.id)],
                strip=Strip(
                    manual=True,
                    panel_boxes={"p": (24, 24, 776, 900)},
                    crops={"p": (0, 0, 1, 1)},
                    lettering=[
                        LetteringLayer(
                            panel_id="p", speaker_id="alice", text="Caption", box=(30, 30, 200, 100)
                        )
                    ],
                ),
            )
        )
        self.selection = KitSelection(
            series_id=self.series.id, episode_ids=[self.episode.id], preset_ids=["blue", "red"]
        )
        self.archive = export_kit(self.source, self.selection)

    def request(self, **kw):
        return KitImport(
            archive_base64=base64.b64encode(self.archive).decode(),
            profiles={"profile_default": {"instances": ["local"]}},
            idempotency_key="kit-once",
            **kw,
        )

    def counts(self):
        store = self.target.store
        return (
            len(store.list_series()),
            len(store.list_docs("profile")),
            len(store.list_docs("workflow")),
            len(store.asset_ids()),
        )

    def test_export_inspect_preserves_order_closure_and_does_not_write(self):
        before = self.counts()
        report = inspect_kit(self.archive)
        self.assertEqual([p.id for p in report.presets], ["blue", "red"])
        self.assertEqual(report.asset_count, 1)
        self.assertTrue(report.external[0].local)
        self.assertEqual(self.counts(), before)
        with zipfile.ZipFile(io.BytesIO(self.archive)) as zf:
            payload = json.loads(zf.read("kit.json"))
        self.assertEqual(payload["profiles"][0]["instances"], [])
        self.assertEqual(payload["episodes"][0]["takes"], [])
        self.assertEqual(payload["episodes"][0]["panels"][0]["controls"][0]["source"], "asset")
        self.assertNotIn("base_url", json.dumps(payload))
        self.assertEqual(len(self.source.store.get_episode(self.episode.id).takes), 1)

    def test_cross_workspace_import_rewrites_nested_ids_and_retains_composition(self):
        original_workflow = self.target.store.get_doc("workflow", "builtin_t2i_sdxl")
        original_workflow.name = "Destination differs"
        self.target.store.put_doc(original_workflow)
        result = import_kit(self.target, self.request())
        kit = self.target.store.get_series(result.series_id)
        episode = self.target.store.get_episode(result.episode_ids[0])
        self.assertEqual(kit.kind, "kit")
        self.assertEqual([p.title for p in kit.presets], ["Blue", "Red"])
        cid, pid = kit.bible.characters[0].id, episode.panels[0].id
        self.assertNotEqual(cid, "alice")
        self.assertEqual(episode.panels[0].characters[0].character_id, cid)
        self.assertEqual(episode.panels[0].dialogues[0].speaker_id, cid)
        self.assertIn(cid, kit.variants[0].characters)
        self.assertEqual(kit.variants[0].style_id, kit.bible.styles[0].id)
        self.assertEqual(episode.panels[0].overrides.raw_prompt, "{" + cid + "} {color} {{alice}}")
        self.assertEqual(set(episode.strip.panel_boxes), {pid})
        self.assertEqual(episode.strip.lettering[0].panel_id, pid)
        self.assertEqual(episode.strip.lettering[0].speaker_id, cid)
        self.assertEqual(
            self.target.assets.read(self.asset.id), self.source.assets.read(self.asset.id)
        )
        profile = self.target.store.get_doc("profile", kit.default_profile_id)
        self.assertEqual(profile.instances, ["local"])
        self.assertNotEqual(profile.draft[0].workflow_id, "builtin_t2i_sdxl")
        self.assertEqual(
            self.target.store.get_doc("workflow", "builtin_t2i_sdxl").name, "Destination differs"
        )
        self.assertEqual(self.target.engine.list(), [])

    def test_explicit_unbound_import_allows_preview_without_a_service(self):
        request = self.request()
        request.profiles["profile_default"] = request.profiles["profile_default"].model_copy(
            update={"unbound": True, "instances": None}
        )
        result = import_kit(self.target, request)
        self.assertEqual(len(result.unbound_profile_ids), 1)
        profile = self.target.store.get_doc("profile", result.unbound_profile_ids[0])
        self.assertTrue(profile.instances[0].startswith("unbound-"))
        self.assertTrue(profile.binding_required)
        review = preview_kit(
            self.target,
            result.series_id,
            KitAssembly(
                episode_id=result.episode_ids[0],
                preset_ids=result.preset_ids,
                idempotency_key="unused",
            ),
        )
        self.assertIn("red", review.panels[0].positive)
        with self.assertRaisesRegex(ValueError, "配置|绑定"):
            self.target.render.render(result.episode_ids[0], profile_id=profile.id)
        self.assertEqual(self.target.engine.list(), [])

    def test_cloud_binding_is_explicit_and_never_carries_credentials(self):
        profile = self.source.store.get_doc("profile", "profile_default")
        profile.cloud_shape, profile.cloud_channel = True, "private-channel"
        self.source.store.put_doc(profile)
        self.source.store.put_doc(
            AppSettings(image_channels=[ImageChannel(id="private-channel", api_key="do-not-share")])
        )
        self.archive = export_kit(self.source, self.selection)
        self.assertNotIn(b"do-not-share", self.archive)
        self.target.store.put_doc(AppSettings(image_channels=[ImageChannel(id="target-channel")]))
        request = self.request()
        request.profiles["profile_default"] = request.profiles["profile_default"].model_copy(
            update={"instances": None, "cloud_channel": "target-channel"}
        )
        result = import_kit(self.target, request)
        kit = self.target.store.get_series(result.series_id)
        imported = self.target.store.get_doc("profile", kit.default_profile_id)
        self.assertEqual(imported.cloud_channel, "target-channel")
        self.assertFalse(imported.binding_required)
        self.assertEqual(self.target.settings().image_channels[0].api_key, "")

    def test_corrupt_missing_or_nonimage_assets_are_rejected_before_writes(self):
        with zipfile.ZipFile(io.BytesIO(self.archive)) as zf:
            original = {name: zf.read(name) for name in zf.namelist()}
        for case in ("missing", "corrupt", "not-image"):
            with self.subTest(case=case):
                files = original.copy()
                name = f"assets/{self.asset.id}"
                if case == "missing":
                    del files[name]
                elif case == "corrupt":
                    files[name] = b"broken"
                else:
                    blob = b"plain text"
                    replacement = hashlib.sha256(blob).hexdigest()
                    files["kit.json"] = files["kit.json"].replace(
                        self.asset.id.encode(), replacement.encode()
                    )
                    del files[name]
                    files[f"assets/{replacement}"] = blob
                out = io.BytesIO()
                with zipfile.ZipFile(out, "w") as zf:
                    for key, value in files.items():
                        zf.writestr(key, value)
                before = self.counts()
                with self.assertRaises(ValueError):
                    import_kit(
                        self.target,
                        self.request().model_copy(
                            update={"archive_base64": base64.b64encode(out.getvalue()).decode()}
                        ),
                    )
                self.assertEqual(before, self.counts())

    def test_import_rejects_implicit_or_missing_external_mapping(self):
        for profiles in (
            {},
            {"profile_default": {}},
            {"profile_default": {"instances": ["missing"]}},
        ):
            request = self.request().model_copy(
                update={
                    "profiles": KitImport(
                        archive_base64="eA==", profiles=profiles, idempotency_key="x"
                    ).profiles
                }
            )
            before = self.counts()
            with self.assertRaises((ValueError, NotFound)):
                import_kit(self.target, request)
            self.assertEqual(self.counts(), before)

    def test_concurrent_import_and_restart_replay_one_resource(self):
        request = self.request()
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda _: import_kit(self.target, request), range(3)))
        self.assertEqual(len({r.series_id for r in results}), 1)
        self.target.close()
        self.target = AppContext.create(
            Path(self.tmp.name) / "target", autostart=False, seed_instance=False
        )
        self.addCleanup(self.target.close)
        self.assertEqual(import_kit(self.target, request), results[0])
        changed = request.model_copy(
            update={
                "profiles": {
                    "profile_default": request.profiles["profile_default"].model_copy(
                        update={"instances": ["missing"]}
                    )
                }
            }
        )
        with self.assertRaises(Conflict):
            import_kit(self.target, changed)
        self.target.store.delete_series(results[0].series_id)
        with self.assertRaises(NotFound):
            import_kit(self.target, request)

    def test_import_write_failure_rolls_back_all_visible_records(self):
        before = self.counts()
        with patch.object(
            self.target.store, "create_episode", side_effect=RuntimeError("injected")
        ):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                import_kit(self.target, self.request())
        self.assertEqual(self.counts(), before)
        self.assertEqual(len(import_kit(self.target, self.request()).episode_ids), 1)

    def test_bad_archives_and_references_fail_without_partial_import(self):
        bad = [
            rewrite(self.archive, extra=("../outside", b"x")),
            rewrite(self.archive, extra=("kit.json", b"{}")),
            rewrite(
                self.archive, lambda p: p["episodes"][0]["panels"][0].update(location_id="missing")
            ),
            rewrite(self.archive, lambda p: p["series"].update(default_profile_id="missing")),
            rewrite(self.archive, lambda p: p["profiles"][0].update(instances=["private"])),
            rewrite(
                self.archive,
                lambda p: p["workflows"][0]["graph"]["1"]["inputs"].update(api_key="do-not-export"),
            ),
        ]
        for data in bad:
            with self.subTest(size=len(data)):
                before = self.counts()
                with self.assertRaises(ValueError):
                    import_kit(
                        self.target,
                        self.request().model_copy(
                            update={"archive_base64": base64.b64encode(data).decode()}
                        ),
                    )
                self.assertEqual(self.counts(), before)

    def test_assemble_is_independent_and_idempotent_after_source_changes(self):
        result = import_kit(self.target, self.request())
        body = KitAssembly(
            episode_id=result.episode_ids[0],
            preset_ids=result.preset_ids,
            idempotency_key="one-album",
        )
        album, ep = assemble_kit(self.target, result.series_id, body)
        self.assertEqual(album.kind, "album")
        self.assertEqual(
            album.default_profile_id,
            self.target.store.get_series(result.series_id).default_profile_id,
        )
        self.assertEqual(album.variables["color"], "red")
        self.target.store.update_episode(
            result.episode_ids[0], lambda e: setattr(e, "title", "Changed")
        )
        again = assemble_kit(self.target, result.series_id, body)
        self.assertEqual((again[0].id, again[1].id), (album.id, ep.id))
        self.assertEqual(self.target.store.get_episode(ep.id).title, "Rain")
        self.assertEqual(self.target.engine.list(), [])

    def test_assembly_profile_override_matches_preview_and_preserves_source_and_panel_choices(self):
        result = import_kit(self.target, self.request())
        source = self.target.store.get_series(result.series_id)
        board = self.target.store.get_episode(result.episode_ids[0])
        selected = self.target.store.put_doc(
            RenderProfile(name="Selected cloud", cloud_shape=True, dialect="natural")
        )
        per_panel = self.target.store.put_doc(RenderProfile(name="Panel local", dialect="tags"))
        board.panels.append(Panel(order=1, overrides=PanelOverrides(profile_id=per_panel.id)))
        self.target.store.save_episode(board)
        source_before = source.model_dump()
        board_before = self.target.store.get_episode(board.id).model_dump()
        body = KitAssembly(
            episode_id=board.id, preset_ids=result.preset_ids, idempotency_key="profile-override"
        )
        default = preview_kit(self.target, source.id, body)
        self.assertEqual(default.profile_id, source.default_profile_id)
        self.assertEqual(default.panels[0].profile_id, source.default_profile_id)
        body.profile_id = selected.id
        before = self.counts()
        preview = preview_kit(self.target, source.id, body)
        self.assertEqual(self.counts(), before)
        self.assertEqual(preview.profile_id, selected.id)
        self.assertEqual(
            [(p.profile_id, p.dialect) for p in preview.panels],
            [(selected.id, "natural"), (per_panel.id, "tags")],
        )
        album, episode = assemble_kit(self.target, source.id, body)
        self.assertEqual(album.default_profile_id, selected.id)
        self.assertIsNone(episode.panels[0].overrides.profile_id)
        self.assertEqual(episode.panels[1].overrides.profile_id, per_panel.id)
        self.assertEqual(self.target.store.get_series(source.id).model_dump(), source_before)
        self.assertEqual(self.target.store.get_episode(board.id).model_dump(), board_before)
        self.assertEqual(self.target.engine.list(), [])

    def test_missing_assembly_profile_is_rejected_even_when_every_panel_overrides_it(self):
        result = import_kit(self.target, self.request())
        source = self.target.store.get_series(result.series_id)
        board = self.target.store.get_episode(result.episode_ids[0])
        board.panels[0].overrides.profile_id = source.default_profile_id
        self.target.store.save_episode(board)
        body = KitAssembly(
            episode_id=board.id, profile_id="missing-profile", idempotency_key="bad-profile"
        )
        before = self.counts()
        for operation in (preview_kit, assemble_kit):
            with self.subTest(operation=operation.__name__):
                with self.assertRaises(NotFound):
                    operation(self.target, source.id, body)
                self.assertEqual(self.counts(), before)
        valid = body.model_copy(update={"profile_id": source.default_profile_id})
        album, _ = assemble_kit(self.target, source.id, valid)
        self.assertEqual(album.default_profile_id, source.default_profile_id)
        self.assertEqual(self.target.engine.list(), [])

    def test_assembly_profile_is_part_of_idempotency_identity_and_original_replay(self):
        result = import_kit(self.target, self.request())
        selected = self.target.store.put_doc(RenderProfile(name="Selected"))
        alternative = self.target.store.put_doc(RenderProfile(name="Alternative"))
        body = KitAssembly(
            episode_id=result.episode_ids[0],
            profile_id=selected.id,
            idempotency_key="same-profile-intent",
        )
        album, episode = assemble_kit(self.target, result.series_id, body)
        for profile_id in (alternative.id, None):
            with self.subTest(profile_id=profile_id):
                with self.assertRaises(Conflict):
                    assemble_kit(
                        self.target,
                        result.series_id,
                        body.model_copy(update={"profile_id": profile_id}),
                    )
        self.target.store.delete_series(result.series_id)
        with patch(
            "mio_server.creation_kits.service._assembly_snapshot",
            side_effect=AssertionError("receipt replay read source"),
        ):
            again = assemble_kit(self.target, result.series_id, body)
        self.assertEqual((again[0].id, again[1].id), (album.id, episode.id))
        self.assertEqual(again[0].default_profile_id, selected.id)
        self.assertEqual(self.target.engine.list(), [])

    def test_v2_api_exposes_inspect_import_preview_and_assemble(self):
        with TestClient(
            create_app(self.target, serve_web=False), base_url="http://127.0.0.1"
        ) as client:
            token = client.post(
                "/api/tokens", json={"name": "kit", "scopes": ["read", "write"]}
            ).json()["token"]
            headers = {"Authorization": f"Bearer {token}"}
            report = client.post(
                "/api/v2/creation-kits/inspect", headers=headers, content=self.archive
            )
            self.assertEqual(report.status_code, 200, report.text)
            self.assertEqual(self.counts()[0], 0)
            imported = client.post(
                "/api/v2/creation-kits/import", headers=headers, json=self.request().model_dump()
            )
            self.assertEqual(imported.status_code, 201, imported.text)
            result = imported.json()
            profile = self.target.store.put_doc(
                RenderProfile(name="API profile", dialect="natural")
            )
            body = {
                "episode_id": result["episode_ids"][0],
                "preset_ids": result["preset_ids"],
                "idempotency_key": "api-album",
                "profile_id": profile.id,
            }
            preview = client.post(
                f"/api/v2/creation-kits/{result['series_id']}/preview", headers=headers, json=body
            )
            self.assertEqual(preview.status_code, 200, preview.text)
            self.assertEqual(preview.json()["profile_id"], profile.id)
            self.assertEqual(preview.json()["panels"][0]["profile_id"], profile.id)
            assembled = client.post(
                f"/api/v2/creation-kits/{result['series_id']}/assemble", headers=headers, json=body
            )
            self.assertEqual(assembled.status_code, 201, assembled.text)
            self.assertEqual(assembled.json()["series"]["default_profile_id"], profile.id)
            self.assertEqual(len(client.get("/api/v2/creation-kits", headers=headers).json()), 1)
            self.assertEqual(len(client.get("/api/v2/series", headers=headers).json()), 1)
            self.assertEqual(self.target.engine.list(), [])
