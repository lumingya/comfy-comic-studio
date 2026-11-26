"""Offline classification of owned-budget timeouts and custom transport failures."""

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


class FakeDeadline:
    def __init__(self):
        self.started = self.closed = 0

    def start(self):
        self.started += 1

    def close(self):
        self.closed += 1

    def trace(self, event, info):
        pass


@contextmanager
def transfer_with(case, handler, *, native):
    clock, calls = [0.0], []
    scope, cancel = TRANSPORT.Scope(), threading.Event()
    guard, ssl_context = FakeDeadline(), object()
    channel = SimpleNamespace(
        base_url="https://image-service.invalid",
        api_key="",
        extra_options={"min_interval": 0},
    )

    def respond(request):
        calls.append(request)
        return handler(request, clock, scope, cancel)

    transport = httpx.MockTransport(respond)
    with (
        mock.patch.object(TRANSPORT.time, "monotonic", side_effect=lambda: clock[0]),
        mock.patch.object(TRANSPORT, "create_ssl_context", return_value=ssl_context) as ssl_factory,
        mock.patch.object(TRANSPORT, "Deadline", return_value=guard) as deadline_factory,
        mock.patch.object(httpx, "HTTPTransport", return_value=transport) as transport_factory,
    ):
        if not native:
            for factory in (ssl_factory, deadline_factory, transport_factory):
                factory.side_effect = AssertionError("custom transport must not create native I/O")
        with TRANSPORT.Transfer(
            channel, None if native else transport, scope, cancel, 1.2
        ) as transfer:
            yield transfer, clock
            case.assertEqual(transfer.native, native)
            case.assertEqual(len(calls), 1)
            case.assertEqual(
                calls[0].extensions["timeout"],
                dict.fromkeys(("connect", "read", "write", "pool"), 1.2),
            )
            if native:
                ssl_factory.assert_called_once_with(trust_env=False)
                transport_factory.assert_called_once()
                deadline_factory.assert_called_once_with(transfer, ssl_context)
                case.assertEqual((guard.started, guard.closed), (1, 1))
            else:
                for factory in (ssl_factory, deadline_factory, transport_factory):
                    factory.assert_not_called()


class TimeoutStream(httpx.SyncByteStream):
    def __init__(self, fail):
        self.fail = fail

    def __iter__(self):
        yield b"partial"
        self.fail()


def failing_handler(exception_type, *, stop=None, expired=False):
    def respond(request, clock, scope, cancel):
        def fail():
            clock[0] = 1.3 if expired else 1.187
            if stop == "cancel":
                cancel.set()
            elif stop == "scope":
                scope.close()
            raise exception_type("synthetic transfer failure", request=request)

        if exception_type is httpx.ReadTimeout:
            return httpx.Response(200, stream=TimeoutStream(fail))
        fail()

    return respond


class CloudTimeoutClassificationTests(unittest.TestCase):
    def test_native_budget_timeouts_are_deadlines_with_positive_time_remaining(self):
        for method, timeout_type in product(("POST", "GET"), TIMEOUTS):
            handler = failing_handler(timeout_type)
            with (
                self.subTest(method=method, timeout=timeout_type.__name__),
                transfer_with(self, handler, native=True) as (transfer, clock),
            ):
                with self.assertRaises(LLMError) as caught:
                    transfer.request(method, transfer.base + "/image")
                self.assertAlmostEqual(transfer.deadline - clock[0], 0.013)
                self.assertIn("deadline exceeded", str(caught.exception))
                self.assertNotIn("connection failed", str(caught.exception))
                self.assertFalse(caught.exception.retryable)
                self.assertEqual(caught.exception.sent, method == "POST")

    def test_custom_timeouts_keep_early_failure_semantics(self):
        for method, timeout_type in product(("POST", "GET"), TIMEOUTS):
            handler = failing_handler(timeout_type)
            with (
                self.subTest(method=method, timeout=timeout_type.__name__),
                transfer_with(self, handler, native=False) as (transfer, clock),
            ):
                if method == "POST":
                    with self.assertRaises(LLMError) as caught:
                        transfer.request(method, transfer.base + "/image")
                    connection_failure = timeout_type is httpx.ConnectTimeout
                    self.assertIn(
                        "connection failed"
                        if connection_failure
                        else "transport ended without a confirmed result",
                        str(caught.exception),
                    )
                    self.assertNotIn("deadline", str(caught.exception))
                    self.assertEqual(caught.exception.sent, not connection_failure)
                    self.assertFalse(caught.exception.retryable)
                else:
                    status, headers, body = transfer.request(method, transfer.base + "/image")
                    self.assertEqual((status, dict(headers), body), (503, {}, b""))
                self.assertAlmostEqual(transfer.deadline - clock[0], 0.013)

    def test_ordinary_connection_failures_keep_post_and_get_semantics(self):
        def respond(request, clock, scope, cancel):
            clock[0] = 1.187
            raise httpx.ConnectError("synthetic TLS peer close", request=request)

        for native, method in product((False, True), ("POST", "GET")):
            with (
                self.subTest(native=native, method=method),
                transfer_with(self, respond, native=native) as (transfer, clock),
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

    def test_cancel_and_scope_stop_precede_timeout_and_connection_classification(self):
        cases = product(
            (False, True),
            ("POST", "GET"),
            (*TIMEOUTS, httpx.ConnectError),
            ("cancel", "scope"),
            (False, True),
        )
        for native, method, exception_type, stop, expired in cases:
            with (
                self.subTest(
                    native=native,
                    method=method,
                    error=exception_type.__name__,
                    stop=stop,
                    expired=expired,
                ),
                transfer_with(
                    self,
                    failing_handler(exception_type, stop=stop, expired=expired),
                    native=native,
                ) as (transfer, clock),
            ):
                with self.assertRaises(LLMError) as caught:
                    transfer.request(method, transfer.base + "/image")
                self.assertEqual(transfer.deadline <= clock[0], expired)
                self.assertIn("cancelled", str(caught.exception))
                self.assertNotIn("deadline", str(caught.exception))
                self.assertNotIn("connection failed", str(caught.exception))
                self.assertEqual(caught.exception.sent, method == "POST")
                self.assertFalse(caught.exception.retryable)


if __name__ == "__main__":
    unittest.main()
