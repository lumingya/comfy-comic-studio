"""Cancelable local sockets; closing a connection cannot revoke upstream billing."""
import http.client
import socket
import urllib.request


def close_socket(sock):
    try:sock.shutdown(socket.SHUT_RDWR)
    except OSError:pass
    try:sock.close()
    except OSError:pass


def opener(payload, *handlers):
    register=payload.get('_onSocket')
    if not register:return urllib.request.build_opener(*handlers)
    class HTTPConnection(http.client.HTTPConnection):
        def connect(self):
            super().connect();register(self.sock)
    class HTTPSConnection(http.client.HTTPSConnection):
        def connect(self):
            super().connect();register(self.sock)
    class HTTPHandler(urllib.request.HTTPHandler):
        def http_open(self,req):return self.do_open(HTTPConnection,req)
    class HTTPSHandler(urllib.request.HTTPSHandler):
        def https_open(self,req):return self.do_open(HTTPSConnection,req,context=self._context)
    return urllib.request.build_opener(HTTPHandler(),HTTPSHandler(),*handlers)
