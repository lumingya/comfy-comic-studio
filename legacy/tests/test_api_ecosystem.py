"""Public API: ecosystem bridge and extension backends (scene-notebook example, local only)."""
import base64
import io
import unittest
import zipfile
from pathlib import Path

from tests.api_support import ApiServerCase

ROOT = Path(__file__).resolve().parents[1]


def zipped(folder):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for path in folder.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(folder).as_posix())
    return buffer.getvalue()


class EcosystemApiTests(ApiServerCase):
    def test_status_platform_and_events(self):
        status = self.ok(self.get("/api/v1/ecosystem/status"))
        self.assertIn("extensions", status)
        self.assertIn("providers", self.ok(self.get("/api/v1/ecosystem/platform")))
        self.ok(self.post("/api/v1/ecosystem/events/emit", {"name": "bot.hello", "payload": {"n": 1}}))
        activity = self.ok(self.get("/api/v1/ecosystem/activity?since=0"))
        self.assertIn("bot.hello", [e["name"] for e in activity["events"]])
        self.assertEqual(self.post("/api/v1/ecosystem/events/emit", {"name": "app.ready"}).status, 400)
        self.assertEqual(self.get("/api/v1/ecosystem/nope").status, 404)
        self.assertEqual(self.post("/api/v1/ecosystem/themes/reload", {}).error["code"], "missing_field")

    def test_user_scripts_round_trip(self):
        saved = self.ok(self.post("/api/v1/ecosystem/scripts/save", {"name": "问候", "source": "console.log('hi')"}))
        script_id = saved["id"] if isinstance(saved, dict) and "id" in saved else saved[0]["id"]
        self.assertIn(script_id, [s["id"] for s in self.ok(self.get("/api/v1/ecosystem/scripts"))])
        self.assertIn("console.log", self.ok(self.get("/api/v1/ecosystem/scripts/" + script_id))["source"])
        self.ok(self.post("/api/v1/ecosystem/scripts/delete", {"id": script_id}))
        self.assertNotIn(script_id, [s["id"] for s in self.ok(self.get("/api/v1/ecosystem/scripts"))])

    def test_install_and_call_an_extension_backend(self):
        raw = base64.b64encode(zipped(ROOT / "examples/extensions/scene-notebook")).decode()
        self.assertEqual(self.post("/api/v1/extensions/scene-notebook/notes", {"title": "x"}).status, 403)
        self.ok(self.post("/api/v1/ecosystem/extensions/install", {"zip": raw, "trusted": True}))
        self.assertIn("scene-notebook", [e["id"] for e in self.ok(self.get("/api/v1/extensions"))])
        self.ok(self.post("/api/v1/extensions/scene-notebook/notes", {"title": "场记", "text": "第一条"}))
        notes = self.ok(self.get("/api/v1/extensions/scene-notebook/notes"))
        self.assertEqual(notes[-1]["title"], "场记")
        self.ok(self.post("/api/v1/extensions/scene-notebook/storage", {"key": "k", "value": {"a": 1}}))
        self.assertEqual(self.ok(self.get("/api/v1/extensions/scene-notebook/storage?key=k")), {"a": 1})
        self.ok(self.put("/api/v1/ecosystem/extensions/scene-notebook/files/memo.txt", {"text": "备忘"}))
        listed = self.ok(self.get("/api/v1/ecosystem/extensions/scene-notebook/files"))
        self.assertIn("memo.txt", str(listed))
        content = self.get("/api/v1/ecosystem/extensions/scene-notebook/files/memo.txt")
        self.assertEqual((content.status, content.raw.decode()), (200, "备忘"))
        self.ok(self.delete("/api/v1/ecosystem/extensions/scene-notebook/files/memo.txt"))
        self.ok(self.post("/api/v1/ecosystem/extensions/enable", {"id": "scene-notebook", "enabled": False}))
        self.assertEqual(self.get("/api/v1/extensions/scene-notebook/notes").status, 403)
        self.ok(self.post("/api/v1/ecosystem/extensions/uninstall", {"id": "scene-notebook", "purge": "all"}))


if __name__ == "__main__":
    unittest.main()
