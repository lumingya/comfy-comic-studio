from .api_harness import ApiCase


class WorkflowFormatErrorTests(ApiCase):
    def test_ui_format_has_the_same_machine_readable_error_in_import_patch_and_inspection(self):
        graph = {"nodes": [], "links": []}
        imported = self.client.post("/api/workflows", json={"name": "UI graph", "graph": graph})
        self.assertEqual(imported.status_code, 400)
        self.assertEqual(imported.json()["code"], "ui_format")
        self.assertIn("API", imported.json()["detail"])
        doc = self.ok(
            self.client.post(
                "/api/workflows",
                json={
                    "name": "API graph",
                    "graph": {"1": {"class_type": "SaveImage", "inputs": {}}},
                },
            ),
            201,
        )
        patched = self.client.patch(f"/api/workflows/{doc['id']}", json={"graph": graph})
        self.assertEqual(patched.status_code, 400)
        self.assertEqual(patched.json()["code"], "ui_format")
        inspected = self.ok(self.client.post("/api/workflows/inspect", json={"workflow": graph}))
        self.assertFalse(inspected["importable"])
        self.assertEqual(inspected["issues"][0]["code"], "ui_format")
        issued = self.ok(
            self.client.post("/api/tokens", json={"name": "Format fixture", "scopes": ["write"]}),
            201,
        )
        headers = {"Authorization": f"Bearer {issued['token']}"}
        for method, path, body in (
            ("POST", "/api/v2/workflows", {"name": "UI graph", "graph": graph}),
            ("PATCH", f"/api/v2/workflows/{doc['id']}", {"graph": graph}),
        ):
            response = self.client.request(method, path, json=body, headers=headers)
            self.assertEqual(response.status_code, 400, response.text)
            self.assertEqual(response.json()["code"], "ui_format")
