"""Real HTML export/import projections, pixels, bounded parsing and atomic publication."""

from __future__ import annotations

import base64
import copy
import io
import json
from html.parser import HTMLParser
from unittest.mock import patch

from PIL import Image

from mio_server import album_import as I
from mio_server import album_interchange as A
from mio_server.album.render import AlbumOptions, Book, Frame, render_album
from mio_server.album.templates import builtin_templates
from mio_server.models import Dialogue, Episode, Panel, PanelOverrides, Series, Strip, Take

from .api_harness import ApiCase

CURATED = {
    "export-monograph",
    "export-nocturne",
    "export-folio",
    "export-zine",
    "export-contact-sheet",
}


def png(color=(255, 0, 0, 127), size=(80, 64)):
    output = io.BytesIO()
    im = Image.new("RGBA", size, color)
    im.putpixel((1, 1), (13, 29, 71, 0))
    im.save(output, format="PNG")
    return output.getvalue()


def url(data):
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


class Extract(HTMLParser):
    def __init__(self, document):
        super().__init__()
        self.assets = {}
        self.raw = ""
        self.active = False
        self.feed(document)
        self.payload = json.loads(self.raw)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "img" and "data-mio-asset" in attrs:
            self.assets[attrs["data-mio-asset"]] = attrs["src"]
        if tag == "script" and attrs.get("id") == "mio-album-data":
            self.active = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.raw += data


def html(payload, assets=None, extra=""):
    images = "".join(
        f'<img data-mio-asset="{key}" src="{value}">' for key, value in (assets or {}).items()
    )
    text = json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")
    return f'{images}{extra}<script id="mio-album-data" type="application/json">{text}</script>'


def payload():
    return {
        "schema": "mio.album-html.v1",
        "books": [
            {
                "album": {
                    "title": "Imported book",
                    "synopsis": "",
                    "totalSteps": 1,
                    "steps": [
                        {
                            "stepIndex": 0,
                            "name": "frame",
                            "caption": "caption",
                            "prompt": "raw",
                            "image": {"$mioImage": "a"},
                        }
                    ],
                },
                "storyboard": None,
            }
        ],
    }


