"""Cancelable local sockets; closing a connection cannot revoke upstream billing."""

import http.client
import socket
import urllib.request


import sys


def cancel_thread_io(thread_ident):
    if sys.platform == "win32" and thread_ident:
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            kernel32.OpenThread.restype = ctypes.c_void_p
            kernel32.OpenThread.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
            kernel32.CancelSynchronousIo.restype = ctypes.c_int
            kernel32.CancelSynchronousIo.argtypes = [ctypes.c_void_p]
            kernel32.CloseHandle.restype = ctypes.c_int
            kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
            h_thread = kernel32.OpenThread(0x0001, False, thread_ident)
            if h_thread:
                try:
                    kernel32.CancelSynchronousIo(h_thread)
                finally:
                    kernel32.CloseHandle(h_thread)
        except Exception:
            pass


def close_socket(sock, thread_ident=None):
    if thread_ident:
        cancel_thread_io(thread_ident)
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    try:
        real_close = getattr(sock, "_real_close", None)
        if callable(real_close):
            real_close()
        else:
            sock.close()
    except OSError:
        pass
    try:
        sock.close()
    except OSError:
        pass


def opener(payload, *handlers):
    register = payload.get("_onSocket")
    if not register:
        return urllib.request.build_opener(*handlers)

    class HTTPConnection(http.client.HTTPConnection):
        def connect(self):
            super().connect()
            tid = threading.get_ident()
            try:
                register(self.sock, tid)
            except TypeError:
                register(self.sock)

    class HTTPSConnection(http.client.HTTPSConnection):
        def connect(self):
            super().connect()
            tid = threading.get_ident()
            try:
                register(self.sock, tid)
            except TypeError:
                register(self.sock)

    class HTTPHandler(urllib.request.HTTPHandler):
        def http_open(self, req):
            return self.do_open(HTTPConnection, req)

    class HTTPSHandler(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(HTTPSConnection, req, context=self._context)

    return urllib.request.build_opener(HTTPHandler(), HTTPSHandler(), *handlers)


from contextlib import contextmanager
import threading


@contextmanager
def cancellation_scope(payload):
    """Give production calls their own socket owner; legacy jobs already have one."""
    cancelled = payload.get("_isCanceled")
    if not callable(cancelled) or callable(payload.get("_onSocket")):
        yield payload
        return
    local = dict(payload)
    done = threading.Event()
    current = {"socket": None, "thread_ident": None}

    def register(sock, thread_ident=None):
        current["socket"] = sock
        current["thread_ident"] = thread_ident or threading.get_ident()
        if cancelled():
            close_socket(sock, current["thread_ident"])

    def watch():
        while not done.wait(0.1):
            if cancelled():
                if current["socket"]:
                    close_socket(current["socket"], current["thread_ident"])
                return

    local["_onSocket"] = register
    worker = threading.Thread(target=watch, daemon=True, name="provider-cancellation")
    worker.start()
    try:
        yield local
    finally:
        done.set()
        worker.join(timeout=1)
