"""Python validation, generated schemas and injected bridges share a wire contract."""

import json
import re
from unittest import TestCase

from pydantic import ValidationError

from mio_server.api.extension_surfaces import WORKSPACE_BRIDGE_JS
from mio_server.api.theme_packages import _settings_bridge
from mio_server.extensions.manifest import Manifest
from mio_server.extensions.panel_bridge import PanelBridgeRequest
from mio_server.extensions.protocol import (
    CONTRACT_VERSION,
    PanelFromFrame,
    PanelToFrame,
    SurfaceLifecycle,
    ThemeSettingsFromFrame,
    WorkspaceFromFrame,
    WorkspaceLifecycle,
    client_constants,
    contract_schemas,
)

from .api_harness import ApiCase


class ExtensionContractModelTests(TestCase):
    def test_every_schema_reference_resolves_inside_the_contract_bundle(self):
        schemas = contract_schemas()
        pending = list(schemas.values())
        while pending:
            value = pending.pop()
            if isinstance(value, dict):
                if "$ref" in value:
                    prefix = "#/components/schemas/"
                    self.assertTrue(value["$ref"].startswith(prefix))
                    self.assertIn(value["$ref"][len(prefix) :], schemas)
                self.assertNotIn("$defs", value)
                pending.extend(value.values())
            elif isinstance(value, list):
                pending.extend(value)

    def test_manifest_and_http_panel_models_are_the_existing_runtime_authorities(self):
        from mio_server.extensions import protocol

        self.assertIs(protocol.Manifest, Manifest)
        self.assertIs(protocol.PanelBridgeRequest, PanelBridgeRequest)
        schema = Manifest.model_json_schema(ref_template="#/components/schemas/MioContract_{model}")
        schema.pop("$defs", None)
        self.assertEqual(contract_schemas()["MioContract_Manifest"], schema)

    def test_injected_bridge_configs_are_exactly_the_exported_constants(self):
        constants = client_constants()
        workspace = re.search(r"const protocol = (\{[^\n]+\});", WORKSPACE_BRIDGE_JS)
        settings = re.search(r"const protocol=(\{.+?\});", _settings_bridge("test-nonce"))
        self.assertIsNotNone(workspace)
        self.assertIsNotNone(settings)
        self.assertEqual(json.loads(workspace[1]), constants["workspace"])
        self.assertEqual(json.loads(settings[1]), constants["themeSettings"])
        self.assertNotIn("__MIO_WORKSPACE_PROTOCOL__", WORKSPACE_BRIDGE_JS)
        self.assertIn("Object.values(protocol.lifecycle)", WORKSPACE_BRIDGE_JS)
        self.assertIn("for (const type of globalHandlers.keys())", WORKSPACE_BRIDGE_JS)
        self.assertIn("protocol.maxBytes", _settings_bridge("test-nonce"))

    def test_message_families_accept_declared_shapes_and_reject_cross_family_payloads(self):
        constants = client_constants()
        panel = {
            "session": "s",
            "version": constants["panel"]["version"],
            "type": constants["panel"]["types"]["ready"],
        }
        workspace = {
            "session": "s",
            "type": constants["workspace"]["types"]["resize"],
            "width": 600,
            "height": 400,
        }
        theme = {
            "session": "s",
            "type": constants["themeSettings"]["types"]["request"],
            "requestId": "1",
            "action": constants["themeSettings"]["actions"]["updateSettings"],
            "settings": {"accent": "blue"},
        }
        for model, value in (
            (PanelFromFrame, panel),
            (WorkspaceFromFrame, workspace),
            (ThemeSettingsFromFrame, theme),
        ):
            model.model_validate(value)
            with self.assertRaises(ValidationError):
                model.model_validate({**value, "type": "mio:unknown:message"})
            with self.assertRaises(ValidationError):
                model.model_validate({**value, "session": ""})
        for value in (
            {**panel, "version": 2},
            {**panel, "version": True},
            {**panel, "extra": True},
        ):
            with self.assertRaises(ValidationError):
                PanelFromFrame.model_validate(value)
        for value in (float("nan"), float("inf"), "600"):
            with self.assertRaises(ValidationError):
                WorkspaceFromFrame.model_validate({**workspace, "width": value})
        with self.assertRaises(ValidationError):
            WorkspaceFromFrame.model_validate(
                {
                    "session": "s",
                    "type": constants["workspace"]["types"]["listen"],
                    "event": "keyup",
                    "enabled": True,
                }
            )
        with self.assertRaises(ValidationError):
            ThemeSettingsFromFrame.model_validate({**theme, "settings": []})
        appearance = {
            "tokens": {"bg": "#17191b", "accent": "#e0a070"},
            "theme": "dark",
            "locale": "zh-CN",
        }
        init = {
            "session": "s",
            "version": constants["panel"]["version"],
            "type": constants["panel"]["types"]["init"],
            "context": {"episode_id": "episode"},
            "appearance": appearance,
            "requests": [],
            "limits": {
                "requestBytes": 1,
                "responseBytes": 1,
                "concurrent": 1,
                "imageBytes": 1,
                "downloadBytes": 1,
                "mediaBytes": 1,
                "mediaItems": 1,
            },
        }
        PanelToFrame.model_validate(init)
        changed = {
            "session": "s",
            "version": constants["panel"]["version"],
            "type": constants["panel"]["types"]["appearance"],
            "appearance": {**appearance, "theme": "light", "locale": "en"},
        }
        PanelToFrame.model_validate(changed)
        with self.assertRaises(ValidationError):
            PanelToFrame.model_validate(
                {**changed, "appearance": {**appearance, "tokens": {"evil": "red"}}}
            )
        with self.assertRaises(ValidationError):
            PanelFromFrame.model_validate({**panel, "appearance": appearance})
        for state in SurfaceLifecycle:
            WorkspaceLifecycle.model_validate(
                {
                    "session": "s",
                    "type": constants["workspace"]["types"]["lifecycle"],
                    "state": state,
                }
            )


class ExtensionContractOpenAPITests(ApiCase):
    def test_local_and_v2_publish_the_same_authoritative_contract_components(self):
        schemas = contract_schemas()
        local = self.ok(self.client.get("/openapi.json"))
        v2 = self.ok(self.client.get("/api/v2/openapi.json"))
        for document in (local, v2):
            self.assertEqual(document["x-mio-extension-contract-version"], CONTRACT_VERSION)
            for name, value in schemas.items():
                self.assertEqual(document["components"]["schemas"][name], value)
        # Schema publication adds no callable bridge or unguarded business route.
        self.assertEqual(self.client.get("/api/v2/extension-surfaces").status_code, 401)
        self.assertEqual(self.client.get("/api/extension-contracts").status_code, 404)
