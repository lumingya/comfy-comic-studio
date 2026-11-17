"""Generated-client error and polling contracts, without external HTTP services."""

from __future__ import annotations

import importlib.util
import io
import json
import types
import unittest
import urllib.error
from email import policy
from email.parser import BytesParser
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from .api_harness import ApiCase
from .test_api_v2 import LiveServer


def load_client():
    path = Path(__file__).resolve().parents[2] / "clients" / "python" / "mio_client.py"
    spec = importlib.util.spec_from_file_location("client_runtime_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ClientRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_client()

    def test_http_errors_always_use_mio_error(self):
        for body in (b'[{"message":"unavailable"}]', b"null", b'"unavailable"', b"502", b"oops"):
            with self.subTest(body=body):
                error = urllib.error.HTTPError(
                    "http://mio.invalid/api/v2/series", 502, "Bad Gateway", {}, io.BytesIO(body)
                )
                with (
                    mock.patch.object(self.module.urllib.request, "urlopen", side_effect=error),
                    self.assertRaises(self.module.MioError) as caught,
                ):
                    self.module.MioClient().list_series()
                self.assertEqual(caught.exception.status, 502)
                self.assertEqual(caught.exception.kind, "error")
                self.assertEqual(caught.exception.detail, body.decode())

    def test_http_error_keeps_server_kind_and_detail(self):
        body = b'{"kind":"conflict","detail":"already running"}'
        error = urllib.error.HTTPError(
            "http://mio.invalid/api/v2/series", 409, "Conflict", {}, io.BytesIO(body)
        )
        with (
            mock.patch.object(self.module.urllib.request, "urlopen", side_effect=error),
            self.assertRaises(self.module.MioError) as caught,
        ):
            self.module.MioClient().list_series()
        self.assertEqual(caught.exception.kind, "conflict")
        self.assertEqual(caught.exception.detail, "already running")

    def test_wait_job_caps_poll_sleep_at_remaining_deadline(self):
        clock = SimpleNamespace(now=0.0)
        sleeps = []

        def sleep(seconds):
            sleeps.append(seconds)
            clock.now += seconds

        mio = self.module.MioClient()
        with (
            mock.patch.object(self.module.time, "monotonic", side_effect=lambda: clock.now),
            mock.patch.object(self.module.time, "sleep", side_effect=sleep),
            mock.patch.object(mio, "_request", return_value={"state": "running"}) as request,
            self.assertRaises(TimeoutError),
        ):
            mio.wait_job("job_1", timeout=1, poll=0.6)
        self.assertEqual(clock.now, 1)
        self.assertEqual(sleeps, [0.6, 0.4])
        self.assertEqual(request.call_count, 2)
        self.assertEqual([call.kwargs["timeout"] for call in request.call_args_list], [1, 0.4])

    def test_wait_job_caps_http_timeout_at_remaining_deadline(self):
        for request_timeout, expected in ((120, 1), (0.25, 0.25), (None, 1)):
            with self.subTest(request_timeout=request_timeout):
                response = mock.MagicMock()
                response.__enter__.return_value = response
                response.headers = {"Content-Type": "application/json"}
                response.read.return_value = json.dumps({"state": "completed"}).encode()
                with (
                    mock.patch.object(self.module.time, "monotonic", return_value=0),
                    mock.patch.object(
                        self.module.urllib.request, "urlopen", return_value=response
                    ) as urlopen,
                ):
                    result = self.module.MioClient(timeout=request_timeout).wait_job(
                        "job_1", timeout=1
                    )
                self.assertEqual(result["state"], "completed")
                self.assertEqual(urlopen.call_args.kwargs["timeout"], expected)

    def test_wait_job_zero_timeout_does_not_start_http_request(self):
        mio = self.module.MioClient()
        with mock.patch.object(mio, "_request") as request, self.assertRaises(TimeoutError):
            mio.wait_job("job_1", timeout=0)
        request.assert_not_called()

    def test_wait_job_rejects_invalid_time_budgets_before_http_request(self):
        mio = self.module.MioClient()
        for options in (
            {"timeout": -1},
            {"timeout": float("inf")},
            {"timeout": float("nan")},
            {"poll": 0},
            {"poll": -1},
            {"poll": float("inf")},
            {"poll": float("nan")},
        ):
            with (
                self.subTest(options=options),
                mock.patch.object(mio, "_request") as request,
                self.assertRaises(ValueError),
            ):
                mio.wait_job("job_1", **options)
            request.assert_not_called()


class GeneratedMultipartClientTests(ApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.client_root = Path(__file__).resolve().parents[2] / "clients" / "python"
        spec = importlib.util.spec_from_file_location(
            "client_generator_under_test", cls.client_root / "generate.py"
        )
        cls.generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.generator)

    def client_module(self, path="/themes/folder", operation=None):
        if operation is None:
            schema = self.ok(self.client.get("/api/v2/openapi.json"))
            operation = schema["paths"][path]["post"]
        source = (self.client_root / "_runtime.py").read_text(encoding="utf-8")
        source += "\n\n" + self.generator.method_source(path, "post", operation) + "\n"
        module = types.ModuleType("generated_multipart_client")
        exec(compile(source, "<generated multipart client>", "exec"), module.__dict__)
        return module

    def test_generated_folder_method_uploads_to_real_theme_endpoint(self):
        module = self.client_module()
        token = self.ok(
            self.client.post("/api/tokens", json={"name": "upload", "scopes": ["admin", "write"]}),
            201,
        )["token"]
        theme = {
            "id": "client-theme",
            "name": "雨后纸页",
            "mode": "light",
            "tokens": {"accent": "#345678"},
        }
        manifest = {
            "id": theme["id"],
            "name": theme["name"],
            "version": "1.0.0",
            "author": "",
            "description": "",
            "theme_file": "theme.json",
        }
        files = [
            ("files", (f"client-theme/{name}", json.dumps(value, ensure_ascii=False).encode()))
            for name, value in (("mio-theme.json", manifest), ("theme.json", theme))
        ]
        with LiveServer(self.client.app) as url:
            result = module.MioClient(url, token=token).import_theme_folder(files)
        self.assertEqual((result["id"], result["source"]), ("client-theme", "theme-package"))
        self.assertEqual(result["tokens"]["accent"], "#345678")
        saved = Path(self.tmp) / "themes/client-theme/theme.json"
        self.assertEqual(saved.read_bytes(), files[1][1][1])

    def test_generated_multipart_method_preserves_query_and_file_interface(self):
        operation = {
            "operationId": "upload_folder",
            "parameters": [{"in": "query", "name": "replace", "schema": {"type": "boolean"}}],
            "requestBody": {"content": {"multipart/form-data": {}}},
        }
        mio = self.client_module("/sample/folder", operation).MioClient()
        files = [("files", ("sample/file.json", b"{}"))]
        with mock.patch.object(mio, "_request", return_value={}) as request:
            mio.upload_folder(files, replace=True)
        request.assert_called_once_with(
            "POST", "/sample/folder", params={"replace": True}, files=files
        )

    def test_encoder_preserves_binary_repeated_fields_and_quoted_unicode_names(self):
        module = self.client_module()
        payload = b"\x00\xff\r\n--not-a-boundary\r\n"
        filename = '画稿/part "one"\\two.bin'
        content, content_type = module._multipart(
            [("files", (filename, payload)), ("files", ("empty.bin", b""))]
        )
        envelope = BytesParser(policy=policy.default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode() + content
        )
        parts = list(envelope.iter_parts())
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0].get_filename(), filename)
        self.assertEqual(parts[0].get_param("name", header="content-disposition"), "files")
        self.assertEqual(parts[0].get_payload(decode=True), payload)
        self.assertEqual(parts[1].get_payload(decode=True), b"")

    def test_unsafe_multipart_names_are_rejected_before_any_http_request(self):
        module = self.client_module()
        mio = module.MioClient()
        for field, filename in (
            ("files\r\nX-Header: yes", "safe.json"),
            ("files", "unsafe\r\nX-Header: yes"),
            ("files\n", "safe.json"),
            ("files", "unsafe\x00.json"),
        ):
            with (
                self.subTest(field=field, filename=filename),
                mock.patch.object(module.urllib.request, "urlopen") as urlopen,
                self.assertRaises(ValueError),
            ):
                mio.import_theme_folder([(field, (filename, b"{}"))])
            urlopen.assert_not_called()

    def test_multipart_content_must_be_bytes_and_body_types_are_exclusive(self):
        module = self.client_module()
        mio = module.MioClient()
        with mock.patch.object(module.urllib.request, "urlopen") as urlopen:
            with self.assertRaises(TypeError):
                mio.import_theme_folder([("files", ("safe.json", "not bytes"))])
            with self.assertRaises(ValueError):
                mio._request("POST", "/themes/folder", json={}, files=[])
        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
