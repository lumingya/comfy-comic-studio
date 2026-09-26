"""Export image profiles: lossless scrubbing, lightweight publishing and the ZIP / PDF / HTTP contract."""

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, PngImagePlugin

from backend.mio_export import pdf, portable_zip, read_export_body, stream_export, export_filename
from backend.mio_export_images import (
    PUBLISH_MAX_EDGE,
    PreparedImage,
    exif_orientation,
    metadata_keys,
    minimal_exif,
    prepare,
    profile_summary,
    resolve_profile,
    strip_metadata,
)
from backend.mio_library import LibraryError


def comfy_png(size=(96, 64), workflow=None):
    """A PNG the way ComfyUI's SaveImage writes it: prompt + workflow tEXt chunks."""
    image = Image.radial_gradient("L").convert("RGB").resize(size)
    info = PngImagePlugin.PngInfo()
    info.add_text("prompt", json.dumps({"3": {"class_type": "KSampler", "inputs": {"seed": 7, "text": "secret positive prompt"}}}))
    info.add_text("workflow", json.dumps(workflow or {"nodes": [{"type": "CheckpointLoaderSimple", "widgets_values": ["private-model.safetensors"]}]}))
    buffer = io.BytesIO()
    image.save(buffer, "PNG", pnginfo=info)
    return buffer.getvalue()


def pixels(raw):
    with Image.open(io.BytesIO(raw)) as image:
        return image.size, image.tobytes()


