"""Independent regressions for the final adversarial review's six security findings."""

from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server import settings as SET
from mio_server.album.render import Book, Frame, render_album
from mio_server.album.templates import parse_template
from mio_server.extensions.sdk import ExtensionAPI
from mio_server.pipeline import cloud_request as CR
from mio_server.pipeline import providers as PV

from .api_harness import ApiCase

HTML = (
    "<!doctype html><html><head>{head}</head><body>{body}"
    '{{{{#books}}}}<section>{{{{#frames}}}}<img src="{{{{image}}}}">'
    "{{{{/frames}}}}</section>{{{{/books}}}}</body></html>"
)


def nested(depth):
    value = "ordinary"
    for _ in range(depth):
        value = {"item": value}
    return value


def template(head="", body=""):
    return {"id": "security-review", "title": "Review", "html": HTML.format(head=head, body=body)}


class SecurityReviewRegressions(ApiCase):
    def setUp(self):
        super().setUp()
        self.ctx.legacy_root = Path(self.tmp) / "empty"

    def token(self, *scopes):
        issued = self.ok(
            self.client.post("/api/tokens", json={"name": "Security review", "scopes": scopes}),
            201,
        )
        return {"Authorization": f"Bearer {issued['token']}"}

    def configure(self, options, *, path="/api/settings", headers=None):
        return self.client.patch(
            path,
            headers=headers,
            json={"image_channels": [{"id": "review", "kind": "review", "extra_options": options}]},
        )

    def test_600_level_option_payload_is_a_client_error_through_both_real_apis(self):
        headers = self.token("admin")
        payload = nested(600)
        self.assertLess(len(json.dumps(payload)), 32 * 1024)
        for path in ("/api/settings", "/api/v2/settings"):
            with self.subTest(path=path):
                response = self.configure(payload, path=path, headers=headers)
                self.assertIn(response.status_code, (400, 422), response.text)
                self.assertIn("json", response.headers.get("content-type", ""))
        self.assertFalse(self.ctx.settings().image_channels)
        accepted = self.ok(self.configure({"nested": nested(4)}))
        self.assertEqual(accepted["image_channels"][0]["extra_options"]["nested"], nested(4))

    def test_metadata_rejects_excessive_depth_and_node_counts_before_recursive_copy(self):
        extension = ExtensionAPI("review", Path(self.tmp), self.ctx)
        for schema in (nested(600), {"items": [0] * 8192}):
            with self.subTest(kind="deep" if "item" in schema else "wide"):
                with self.assertRaises(ValueError):
                    extension.contribute("cloud_adapter", "review", object, schema=schema)
        self.assertFalse(any(row.id == "review" for row in self.ctx.registry.all("cloud_adapter")))
        extension.contribute(
            "cloud_adapter",
            "review",
            object,
            schema={"type": "object", "properties": {"quality": {"type": "string"}}},
        )
        descriptors = self.ok(self.client.get("/api/image-adapters"))
        descriptor = next(row for row in descriptors if row["id"] == "review")
        self.assertEqual(descriptor["schema"]["properties"]["quality"], {"type": "string"})

    def test_cookie_and_session_values_remain_private_across_api_mask_freeze_and_rebind(self):
        secrets = {
            "Cookie": "fixture-cookie",
            "Set-Cookie": "fixture-set-cookie",
            "X-Session-Key": "fixture-session-key",
            "sessionId": "fixture-session-id",
            "session_token": "fixture-session-token",
        }
        public = self.ok(self.configure({"quality": "draft", "headers": secrets}))
        options = public["image_channels"][0]["extra_options"]
        self.assertEqual(options["headers"], {name: SET.MASK for name in secrets})
        replay = self.ok(
            self.client.patch("/api/settings", json={"image_channels": public["image_channels"]})
        )
        for value in secrets.values():
            self.assertNotIn(value, json.dumps(replay))
        channel = self.ctx.settings().image_channels[0]
        self.assertEqual(channel.extra_options["headers"], secrets)
        original = SimpleNamespace(channel=channel, image_models=())
        frozen = CR.freeze_request(original, {"prompt": "a chair"})
        self.assertEqual(frozen["options"]["extra_options"], {"quality": "draft", "headers": {}})
        current = SimpleNamespace(
            channel=channel.model_copy(
                update={
                    "extra_options": {
                        "quality": "final",
                        "headers": {key: "fixture-rotated" for key in secrets},
                    }
                }
            ),
            image_models=(),
        )
        bound = CR.bind_request(current, frozen)
        self.assertEqual(bound.channel.extra_options["quality"], "draft")
        self.assertEqual(
            bound.channel.extra_options["headers"], {key: "fixture-rotated" for key in secrets}
        )
        for value in secrets.values():
            self.assertNotIn(value, json.dumps(frozen))

    def test_credential_urls_are_rejected_even_with_leading_url_whitespace(self):
        urls = (
            "https://fixture-user:fixture-secret@example.invalid/path",
            "https://example.invalid/path?access_token=fixture-secret",
            " https://example.invalid/path?access_token=fixture-secret",
            "\nhttps://fixture-user:fixture-secret@example.invalid/path",
            "//fixture-user:fixture-secret@example.invalid/path",
            "https://example.invalid/path#access_token=fixture-secret",
        )
        for index, value in enumerate(urls):
            with self.subTest(variant=index):
                response = self.configure({"endpoint": value})
                self.assertIn(response.status_code, (400, 422))
        self.assertFalse(self.ctx.settings().image_channels)

    def test_ordinary_urls_and_explicit_secret_fields_still_work(self):
        url = "https://example.invalid/path?quality=high#chapter"
        secret_url = "https://fixture-user:fixture-secret@example.invalid/path"
        public = self.ok(self.configure({"endpoint": url, "api_key": secret_url}))
        self.assertEqual(
            public["image_channels"][0]["extra_options"], {"endpoint": url, "api_key": SET.MASK}
        )
        channel = self.ctx.settings().image_channels[0]
        self.assertEqual(channel.extra_options["api_key"], secret_url)
        self.assertEqual(CR.channel_options(channel)["extra_options"], {"endpoint": url})

    def test_historical_credential_url_validation_never_echoes_the_stored_secret(self):
        headers = self.token("admin")
        # A model constructed without today's validator represents an older persisted row.
        # A deliberately short URL exposes accidental input echoing instead of relying on
        # Pydantic's display truncation of a longer synthetic credential.
        historical = SET.AppSettings(
            image_channels=[
                PV.ImageChannel.model_construct(
                    id="historical", extra_options={"url": "http://u:shortpass@x"}
                )
            ]
        )
        self.ctx.store.put_doc(historical)
        for prefix in ("/api", "/api/v2"):
            for method, body in (("GET", None), ("PATCH", {"trash_days": 10})):
                with self.subTest(prefix=prefix, method=method):
                    response = self.client.request(
                        method, f"{prefix}/settings", headers=headers, json=body
                    )
                    self.assertIn(response.status_code, (400, 422))
                    self.assertNotIn("shortpass", response.text)

    def test_meta_refresh_case_and_entities_are_rejected_on_import_and_stored_render(self):
        refresh_tags = (
            '<meta http-equiv="refresh" content="0; url=https://example.invalid/">',
            '<META HTTP-EQUIV="  ReFrEsH  " CONTENT="0;url=https://example.invalid/">',
            '<meta http-equiv="refr&#101;sh" content="0;url=https://example.invalid/">',
            '<meta http-equiv="&#x72;efresh" content="0;url=https://example.invalid/"/>',
        )
        base = parse_template(template())
        for index, tag in enumerate(refresh_tags):
            raw = template(head=tag)
            with self.subTest(variant=index, boundary="import"), self.assertRaises(ValueError):
                parse_template(raw)
            historical = base.model_copy(update={"html": raw["html"]})
            with self.subTest(variant=index, boundary="render"), self.assertRaises(ValueError):
                render_album(historical, [Book("Review", [Frame("")])])

    def test_meta_refresh_hidden_by_abrupt_comments_or_noscript_is_rejected(self):
        tag = '<meta http-equiv="refresh" content="0;url=https://example.invalid/">'
        fragments = (f"<!-->{tag} -->", f"<!--->{tag} -->", f"<noscript>{tag}</noscript>")
        base = parse_template(template())
        for index, fragment in enumerate(fragments):
            raw = template(body=fragment)
            with self.subTest(variant=index, boundary="import"), self.assertRaises(ValueError):
                parse_template(raw)
            historical = base.model_copy(update={"html": raw["html"]})
            with self.subTest(variant=index, boundary="render"), self.assertRaises(ValueError):
                render_album(historical, [Book("Review", [Frame("")])])

    def test_open_api_import_and_patch_preserve_the_precise_workflow_format_code(self):
        headers = self.token("write")
        valid = self.ok(
            self.client.post(
                "/api/workflows",
                json={"name": "Review", "graph": {"1": {"class_type": "SaveImage", "inputs": {}}}},
            ),
            201,
        )
        invalid = {"nodes": [], "links": []}
        for prefix in ("/api", "/api/v2"):
            for method, path, body in (
                ("POST", f"{prefix}/workflows", {"name": "UI", "graph": invalid}),
                ("PATCH", f"{prefix}/workflows/{valid['id']}", {"graph": invalid}),
            ):
                with self.subTest(method=method, prefix=prefix):
                    response = self.client.request(method, path, json=body, headers=headers)
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertEqual(response.json()["code"], "ui_format")
                    self.assertIn("API", response.json()["detail"])
        self.assertEqual(
            self.ok(self.client.get(f"/api/workflows/{valid['id']}"))["graph"], valid["graph"]
        )

    def test_two_concurrent_independent_preset_patches_merge_the_current_locked_value(self):
        headers = self.token("read", "write")
        preset = self.ok(
            self.client.post(
                "/api/v2/workshop/presets", headers=headers, json={"title": "Original"}
            ),
            201,
        )
        route = f"/api/v2/workshop/presets/{preset['id']}"
        original_update = self.ctx.store.update_series
        title_at_update = threading.Event()
        title_committed = threading.Event()
        both_at_update = threading.Barrier(2)
        ordinal_lock = threading.Lock()
        calls = 0

        def controlled_update(*args, **kwargs):
            nonlocal calls
            with ordinal_lock:
                ordinal, calls = calls, calls + 1
            if ordinal == 0:
                title_at_update.set()
                both_at_update.wait(timeout=10)
                try:
                    return original_update(*args, **kwargs)
                finally:
                    title_committed.set()
            both_at_update.wait(timeout=10)
            if not title_committed.wait(timeout=10):
                raise TimeoutError("title patch did not commit")
            return original_update(*args, **kwargs)

        with (
            patch.object(self.ctx.store, "update_series", side_effect=controlled_update),
            ThreadPoolExecutor(max_workers=2) as executor,
        ):
            title = executor.submit(
                self.client.patch, route, headers=headers, json={"title": "Renamed"}
            )
            self.assertTrue(title_at_update.wait(timeout=10))
            entries = executor.submit(
                self.client.patch,
                route,
                headers=headers,
                json={"entries": [{"key": "subject", "value": "chair"}]},
            )
            title_response = self.ok(title.result(timeout=15))
            entries_response = self.ok(entries.result(timeout=15))
        self.assertEqual(title_response["title"], "Renamed")
        self.assertEqual(entries_response["title"], "Renamed")
        final = self.ok(self.client.get(route, headers=headers))
        self.assertEqual(final["title"], "Renamed")
        self.assertEqual(final["entries"][0]["value"], "chair")
