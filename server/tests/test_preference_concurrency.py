"""Preference revisions bind HTTP writes, sibling subtrees and restart persistence."""

import asyncio
import hashlib
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from mio_server.api import create_app
from mio_server.auth import issue
from mio_server.context import AppContext
from mio_server.private_store import PreferencePatch, PrivateStore, read_bounded_bytes

from .api_harness import ApiCase
from .test_extensions import write_ext

THEME = "/api/themes/paper/preferences"
EXTENSION = "/api/ext/demo/preferences"
EMPTY_REVISION = hashlib.sha256(b"{}").hexdigest()


def command(etag, path, value):
    return {"expected_revision": etag.strip('"'), "path": path, "value": value}


class PreferenceConcurrencyTests(ApiCase):
    def setUp(self):
        super().setUp()
        write_ext(self.ctx.extensions.root, "demo", "raise AssertionError('must not activate')")

    def etag(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        self.assertRegex(response.headers["ETag"], r'^"[a-f0-9]{64}"$')
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual(
            response.headers["ETag"].strip('"'), PrivateStore.revision(response.json())
        )
        return response.headers["ETag"]

    def test_get_put_keep_objects_and_return_stable_content_revisions(self):
        for resource in (THEME, EXTENSION):
            with self.subTest(resource=resource):
                empty = self.client.get(resource)
                self.assertEqual(empty.json(), {})
                self.assertEqual(self.etag(empty), f'"{EMPTY_REVISION}"')
                first = self.client.put(resource, json={"a": 1, "nested": {"z": False}})
                first_etag = self.etag(first)
                reordered = self.client.put(resource, json={"nested": {"z": False}, "a": 1})
                self.assertEqual(self.etag(reordered), first_etag)
                changed = self.client.put(resource, json={"a": 2})
                self.assertNotEqual(self.etag(changed), first_etag)
                self.assertEqual(self.etag(self.client.get(resource)), self.etag(changed))

    def test_put_if_match_is_conditional_and_unconditional_put_remains_explicit(self):
        for resource in (THEME, EXTENSION):
            with self.subTest(resource=resource):
                first = self.client.put(resource, json={"value": 1})
                previous = self.etag(first)
                second = self.client.put(
                    resource, json={"value": 2}, headers={"If-Match": previous}
                )
                current = self.etag(second)
                stale = self.client.put(
                    resource, json={"value": "stale"}, headers={"If-Match": previous}
                )
                self.assertEqual(stale.status_code, 409, stale.text)
                self.assertEqual(self.etag(self.client.get(resource)), current)
                explicit = self.client.put(resource, json={"explicit": "replacement"})
                self.assertEqual(explicit.json(), {"explicit": "replacement"})
                self.etag(explicit)
                for unsupported in (
                    "*",
                    f"W/{current}",
                    current.strip('"'),
                    f"{current}, {current}",
                ):
                    response = self.client.put(resource, json={}, headers={"If-Match": unsupported})
                    self.assertEqual(response.status_code, 400, response.text)

    def test_surface_subtree_patch_preserves_extension_fields_and_sibling_surfaces(self):
        for resource in (THEME, EXTENSION):
            with self.subTest(resource=resource):
                original = {
                    "extension": {"mode": "manual"},
                    "floating_surfaces": {"first": {"x": 1}, "second": {"x": 2}},
                }
                initial = self.etag(self.client.put(resource, json=original))
                first = self.client.patch(
                    resource,
                    json=command(initial, ["floating_surfaces", "first"], {"x": 9}),
                )
                current = self.etag(first)
                self.assertEqual(first.json()["extension"], original["extension"])
                self.assertEqual(first.json()["floating_surfaces"]["second"], {"x": 2})
                stale = self.client.patch(
                    resource,
                    json=command(initial, ["floating_surfaces", "second"], {"x": 8}),
                )
                self.assertEqual(stale.status_code, 409, stale.text)
                latest = self.client.patch(
                    resource,
                    json=command(current, ["floating_surfaces", "second"], {"x": 8}),
                )
                self.etag(latest)
                self.assertEqual(
                    latest.json(),
                    {
                        "extension": {"mode": "manual"},
                        "floating_surfaces": {"first": {"x": 9}, "second": {"x": 8}},
                    },
                )

    def test_exactly_one_concurrent_write_can_commit_the_same_revision(self):
        for resource in (THEME, EXTENSION):
            with self.subTest(resource=resource):
                revision = self.etag(self.client.put(resource, json={"retained": True}))
                started = threading.Barrier(2)

                def save(value):
                    started.wait(timeout=5)
                    return self.client.patch(resource, json=command(revision, ["winner"], value))

                with ThreadPoolExecutor(max_workers=2) as pool:
                    futures = [pool.submit(save, value) for value in (1, 2)]
                    responses = [future.result(timeout=10) for future in futures]
                self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
                winner = next(response for response in responses if response.status_code == 200)
                current = self.client.get(resource)
                self.assertEqual(current.json(), winner.json())
                self.assertEqual(current.json()["retained"], True)
                self.assertEqual(self.etag(current), self.etag(winner))

    def test_revision_is_checked_after_waiting_for_the_shared_operation_barrier(self):
        resource = EXTENSION
        revision = self.etag(self.client.put(resource, json={"value": "before"}))
        started = threading.Event()

        def save():
            started.set()
            return self.client.patch(resource, json=command(revision, ["value"], "stale"))

        with ThreadPoolExecutor(max_workers=1) as pool:
            with self.ctx.engine.hold_operation():
                pending = pool.submit(save)
                self.assertTrue(started.wait(3))
                PrivateStore(self.ctx.data_dir, "extension", "demo").write_json({"value": "newer"})
            response = pending.result(timeout=10)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.client.get(resource).json(), {"value": "newer"})

    def test_patch_creates_missing_objects_but_never_replaces_non_object_parents(self):
        for resource in (THEME, EXTENSION):
            with self.subTest(resource=resource):
                initial = self.etag(self.client.put(resource, json={"scalar": 3, "array": [1]}))
                for parent in ("scalar", "array"):
                    response = self.client.patch(
                        resource, json=command(initial, [parent, "nested"], {"x": 1})
                    )
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertEqual(self.etag(self.client.get(resource)), initial)
                created = self.client.patch(
                    resource, json=command(initial, ["new", "nested"], None)
                )
                updated = self.etag(created)
                self.assertEqual(created.json()["new"], {"nested": None})
                replaced = self.client.patch(resource, json=command(updated, [], {"only": [1, 2]}))
                self.etag(replaced)
                self.assertEqual(replaced.json(), {"only": [1, 2]})

    def test_invalid_patch_models_and_strict_json_cannot_change_state(self):
        for resource in (THEME, EXTENSION):
            with self.subTest(resource=resource):
                initial = self.etag(self.client.put(resource, json={"retained": True}))
                valid = command(initial, ["setting"], 1)
                invalid = [
                    {**valid, "expected_revision": "old"},
                    {**valid, "expected_revision": 123},
                    {**valid, "path": ["many"] * 17},
                    {**valid, "path": [1]},
                    {**valid, "path": [""]},
                    {**valid, "path": ["__proto__"]},
                    {**valid, "path": ["nested", "constructor"]},
                    {**valid, "path": ["prototype"]},
                    {**valid, "path": [], "value": []},
                    {**valid, "extra": "unsupported"},
                    {key: value for key, value in valid.items() if key != "value"},
                ]
                for body in invalid:
                    response = self.client.patch(resource, json=body)
                    self.assertEqual(response.status_code, 400, response.text)
                raw = json.dumps(valid).encode()
                prefix = raw[: raw.rfind(b'"value"')]
                for malformed in (
                    b"[]",
                    raw[:-1] + b', "path": []}',
                    prefix + b'"value": {"a":1,"a":2}}',
                    prefix + b'"value": NaN}',
                    prefix + b'"value": Infinity}',
                    prefix + b'"value": 1e309}',
                    prefix + b'"value": "\\ud800"}',
                    prefix + b'"value": "\xff"}',
                ):
                    response = self.client.patch(
                        resource, content=malformed, headers={"Content-Type": "application/json"}
                    )
                    self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(self.etag(self.client.get(resource)), initial)

    def test_both_request_bytes_and_resulting_document_are_bounded(self):
        for resource, module in (
            (THEME, "mio_server.api.theme_preferences.MAX_PREFERENCES_BYTES"),
            (EXTENSION, "mio_server.api.extension_private.MAX_PREFERENCES_JSON"),
        ):
            with self.subTest(resource=resource), patch(module, 512):
                initial = self.etag(self.client.put(resource, json={"keep": "x" * 350}))
                result_too_large = command(initial, ["another"], "y" * 200)
                self.assertLess(len(json.dumps(result_too_large)), 512)
                response = self.client.patch(resource, json=result_too_large)
                self.assertEqual(response.status_code, 400, response.text)
                for method in (self.client.put, self.client.patch):
                    response = method(
                        resource,
                        content=b" " * 513,
                        headers={"Content-Type": "application/json", "Content-Length": "1"},
                    )
                    self.assertEqual(response.status_code, 400, response.text)
                    wrong_type = method(
                        resource, content=b"{}", headers={"Content-Type": "text/plain"}
                    )
                    self.assertEqual(wrong_type.status_code, 400, wrong_type.text)
                self.assertEqual(self.etag(self.client.get(resource)), initial)

    def test_patch_uses_retained_legacy_preferences_without_mutating_the_legacy_copy(self):
        legacy = self.ctx.data_dir / "extension_data/demo/preferences.json"
        legacy.parent.mkdir(parents=True)
        raw = b'{"legacy":true,"retained":3}'
        legacy.write_bytes(raw)
        initial = self.etag(self.client.get(EXTENSION))
        self.ctx.extensions.remove("demo")
        response = self.client.patch(EXTENSION, json=command(initial, ["legacy"], False))
        self.etag(response)
        self.assertEqual(response.json(), {"legacy": False, "retained": 3})
        self.assertEqual(legacy.read_bytes(), raw)
        self.assertEqual(self.ctx.extensions.loaded, {})

    def test_v2_preserves_theme_write_and_extension_admin_permissions(self):
        for scope in ("read", "write", "render", "admin"):
            token, plain = issue(scope, [scope])
            self.ctx.store.put_doc(token)
            headers = {"Authorization": f"Bearer {plain}"}
            for local, allowed in ((THEME, "write"), (EXTENSION, "admin")):
                with self.subTest(scope=scope, resource=local):
                    initial = self.etag(self.client.get(local))
                    response = self.client.patch(
                        local.replace("/api/", "/api/v2/", 1),
                        headers=headers,
                        json=command(initial, ["value"], scope),
                    )
                    self.assertEqual(
                        response.status_code, 200 if scope == allowed else 403, response.text
                    )
                    if scope == allowed:
                        self.etag(response)
        self.assertEqual(
            self.client.patch(
                "/api/v2/themes/paper/preferences", json=command(f'"{EMPTY_REVISION}"', [], {})
            ).status_code,
            401,
        )

    def test_openapi_patch_body_is_generated_from_the_runtime_model(self):
        schema = self.client.get("/api/v2/openapi.json").json()
        for resource in ("/themes/{theme_id}/preferences", "/ext/{ext_id}/preferences"):
            with self.subTest(resource=resource):
                operations = schema["paths"][resource]
                body = operations["patch"]["requestBody"]["content"]["application/json"]["schema"]
                self.assertEqual(body, PreferencePatch.model_json_schema())
                self.assertIn("ETag", operations["patch"]["responses"]["200"]["headers"])
                self.assertIn("409", operations["patch"]["responses"])
                self.assertIn(
                    "if-match", {parameter["name"] for parameter in operations["put"]["parameters"]}
                )


