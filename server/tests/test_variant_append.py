"""Atomic native variant append never replaces a version saved by another caller."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from mio_server.models import Series, VariantSet

from .api_harness import ApiCase

PRIVATE = "variant-private-input-must-not-appear"


class VariantAppendTests(ApiCase):
    def setUp(self):
        super().setUp()
        self.existing = VariantSet(id="var_original", name="Original")
        self.series = self.ctx.store.create_series(
            Series(title="A quiet study", subtitle="Keep this", variants=[self.existing])
        )
        self.path = f"/api/series/{self.series.id}/variants"

    def append(self, variants, *, token=None):
        return self.client.post(
            self.path.replace("/api/", "/api/v2/") if token else self.path,
            json={"variants": variants},
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )

    def token(self, *scopes):
        return self.ok(
            self.client.post("/api/tokens", json={"name": "native-variants", "scopes": scopes}), 201
        )["token"]

    def concurrent(self, *variants):
        start = Barrier(len(variants))

        def call(variant):
            start.wait(timeout=10)
            return self.append([variant])

        with ThreadPoolExecutor(max_workers=len(variants)) as pool:
            return list(pool.map(call, variants))

    def test_two_concurrent_appends_preserve_both_additions_and_existing_fields(self):
        results = self.concurrent(
            {"id": "var_left", "name": "Ink"},
            {"id": "var_right", "name": "Paper"},
        )
        self.assertEqual([response.status_code for response in results], [200, 200])
        saved = self.ctx.store.get_series(self.series.id)
        self.assertEqual(
            {variant.id for variant in saved.variants}, {"var_original", "var_left", "var_right"}
        )
        self.assertEqual(saved.variants[0], self.existing)
        self.assertEqual(
            (saved.title, saved.subtitle, saved.bible),
            (self.series.title, self.series.subtitle, self.series.bible),
        )
        self.assertEqual(self.ctx.engine.list(), [])

    def test_identical_ids_are_idempotent_in_one_batch_and_concurrently(self):
        variant = {"id": "var_once", "name": "Once", "characters": {}}
        self.ok(self.append([variant, variant]))
        self.ok(self.append([{"profile_id": None, "style_id": None, **variant}]))
        self.assertEqual(
            [response.status_code for response in self.concurrent(variant, variant)], [200, 200]
        )
        saved = self.ctx.store.get_series(self.series.id)
        self.assertEqual([value.id for value in saved.variants], ["var_original", "var_once"])

    def test_same_id_different_content_conflicts_without_replacing_the_winner(self):
        responses = self.concurrent(
            {"id": "var_race", "name": "First"},
            {"id": "var_race", "name": "Second"},
        )
        self.assertEqual(sorted(response.status_code for response in responses), [200, 409])
        winner = next(response.json() for response in responses if response.status_code == 200)
        saved = self.ctx.store.get_series(self.series.id)
        self.assertEqual(
            [value.model_dump(mode="json") for value in saved.variants], winner["variants"]
        )
        self.assertEqual(len(saved.variants), 2)

    def test_conflicting_batch_is_all_or_nothing_and_never_echoes_variant_values(self):
        for variants in (
            [{"id": "var_fresh", "name": "Fresh"}, {"id": self.existing.id, "name": PRIVATE}],
            [{"id": "var_duplicate", "name": "First"}, {"id": "var_duplicate", "name": PRIVATE}],
        ):
            result = self.append(variants)
            self.assertEqual(result.status_code, 409)
            self.assertNotIn(PRIVATE, result.text)
            self.assertEqual(self.ctx.store.get_series(self.series.id).variants, [self.existing])

    def test_native_v2_scope_and_typed_payload_boundaries(self):
        variant = {"id": "var_safe", "name": "Safe"}
        v2 = self.path.replace("/api/", "/api/v2/")
        self.assertEqual(self.client.post(v2, json={"variants": [variant]}).status_code, 401)
        for scopes in (("read",), ("render",)):
            self.assertEqual(self.append([variant], token=self.token(*scopes)).status_code, 403)
        self.ok(self.append([variant], token=self.token("write")))
        for body in (
            {"variants": []},
            {"variants": [{"id": f"var_{i}", "name": "Many"} for i in range(25)]},
            {"variants": [variant], "api_key": PRIVATE},
            {"variants": [{"id": "bad", "name": {"api_key": PRIVATE}}]},
            {"variants": [{"id": "bad", "name": "Bad", "api_key": PRIVATE}]},
        ):
            result = self.client.post(
                v2, json=body, headers={"Authorization": f"Bearer {self.token('write')}"}
            )
            self.assertEqual(result.status_code, 422)
            self.assertNotIn(PRIVATE, result.text)
        invalid_json_number = self.client.post(
            self.path,
            content=b'{"variants":[{"id":"bad","name":"Bad","characters":{"c":{"x":NaN}}}]}',
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(invalid_json_number.status_code, 422)
        self.assertEqual(
            [value.id for value in self.ctx.store.get_series(self.series.id).variants],
            ["var_original", "var_safe"],
        )
        self.assertEqual(
            self.client.post(
                "/api/series/missing/variants", json={"variants": [variant]}
            ).status_code,
            404,
        )
