import base64
import io
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


if __name__ == "__main__":
    unittest.main()