class PreferenceRestartTests(unittest.TestCase):
    def test_patch_revision_and_values_survive_a_real_context_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary).resolve()
            ctx = AppContext.create(workspace, autostart=False, seed_instance=False)
            try:
                write_ext(ctx.extensions.root, "demo", "raise AssertionError('must not activate')")
                saved = {}
                client = TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1")
                try:
                    for resource in (THEME, EXTENSION):
                        initial = client.get(resource).headers["ETag"]
                        patched = client.patch(
                            resource, json=command(initial, ["nested", "value"], 7)
                        )
                        self.assertEqual(patched.status_code, 200, patched.text)
                        saved[resource] = patched.headers["ETag"]
                finally:
                    client.close()
            finally:
                ctx.close()
            restarted = AppContext.create(workspace, autostart=False, seed_instance=False)
            try:
                client = TestClient(
                    create_app(restarted, serve_web=False), base_url="http://127.0.0.1"
                )
                try:
                    for resource, revision in saved.items():
                        loaded = client.get(resource)
                        self.assertEqual(loaded.json(), {"nested": {"value": 7}})
                        self.assertEqual(loaded.headers["ETag"], revision)
                finally:
                    client.close()
            finally:
                restarted.close()

    def test_stream_reader_stops_before_consuming_chunks_after_the_limit(self):
        consumed = []

        async def chunks():
            for value in (b"1234", b"56789", b"must-not-read"):
                consumed.append(value)
                yield value

        with self.assertRaises(ValueError):
            asyncio.run(read_bounded_bytes(chunks(), limit=8))
        self.assertEqual(consumed, [b"1234", b"56789"])
