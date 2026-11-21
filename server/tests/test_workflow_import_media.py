"""Synthetic image containers and graphs only: import review never stores or executes assets."""

import copy
import io
import json
import struct
import unittest
import zlib
from unittest import mock

from PIL import Image, PngImagePlugin

from mio_server.comfy import inspection as I
from mio_server.comfy import workflow_import as W

from .api_harness import ApiCase
from .test_bindings import plain_sdxl


def png(metadata=None, *, compressed=False, international=False):
    info = PngImagePlugin.PngInfo()
    for key, value in (metadata or {}).items():
        text = json.dumps(value)
        if international:
            info.add_itxt(key, text, zip=compressed)
        else:
            info.add_text(key, text, zip=compressed)
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, "PNG", pnginfo=info)
    return buffer.getvalue()


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def webp(metadata):
    exif = Image.Exif()
    for key, value in metadata.items():
        exif[{"prompt": 0x0110, "workflow": 0x010F}[key]] = key + ":" + json.dumps(value)
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, "WEBP", exif=exif.tobytes())
    return buffer.getvalue()


class WorkflowDecodeTests(unittest.TestCase):
    def test_json_graph_envelopes_and_api_names_remain_intact(self):
        graph = plain_sdxl()
        for value in (graph, {"prompt": graph}, {"prompt": graph, "workflow": {"nodes": []}}):
            before = copy.deepcopy(value)
            self.assertEqual(W.normalize_workflow(value), {"graph": graph})
            self.assertEqual(value, before)
        package = {"graph": graph, "name": "Synthetic", "config": {"values": {"seed": 5}}}
        self.assertEqual(W.decode_workflow_bytes(json.dumps(package).encode()), package)
        named = {
            key: {"class_type": "Literal", "inputs": {"value": 1}}
            for key in ("graph", "prompt", "workflow")
        }
        self.assertEqual(W.normalize_workflow(named), {"graph": named})

    def test_bom_json_and_prompt_envelope_inspection_share_decoder(self):
        graph = plain_sdxl()
        self.assertEqual(
            W.decode_workflow_bytes(b"\xef\xbb\xbf" + json.dumps(graph).encode())["graph"], graph
        )
        result = I.inspect(I.InspectRequest(workflow={"prompt": graph}))
        self.assertEqual(result.format, "api")
        self.assertTrue(result.importable)
        self.assertTrue(result.compilable)

    def test_png_text_compressed_and_international_metadata(self):
        graph = plain_sdxl()
        for compressed in (False, True):
            for international in (False, True):
                with self.subTest(compressed=compressed, international=international):
                    content = png(
                        {"workflow": {"nodes": []}, "prompt": graph},
                        compressed=compressed,
                        international=international,
                    )
                    with mock.patch.object(Image, "open", side_effect=AssertionError("pixels")):
                        self.assertEqual(W.decode_workflow_bytes(content), {"graph": graph})

    def test_modern_comf_chunk_after_pixels_is_extracted(self):
        graph = plain_sdxl()
        original = png()
        content = (
            original[:-12]
            + chunk(b"comf", b"prompt\0" + json.dumps(graph).encode("ascii"))
            + original[-12:]
        )
        self.assertEqual(W.decode_workflow_bytes(content), {"graph": graph})

    def test_webp_uses_prompt_exif_before_frontend_workflow(self):
        graph = plain_sdxl()
        content = webp({"workflow": {"nodes": []}, "prompt": graph})
        with mock.patch.object(Image, "open", side_effect=AssertionError("pixels")):
            self.assertEqual(W.decode_workflow_bytes(content), {"graph": graph})

    def test_ui_only_is_reviewable_with_counts_dynamic_warning_and_steps(self):
        ui = {
            "nodes": [
                {"id": 1, "type": "Anything Everywhere", "mode": 4},
                {"id": 2, "type": "Sampler", "mode": 2},
            ],
            "links": [[1, 1, 0, 2, 0, "MODEL"]],
            "definitions": {"subgraphs": [{"id": "synthetic"}]},
        }
        for content in (png({"workflow": ui}), webp({"workflow": ui})):
            package = W.decode_workflow_bytes(content)
            report = I.inspect(I.InspectRequest(workflow=package))
            self.assertEqual(report.format, "ui")
            self.assertFalse(report.importable)
            self.assertIn("导出工作流 (API)", report.issues[0].message)
            self.assertTrue(any(i.code == "frontend_graph" for i in report.issues))
            self.assertIn("2 个节点、1 条连线", report.issues[1].message)

    def test_no_metadata_incomplete_containers_and_bad_json_fail_clearly(self):
        for content in (
            png(),
            png({"prompt": plain_sdxl()})[:-15],
            webp({"prompt": plain_sdxl()})[:-4],
            b"not json or an image",
            b"[]",
            b"{}",
            b'{"secret-prompt":"private",',
            b'{"1":{"class_type":"X","inputs":{"value":NaN}}}',
        ):
            with self.subTest(content=content[:8]):
                with self.assertRaises(W.WorkflowDecodeError) as error:
                    W.decode_workflow_bytes(content)
                self.assertNotIn("secret-prompt", str(error.exception))
                self.assertNotIn("private", str(error.exception))

    def test_metadata_decompression_and_combined_limits_are_bounded(self):
        for content in (
            png({"prompt": {"text": "x" * 200}}, compressed=True),
            png({"prompt": {"text": "x" * 70}, "workflow": {"text": "y" * 70}}),
            webp({"prompt": {"text": "x" * 200}}),
        ):
            with mock.patch.object(W, "MAX_METADATA_BYTES", 100):
                with self.assertRaises(W.WorkflowDecodeError):
                    W.decode_workflow_bytes(content)

    def test_corrupt_metadata_checksum_duplicate_keys_and_huge_dimensions_rejected(self):
        base = png()
        text = chunk(b"tEXt", b"prompt\0{}")
        bad_crc = text[:-1] + bytes([text[-1] ^ 1])
        duplicate = base[:-12] + text + text + base[-12:]
        oversized = (
            W.PNG_SIGNATURE
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 100_000, 100_000, 8, 2, 0, 0, 0))
            + chunk(b"IEND", b"")
        )
        for content in (base[:-12] + bad_crc + base[-12:], duplicate, oversized):
            with self.assertRaises(W.WorkflowDecodeError):
                W.decode_workflow_bytes(content)

    def test_invalid_graph_diagnostic_does_not_echo_literal_values(self):
        report = I.inspect(
            I.InspectRequest(workflow={"1": {"inputs": {"secret": "private-marker"}}})
        )
        self.assertFalse(report.importable)
        self.assertNotIn("private-marker", report.model_dump_json())

    def test_image_candidates_keep_reference_control_init_and_mask_manual(self):
        graph = {
            "1": {"class_type": "AnyImageLoader", "inputs": {"image": "synthetic.png"}},
            "2": {
                "class_type": "AnyControl",
                "inputs": {"image": ["1", 0], "control_net": ["5", 0]},
            },
            "3": {"class_type": "AnyEncoder", "inputs": {"pixels": ["1", 0]}},
            "4": {"class_type": "AnyMask", "inputs": {"mask": ["1", 1]}},
        }
        candidates = I._candidates(graph, set(), None)
        self.assertEqual(
            {(item.kind, item.node, item.field) for item in candidates},
            {(kind, "1", "image") for kind in ("ref", "control", "init", "mask")},
        )
        self.assertTrue(all(item.source == "candidate" for item in candidates))


