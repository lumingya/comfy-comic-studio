"""Import the inert reading projection of a self-contained offline HTML album.

HTML and images are spooled on disk. Only bounded tag headers, one decoding chunk, and
the bounded JSON metadata are retained in memory; scripts are never executed.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re
import tempfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path

from pydantic import BaseModel

from . import album_interchange as A
from .models import Dialogue, Episode, Panel, PanelOverrides, Series, Strip, Take
from .pipeline import variables as V
from .render_models import Asset

CHUNK_BYTES = 64 * 1024
MAX_TAG_BYTES = 64 * 1024
_INLINE = re.compile(rb"\bsrc\s*=\s*([\"'])data:", re.IGNORECASE)
_MIME = re.compile(rb"data:([a-zA-Z0-9.+/-]+);base64,\Z")


class AlbumImportResult(BaseModel):
    series_ids: list[str]
    episode_ids: list[str]
    imported_books: int
    imported_frames: int
    imported_assets: int
    source_data_used: bool
    warnings: list[str]


@dataclass
class EmbeddedImage:
    path: Path
    mime: str
    digest: str
    size: int
    width: int | None = None
    height: int | None = None


class _Tag(HTMLParser):
    """Use the standard HTML parser for attribute/entity interpretation, not regex."""

    def __init__(self, text: bytes):
        super().__init__(convert_charrefs=True)
        self.tag = ""
        self.attrs = {}
        self.closing = text.startswith(b"</")
        self.feed(text.decode("utf-8"))
        self.close()

    def handle_starttag(self, tag, attrs):
        self.tag = tag
        for key, value in attrs:
            if key in self.attrs and key in {"src", "id", "type", "data-mio-asset"}:
                raise ValueError("album HTML has ambiguous duplicate attributes")
            self.attrs[key] = value

    handle_startendtag = handle_starttag


class _ImageSink:
    def __init__(self, path):
        self.path = path
        self.file = path.open("xb")
        self.mime = None
        self.header = b"data:"
        self.carry = b""
        self.digest = hashlib.sha256()
        self.size = 0

    def write(self, data, final=False):
        if self.mime is None:
            comma = data.find(b",")
            if comma == -1:
                self.header += data
                if len(self.header) > 200:
                    raise ValueError("album data URL header is too large")
                if final:
                    raise ValueError("album image must be an embedded base64 data URL")
                return
            self.header += data[: comma + 1]
            match = _MIME.fullmatch(self.header)
            if not match:
                raise ValueError("album image must be an embedded base64 data URL")
            self.mime = match[1].decode("ascii").lower()
            data = data[comma + 1 :]
        data = self.carry + data
        length = len(data) if final else max(0, ((len(data) - 4) // 4) * 4)
        encoded, self.carry = data[:length], data[length:]
        if not final and b"=" in encoded:
            raise ValueError("album image contains invalid base64 padding")
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("album image contains invalid base64") from exc
        self.size += len(decoded)
        if self.size > A.MAX_IMAGE_BYTES:
            raise ValueError("album image exceeds the encoded image byte limit")
        self.file.write(decoded)
        self.digest.update(decoded)
        if final:
            self.file.close()

    def close(self):
        self.file.close()


class _AlbumHTML:
    """Bounded lexical framing around HTMLParser, including streaming image attributes.

    HTMLParser alone retains a whole unclosed attribute or script in ``rawdata``. This
    framing strips comments/unrelated raw text and substitutes file tokens for data URLs
    before submitting each small tag to HTMLParser.
    """

    def __init__(self, temporary: Path):
        self.temporary = temporary
        self.buffer = b""
        self.mode = "text"
        self.raw_tag = b""
        self.metadata = False
        self.json = bytearray()
        self.metadata_count = 0
        self.assets: dict[str, EmbeddedImage] = {}
        self.unique: dict[str, EmbeddedImage] = {}
        self.total_bytes = 0
        self.sink = None
        self.pending = None
        self.tag_prefix = b""
        self.quote = None
        self.serial = 0

    def _raw_data(self, data):
        if self.metadata:
            if len(self.json) + len(data) > A.MAX_JSON_BYTES:
                raise ValueError("album JSON exceeds 16 MiB")
            self.json.extend(data)

    def _tag(self, data):
        if data.startswith((b"<!", b"<?")):
            return
        parsed = _Tag(data)
        if parsed.closing:
            return
        attrs = parsed.attrs
        if parsed.tag in {"script", "style", "textarea", "title"}:
            self.raw_tag = parsed.tag.encode("ascii")
            self.metadata = parsed.tag == "script" and attrs.get("id") == "mio-album-data"
            if self.metadata:
                self.metadata_count += 1
                if self.metadata_count != 1 or attrs.get("type") != "application/json":
                    raise ValueError("album requires exactly one JSON mio-album-data script")
            self.mode = "raw"
        if parsed.tag != "img" or "data-mio-asset" not in attrs:
            if self.pending:
                self.pending.path.unlink()
                self.pending = None
            return
        key, src = attrs.get("data-mio-asset"), attrs.get("src")
        if not key or len(key) > 200:
            raise ValueError("album image key is invalid")
        if self.pending is None or src != "mio-import-inline":
            raise ValueError("album asset must use an embedded data URL")
        image, self.pending = self.pending, None
        if key in self.assets:
            existing = self.assets[key]
            image.path.unlink()
            if image.digest != existing.digest or image.mime != existing.mime:
                raise ValueError("album image key has conflicting embedded bytes")
            return
        if image.digest in self.unique:
            image.path.unlink()
            existing = self.unique[image.digest]
            if image.mime != existing.mime:
                raise ValueError("album image MIME declarations conflict for identical bytes")
            image = existing
        else:
            self.total_bytes += image.size
            self.unique[image.digest] = image
        self.assets[key] = image
        A.enforce_asset_limits(len(self.assets), self.total_bytes)

    def feed(self, data: bytes, final=False):
        self.buffer += data
        while self.buffer:
            if self.mode == "comment":
                end = self.buffer.find(b"-->")
                if end < 0:
                    self.buffer = self.buffer[-2:]
                    break
                self.buffer = self.buffer[end + 3 :]
                self.mode = "text"
            elif self.mode == "raw":
                marker = b"</" + self.raw_tag
                index = self.buffer.lower().find(marker)
                if index < 0:
                    keep = len(marker) + 1
                    if len(self.buffer) <= keep:
                        break
                    self._raw_data(self.buffer[:-keep])
                    self.buffer = self.buffer[-keep:]
                    break
                end = self.buffer.find(b">", index)
                if end < 0:
                    self._raw_data(self.buffer[:index])
                    self.buffer = self.buffer[index:]
                    if len(self.buffer) > MAX_TAG_BYTES:
                        raise ValueError("album HTML tag header is too large")
                    break
                closing = self.buffer[index : end + 1]
                if not re.fullmatch(rb"</" + self.raw_tag + rb"\s*>", closing, re.IGNORECASE):
                    self._raw_data(self.buffer[: index + 2])
                    self.buffer = self.buffer[index + 2 :]
                    continue
                self._raw_data(self.buffer[:index])
                self.buffer = self.buffer[end + 1 :]
                self.mode, self.metadata = "text", False
            elif self.mode == "image":
                end = self.buffer.find(self.quote)
                if end < 0:
                    self.sink.write(self.buffer)
                    self.buffer = b""
                    break
                self.sink.write(self.buffer[:end], final=True)
                self.pending = EmbeddedImage(
                    self.sink.path, self.sink.mime, self.sink.digest.hexdigest(), self.sink.size
                )
                self.sink = None
                self.buffer = self.tag_prefix + b"mio-import-inline" + self.buffer[end:]
                self.mode = "tag"
            elif self.mode == "tag":
                # Search only a bounded prefix; the image body is not an HTML tag header.
                prefix = self.buffer[:MAX_TAG_BYTES]
                match = _INLINE.search(prefix) if re.match(rb"<img\b", prefix, re.I) else None
                quote = None
                end = None
                for index, char in enumerate(prefix):
                    if quote:
                        if char == quote:
                            quote = None
                    elif char in (34, 39):
                        quote = char
                    elif char == 62:
                        end = index
                        break
                if match is not None and (end is None or match.start() < end):
                    if self.pending is not None:
                        raise ValueError("album image contains multiple data URL sources")
                    self.serial += 1
                    self.sink = _ImageSink(self.temporary / f"image-{self.serial}")
                    self.tag_prefix = self.buffer[: match.end() - 5]
                    self.quote = match[1]
                    self.buffer = self.buffer[match.end() :]
                    self.mode = "image"
                    continue
                if end is None:
                    if len(self.buffer) > MAX_TAG_BYTES:
                        raise ValueError("album HTML tag header is too large")
                    break
                tag, self.buffer = self.buffer[: end + 1], self.buffer[end + 1 :]
                self.mode = "text"
                self._tag(tag)
            else:
                index = self.buffer.find(b"<")
                if index < 0:
                    self.buffer = b""
                    break
                self.buffer = self.buffer[index:]
                if len(self.buffer) < 10 and not final:
                    break
                self.mode = "comment" if self.buffer.startswith(b"<!--") else "tag"
        if final and (self.mode in {"tag", "image", "comment", "raw"}):
            raise ValueError("album HTML is incomplete")

    def close(self):
        if self.sink:
            self.sink.close()


def _parse(path: Path, temporary: Path):
    parser = _AlbumHTML(temporary)
    try:
        size = 0
        with path.open("rb") as source:
            while chunk := source.read(CHUNK_BYTES):
                size += len(chunk)
                if size > A.MAX_HTML_BYTES:
                    raise ValueError("album HTML exceeds 1 GiB")
                parser.feed(chunk)
        parser.feed(b"", final=True)
        if parser.metadata_count != 1:
            raise ValueError("album requires exactly one JSON mio-album-data script")
        try:
            payload = A.strict_json_loads(parser.json.decode("utf-8"))
            document = A.validate_album_payload(payload)
        except UnicodeError as exc:
            raise ValueError("album metadata must be UTF-8") from exc
        return document, parser.assets
    finally:
        parser.close()


def _documents(book: A.SourceBook, images: dict[str, EmbeddedImage]):
    series = Series(title=book.title, subtitle=book.synopsis)
    episode = Episode(
        series_id=series.id, title=book.story_title or book.title, order=0, synopsis=book.synopsis
    )
    episode.album_source = A.ImportedAlbumBook(
        title=book.title,
        synopsis=book.synopsis,
        character_name=book.character_name,
        story_title=book.story_title,
        composition=book.composition,
        mapped_series_title=series.title,
        mapped_episode_title=episode.title,
        mapped_synopsis=episode.synopsis,
    )
    for order, frame in enumerate(book.frames):
        dialogues = (
            [Dialogue(text=frame.caption, kind="narration")] if frame.caption.strip() else []
        )
        panel = Panel(
            order=order,
            description=frame.name,
            dialogues=dialogues,
            gap_after=0,
            overrides=PanelOverrides(raw_prompt=frame.prompt),
        )
        image = images[frame.image.key] if frame.image else None
        if image:
            if 0.1 <= image.width / image.height <= 10:
                panel.aspect_ratio = f"{image.width}:{image.height}"
            episode.takes.append(
                Take(
                    panel_id=panel.id,
                    asset_id=image.digest,
                    status="adopted",
                    stage="final",
                    width=image.width,
                    height=image.height,
                )
            )
        panel.album_source = A.ImportedAlbumFrame(
            **frame.model_dump(),
            mapped_description=panel.description,
            mapped_caption=V.display(dialogues[0].text, V.table(series, panel))
            if dialogues
            else "",
            mapped_prompt=frame.prompt,
            mapped_asset_id=image.digest if image else None,
        )
        episode.panels.append(panel)
    rasterized = _rasterized(book, episode)
    return series, episode, rasterized


def _rasterized(book, episode):
    if not book.composition or not book.frames or len(episode.takes) != len(book.frames):
        return False
    width, height = book.composition.width, book.composition.height
    cursor, boxes = 0, {}
    for panel, frame in zip(episode.panels, book.frames):
        region = frame.source_region
        if region is None or region[:3] != [0, cursor, width]:
            return False
        boxes[panel.id] = tuple(region)
        cursor = region[3]
    if cursor != height:
        return False
    episode.strip = Strip(
        width=width,
        height=height,
        margin=0,
        manual=True,
        rasterized=True,
        panel_boxes=boxes,
        crops={panel.id: (0, 0, 1, 1) for panel in episode.panels},
    )
    return True


def import_album_html(ctx, path: str | Path) -> AlbumImportResult:
    with tempfile.TemporaryDirectory(prefix="mio-album-import-") as temporary:
        document, images = _parse(Path(path), Path(temporary))
        # Even hidden legacy references are checked before trusting optional sourceData.
        referenced = {}
        for book in [b.album.as_source() for b in document.books]:
            for frame in book.frames:
                if frame.image:
                    if frame.image.key not in images:
                        raise ValueError("album metadata refers to a missing embedded image")
                    image = images[frame.image.key]
                    referenced[image.digest] = image
        # The shipped missing-image SVG is an inert reader placeholder, never a take.
        # Other labeled images are checked even when an edited metadata block omits them.
        from .album.render import MISSING

        missing = base64.b64decode(MISSING.split(",", 1)[1])
        missing_sha = hashlib.sha256(missing).hexdigest()
        unique = {image.digest: image for image in images.values()}
        for image in unique.values():
            if (
                image.digest not in referenced
                and image.mime == "image/svg+xml"
                and image.digest == missing_sha
            ):
                continue
            image.mime, image.width, image.height = A.validate_image_file(image.path, image.mime)
        books = (
            document.source_data.books
            if document.source_data
            else [b.album.as_source() for b in document.books]
        )
        for book in [*[b.album.as_source() for b in document.books], *books]:
            for frame in book.frames:
                if frame.image:
                    image = images[frame.image.key]
                    if frame.width is not None and (frame.width, frame.height) != (
                        image.width,
                        image.height,
                    ):
                        raise ValueError("album frame dimensions do not match its embedded image")
                    if frame.source_region is not None:
                        x0, y0, x1, y1 = frame.source_region
                        region_width = x1 - x0
                        expected_height = (
                            (y1 - y0) * image.width + region_width // 2
                        ) // region_width
                        if abs(expected_height - image.height) > 1:
                            raise ValueError(
                                "album sourceRegion aspect ratio does not match its image"
                            )
        documents = [_documents(book, images) for book in books]
        warnings = []
        if document.source_data is None:
            warnings.append(
                "This legacy album has no sourceData; hidden captions and prompts cannot be recovered."
            )
        if any(book.composition and not result[2] for book, result in zip(books, documents)):
            warnings.append(
                "Incomplete composition imported as individual images; original geometry is retained in provenance."
            )
        # Content-addressed files can safely pre-exist or remain unreferenced after a failed
        # disk write. Never remove a shared image on rollback; all visible rows commit together.
        with ctx.store.tx():
            for image in referenced.values():
                manifest = Asset(
                    id=image.digest,
                    mime=image.mime,
                    size=image.size,
                    width=image.width,
                    height=image.height,
                    source="album-html",
                )
                ctx.assets.publish(manifest, image.path.read_bytes())
            for series, episode, _ in documents:
                ctx.store.create_series(series)
                ctx.store.create_episode(episode)
        return AlbumImportResult(
            series_ids=[series.id for series, _, _ in documents],
            episode_ids=[episode.id for _, episode, _ in documents],
            imported_books=len(documents),
            imported_frames=sum(len(episode.panels) for _, episode, _ in documents),
            imported_assets=len(referenced),
            source_data_used=document.source_data is not None,
            warnings=warnings,
        )
