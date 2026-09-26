import base64
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from backend import server


class FakeResponse(io.BytesIO):
    def __init__(self, payload, content_length=None):
        super().__init__(payload)
        self.headers = {}
        if content_length is not None:
            self.headers["Content-Length"] = str(content_length)


class ImageSafetyTests(unittest.TestCase):
    def test_image_data_url_is_normalized(self):
        raw = b"\x89PNG\r\n\x1a\n"
        encoded = base64.b64encode(raw).decode("ascii")

        result = server.data_url_to_base64_data_url(f"data:image/png;base64,{encoded}")

        self.assertEqual(result, f"data:image/png;base64,{encoded}")

    def test_non_image_and_invalid_base64_data_urls_are_rejected(self):
        with self.assertRaises(ValueError):
            server.data_url_to_base64_data_url("data:text/plain;base64,SGVsbG8=")
        with self.assertRaises(ValueError):
            server.data_url_to_base64_data_url("data:image/png;base64,not-valid-@@")

    def test_actual_image_bytes_override_incorrect_extension_mime(self):
        jpeg_bytes = b"\xff\xd8\xff\xe0fake-jpeg"
        self.assertEqual(server.detect_image_mime_type(jpeg_bytes, "image/png"), "image/jpeg")

    def test_local_files_require_native_owned_urls_not_arbitrary_paths(self):
        with tempfile.TemporaryDirectory() as root, patch.object(server,'DATA_DIR',root):
            try:
                url=server.store_image_data('data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\n').decode())
                self.assertTrue(os.path.isfile(server.local_path_from_url(url)))
                with self.assertRaises(ValueError):server.local_path_from_url(root+'/settings/secrets.json')
            finally:
                server.reset_native_stores()

    def test_declared_oversized_image_is_rejected_before_reading(self):
        response = FakeResponse(b"small", content_length=server.MAX_IMAGE_BYTES + 1)
        with self.assertRaises(server.PayloadTooLargeError):
            server.read_limited_response(response)


class NativeServerPersistenceTests(unittest.TestCase):
    def test_write_read_uses_independent_entities(self):
        with tempfile.TemporaryDirectory() as root, patch.object(server,'DATA_DIR',root):
            try:
                cfg=server.read_merged_config();cfg['templates']=[{'id':'one','title':'中文分镜','frames':[]}]
                server.write_split_config(cfg);loaded=server.read_merged_config();self.assertEqual(loaded['templates'],cfg['templates'])
                self.assertEqual(len(list(__import__('pathlib').Path(root,'storyboards').glob('*.json'))),1)
                self.assertFalse(os.path.exists(os.path.join(root,'storyboards/templates.json')))
            finally:
                server.reset_native_stores()
    def test_unchanged_files_are_not_rewritten(self):
        with tempfile.TemporaryDirectory() as root, patch.object(server,'DATA_DIR',root):
            try:
                server.write_split_config(server.read_merged_config());cfg=server.read_merged_config()
                files=list(__import__('pathlib').Path(root).rglob('*.json'));before={p:p.stat().st_mtime_ns for p in files}
                server.write_split_config(cfg);self.assertEqual(before,{p:p.stat().st_mtime_ns for p in files})
            finally:
                server.reset_native_stores()
    def test_bad_existing_data_is_never_seeded_or_merged(self):
        with tempfile.TemporaryDirectory() as root, patch.object(server,'DATA_DIR',root):
            file=__import__('pathlib').Path(root,'content.json');file.write_text('{broken')
            with self.assertRaises(ValueError):server.read_merged_config()
            self.assertEqual(file.read_text(),'{broken')


