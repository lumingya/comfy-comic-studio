"""Small adversarial corpora exercise the production scanners and upload lifecycle."""

import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mio_server.api.theme_packages import _card_scoped_rules
from mio_server.api.uploads import multipart_uploads
from mio_server.theme_media import validate_stylesheet


class StylesheetCorpusTests(unittest.TestCase):
    def test_resource_scanner_rejects_external_and_obfuscated_resource_grammars(self):
        for source in (
            '@import "https://example.invalid/style.css";',
            '@/**/ImPoRt "https://example.invalid/style.css";',
            "body{background:u/**/Rl(https://example.invalid/img.png)}",
            'body{background:URL("//example.invalid/img.png")}',
            'body{background:image-set("https://example.invalid/img.png" 1x)}',
            'body{background:-WEBKIT-IMAGE-SET(url("assets/ok.png") 1x)}',
            "body{background:u\\72l(https://example.invalid/img.png)}",
            'body{background:url("assets/../outside.png")}',
            'body{background:url("assets/ok.png"}',
            'body{content:"unterminated}',
            "body{/* unterminated",
        ):
            with self.subTest(source=source), self.assertRaises(ValueError):
                validate_stylesheet(source, {"assets/ok.png"})
        self.assertEqual(
            validate_stylesheet('body{background:u/**/Rl("assets/ok.png")}', {"assets/ok.png"}),
            {"assets/ok.png"},
        )

    def test_card_filter_never_exposes_siblings_lists_or_unclosed_rules(self):
        scope = '.theme-card[data-theme-id="my-theme"]'
        for selector in (
            scope + " + body",
            scope + " ~ main",
            scope + " > .title + body",
            scope + ",body",
            scope + ' [title="text"] ~ body',
            '.theme-card[data-theme-id="other-theme"]',
            "body",
        ):
            with self.subTest(selector=selector):
                self.assertEqual(_card_scoped_rules(f"{selector} {{display:none}}", "my-theme"), "")
        for source in (
            f"{scope} {{ color:red;",
            f"{scope} {{ & body {{color:red}} }}",
            "} body {color:red}",
        ):
            with self.subTest(source=source):
                self.assertEqual(_card_scoped_rules(source, "my-theme"), "")
        self.assertTrue(_card_scoped_rules(f'{scope} > .title {{content:"+ ~"}}', "my-theme"))


def envelope(payload: bytes) -> bytes:
    return (
        b'--mio-boundary\r\nContent-Disposition: form-data; name="files"; filename="asset.bin"\r\n'
        b"Content-Type: application/octet-stream\r\n\r\n" + payload + b"\r\n--mio-boundary--\r\n"
    )


class UploadBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def request(self, source):
        return SimpleNamespace(
            headers={"content-type": "multipart/form-data; boundary=mio-boundary"}, stream=source
        )

    async def test_arbitrary_chunk_boundaries_preserve_binary_and_false_delimiters(self):
        payload = (
            bytes(range(256)) + b"\r\n--mio-boundaryX!\r\n--mio-boun" + bytes(range(255, -1, -1))
        )
        body = envelope(payload)
        for step in (*range(1, 101), 127, 256, 4096, 65536):
            with self.subTest(step=step):

                async def chunks():
                    for offset in range(0, len(body), step):
                        yield body[offset : offset + step]

                uploads = await multipart_uploads(
                    self.request(chunks),
                    max_files=1,
                    max_file_bytes=len(payload),
                    max_body_bytes=len(body),
                )
                try:
                    self.assertEqual(len(uploads), 1)
                    self.assertEqual(uploads[0][0], "files")
                    self.assertEqual(await uploads[0][1].read(), payload)
                finally:
                    for _, upload in uploads:
                        await upload.close()

    async def test_small_limit_stops_receiving_and_closes_every_spooled_file(self):
        body = envelope(b"x" * (1024 * 1024))
        consumed = 0
        files = []
        original = tempfile.SpooledTemporaryFile
        with tempfile.TemporaryDirectory() as temporary:

            def spool(**kwargs):
                stream = original(max_size=32, mode="w+b", dir=temporary)
                files.append(stream)
                return stream

            async def chunks():
                nonlocal consumed
                for offset in range(0, len(body), 64):
                    consumed += 64
                    yield body[offset : offset + 64]

            with patch("mio_server.api.uploads.tempfile.SpooledTemporaryFile", side_effect=spool):
                with self.assertRaisesRegex(ValueError, "size limit"):
                    await multipart_uploads(
                        self.request(chunks),
                        max_files=1,
                        max_file_bytes=96,
                        max_body_bytes=len(body),
                    )
            self.assertLess(consumed, 1024)
            self.assertTrue(files and all(stream.closed for stream in files))
            self.assertEqual(list(Path(temporary).iterdir()), [])

    async def test_disconnect_or_cancellation_cleans_disk_backed_temporary_files(self):
        from starlette.requests import ClientDisconnect

        body = envelope(b"x" * 4096)
        original = tempfile.SpooledTemporaryFile
        for failure in (asyncio.CancelledError, ClientDisconnect):
            files = []
            with self.subTest(failure=failure.__name__), tempfile.TemporaryDirectory() as temporary:

                def spool(**kwargs):
                    stream = original(max_size=32, mode="w+b", dir=temporary)
                    files.append(stream)
                    return stream

                async def chunks():
                    yield body[:1024]
                    raise failure()

                with patch(
                    "mio_server.api.uploads.tempfile.SpooledTemporaryFile", side_effect=spool
                ):
                    with self.assertRaises(failure):
                        await multipart_uploads(
                            self.request(chunks),
                            max_files=1,
                            max_file_bytes=len(body),
                            max_body_bytes=len(body),
                        )
                self.assertTrue(files and all(stream.closed for stream in files))
                self.assertEqual(list(Path(temporary).iterdir()), [])
