"""Minimal RFC 6455 WebSocket client (standard library only).

Enough for ComfyUI's ``/ws`` channel: text JSON events, binary preview frames, fragmented
messages, ping/pong and close. Plain ``ws://`` only; ComfyUI runs on the local machine.
"""
from __future__ import annotations

import base64
import hashlib
import os
import socket
import struct
from urllib.parse import urlparse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA


class WebSocketError(ConnectionError):
    pass


class WebSocketClosed(WebSocketError):
    pass


def encode_frame(opcode: int, payload: bytes, mask: bool = True, fin: bool = True) -> bytes:
    """Build one frame. Clients must mask; the fake servers in tests send unmasked frames."""
    head = bytes([(0x80 if fin else 0) | opcode])
    length = len(payload)
    mask_bit = 0x80 if mask else 0
    if length < 126:
        head += bytes([mask_bit | length])
    elif length < 1 << 16:
        head += bytes([mask_bit | 126]) + struct.pack("!H", length)
    else:
        head += bytes([mask_bit | 127]) + struct.pack("!Q", length)
    if not mask:
        return head + payload
    key = os.urandom(4)
    masked = bytes(b ^ key[i % 4] for i, b in enumerate(payload))
    return head + key + masked


class WebSocket:
    def __init__(self, url: str, timeout: float = 30.0):
        parts = urlparse(url)
        if parts.scheme != "ws":
            raise WebSocketError(f"只支持 ws:// 地址：{url}")
        host, port = parts.hostname or "127.0.0.1", parts.port or 80
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self._buf = bytearray()
        self._message_op: int | None = None
        self._parts: list[bytes] = []
        key = base64.b64encode(os.urandom(16)).decode()
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        request = (
            f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        head = self._read_until(b"\r\n\r\n").decode("latin-1")
        status, *lines = head.split("\r\n")
        if " 101 " not in status + " ":
            self.sock.close()
            raise WebSocketError(f"握手失败：{status}")
        headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines if l)}
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        if headers.get("sec-websocket-accept") != expected:
            self.sock.close()
            raise WebSocketError("握手校验失败（Sec-WebSocket-Accept 不匹配）")

    def settimeout(self, seconds: float | None) -> None:
        self.sock.settimeout(seconds)

    def _read_until(self, marker: bytes) -> bytes:
        while marker not in self._buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WebSocketClosed("连接在握手时关闭")
            self._buf += chunk
        head, _, rest = bytes(self._buf).partition(marker)
        self._buf = bytearray(rest)
        return head

    def _fill(self, n: int) -> None:
        while len(self._buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise WebSocketClosed("连接已关闭")
            self._buf += chunk

    def _recv_frame(self) -> tuple[bool, int, bytes]:
        """Parse one frame without consuming anything until it is complete.

        A socket timeout can hit halfway through a frame; because the buffer is only consumed
        once the whole frame is present, the caller can simply retry ``recv()``.
        """
        self._fill(2)
        b1, b2 = self._buf[0], self._buf[1]
        length, offset = b2 & 0x7F, 2
        if length == 126:
            self._fill(4)
            (length,) = struct.unpack("!H", self._buf[2:4])
            offset = 4
        elif length == 127:
            self._fill(10)
            (length,) = struct.unpack("!Q", self._buf[2:10])
            offset = 10
        masked = bool(b2 & 0x80)
        if masked:
            offset += 4
        self._fill(offset + length)
        payload = bytes(self._buf[offset:offset + length])
        if masked:
            key = self._buf[offset - 4:offset]
            payload = bytes(b ^ key[i % 4] for i, b in enumerate(payload))
        del self._buf[:offset + length]
        return bool(b1 & 0x80), b1 & 0x0F, payload

    def send(self, opcode: int, payload: bytes = b"") -> None:
        self.sock.sendall(encode_frame(opcode, payload, mask=True))

    def recv(self) -> str | bytes:
        """Next complete data message: ``str`` for text, ``bytes`` for binary.

        Safe to call again after a socket timeout: partial frames stay buffered and fragments
        already received are kept on the instance.
        """
        while True:
            fin, opcode, payload = self._recv_frame()
            if opcode == OP_PING:
                self.send(OP_PONG, payload)
                continue
            if opcode == OP_PONG:
                continue
            if opcode == OP_CLOSE:
                try:
                    self.send(OP_CLOSE, payload[:2])
                finally:
                    self.sock.close()
                raise WebSocketClosed("服务器关闭了连接")
            if opcode in (OP_TEXT, OP_BINARY):
                self._message_op, self._parts = opcode, [payload]
            elif opcode == OP_CONT and self._message_op is not None:
                self._parts.append(payload)
            else:
                raise WebSocketError(f"意外的帧类型 {opcode}")
            if fin:
                data, op = b"".join(self._parts), self._message_op
                self._message_op, self._parts = None, []
                return data.decode("utf-8") if op == OP_TEXT else data

    def close(self) -> None:
        try:
            self.send(OP_CLOSE, struct.pack("!H", 1000))
        except OSError:
            pass
        finally:
            self.sock.close()