class HTMLAlbumImportTests(ApiCase):
    def upload(self, document, expected=201):
        response = self.client.post(
            "/api/imports/album-html",
            content=document.encode("utf-8"),
            headers={"Content-Type": "application/octet-stream"},
        )
        return self.ok(response, expected)

    def assert_pixels(self, asset_id, data):
        with (
            Image.open(self.ctx.assets.path(asset_id)) as actual,
            Image.open(io.BytesIO(data)) as expected,
        ):
            self.assertEqual(actual.size, expected.size)
            self.assertEqual(actual.convert("RGBA").tobytes(), expected.convert("RGBA").tobytes())

    def source_episode(self):
        series = self.ctx.store.create_series(Series(title="Book & original"))
        episode = Episode(series_id=series.id, title="Story title", order=0, synopsis="Synopsis")
        first = self.ctx.assets.put(png(size=(320, 200)))
        second = self.ctx.assets.put(png((0, 31, 200, 255), size=(320, 260)))
        for order, asset in enumerate((first, second, first)):
            panel = Panel(
                order=order,
                description=f"Name {order}",
                dialogues=[
                    Dialogue(text=f"Caption {order} <script> & {{literal}}", kind="narration")
                ],
                overrides=PanelOverrides(raw_prompt=f"positive {order} & <details>"),
            )
            episode.panels.append(panel)
            episode.takes.append(Take(panel_id=panel.id, asset_id=asset.id, status="adopted"))
        self.ctx.store.create_episode(episode)
        return series, episode

    def test_five_native_exports_reimport_every_projected_field_and_rgba_pixel(self):
        _, episode = self.source_episode()
        for template_id in sorted(CURATED):
            with self.subTest(template_id):
                response = self.client.post(
                    "/api/export/album",
                    json={
                        "episode_ids": [episode.id],
                        "template_id": template_id,
                        "image_profile": "archive",
                        "lettered": False,
                        "include_source_data": True,
                        "show_captions": False,
                        "show_prompts": False,
                    },
                )
                self.assertEqual(response.status_code, 200, response.text[:1000])
                original = Extract(response.text)
                result = self.upload(response.text)
                self.assertTrue(result["source_data_used"])
                self.assertEqual(result["imported_assets"], 2)
                self.assertEqual(result["imported_frames"], 3)
                restored = self.ctx.store.get_episode(result["episode_ids"][0])
                series = self.ctx.store.get_series(result["series_ids"][0])
                book = original.payload["sourceData"]["books"][0]
                self.assertEqual(series.title, book["title"])
                self.assertEqual(restored.title, book["storyTitle"] or book["title"])
                self.assertEqual(restored.synopsis, book["synopsis"])
                self.assertEqual(restored.album_source.character_name, book["characterName"])
                for panel, frame in zip(restored.panels, book["frames"]):
                    exact = panel.album_source.model_dump(
                        by_alias=True,
                        exclude={
                            "mapped_description",
                            "mapped_caption",
                            "mapped_prompt",
                            "mapped_asset_id",
                        },
                        exclude_none=True,
                    )
                    self.assertEqual(exact, frame)
                    self.assertEqual(panel.description, frame["name"])
                    self.assertEqual(panel.dialogues[0].text, frame["caption"])
                    self.assertEqual(panel.overrides.raw_prompt, frame["prompt"])
                    take = restored.adopted(panel.id)
                    data = base64.b64decode(
                        original.assets[frame["image"]["$mioImage"]].split(",", 1)[1]
                    )
                    self.assert_pixels(take.asset_id, data)

    def test_explicit_source_keeps_hidden_text_default_legacy_warns(self):
        book = Book("Book", [Frame(url(png()), caption="private caption", prompt="private prompt")])
        template = next(t for t in builtin_templates() if t.id == "export-monograph")
        default = render_album(template, [book], AlbumOptions(show_captions=False))
        metadata = Extract(default).payload
        self.assertNotIn("sourceData", metadata)
        self.assertNotIn("private caption", default)
        self.assertNotIn("private prompt", default)
        result = self.upload(default)
        self.assertFalse(result["source_data_used"])
        self.assertTrue(result["warnings"])
        panel = self.ctx.store.get_episode(result["episode_ids"][0]).panels[0]
        self.assertEqual(panel.dialogues, [])
        self.assertEqual(panel.overrides.raw_prompt, "")
        included = render_album(
            template, [book], AlbumOptions(show_captions=False, include_source_data=True)
        )
        result = self.upload(included)
        panel = self.ctx.store.get_episode(result["episode_ids"][0]).panels[0]
        self.assertEqual(panel.dialogues[0].text, "private caption")
        self.assertEqual(panel.overrides.raw_prompt, "private prompt")

    def test_exact_whitespace_braces_and_names_survive_import_and_reexport(self):
        template = next(t for t in builtin_templates() if t.id == "export-monograph")
        book = Book(
            "  Title  ",
            [
                Frame(
                    url(png()),
                    name="  Frame  ",
                    caption=" \n{{literal}} {unknown}  ",
                    prompt="  {{positive}} {unknown}  ",
                    width=80,
                    height=64,
                )
            ],
            synopsis="  Synopsis \n",
            character_name="  Cast  ",
            story_title="  Chapter  ",
        )
        document = render_album(template, [book], AlbumOptions(include_source_data=True))
        imported = self.upload(document)
        response = self.client.post(
            "/api/export/album",
            json={
                "episode_ids": imported["episode_ids"],
                "template_id": template.id,
                "include_source_data": True,
                "image_profile": "archive",
                "lettered": False,
            },
        )
        self.assertEqual(response.status_code, 200, response.text[:1000])
        before = Extract(document).payload["sourceData"]["books"][0]
        after = Extract(response.text).payload["sourceData"]["books"][0]
        before["frames"][0].pop("image")
        after["frames"][0].pop("image")
        self.assertEqual(after, before)

    def test_complete_composition_restores_raster_strip(self):
        template = next(t for t in builtin_templates() if t.id == "export-folio")
        book = Book(
            "Canvas",
            [
                Frame(
                    url(png(size=(320, 100))), width=320, height=100, source_region=(0, 0, 320, 100)
                ),
                Frame(
                    url(png((0, 2, 5, 255), size=(320, 120))),
                    width=320,
                    height=120,
                    source_region=(0, 100, 320, 220),
                ),
            ],
            composition={"width": 320, "height": 220},
        )
        result = self.upload(render_album(template, [book], AlbumOptions(include_source_data=True)))
        episode = self.ctx.store.get_episode(result["episode_ids"][0])
        self.assertTrue(episode.strip.rasterized)
        self.assertEqual((episode.strip.width, episode.strip.height), (320, 220))
        self.assertEqual(
            list(episode.strip.panel_boxes.values()), [(0, 0, 320, 100), (0, 100, 320, 220)]
        )

    def test_native_saved_composition_reimports_and_reexports_identical_canvas_pixels(self):
        _, episode = self.source_episode()
        episode.strip = Strip(
            width=320,
            height=640,
            manual=True,
            margin=0,
            panel_boxes={
                episode.panels[0].id: (0, 0, 320, 200),
                episode.panels[1].id: (0, 200, 320, 460),
                episode.panels[2].id: (0, 460, 320, 640),
            },
        )
        self.ctx.store.save_episode(episode)
        exported = self.client.post(
            "/api/export/album",
            json={
                "episode_ids": [episode.id],
                "include_source_data": True,
                "image_profile": "archive",
            },
        )
        self.assertEqual(exported.status_code, 200, exported.text[:1000])
        original = Extract(exported.text)
        result = self.upload(exported.text)
        restored = self.ctx.store.get_episode(result["episode_ids"][0])
        self.assertTrue(restored.strip.rasterized)
        composition = original.payload["sourceData"]["books"][0]["composition"]
        self.assertEqual(
            (restored.strip.width, restored.strip.height),
            (composition["width"], composition["height"]),
        )
        exported_again = self.client.post(
            "/api/export/album",
            json={
                "episode_ids": result["episode_ids"],
                "include_source_data": True,
                "image_profile": "archive",
            },
        )
        self.assertEqual(exported_again.status_code, 200, exported_again.text[:1000])
        repeated = Extract(exported_again.text)
        old_frames = original.payload["sourceData"]["books"][0]["frames"]
        new_frames = repeated.payload["sourceData"]["books"][0]["frames"]
        self.assertEqual(len(old_frames), len(new_frames))
        for before, after in zip(old_frames, new_frames):
            old_image = base64.b64decode(
                original.assets[before["image"]["$mioImage"]].split(",", 1)[1]
            )
            new_image = base64.b64decode(
                repeated.assets[after["image"]["$mioImage"]].split(",", 1)[1]
            )
            with Image.open(io.BytesIO(old_image)) as old, Image.open(io.BytesIO(new_image)) as new:
                self.assertEqual(old.size, new.size)
                self.assertEqual(old.convert("RGBA").tobytes(), new.convert("RGBA").tobytes())

    def test_missing_frame_has_no_asset_and_small_chunks_are_supported(self):
        item = payload()
        item["books"][0]["album"]["steps"][0]["image"] = ""
        with patch.object(I, "CHUNK_BYTES", 7):
            result = self.upload(html(item))
        episode = self.ctx.store.get_episode(result["episode_ids"][0])
        self.assertEqual(episode.takes, [])
        self.assertEqual(result["imported_assets"], 0)
        with patch.object(I, "CHUNK_BYTES", 7):
            result = self.upload(html(payload(), {"a": url(png())}))
        self.assertEqual(result["imported_assets"], 1)

    def test_actual_renderer_missing_svg_is_not_imported_as_artwork(self):
        template = next(t for t in builtin_templates() if t.id == "export-zine")
        document = render_album(template, [Book("Missing", [Frame("")])])
        result = self.upload(document)
        self.assertEqual(result["imported_assets"], 0)
        self.assertEqual(self.ctx.store.get_episode(result["episode_ids"][0]).takes, [])

    def test_composition_geometry_cannot_inflate_a_tiny_image_to_an_enormous_canvas(self):
        item = payload()
        item["books"][0]["album"]["composition"] = {"width": 320, "height": 10**30}
        item["books"][0]["album"]["steps"][0]["sourceRegion"] = [0, 0, 320, 10**30]
        self.upload(html(item, {"a": url(png())}), 400)

    def test_duplicate_same_image_key_bytes_and_different_keys_deduplicate(self):
        extra = f'<img data-mio-asset="a" src="{url(png())}">'
        result = self.upload(html(payload(), {"a": url(png())}, extra))
        self.assertEqual(result["imported_assets"], 1)
        item = payload()
        second = copy.deepcopy(item["books"][0]["album"]["steps"][0])
        second.update(stepIndex=1, image={"$mioImage": "b"})
        item["books"][0]["album"]["steps"].append(second)
        item["books"][0]["album"]["totalSteps"] = 2
        result = self.upload(html(item, {"a": url(png()), "b": url(png())}))
        episode = self.ctx.store.get_episode(result["episode_ids"][0])
        self.assertEqual(episode.takes[0].asset_id, episode.takes[1].asset_id)
        self.assertEqual(result["imported_assets"], 1)

    def test_rejects_ambiguous_json_schema_refs_geometry_and_unsafe_asset_sources(self):
        original = payload()
        samples = [
            html(original),
            html(original, {"a": "https://invalid.example/image.png"}),
            html(original, {"a": "../../private.png"}),
            html(original, {"a": "data:image/png;base64,%%%"}),
            html(original, {"a": "data:image/jpeg;base64," + base64.b64encode(png()).decode()}),
            html(original, {"a": url(b"invalid image")}),
            html(
                original,
                {"a": url(png())},
                f'<img data-mio-asset="a" src="{url(png((1, 2, 3, 255)))}">',
            ),
            html(original, {"a": url(png())}) + html(original),
            html(original, {"a": url(png())}).replace(
                '"schema":', '"schema":"duplicate", "schema":', 1
            ),
            html(original, {"a": url(png())}).replace('"synopsis": ""', '"synopsis": NaN'),
            html(original, {"a": url(png())}).replace('"synopsis": ""', '"synopsis": 1e999'),
            html(original, {"a": url(png())}).replace('"synopsis": ""', '"synopsis": "\\ud800"'),
            html(original, {"a": url(png()), "unused": url(b"unreferenced invalid image")}),
            html(
                original,
                {
                    "a": url(png()),
                    "unused": "data:image/jpeg;base64," + base64.b64encode(png()).decode(),
                },
            ),
        ]
        for change in (
            {"width": -1, "height": 10},
            {"width": 81, "height": 64},
            {"sourceRegion": [0, 0, 1, 1]},
            {"image": {"$mioImage": "missing"}},
            {"image": "https://invalid.example/file"},
        ):
            item = copy.deepcopy(original)
            item["books"][0]["album"]["steps"][0].update(change)
            samples.append(html(item, {"a": url(png())}))
        before = len(self.ctx.store.list_series())
        assets_before = len(self.ctx.store._rows("SELECT id FROM assets"))
        for index, document in enumerate(samples):
            with self.subTest(index=index):
                self.upload(document, 400)
                self.assertEqual(len(self.ctx.store.list_series()), before)
                self.assertEqual(len(self.ctx.store._rows("SELECT id FROM assets")), assets_before)

    def test_xss_strings_remain_inert_and_do_not_trigger_network(self):
        item = payload()
        value = (
            '<script>fetch("https://invalid.example/private")</script><img src=x onerror=alert(1)>'
        )
        item["books"][0]["album"]["steps"][0]["caption"] = value
        item["books"][0]["album"]["steps"][0]["prompt"] = value
        result = self.upload(
            html(
                item,
                {"a": url(png())},
                '<script src="https://invalid.example/script">ignored</script>',
            )
        )
        panel = self.ctx.store.get_episode(result["episode_ids"][0]).panels[0]
        self.assertEqual(panel.album_source.caption, value)
        self.assertEqual(panel.overrides.raw_prompt, value)

    def test_upload_json_tag_asset_byte_and_pixel_limits_fail_without_writes(self):
        document = html(payload(), {"a": url(png())})
        for owner, setting, limit in (
            (A, "MAX_HTML_BYTES", 64),
            (A, "MAX_JSON_BYTES", 32),
            (A, "MAX_IMAGE_BYTES", 16),
            (A, "MAX_TOTAL_IMAGE_BYTES", 16),
            (A, "MAX_ASSETS", 0),
            (A, "MAX_IMAGE_PIXELS", 2),
        ):
            with self.subTest(setting=setting), patch.object(owner, setting, limit):
                before = len(self.ctx.store.list_series())
                self.upload(document, 400)
                self.assertEqual(len(self.ctx.store.list_series()), before)
        with patch.object(I, "MAX_TAG_BYTES", 32):
            self.upload('<div title="' + "x" * 100 + '">' + document, 400)
        item = payload()
        item["books"] *= 51
        self.upload(html(item, {"a": url(png())}), 400)
        item = payload()
        item["books"][0]["album"]["steps"] *= 10_001
        item["books"][0]["album"]["totalSteps"] = 10_001
        self.upload(html(item, {"a": url(png())}), 400)

    def test_late_store_failure_rolls_back_all_visible_books_and_keeps_shared_asset(self):
        existing = self.ctx.assets.put(png())
        path = self.ctx.assets.path(existing.id)
        item = payload()
        item["books"].append(copy.deepcopy(item["books"][0]))
        before = len(self.ctx.store.list_series())
        assets_before = len(self.ctx.store._rows("SELECT id FROM assets"))
        original = self.ctx.store.create_episode
        calls = []

        def fail_second(episode):
            calls.append(episode.id)
            if len(calls) == 2:
                raise ValueError("injected atomic write failure")
            return original(episode)

        with patch.object(self.ctx.store, "create_episode", side_effect=fail_second):
            self.upload(html(item, {"a": url(png())}), 400)
        self.assertEqual(len(self.ctx.store.list_series()), before)
        self.assertEqual(len(self.ctx.store._rows("SELECT id FROM assets")), assets_before)
        self.assertTrue(path.is_file())
        self.assert_pixels(existing.id, png())

    def test_new_asset_metadata_is_rolled_back_if_publication_fails(self):
        document = html(payload(), {"a": url(png())})
        before = len(self.ctx.store.list_series())
        assets_before = len(self.ctx.store._rows("SELECT id FROM assets"))
        with patch.object(
            self.ctx.store, "create_series", side_effect=ValueError("injected failure")
        ):
            self.upload(document, 400)
        self.assertEqual(len(self.ctx.store.list_series()), before)
        self.assertEqual(len(self.ctx.store._rows("SELECT id FROM assets")), assets_before)

    def test_editing_imported_fields_takes_precedence_over_exact_provenance(self):
        result = self.upload(html(payload(), {"a": url(png())}))
        episode = self.ctx.store.get_episode(result["episode_ids"][0])
        panel = episode.panels[0]
        panel.description = "edited frame"
        panel.dialogues = [Dialogue(text="edited caption", kind="narration")]
        panel.overrides.raw_prompt = "edited prompt"
        episode.title = "edited story"
        episode.synopsis = "edited synopsis"
        self.ctx.store.save_episode(episode)
        self.ctx.store.update_series(
            episode.series_id, lambda s: setattr(s, "title", "edited title")
        )
        response = self.client.post(
            "/api/export/album",
            json={
                "episode_ids": [episode.id],
                "include_source_data": True,
                "image_profile": "archive",
                "lettered": False,
            },
        )
        self.assertEqual(response.status_code, 200, response.text[:1000])
        book = Extract(response.text).payload["sourceData"]["books"][0]
        self.assertEqual(book["title"], "edited title")
        self.assertEqual(book["storyTitle"], "edited story")
        self.assertEqual(book["synopsis"], "edited synopsis")
        self.assertEqual(book["frames"][0]["name"], "edited frame")
        self.assertEqual(book["frames"][0]["caption"], "edited caption")
        self.assertEqual(book["frames"][0]["prompt"], "edited prompt")
