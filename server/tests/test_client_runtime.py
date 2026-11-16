"""Generated-client error and polling contracts, without external HTTP services."""

from __future__ import annotations

import importlib.util
import io
import json
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


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


if __name__ == "__main__":
    unittest.main()