class MetadataScrubbingTests(unittest.TestCase):
    def test_png_workflow_and_prompt_chunks_are_removed_losslessly(self):
        raw = comfy_png()
        self.assertEqual(metadata_keys(raw), ["tEXt:prompt", "tEXt:workflow"])
        self.assertIn(b"private-model.safetensors", raw)
        clean, removed = strip_metadata(raw)
        self.assertEqual(removed, ["tEXt:prompt", "tEXt:workflow"])
        self.assertNotIn(b"private-model.safetensors", clean)
        self.assertNotIn(b"secret positive prompt", clean)
        self.assertEqual(metadata_keys(clean), [])
        self.assertEqual(pixels(clean), pixels(raw), "cleaning must never change a single pixel")
        self.assertEqual(strip_metadata(clean), (clean, []), "a clean file is returned unchanged, not rewritten")

    def test_jpeg_exif_and_comment_are_removed_but_orientation_survives(self):
        image = Image.radial_gradient("L").convert("RGB").resize((90, 60))
        exif = Image.Exif()
        exif[0x0112] = 6
        exif[0x010E] = "ImageDescription leak"
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=80, exif=exif.tobytes(), comment=b"parameters: masterpiece, secret lora")
        raw = buffer.getvalue()
        self.assertEqual(metadata_keys(raw), ["EXIF", "COM"])
        clean, removed = strip_metadata(raw)
        self.assertEqual(removed, ["EXIF", "COM"])
        self.assertNotIn(b"secret lora", clean)
        self.assertNotIn(b"ImageDescription leak", clean)
        self.assertEqual(pixels(clean), pixels(raw))
        with Image.open(io.BytesIO(clean)) as cleaned:
            self.assertEqual(cleaned.getexif().get(0x0112), 6)
        self.assertEqual(metadata_keys(clean), [], "the orientation-only block is not reported as metadata")
        self.assertEqual(strip_metadata(clean), (clean, []))

    def test_progressive_jpeg_scans_are_preserved(self):
        image = Image.radial_gradient("L").convert("RGB").resize((70, 50))
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=80, progressive=True, comment=b"hidden")
        raw = buffer.getvalue()
        clean, removed = strip_metadata(raw)
        self.assertEqual(removed, ["COM"])
        self.assertNotIn(b"hidden", clean)
        self.assertEqual(pixels(clean), pixels(raw))

    def test_webp_exif_and_xmp_are_removed(self):
        image = Image.radial_gradient("L").convert("RGBA").resize((64, 48))
        exif = Image.Exif()
        exif[0x0112] = 8
        exif[0x0131] = "ComfyUI 0.3"  # Software tag: a real EXIF block, not the orientation-only one
        buffer = io.BytesIO()
        image.save(buffer, "WEBP", quality=80, exif=exif.tobytes(), xmp=b"<x:xmpmeta>leak</x:xmpmeta>")
        raw = buffer.getvalue()
        self.assertEqual(metadata_keys(raw), ["EXIF", "XMP"])
        clean, removed = strip_metadata(raw)
        self.assertEqual(removed, ["EXIF", "XMP"])
        self.assertNotIn(b"xmpmeta", clean)
        self.assertNotIn(b"ComfyUI 0.3", clean)
        self.assertEqual(pixels(clean), pixels(raw))
        with Image.open(io.BytesIO(clean)) as cleaned:
            self.assertEqual(cleaned.getexif().get(0x0112), 8)
        self.assertEqual(metadata_keys(clean), [])
        upright = io.BytesIO()
        only_orientation = Image.Exif()
        only_orientation[0x0112] = 3
        image.save(upright, "WEBP", quality=80, exif=only_orientation.tobytes())
        self.assertEqual(metadata_keys(upright.getvalue()), [], "an orientation-only EXIF block is not private data")
        plain = io.BytesIO()
        image.convert("RGB").save(plain, "WEBP", quality=80)
        self.assertEqual(strip_metadata(plain.getvalue()), (plain.getvalue(), []))

    def test_minimal_exif_round_trips_every_orientation(self):
        for orientation in range(1, 9):
            self.assertEqual(exif_orientation(minimal_exif(orientation)), orientation)
        self.assertEqual(exif_orientation(b"garbage"), 1)

    def test_profile_resolution(self):
        self.assertEqual(resolve_profile(None), "clean")
        self.assertEqual(resolve_profile("auto"), "clean")
        self.assertEqual(resolve_profile("archive"), "archive")
        self.assertEqual(resolve_profile("publish"), "publish")
        for bad in ("lossy", 3, "", None):
            if bad in ("", None):
                self.assertEqual(resolve_profile(bad, "archive"), "archive")
                continue
            with self.assertRaises(LibraryError):
                resolve_profile(bad)


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, raw):
        path = self.root / name
        path.write_bytes(raw)
        return path

    def test_archive_keeps_bytes_and_metadata(self):
        raw = comfy_png()
        prepared = prepare(self.write("a.png", raw), "archive")
        self.assertEqual(prepared.data, raw)
        self.assertEqual(prepared.suffix, ".png")
        self.assertFalse(prepared.scrubbed)

    def test_clean_keeps_format_and_resolution(self):
        raw = comfy_png((120, 80))
        prepared = prepare(self.write("a.png", raw), "clean")
        self.assertEqual(prepared.suffix, ".png")
        self.assertEqual(prepared.removed, ["tEXt:prompt", "tEXt:workflow"])
        self.assertFalse(prepared.recompressed)
        self.assertEqual(pixels(prepared.data), pixels(raw))

    def test_publish_recompresses_to_webp_and_bounds_the_long_edge(self):
        big = Image.new("RGB", (PUBLISH_MAX_EDGE + 1440, 1000), "teal")
        info = PngImagePlugin.PngInfo()
        info.add_text("workflow", "{}")
        buffer = io.BytesIO()
        big.save(buffer, "PNG", pnginfo=info)
        prepared = prepare(self.write("big.png", buffer.getvalue()), "publish")
        self.assertEqual((prepared.suffix, prepared.mime), (".webp", "image/webp"))
        self.assertTrue(prepared.recompressed)
        self.assertEqual(prepared.removed, ["tEXt:workflow"])
        self.assertLess(len(prepared.data), len(buffer.getvalue()))
        with Image.open(io.BytesIO(prepared.data)) as image:
            self.assertEqual(image.format, "WEBP")
            self.assertEqual(max(image.size), PUBLISH_MAX_EDGE)
        self.assertEqual(metadata_keys(prepared.data), [])

    def test_publish_never_inflates_an_already_compact_jpeg(self):
        image = Image.effect_noise((320, 240), 64).convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=15, comment=b"tiny")
        raw = buffer.getvalue()
        prepared = prepare(self.write("tiny.jpg", raw), "publish")
        self.assertEqual(prepared.suffix, ".jpg", "a heavier WebP is rejected; the cleaned JPEG is kept")
        self.assertFalse(prepared.recompressed)
        self.assertEqual(prepared.removed, ["COM"])
        self.assertNotIn(b"tiny", prepared.data)
        self.assertLessEqual(len(prepared.data), len(raw))
        self.assertEqual(pixels(prepared.data), pixels(raw))

    def test_publish_for_pdf_yields_jpeg_without_exif(self):
        raw = comfy_png((300, 200))
        prepared = prepare(self.write("a.png", raw), "publish", pdf=True)
        self.assertEqual(prepared.mime, "image/jpeg")
        with Image.open(io.BytesIO(prepared.data)) as image:
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(image.size, (300, 200))
        self.assertEqual(metadata_keys(prepared.data), [])

    def test_svg_passes_through_every_profile(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
        path = self.write("a.svg", svg)
        for profile in ("archive", "clean", "publish"):
            prepared = prepare(path, profile)
            self.assertEqual((prepared.data, prepared.suffix), (svg, ".svg"))

    def test_summary_wording(self):
        self.assertIn("保留图片内嵌的工作流", profile_summary("archive", []))
        published = [PreparedImage(b"x" * 10, ".webp", "image/webp", 100, ["tEXt:workflow"], True)]
        text = profile_summary("publish", published)
        self.assertIn("1 张图片内嵌的工作流", text)
        self.assertIn("100 B → 10 B", text)
        self.assertIn("分辨率与编码与原图一致", profile_summary("clean", []))


class PortableExportProfileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "frame.png"
        self.source.write_bytes(comfy_png((160, 120)))
        self.book = {"title": "隐私画册"}
        self.frames = [({"name": "第一幕", "caption": "台词"}, self.source), ({"name": "第二幕", "caption": ""}, None)]

    def zip_entries(self, profile):
        target = self.root / (profile + ".zip")
        portable_zip([(self.book, self.frames)], target, profile)
        with zipfile.ZipFile(target) as archive:
            self.assertIsNone(archive.testzip())
            names = archive.namelist()
            images = {name: archive.read(name) for name in names if name.startswith("images/")}
            return names, images, archive.read("README.txt").decode(), archive.read("index.html").decode()

    def test_archive_zip_keeps_original_bytes_including_workflow(self):
        names, images, readme, html = self.zip_entries("archive")
        self.assertEqual(list(images), ["images/001-0001.png"])
        self.assertEqual(images["images/001-0001.png"], self.source.read_bytes())
        self.assertIn(b"private-model.safetensors", images["images/001-0001.png"])
        self.assertIn("保留图片内嵌的工作流", readme)
        self.assertIn('src="images/001-0001.png"', html)

    def test_clean_zip_scrubs_workflow_but_keeps_png_pixels(self):
        names, images, readme, html = self.zip_entries("clean")
        data = images["images/001-0001.png"]
        self.assertNotIn(b"private-model.safetensors", data)
        self.assertNotIn(b"secret positive prompt", data)
        self.assertEqual(pixels(data), pixels(self.source.read_bytes()))
        self.assertIn("已移除 1 张图片内嵌的工作流", readme)
        self.assertIn("尚未生成图片", html)

    def test_publish_zip_ships_webp_without_metadata(self):
        names, images, readme, html = self.zip_entries("publish")
        self.assertEqual(list(images), ["images/001-0001.webp"])
        data = images["images/001-0001.webp"]
        self.assertEqual(data[:4], b"RIFF")
        self.assertNotIn(b"KSampler", data)
        self.assertEqual(metadata_keys(data), [])
        self.assertLess(len(data), self.source.stat().st_size)
        self.assertIn('src="images/001-0001.webp"', html)
        self.assertIn("轻量发布", readme)

    def test_pdf_publish_and_clean_do_not_embed_jpeg_comments(self):
        image = Image.radial_gradient("L").convert("RGB").resize((200, 140))
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=90, comment=b"parameters: secret lora recipe")
        jpeg = self.root / "photo.jpg"
        jpeg.write_bytes(buffer.getvalue())
        frames = [({}, jpeg), ({}, self.source)]
        archive_pdf = self.root / "archive.pdf"
        pdf([({}, frames)], archive_pdf, "archive")
        self.assertIn(b"secret lora recipe", archive_pdf.read_bytes(), "archive mirrors the stored JPEG bytes")
        for profile in ("clean", "publish"):
            target = self.root / (profile + ".pdf")
            pdf([({}, frames)], target, profile)
            raw = target.read_bytes()
            self.assertTrue(raw.startswith(b"%PDF-1.4"))
            self.assertIn(b"/Count 2", raw)
            self.assertNotIn(b"secret lora recipe", raw)
            self.assertNotIn(b"private-model.safetensors", raw)

    def test_stream_export_validates_profile_and_reports_it(self):
        store = SimpleNamespace(
            entity=lambda *_: {"document": {"title": "t", "totalSteps": 1, "steps": [{"stepIndex": 0, "image": "/images/x.png"}]}},
            image_path=lambda _: self.source,
        )
        replies = []
        handler = SimpleNamespace(send_json=lambda status, body: replies.append((status, body)))
        stream_export(handler, store, {"format": "zip", "albumIds": ["book"], "validateOnly": True})
        self.assertEqual(replies[-1], (200, {"ready": True, "imageProfile": "clean"}))
        stream_export(handler, store, {"format": "zip", "albumIds": ["book"], "imageProfile": "publish", "validateOnly": True})
        self.assertEqual(replies[-1][1]["imageProfile"], "publish")
        with self.assertRaises(LibraryError) as failure:
            stream_export(handler, store, {"format": "zip", "albumIds": ["book"], "imageProfile": "lossy", "validateOnly": True})
        self.assertIn("图片处理方式", str(failure.exception))

    def test_form_body_carries_the_profile_and_filenames_label_non_archive_exports(self):
        body = b"format=zip&albumIds=%5B%22a%22%5D&imageProfile=publish&_csrf=token"
        handler = SimpleNamespace(
            headers={"Content-Type": "application/x-www-form-urlencoded", "Content-Length": str(len(body))},
            rfile=io.BytesIO(body),
        )
        self.assertEqual(read_export_body(handler), {"format": "zip", "albumIds": ["a"], "imageProfile": "publish"})
        handler.rfile = io.BytesIO(b"format=pdf&albumIds=%5B%5D")
        handler.headers["Content-Length"] = str(len(b"format=pdf&albumIds=%5B%5D"))
        self.assertEqual(read_export_body(handler)["imageProfile"], "auto")
        books = [({"title": "海风"}, [])]
        self.assertRegex(export_filename(books, "zip"), r"^海风_\d+\.zip$")
        self.assertRegex(export_filename(books, "zip", "publish"), r"^海风_轻量发布_\d+\.zip$")
        self.assertRegex(export_filename(books, "pdf", "clean"), r"^海风_无损清洗_\d+\.pdf$")


if __name__ == "__main__":
    unittest.main()