class ServerBoundaryTests(unittest.TestCase):
    def test_only_public_app_assets_and_owned_images_are_served(self):
        with tempfile.TemporaryDirectory() as root, patch.object(server,'DATA_DIR',root):
            try:
                url=server.store_image_data('data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\n').decode())
                for value in ['/', '/index.html',url]:self.assertTrue(server.is_public_static_path(value))
                for value in ['/images/','/data/settings/secrets.json','/.git/config','/server.py','/images/../server.py']:
                    self.assertFalse(server.is_public_static_path(value))
            finally:
                server.reset_native_stores()

    def test_front_end_asset_dirs_are_served_but_stay_sandboxed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            for sub in ("vendor", "js"):
                os.makedirs(os.path.join(temp_dir, sub))
            for rel in ("vendor/lucide.min.js", "vendor/tailwind-browser.js", "js/ui-gallery.js"):
                with open(os.path.join(temp_dir, rel), "w", encoding="utf-8") as asset:
                    asset.write("// asset")
            with open(os.path.join(temp_dir, "vendor", "notes.txt"), "w", encoding="utf-8") as secret:
                secret.write("secret")
            with open(os.path.join(temp_dir, "secret.js"), "w", encoding="utf-8") as outside:
                outside.write("// outside")

            images_dir = os.path.join(temp_dir, "images")
            os.makedirs(images_dir)

            with patch.object(server, "BASE_DIR", temp_dir), patch.object(
                server, "IMAGES_DIR", images_dir
            ):
                self.assertTrue(server.is_public_static_path("/vendor/lucide.min.js"))
                self.assertTrue(server.is_public_static_path("/vendor/tailwind-browser.js"))
                self.assertTrue(server.is_public_static_path("/js/ui-gallery.js"))
                # Only front-end asset extensions, never arbitrary files dropped in there.
                self.assertFalse(server.is_public_static_path("/vendor/notes.txt"))
                self.assertFalse(server.is_public_static_path("/vendor/missing.js"))
                # Traversal out of the asset dir must not leak sibling files.
                self.assertFalse(server.is_public_static_path("/js/../secret.js"))
                self.assertFalse(server.is_public_static_path("/vendor/../../etc/passwd"))

    def test_port_comes_from_env_and_rejects_bad_values(self):
        with patch.dict(os.environ, {"COMFY_COMIC_PORT": "9123"}, clear=False):
            self.assertEqual(server._read_port_from_env(), 9123)
        for bad in ("", "abc", "0", "70000", "-1"):
            with patch.dict(os.environ, {"COMFY_COMIC_PORT": bad}, clear=False):
                self.assertEqual(server._read_port_from_env(8777), 8777)

    def test_config_payload_requires_complete_typed_state(self):
        valid = {
            "templates": [],
            "batchMatrix": {},
            "savedGalleries": [],
            "comfyWorkflows": [],
            "comfyConfig": {},
            "llmConfig": {},
            "xmlConfig": {},
            "chatConfig": {},
            "uiConfig": {},
            "batchRunState": {},
            "forceWrite": False,
        }
        self.assertIs(server.validate_config_payload(valid), valid)

        with self.assertRaises(ValueError):
            server.validate_config_payload({**valid, "templates": None})
        with self.assertRaises(ValueError):
            server.validate_config_payload({key: value for key, value in valid.items() if key != "chatConfig"})
        with self.assertRaises(ValueError):
            server.validate_config_payload({**valid, "forceWrite": "false"})


