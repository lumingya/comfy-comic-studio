"""Declarative host entries disclose only reviewed, currently active episode panels."""

import io
import json
import zipfile
from pathlib import Path

from pydantic import ValidationError

from mio_server.extensions.manifest import Manifest
from mio_server.extensions.protocol import CreationContextV1

from .api_harness import ApiCase

EXAMPLE = Path(__file__).resolve().parents[2] / "examples/extensions/creation-inspector"


class HostSlotTests(ApiCase):
    def package(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            for path in sorted(EXAMPLE.iterdir()):
                if path.is_file():
                    archive.write(path, f"creation-inspector/{path.name}")
        return output.getvalue()

    def test_directory_requires_reviewed_activation_and_disappears_on_disable_or_change(self):
        before = self.ok(self.client.get("/api/extension-host-slots"))
        self.assertEqual(before, [])
        self.ok(self.client.post("/api/extensions", content=self.package()), 201)
        self.assertEqual(self.ok(self.client.get("/api/extension-host-slots")), [])
        info = self.ctx.extensions.info("creation-inspector")
        self.ctx.extensions.enable(info.id, info.digest)
        entries = self.ok(self.client.get("/api/extension-host-slots"))
        self.assertEqual(
            {entry["slot"] for entry in entries},
            {"command_palette", "context_menu.episode", "inspector.panel"},
        )
        self.assertTrue(all(entry["panel"]["digest"] == info.digest for entry in entries))
        self.assertTrue(all(entry["panel"]["subscriptions"] for entry in entries))
        read = self.ok(
            self.client.post("/api/tokens", json={"name": "slots", "scopes": ["read"]}), 201
        )["token"]
        self.assertEqual(self.client.get("/api/v2/extension-host-slots").status_code, 401)
        self.assertEqual(
            self.client.get(
                "/api/v2/extension-host-slots", headers={"Authorization": f"Bearer {read}"}
            ).status_code,
            200,
        )
        self.ctx.extensions.disable(info.id)
        self.assertEqual(self.ok(self.client.get("/api/extension-host-slots")), [])
        self.ctx.extensions.enable(info.id, info.digest)
        current = self.ok(self.client.get("/api/extension-host-slots"))
        self.assertNotEqual(current[0]["panel"]["activation"], entries[0]["panel"]["activation"])
        (self.ctx.extensions.root / info.id / "panel.js").write_text("changed", encoding="utf-8")
        self.assertEqual(self.ok(self.client.get("/api/extension-host-slots")), [])
        self.assertEqual(self.ctx.engine.list(), [])

    def test_manifest_rejects_executable_slots_cross_extension_targets_and_ungranted_events(self):
        source = json.loads((EXAMPLE / "mio-extension.json").read_text("utf-8"))
        self.assertEqual(len(Manifest.model_validate(source).contributes.host_slots), 3)
        for slots in (("settings", "episode"), ("episode", "settings"), ("episode", "episode")):
            value = json.loads(json.dumps(source))
            panel = value["contributes"]["panels"][0]
            value["contributes"]["panels"] = [{**panel, "slot": slot} for slot in slots]
            with self.subTest(duplicate_panels=slots), self.assertRaises(ValidationError):
                Manifest.model_validate(value)
        for change in (
            {"action": {"kind": "request", "request_id": "read"}},
            {"action": {"kind": "open_panel", "panel_id": "other-panel"}},
            {"slot": "arbitrary.dom"},
            {"icon": "<script>"},
            {"when": "eval(input)"},
            {"version": True},
        ):
            value = json.loads(json.dumps(source))
            value["contributes"]["host_slots"][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValidationError):
                Manifest.model_validate(value)
        for subscriptions, requests in (
            (["business.custom"], source["contributes"]["panels"][0]["requests"]),
            (["selection.changed"], []),
            (
                ["selection.changed", "selection.changed"],
                source["contributes"]["panels"][0]["requests"],
            ),
        ):
            value = json.loads(json.dumps(source))
            value["contributes"]["panels"][0].update(subscriptions=subscriptions, requests=requests)
            with self.assertRaises(ValidationError):
                Manifest.model_validate(value)

    def test_context_contract_is_bounded_and_has_no_text_or_configuration_escape(self):
        payload = {
            "seq": 1,
            "context_id": "context-a",
            "selection": {"kind": "panels", "ids": ["a"]},
        }
        parsed = CreationContextV1.model_validate(payload)
        self.assertEqual(parsed.revisions.episode, None)
        for changes in (
            {"prompt": "private"},
            {"settings": {}},
            {"version": True},
            {"selection": {"kind": "panels", "ids": [str(i) for i in range(101)]}},
            {"selection": {"kind": "panels", "ids": ["x" * 129]}},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                CreationContextV1.model_validate({**payload, **changes})
