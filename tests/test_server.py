import base64
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import server


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

    def test_local_files_must_be_inside_images_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            images_dir = os.path.join(temp_dir, "images")
            os.makedirs(images_dir)
            allowed_path = os.path.join(images_dir, "panel.png")
            outside_path = os.path.join(temp_dir, "secret.png")
            for path in (allowed_path, outside_path):
                with open(path, "wb"):
                    pass

            with patch.object(server, "IMAGES_DIR", images_dir):
                self.assertEqual(server.local_path_from_url(allowed_path), os.path.realpath(allowed_path))
                with self.assertRaises(PermissionError):
                    server.local_path_from_url(outside_path)

    def test_declared_oversized_image_is_rejected_before_reading(self):
        response = FakeResponse(b"small", content_length=server.MAX_IMAGE_BYTES + 1)
        with self.assertRaises(server.PayloadTooLargeError):
            server.read_limited_response(response)


class SplitConfigTests(unittest.TestCase):
    def test_split_config_round_trip_preserves_core_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_files = {
                key: os.path.join(temp_dir, f"{key}.json")
                for key in server.CONFIG_FILES
            }
            payload = {
                "templates": [{"id": "tpl-1", "title": "Example", "steps": []}],
                "activeTemplateId": "tpl-1",
                "batchMatrix": {"columns": ["character"], "rows": []},
                "savedGalleries": [{"id": "book-1", "steps": []}],
                "comfyWorkflows": [{"id": "wf-1", "workflow": {}}],
                "activeWorkflowId": "wf-1",
                "comfyConfig": {"baseUrl": "http://127.0.0.1:8188"},
                "llmConfig": {"model": "test-model"},
                "xmlConfig": {"systemPrompt": "prompt"},
                "chatConfig": {"sessions": []},
                "uiConfig": {"theme": "dark"},
                "batchRunState": {"status": "idle"},
                "updatedAt": 123,
            }

            with patch.object(server, "CONFIG_FILES", config_files), patch.object(
                server, "LEGACY_DATA_FILE", os.path.join(temp_dir, "legacy.json")
            ):
                server.write_split_config(payload)
                restored = server.read_merged_config()

            self.assertEqual(restored["templates"], payload["templates"])
            self.assertEqual(restored["savedGalleries"], payload["savedGalleries"])
            self.assertEqual(restored["activeWorkflowId"], "wf-1")
            self.assertEqual(restored["llmConfig"]["model"], "test-model")
            self.assertEqual(restored["xmlSystemPrompt"], "prompt")

    def test_unchanged_config_files_are_not_rewritten(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_files = {
                key: os.path.join(temp_dir, f"{key}.json") for key in server.CONFIG_FILES
            }
            payload = {
                "templates": [{"id": "tpl-1", "steps": []}],
                "batchMatrix": {"columns": [], "rows": []},
                "savedGalleries": [],
                "comfyWorkflows": [],
                "comfyConfig": {},
                "llmConfig": {},
                "xmlConfig": {},
                "chatConfig": {},
                "uiConfig": {},
                "batchRunState": {"status": "idle"},
            }
            with patch.object(server, "CONFIG_FILES", config_files):
                first = server.write_split_config(payload)
                self.assertEqual(sorted(first), sorted(server.CONFIG_FILES))

                # 同一份数据再写一次：一个文件都不应该被重写
                self.assertEqual(server.write_split_config(payload), [])

                # 只动 llmConfig，就只有 llm.json 被重写
                payload["llmConfig"] = {"model": "changed"}
                self.assertEqual(server.write_split_config(payload), ["llm"])

    def test_incomplete_or_corrupt_split_config_is_not_merged(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_files = {
                key: os.path.join(temp_dir, f"{key}.json")
                for key in server.CONFIG_FILES
            }
            with open(config_files["content"], "w", encoding="utf-8") as config_file:
                config_file.write("{}")

            with patch.object(server, "CONFIG_FILES", config_files), patch.object(
                server, "LEGACY_DATA_FILE", os.path.join(temp_dir, "legacy.json")
            ):
                with self.assertRaises(server.ConfigReadError):
                    server.read_merged_config()

                for path in config_files.values():
                    with open(path, "w", encoding="utf-8") as config_file:
                        config_file.write("{}")
                with open(config_files["llm"], "w", encoding="utf-8") as config_file:
                    config_file.write("{not-json")

                with self.assertRaises(server.ConfigReadError):
                    server.read_merged_config()


class ServerBoundaryTests(unittest.TestCase):
    def test_only_public_app_assets_and_images_are_served(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            images_dir = os.path.join(temp_dir, "images")
            os.makedirs(images_dir)
            image_path = os.path.join(images_dir, "panel.png")
            with open(image_path, "wb") as image_file:
                image_file.write(b"\x89PNG\r\n\x1a\n")

            with patch.object(server, "BASE_DIR", temp_dir), patch.object(
                server, "IMAGES_DIR", images_dir
            ):
                self.assertTrue(server.is_public_static_path("/"))
                self.assertTrue(server.is_public_static_path("/index.html"))
                self.assertTrue(server.is_public_static_path("/images/panel.png"))
                self.assertFalse(server.is_public_static_path("/images/"))
                self.assertFalse(server.is_public_static_path("/data/llm.json"))
                self.assertFalse(server.is_public_static_path("/.git/config"))
                self.assertFalse(server.is_public_static_path("/server.py"))
                self.assertFalse(server.is_public_static_path("/images/../server.py"))

    def test_front_end_asset_dirs_are_served_but_stay_sandboxed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            for sub in ("vendor", "js"):
                os.makedirs(os.path.join(temp_dir, sub))
            for rel in ("vendor/lucide.min.js", "vendor/tailwind-browser.js", "js/gallery.js"):
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
                self.assertTrue(server.is_public_static_path("/js/gallery.js"))
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

