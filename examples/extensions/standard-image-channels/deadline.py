"""Interrupt native HTTP I/O without moving requests into background threads."""

from __future__ import annotations

import socket
import threading
import time


class Deadline:
    """Own one request's socket and a joined cancellation watchdog.

    HTTPcore's trace extension exposes the TCP stream before TLS wrapping and
    before any HTTP headers. Our private SSL context registers the replacement
    SSLSocket before its handshake. Closing the actual socket after shutdown is
    necessary to wake Python's timed socket select on Windows.
    """

    def __init__(self, transfer, context):
        self.transfer = transfer
        self.context = context
        self.wrap_socket = context.wrap_socket
        self.done = threading.Event()
        self.lock = threading.Lock()
        self.socket = None
        self.thread = threading.Thread(target=self.watch, name="mio-image-deadline")

    def start(self):
        self.context.wrap_socket = self.start_tls
        self.thread.start()

    def capture(self, sock):
        with self.lock:
            # Keep the socket object, never a descriptor that could be reused.
            self.socket = sock
            try:
                self.transfer.check()
            except BaseException:
                self.abort()
                raise

    def trace(self, event, info):
        if event != "connection.connect_tcp.complete":
            return
        stream = info["return_value"]
        sock = stream.get_extra_info("socket")
        if sock is not None:
            self.capture(sock)

    def start_tls(self, *args, **kwargs):
        handshake = kwargs.get("do_handshake_on_connect", True)
        kwargs["do_handshake_on_connect"] = False
        with self.lock:
            # SSL detaches the TCP socket. Register its new owner atomically,
            # without holding the lock across any handshake network I/O.
            sock = self.wrap_socket(*args, **kwargs)
            self.socket = sock
        try:
            self.transfer.check()
            if handshake:
                sock.do_handshake()
            return sock
        except BaseException:
            sock.close()
            raise

    def abort(self):
        if self.socket is not None:
            try:
                self.socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass  # The request may have just closed its stream.
            try:
                self.socket.close()
            except OSError:
                pass
            self.socket = None

    def watch(self):
        while not self.done.is_set():
            remaining = self.transfer.deadline - time.monotonic()
            stopped = self.transfer.cancel.is_set() or self.transfer.scope.stopped.is_set()
            if stopped or remaining <= 0:
                with self.lock:
                    if not self.done.is_set():
                        self.abort()
                return
            self.done.wait(min(remaining, 0.025))

    def close(self):
        self.done.set()
        self.thread.join()
        del self.context.wrap_socket  # Restore the private context's class method.
        with self.lock:
            self.socket = None  # The caller owns normal response/connection closure.