class MarketplaceAndVisionTests(unittest.TestCase):
    def test_marketplace_catalog_returns_default_structure(self):
        catalog = server.get_marketplace_catalog()
        self.assertIn("storyboards", catalog)
        self.assertIn("exportPresets", catalog)
        self.assertTrue(len(catalog["storyboards"]) >= 2)
        self.assertTrue(len(catalog["exportPresets"]) >= 4)

    def test_fetch_remote_json_rejects_unsafe_protocols(self):
        with self.assertRaises(ValueError):
            server.fetch_remote_json("ftp://example.com/template.json")
        with self.assertRaises(ValueError):
            server.fetch_remote_json("file:///etc/passwd")

    def test_vision_audit_validates_required_fields(self):
        with self.assertRaises(ValueError):
            server.handle_vision_audit({"baseUrl": "", "imageDataUrl": "data:image/png;base64,123"})
        with self.assertRaises(ValueError):
            server.handle_vision_audit({"baseUrl": "http://localhost:11434", "imageDataUrl": ""})

    @patch("urllib.request.urlopen")
    def test_fetch_remote_json_handles_utf8_bom(self, mock_urlopen):
        raw_with_bom = b'\xef\xbb\xbf{"title": "BOM Template", "steps": []}'
        mock_resp = unittest.mock.MagicMock()
        mock_resp.read.return_value = raw_with_bom
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        result = server.fetch_remote_json("https://raw.githubusercontent.com/test/tpl.json")
        self.assertEqual(result["title"], "BOM Template")

    @patch("urllib.request.urlopen")
    def test_vision_audit_extracts_json_from_conversational_output(self, mock_urlopen):
        mock_resp = unittest.mock.MagicMock()
        mock_body = {
            "choices": [{
                "message": {
                    "content": "以下是审校结果：\n```json\n{\n  \"score\": 9.0,\n  \"passed\": true,\n  \"summary\": \"构图极佳\",\n  \"anatomy\": \"正常\",\n  \"scene\": \"符合\",\n  \"suggestions\": \"无\"\n}\n```\n祝创作愉快！"
                }
            }]
        }
        mock_resp.read.return_value = json.dumps(mock_body).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        critique = server.handle_vision_audit({
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "test",
            "model": "gpt-4o",
            "promptText": "check",
            "imageDataUrl": "data:image/png;base64,abc"
        })
        self.assertEqual(critique["score"], 9.0)
        self.assertTrue(critique["passed"])
        self.assertEqual(critique["summary"], "构图极佳")

    @patch("urllib.request.urlopen")
    def test_vision_audit_safe_fallback_on_invalid_json(self, mock_urlopen):
        mock_resp = unittest.mock.MagicMock()
        mock_body = {
            "choices": [{
                "message": {
                    "content": "抱歉，由于画面过于模糊无法识别结构，请重新上传清晰图片。"
                }
            }]
        }
        mock_resp.read.return_value = json.dumps(mock_body).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        critique = server.handle_vision_audit({
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "test",
            "model": "gpt-4o",
            "promptText": "check",
            "imageDataUrl": "data:image/png;base64,abc"
        })
        # 必须标记为不通过并提醒人工复核，严禁误报为满分通过
        self.assertFalse(critique["passed"])
        self.assertLess(critique["score"], 7.0)
        self.assertIn("人工复核", critique["summary"])

    @patch("urllib.request.urlopen")
    def test_vision_audit_safe_fallback_on_refusal_or_none_content(self, mock_urlopen):
        mock_resp = unittest.mock.MagicMock()
        mock_body = {
            "choices": [{
                "message": {
                    "content": None,
                    "refusal": "I cannot fulfill this request due to safety policies."
                }
            }]
        }
        mock_resp.read.return_value = json.dumps(mock_body).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        critique = server.handle_vision_audit({
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "test",
            "model": "gpt-4o",
            "promptText": "check",
            "imageDataUrl": "data:image/png;base64,abc"
        })
        self.assertFalse(critique["passed"])
        self.assertLess(critique["score"], 7.0)
        self.assertIn("人工复核", critique["summary"])

    @patch("urllib.request.urlopen")
    def test_vision_audit_extracts_json_with_trailing_placeholders(self, mock_urlopen):
        mock_resp = unittest.mock.MagicMock()
        mock_body = {
            "choices": [{
                "message": {
                    "content": "审校结果如下：\n```json\n{\n  \"score\": 9.5,\n  \"passed\": true,\n  \"summary\": \"完美的一致性与画质\",\n  \"anatomy\": \"正常\",\n  \"scene\": \"契合\",\n  \"suggestions\": \"无\"\n}\n```\n提示：后续生成请注意保持 {character_tag} 与 {background_prompt} 的风格一致！"
                }
            }]
        }
        mock_resp.read.return_value = json.dumps(mock_body).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        critique = server.handle_vision_audit({
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "test",
            "model": "gpt-4o",
            "promptText": "check",
            "imageDataUrl": "data:image/png;base64,abc"
        })
        self.assertEqual(critique["score"], 9.5)
        self.assertTrue(critique["passed"])
        self.assertEqual(critique["summary"], "完美的一致性与画质")


if __name__ == "__main__":
    unittest.main()

