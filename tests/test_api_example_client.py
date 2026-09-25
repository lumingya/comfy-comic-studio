"""examples/mio_client.py against a real server on a temporary workspace (no network, nothing billed)."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import server
from tests.api_support import PNG, TOKEN, ApiServerCase

_SPEC = importlib.util.spec_from_file_location("mio_client", Path(__file__).resolve().parents[1] / "examples" / "mio_client.py")
mio_client = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(mio_client)


class ExampleClientTests(ApiServerCase):
    def setUp(self):
        self.mio = mio_client.MioClient("http://127.0.0.1:%d" % self.httpd.server_port, TOKEN)
        out = tempfile.TemporaryDirectory(prefix="mio-client-")
        self.addCleanup(out.cleanup)
        self.out = Path(out.name)

    def test_refuses_insecure_configuration(self):
        with self.assertRaises(ValueError):
            mio_client.MioClient("http://example.com", TOKEN)
        with self.assertRaises(ValueError):
            self.mio.get("../api/private")

    def test_documented_workflow(self):
        mio = self.mio
        self.assertEqual(mio.capabilities()["apiVersion"], "2.0.0")
        self.assertGreater(len(mio.routes()), 200)
        with self.assertRaises(mio_client.MioError) as empty:
            mio.create("storyboards", {"title": "x"})
        self.assertEqual((empty.exception.status, empty.exception.code), (400, "collection_required"))
        mio.create("collections", {"title": "默认画册集"})

        story = mio.create("storyboards", {"title": "海边的信", "frames": [{"prompt": "seaside"}]})
        patched = mio.patch("storyboards", story["id"], {"outline": "夏天的告别"}, etag=story["etag"])
        self.assertEqual(patched["document"]["outline"], "夏天的告别")
        with self.assertRaises(mio_client.MioError) as stale:
            mio.patch("storyboards", story["id"], {"outline": "x"}, etag=story["etag"])
        self.assertEqual(stale.exception.code, "revision_conflict")
        self.assertEqual(len(mio.add_frames(story["id"], [{"prompt": "a"}, {"prompt": "b"}], index=0)["frames"]), 2)

        preset = mio.create("characters", {"title": "Mio"})
        self.assertTrue(mio.set_variable("characters", preset["id"], "发色", "银色")["created"])
        bundle = mio.export_bundle("storyboards", story["id"], self.out / "story.mio.zip")
        self.assertEqual(mio.import_bundle(bundle)["kind"], "storyboards")
        with self.assertRaises(FileExistsError):
            mio.export_bundle("storyboards", story["id"], bundle)

        channel = mio.create_channel("openai", "网关", "https://api.example.com/v1", "gpt-image-1", api_key="sk-secret")
        self.assertNotIn("sk-secret", str(mio.channels()))
        uploaded = mio.upload_image(self._file("in.png", PNG))
        self.assertEqual(mio.save_asset(uploaded["url"], self.out / "copy.png").read_bytes(), PNG)
        with patch.object(server, "generate_provider_image", return_value={"image": uploaded["url"], "offlineFallback": False}):
            result = mio.generate(channel["id"], "a quiet bookshop")
        self.assertEqual(mio.save_asset(result["assetEndpoint"], self.out / "generated.png").read_bytes(), PNG)

        task = mio.assemble(story["id"], channel_id=channel["id"], presets=[{"kind": "characters", "id": preset["id"]}])
        self.assertEqual(task["title"], "海边的信")
        self.assertEqual(mio.wait_task(task["id"], interval=0.01, timeout=1)["status"], "standby")
        with self.assertRaises(mio_client.MioError) as untrusted:
            mio.start_task(task["id"])
        self.assertEqual(untrusted.exception.status, 403)
        with self.assertRaises(mio_client.MioError) as llm:
            mio.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(llm.exception.code, "llm_not_configured")

    def _file(self, name, raw):
        path = self.out / name
        path.write_bytes(raw)
        return path


if __name__ == "__main__":
    unittest.main()
