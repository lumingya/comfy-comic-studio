"""Native image uploads retain reviewed declarations, raw assets routing and real scopes."""

import hashlib
import io
import json
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from pydantic import ValidationError

from mio_server.extensions.manifest import PanelRequestSpec
from mio_server.extensions.protocol import MAX_IMAGE_PIXELS
from mio_server.models import Episode, Series
from mio_server.storage import NotFound

from .api_harness import ApiCase
from .test_extensions import write_ext


def png(width=2, height=3):
    output = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(output, format="PNG", compress_level=0)
    return output.getvalue()


class PanelUploadTests(ApiCase):
    def setUp(self):
        super().setUp()
        builtins = patch("mio_server.extensions.manager.BUILTIN_ROOT", Path(self.tmp) / "empty")
        builtins.start()
        self.addCleanup(builtins.stop)
        self.folder = write_ext(
            self.ctx.extensions.root,
            main="def activate(mio):\n    pass\n",
            panels=[
                {
                    "id": "paint",
                    "title": "Paint",
                    "slot": "episode",
                    "entry": "panel.html",
                    "requests": [
                        {
                            "id": "mask",
                            "method": "POST",
                            "path": "/assets",
                            "scope": "write",
                            "input": "image",
                        },
                        {"id": "series", "method": "GET", "path": "/series", "scope": "read"},
                    ],
                }
            ],
        )
        (self.folder / "panel.html").write_text("<p>Paint</p>", encoding="utf-8")
        self.ctx.extensions.enable("demo", self.ctx.extensions.info("demo").digest)
        self.panel = self.ok(self.client.get("/api/extension-panels"))[0]
        series = self.ctx.store.create_series(Series(title="Neutral work"))
        self.episode = self.ctx.store.create_episode(
            Episode(series_id=series.id, title="Neutral chapter", order=0)
        )

    def metadata(self, data, **changes):
        return {
            "activation": self.panel["activation"],
            "digest": self.panel["digest"],
            "request_id": "mask",
            "context": {"episode_id": self.episode.id, "series_id": self.episode.series_id},
            "filename": "mask.png",
            "mime": "image/png",
            "bytes": len(data),
            **changes,
        }

    def upload(self, data=None, *, v2=False, token=None, raw=None, **changes):
        data = png() if data is None else data
        metadata = json.dumps(self.metadata(data, **changes)).encode() if raw is None else raw
        return self.client.post(
            f"{'/api/v2' if v2 else '/api'}/extension-panels/demo/paint/uploads",
            files=[
                ("metadata", ("metadata.json", metadata, "application/json")),
                ("image", ("mask.png", data, "image/png")),
            ],
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )

    def token(self, *scopes):
        return self.ok(
            self.client.post("/api/tokens", json={"name": "upload", "scopes": scopes}), 201
        )["token"]

    def test_image_larger_than_json_limit_reaches_original_raw_asset_operation(self):
        data = png(256, 256)
        self.assertGreater(len(data), 64 * 1024)
        result = self.ok(self.upload(data))
        self.assertEqual(result["status"], 201)
        asset = result["data"]
        self.assertEqual(
            (asset["width"], asset["height"], asset["filename"]), (256, 256, "mask.png")
        )
        self.assertEqual(self.ctx.assets.read(asset["id"]), data)

    def test_real_write_scope_is_required_by_upload_and_original_target(self):
        self.assertEqual(self.upload(v2=True).status_code, 401)
        self.assertEqual(self.upload(v2=True, token=self.token("read")).status_code, 403)
        result = self.ok(self.upload(v2=True, token=self.token("write")))
        self.assertEqual(result["status"], 201)

    def test_metadata_limits_declaration_identity_and_context_are_not_frame_controlled(self):
        for changes, status in (
            ({"activation": "old"}, 404),
            ({"digest": "0" * 64}, 404),
            ({"request_id": "series"}, 403),
            ({"request_id": "missing"}, 403),
            ({"context": {"episode_id": "missing"}}, 404),
            ({"context": {"episode_id": self.episode.id, "series_id": "missing"}}, 404),
            ({"filename": "../mask.png"}, 422),
            ({"headers": {"Authorization": "injected"}}, 422),
        ):
            with self.subTest(changes=changes):
                self.assertEqual(self.upload(**changes).status_code, status)
        self.assertEqual(self.upload(raw=b" " * (64 * 1024 + 1)).status_code, 413)
        ordinary = self.client.post(
            "/api/extension-panels/demo/paint/requests",
            json={
                "activation": self.panel["activation"],
                "digest": self.panel["digest"],
                "request_id": "mask",
                "body": "not binary",
            },
        )
        self.assertEqual(ordinary.status_code, 403)

    def test_invalid_spoofed_truncated_animated_and_oversized_images_are_rejected(self):
        self.assertEqual(self.upload(b"<svg></svg>").status_code, 415)
        self.assertEqual(self.upload(mime="image/jpeg").status_code, 415)
        self.assertEqual(self.upload(bytes=1).status_code, 422)
        self.assertEqual(self.upload(png()[:30]).status_code, 415)
        self.assertEqual(MAX_IMAGE_PIXELS, 16 * 1024 * 1024)
        with patch("mio_server.extensions.panel_media.MAX_IMAGE_PIXELS", 5):
            self.assertEqual(self.upload().status_code, 415)
        with patch("mio_server.extensions.panel_upload.MAX_IMAGE_BYTES", 10):
            self.assertEqual(self.upload().status_code, 413)
        output = io.BytesIO()
        frames = [Image.new("RGB", (2, 3), color) for color in ("white", "black")]
        frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:])
        self.assertEqual(self.upload(output.getvalue(), mime="image/gif").status_code, 415)

    def test_changed_code_during_decode_and_disabled_activation_never_write_an_asset(self):
        data = png()
        with patch(
            "mio_server.extensions.panel_upload.verify_image",
            side_effect=lambda *_: (self.folder / "changed.txt").write_text(
                "changed", encoding="utf-8"
            ),
        ):
            self.assertEqual(self.upload(data).status_code, 404)
        with self.assertRaises(NotFound):
            self.ctx.store.get_asset(hashlib.sha256(data).hexdigest())
        self.ctx.extensions.disable("demo")
        self.assertEqual(self.upload(data).status_code, 404)

    def test_upload_manifest_cannot_select_other_routes_scopes_or_output_kinds(self):
        valid = {
            "id": "mask",
            "method": "POST",
            "path": "/assets",
            "scope": "write",
            "input": "image",
        }
        PanelRequestSpec.model_validate(valid)
        for changes in (
            {"method": "GET"},
            {"path": "/series"},
            {"scope": "read"},
            {"response": "download"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                PanelRequestSpec.model_validate({**valid, **changes})
