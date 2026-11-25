"""Shared, bounded contract for offline HTML album interchange.

This is a reading projection, not the editable workspace/source ZIP format.
"""

from __future__ import annotations

import io
import json
import math
import warnings
from pathlib import Path
from typing import Literal

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_HTML_BYTES = 1024 * 1024 * 1024
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_BOOKS = 50
MAX_FRAMES = 10_000
MAX_ASSETS = 10_000
MAX_TOTAL_IMAGE_BYTES = 768 * 1024 * 1024
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
IMAGE_MIMES = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp", "GIF": "image/gif"}


class AlbumModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)


class ImageReference(AlbumModel):
    key: str = Field(alias="$mioImage", min_length=1, max_length=200)


class Composition(AlbumModel):
    width: int = Field(ge=320, le=2400)
    height: int = Field(gt=0)


class AlbumFrame(AlbumModel):
    name: str = ""
    caption: str = ""
    prompt: str = ""
    width: int | None = Field(default=None, gt=0)
    height: int | None = Field(default=None, gt=0)
    source_region: list[int] | None = Field(
        default=None, alias="sourceRegion", min_length=4, max_length=4
    )
    image: ImageReference | Literal[""] = ""

    @model_validator(mode="after")
    def geometry(self):
        if (self.width is None) != (self.height is None):
            raise ValueError("album frame width and height must be specified together")
        if self.width is not None and self.width * self.height > MAX_IMAGE_PIXELS:
            raise ValueError("album frame exceeds the image pixel limit")
        if self.source_region is not None:
            x0, y0, x1, y1 = self.source_region
            if min(x0, y0) < 0 or x1 <= x0 or y1 <= y0:
                raise ValueError("album sourceRegion must be a positive rectangle")
        return self


class SourceBook(AlbumModel):
    title: str
    synopsis: str = ""
    character_name: str = Field(default="", alias="characterName")
    story_title: str = Field(default="", alias="storyTitle")
    composition: Composition | None = None
    frames: list[AlbumFrame] = Field(max_length=MAX_FRAMES)

    @model_validator(mode="after")
    def geometry(self):
        if not self.title.strip():
            raise ValueError("album book title is required")
        for frame in self.frames:
            if frame.source_region is not None:
                if self.composition is None:
                    raise ValueError("album sourceRegion requires composition")
                if (
                    frame.source_region[2] > self.composition.width
                    or frame.source_region[3] > self.composition.height
                ):
                    raise ValueError("album sourceRegion exceeds composition")
        return self


class AlbumSource(AlbumModel):
    schema_name: Literal["mio.album-source.v1"] = Field(alias="schema")
    books: list[SourceBook] = Field(min_length=1, max_length=MAX_BOOKS)


class ImportedAlbumFrame(AlbumFrame):
    """Exact inert import projection plus the corresponding initial editable fields."""

    mapped_description: str
    mapped_caption: str
    mapped_prompt: str
    mapped_asset_id: str | None = None


class ImportedAlbumBook(AlbumModel):
    title: str
    synopsis: str
    character_name: str
    story_title: str
    composition: Composition | None = None
    mapped_series_title: str
    mapped_episode_title: str
    mapped_synopsis: str


class LegacyFrame(AlbumFrame):
    step_index: int = Field(alias="stepIndex", ge=0)


class LegacyAlbum(AlbumModel):
    title: str
    synopsis: str = ""
    total_steps: int = Field(alias="totalSteps", ge=0, le=MAX_FRAMES)
    steps: list[LegacyFrame] = Field(max_length=MAX_FRAMES)
    composition: Composition | None = None
    character_name: str = Field(default="", alias="characterName")
    story_title: str = Field(default="", alias="storyTitle")

    @model_validator(mode="after")
    def steps_consistent(self):
        if self.total_steps != len(self.steps):
            raise ValueError("album totalSteps does not match its frames")
        if [step.step_index for step in self.steps] != list(range(len(self.steps))):
            raise ValueError("album stepIndex must follow reading order")
        self.as_source()
        return self

    def as_source(self) -> SourceBook:
        return SourceBook(
            title=self.title,
            synopsis=self.synopsis,
            character_name=self.character_name,
            story_title=self.story_title,
            composition=self.composition,
            frames=[
                AlbumFrame.model_validate(s.model_dump(exclude={"step_index"})) for s in self.steps
            ],
        )


class LegacyBook(AlbumModel):
    album: LegacyAlbum
    storyboard: dict | None = None


class AlbumDocument(AlbumModel):
    schema_name: Literal["mio.album-html.v1"] = Field(alias="schema")
    books: list[LegacyBook] = Field(min_length=1, max_length=MAX_BOOKS)
    source_data: AlbumSource | None = Field(default=None, alias="sourceData")

    @model_validator(mode="after")
    def counts(self):
        if sum(len(book.album.steps) for book in self.books) > MAX_FRAMES:
            raise ValueError("album exceeds the frame count limit")
        if self.source_data:
            if len(self.source_data.books) != len(self.books):
                raise ValueError("album sourceData book count does not match")
            for legacy, source in zip(self.books, self.source_data.books):
                if len(legacy.album.steps) != len(source.frames):
                    raise ValueError("album sourceData frame count does not match")
                for step, frame in zip(legacy.album.steps, source.frames):
                    if step.image != frame.image:
                        raise ValueError("album sourceData image references do not match")
        return self


def strict_json_loads(text: str):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("album JSON contains a duplicate key")
            result[key] = value
        return result

    def finite(_):
        raise ValueError("album JSON contains a non-finite number")

    def real(text):
        value = float(text)
        if not math.isfinite(value):
            return finite(text)
        return value

    def strings(value):
        if isinstance(value, str):
            value.encode("utf-8")
        elif isinstance(value, dict):
            for key, item in value.items():
                strings(key)
                strings(item)
        elif isinstance(value, list):
            for item in value:
                strings(item)

    try:
        value = json.loads(text, object_pairs_hook=unique, parse_constant=finite, parse_float=real)
        strings(value)
        return value
    except (RecursionError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("album metadata is not valid JSON") from exc


def validate_album_payload(payload: dict) -> AlbumDocument:
    return AlbumDocument.model_validate(payload)


def enforce_asset_limits(count: int, total_bytes: int) -> None:
    if count > MAX_ASSETS or total_bytes > MAX_TOTAL_IMAGE_BYTES:
        raise ValueError("album exceeds the unique image count or total image byte limit")


def _validate_image(source, declared_mime: str) -> tuple[str, int, int]:
    if isinstance(source, (str, Path)) and Path(source).stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError("album image exceeds the encoded image byte limit")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as image:
                mime = IMAGE_MIMES.get(image.format)
                if mime is None or mime != declared_mime:
                    raise ValueError("album image MIME does not match its bytes")
                width, height = image.size
                if width * height > MAX_IMAGE_PIXELS:
                    raise ValueError("album image exceeds the image pixel limit")
                pixels = 0
                for index in range(getattr(image, "n_frames", 1)):
                    image.seek(index)
                    pixels += image.width * image.height
                    if pixels > MAX_IMAGE_PIXELS:
                        raise ValueError("album image exceeds the image pixel limit")
                    image.load()
                return mime, width, height
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as exc:
        raise ValueError("album image cannot be fully decoded") from exc


def validate_image_file(path: str | Path, declared_mime: str) -> tuple[str, int, int]:
    return _validate_image(path, declared_mime)


def validate_image_bytes(data: bytes, declared_mime: str) -> tuple[str, int, int]:
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("album image exceeds the encoded image byte limit")
    return _validate_image(io.BytesIO(data), declared_mime)