class WorkflowMediaApiTests(ApiCase):
    def test_raw_review_has_no_persistent_or_network_side_effects(self):
        before = len(self.ctx.store.list_docs("workflow"))
        content = png({"prompt": plain_sdxl()})
        with mock.patch.object(
            self.ctx, "comfy_client_factory", side_effect=AssertionError("network")
        ):
            report = self.ok(
                self.client.post(
                    "/api/workflows/inspect-file",
                    content=content,
                    headers={"Content-Type": "application/octet-stream"},
                )
            )
        self.assertTrue(report["inspection"]["importable"])
        self.assertEqual(report["workflow"]["graph"], plain_sdxl())
        self.assertEqual(len(self.ctx.store.list_docs("workflow")), before)
        self.assertEqual(self.ctx.engine.list(), [])

    def test_ui_only_and_missing_metadata_return_review_without_save_payload(self):
        for content, expected in ((png({"workflow": {"nodes": []}}), "ui"), (png(), "invalid")):
            result = self.ok(self.client.post("/api/workflows/inspect-file", content=content))
            self.assertIsNone(result["workflow"])
            self.assertEqual(result["inspection"]["format"], expected)
            self.assertFalse(result["inspection"]["importable"])

    def test_api_prompt_wrapper_can_be_imported_and_patched_consistently(self):
        graph = plain_sdxl()
        doc = self.ok(
            self.client.post(
                "/api/workflows", json={"name": "Synthetic", "graph": {"prompt": graph}}
            ),
            201,
        )
        self.assertEqual(doc["graph"], graph)
        patched = self.ok(
            self.client.patch(f"/api/workflows/{doc['id']}", json={"graph": {"prompt": graph}})
        )
        self.assertEqual(patched["graph"], graph)

    def test_invalid_import_error_is_actionable_without_echoing_node_literals(self):
        response = self.client.post(
            "/api/workflows",
            json={"name": "Synthetic", "graph": {"1": {"inputs": {"text": "private-marker"}}}},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("API", response.json()["detail"])
        self.assertNotIn("private-marker", response.text)

    def test_public_inspect_file_uses_same_authenticated_operation(self):
        content = webp({"prompt": plain_sdxl()})
        anonymous = self.client.post("/api/v2/workflows/inspect-file", content=content)
        self.assertEqual(anonymous.status_code, 401)
        issued = self.ok(
            self.client.post("/api/tokens", json={"name": "Synthetic", "scopes": ["write"]}),
            201,
        )
        result = self.ok(
            self.client.post(
                "/api/v2/workflows/inspect-file",
                content=content,
                headers={"Authorization": "Bearer " + issued["token"]},
            )
        )
        self.assertTrue(result["inspection"]["importable"])
