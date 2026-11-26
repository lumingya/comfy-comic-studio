"""Offline classification of transfer-budget timeouts and ordinary connection failures."""

from __future__ import annotations

import importlib.util
import sys
import threading
import unittest
from contextlib import contextmanager
from itertools import product
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import httpx

from mio_server.llm import LLMError

PACKAGE = Path(__file__).resolve().parents[2] / "examples/extensions/standard-image-channels"
SPEC = importlib.util.spec_from_file_location(
    "cloud_timeout_classification_fixture",
    PACKAGE / "main.py",
    submodule_search_locations=[str(PACKAGE)],
)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
TRANSPORT = sys.modules[f"{MODULE.__name__}.transport"]
TIMEOUTS = (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout)


@contextmanager
def transfer_with(handler):
    clock, calls = [0.0], []
    scope, cancel = TRANSPORT.Scope(), threading.Event()
    channel = SimpleNamespace(
        base_url="https://image-service.invalid",
        api_key="",
        extra_options={"min_interval": 0},
    )

    def respond(request):
        calls.append(request)
        return handler(request, clock, scope, cancel)

    with (
        mock.patch.object(TRANSPORT.time, "monotonic", side_effect=lambda: clock[0]),
        mock.patch.object(
            httpx, "HTTPTransport", side_effect=AssertionError("native HTTP transport is forbidden")
        ),
        TRANSPORT.Transfer(channel, httpx.MockTransport(respond), scope, cancel, 1.2) as transfer,
    ):
        yield transfer, clock, calls


class TimeoutStream(httpx.SyncByteStream):
    def __init__(self, fail):
        self.fail = fail

    def __iter__(self):
        yield b"partial"
        self.fail()


class CloudTimeoutClassificationTests(unittest.TestCase):
    def test_transfer_budget_timeouts_are_deadlines_with_positive_time_remaining(self):
        for method, timeout_type in product(("POST", "GET"), TIMEOUTS):
            with self.subTest(method=method, timeout=timeout_type.__name__):

                def respond(request, clock, scope, cancel, timeout_type=timeout_type):
                    def fail():
                        clock[0] = 1.187
                        raise timeout_type("synthetic transfer timeout", request=request)

                    if timeout_type is httpx.ReadTimeout:
                        return httpx.Response(200, stream=TimeoutStream(fail))
                    fail()

                with transfer_with(respond) as (transfer, clock, calls):
                    with self.assertRaises(LLMError) as caught:
                        transfer.request(method, transfer.base + "/image")
                    self.assertAlmostEqual(transfer.deadline - clock[0], 0.013)
                    self.assertIn("deadline exceeded", str(caught.exception))
                    self.assertNotIn("connection failed", str(caught.exception))
                    self.assertFalse(caught.exception.retryable)
                    self.assertEqual(caught.exception.sent, method == "POST")
                    self.assertEqual(len(calls), 1)
                    self.assertEqual(
                        calls[0].extensions["timeout"],
                        dict.fromkeys(("connect", "read", "write", "pool"), 1.2),
                    )

    def test_ordinary_connection_failures_keep_post_and_get_semantics(self):
        def respond(request, clock, scope, cancel):
            clock[0] = 1.187
            raise httpx.ConnectError("synthetic TLS peer close", request=request)

        for method in ("POST", "GET"):
            with (
                self.subTest(method=method),
                transfer_with(respond) as (transfer, clock, calls),
            ):
                if method == "POST":
                    with self.assertRaises(LLMError) as caught:
                        transfer.request(method, transfer.base + "/image")
                    self.assertIn("connection failed", str(caught.exception))
                    self.assertNotIn("deadline", str(caught.exception))
                    self.assertFalse(caught.exception.sent)
                else:
                    status, headers, body = transfer.request(method, transfer.base + "/image")
                    self.assertEqual((status, dict(headers), body), (503, {}, b""))
                self.assertAlmostEqual(transfer.deadline - clock[0], 0.013)
                self.assertEqual(len(calls), 1)

    def test_cancel_and_scope_stop_precede_timeout_and_connection_classification(self):
        cases = product(
            ("POST", "GET"), (*TIMEOUTS, httpx.ConnectError), ("cancel", "scope"), (False, True)
        )
        for method, exception_type, stop, expired in cases:
            with self.subTest(
                method=method, error=exception_type.__name__, stop=stop, expired=expired
            ):

                def respond(
                    request,
                    clock,
                    scope,
                    cancel,
                    exception_type=exception_type,
                    stop=stop,
                    expired=expired,
                ):
                    clock[0] = 1.3 if expired else 1.187
                    cancel.set() if stop == "cancel" else scope.close()
                    raise exception_type("synthetic interrupted transfer", request=request)

                with transfer_with(respond) as (transfer, clock, calls):
                    with self.assertRaises(LLMError) as caught:
                        transfer.request(method, transfer.base + "/image")
                    self.assertIn("cancelled", str(caught.exception))
                    self.assertNotIn("deadline", str(caught.exception))
                    self.assertNotIn("connection failed", str(caught.exception))
                    self.assertEqual(caught.exception.sent, method == "POST")
                    self.assertFalse(caught.exception.retryable)
                    self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
