"""Portable theme resource paths, formats and local-only stylesheet validation."""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath
from typing import Literal

from pydantic import BaseModel

from .fs_paths import regular_path_metadata

ASSET_PREFIX = "assets"
MAX_ASSET_DEPTH = 8
MAX_STYLESHEET_BYTES = 2 * 1024 * 1024
MAX_THEME_SCRIPT_BYTES = 1024 * 1024
MAX_IMAGE_ANIMATION_PROBE = 256 * 1024
MEDIA_FORMATS = {
    "image": frozenset({"jpg", "jpeg", "png", "gif", "webp", "avif"}),
    "video": frozenset({"mp4", "webm", "ogv"}),
}
MIME_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "avif": "image/avif",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "ogv": "video/ogg",
    "woff": "font/woff",
    "woff2": "font/woff2",
    "ttf": "font/ttf",
    "otf": "font/otf",
}


class MediaDescriptor(BaseModel):
    kind: Literal["image", "video"]
    url: str
    animated: bool
    mime_type: str


def media_type(name: str) -> str:
    return MIME_TYPES[PurePosixPath(name).suffix.lower().removeprefix(".")]


def describe_media(path: Path, kind: str, url: str) -> dict:
    animated = False
    if kind == "image":
        with path.open("rb") as stream:
            animated = image_may_animate(
                f"assets/{path.name}", stream.read(MAX_IMAGE_ANIMATION_PROBE)
            )
    return MediaDescriptor(
        kind=kind, url=url, animated=animated, mime_type=media_type(path.name)
    ).model_dump()


ASSET_FORMATS = frozenset(
    {
        *MEDIA_FORMATS["image"],
        *MEDIA_FORMATS["video"],
        "woff",
        "woff2",
        "ttf",
        "otf",
    }
)
SIGNATURES = {
    "jpg": lambda data: data.startswith(b"\xff\xd8\xff"),
    "jpeg": lambda data: data.startswith(b"\xff\xd8\xff"),
    "png": lambda data: data.startswith(b"\x89PNG\r\n\x1a\n"),
    "gif": lambda data: data.startswith((b"GIF87a", b"GIF89a")),
    "webp": lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
    "avif": lambda data: (
        len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in {b"avif", b"avis"}
    ),
    "mp4": lambda data: len(data) >= 12 and data[4:8] == b"ftyp",
    "webm": lambda data: data.startswith(b"\x1a\x45\xdf\xa3"),
    "ogv": lambda data: data.startswith(b"OggS"),
    "woff": lambda data: data.startswith(b"wOFF"),
    "woff2": lambda data: data.startswith(b"wOF2"),
    "ttf": lambda data: data.startswith(b"\x00\x01\x00\x00"),
    "otf": lambda data: data.startswith(b"OTTO"),
}
_ASSET_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}")


def asset_parts(name: str) -> tuple[str, ...] | None:
    parts = PurePosixPath(name).parts
    if (
        len(parts) < 2
        or len(parts) > MAX_ASSET_DEPTH + 2
        or parts[0] != ASSET_PREFIX
        or any(not _ASSET_NAME.fullmatch(part) for part in parts[1:-1])
        or "/".join(parts) != name
    ):
        return None
    stem, separator, suffix = parts[-1].rpartition(".")
    if not separator or not stem or not _ASSET_NAME.fullmatch(stem):
        return None
    if suffix.lower() not in ASSET_FORMATS:
        return None
    return parts


def is_asset_directory(name: str) -> bool:
    normalized = name.rstrip("/")
    parts = PurePosixPath(normalized).parts
    return bool(
        normalized
        and len(parts) <= MAX_ASSET_DEPTH + 1
        and parts[0] == ASSET_PREFIX
        and "/".join(parts) == normalized
        and all(_ASSET_NAME.fullmatch(part) for part in parts[1:])
    )


def supports_background(name: str, kind: str) -> bool:
    parts = asset_parts(name)
    return bool(parts and parts[-1].rsplit(".", 1)[-1].lower() in MEDIA_FORMATS.get(kind, ()))


def valid_media(name: str, data: bytes) -> bool:
    parts = asset_parts(name)
    if not parts:
        return False
    validator = SIGNATURES.get(parts[-1].rsplit(".", 1)[-1].lower())
    return bool(validator and validator(data))


def image_may_animate(name: str, data: bytes) -> bool:
    """Conservatively detect animated image containers for reduced-motion handling."""
    parts = asset_parts(name)
    if not parts:
        return False
    suffix = parts[-1].rsplit(".", 1)[-1].lower()
    data = data[:MAX_IMAGE_ANIMATION_PROBE]
    if suffix == "gif":
        return True
    if suffix == "avif":
        return len(data) >= 12 and data[8:12] == b"avis"
    if suffix == "png":
        cursor = 8
        while cursor + 12 <= len(data):
            length = int.from_bytes(data[cursor : cursor + 4], "big")
            chunk = data[cursor + 4 : cursor + 8]
            if chunk == b"acTL":
                return True
            if chunk == b"IDAT":
                return False
            cursor += 12 + length
        return True
    if suffix == "webp":
        cursor = 12
        while cursor + 8 <= len(data):
            chunk = data[cursor : cursor + 4]
            length = int.from_bytes(data[cursor + 4 : cursor + 8], "little")
            if chunk in {b"ANIM", b"ANMF"}:
                return True
            if chunk in {b"VP8 ", b"VP8L"}:
                return False
            cursor += 8 + length + (length & 1)
        return True
    return False


def _skip_string(source: str, start: int) -> int:
    quote = source[start]
    cursor = start + 1
    while cursor < len(source):
        char = source[cursor]
        if char == "\\":
            cursor += 2
        elif char == quote:
            return cursor + 1
        else:
            cursor += 1
    raise ValueError("theme.css contains an unterminated string")


def _strip_comments(source: str) -> str:
    parts: list[str] = []
    cursor = 0
    while cursor < len(source):
        if source[cursor] in "\"'":
            end = _skip_string(source, cursor)
            parts.append(source[cursor:end])
            cursor = end
        elif source.startswith("/*", cursor):
            end = source.find("*/", cursor + 2)
            if end < 0:
                raise ValueError("theme.css contains an unterminated comment")
            cursor = end + 2
        else:
            parts.append(source[cursor])
            cursor += 1
    return "".join(parts)


def validate_stylesheet(source: str, resources: set[str]) -> set[str]:
    """Reject external fetch primitives; require every URL to name a bundled asset."""
    if len(source.encode("utf-8")) > MAX_STYLESHEET_BYTES:
        raise ValueError("theme.css exceeds 2 MB")
    source = _strip_comments(source)
    cursor = 0
    references: set[str] = set()
    while cursor < len(source):
        char = source[cursor]
        if char in "\"'":
            cursor = _skip_string(source, cursor)
            continue
        if char == "\\":
            raise ValueError("theme.css cannot use escaped identifiers")
        if char == "@":
            match = re.match(r"@([A-Za-z_-][A-Za-z0-9_-]*)", source[cursor:])
            if match and match.group(1).lower() == "import":
                raise ValueError("theme.css cannot import external stylesheets")
            cursor += 1
            continue
        if (char.isascii() and char.isalpha()) or char in "_-":
            match = re.match(r"[A-Za-z_-][A-Za-z0-9_-]*", source[cursor:])
            assert match is not None
            name = match.group(0).lower()
            end = cursor + len(match.group(0))
            probe = end
            while probe < len(source) and source[probe].isspace():
                probe += 1
            if probe < len(source) and source[probe] == "(":
                if name in {"image-set", "-webkit-image-set", "src"}:
                    raise ValueError("theme.css cannot use image-set resource URLs")
                if name == "url":
                    value_start = probe + 1
                    while value_start < len(source) and source[value_start].isspace():
                        value_start += 1
                    if value_start >= len(source):
                        raise ValueError("theme.css contains an invalid url()")
                    if source[value_start] in "\"'":
                        value_end = _skip_string(source, value_start)
                        value = source[value_start + 1 : value_end - 1]
                        close = value_end
                        while close < len(source) and source[close].isspace():
                            close += 1
                        if close >= len(source) or source[close] != ")":
                            raise ValueError("theme.css contains an invalid url()")
                    else:
                        close = source.find(")", value_start)
                        if close < 0:
                            raise ValueError("theme.css contains an invalid url()")
                        value = source[value_start:close].strip()
                    if "\\" in value or asset_parts(value) is None or value not in resources:
                        raise ValueError("theme.css URLs must reference bundled assets")
                    references.add(value)
                    cursor = close + 1
                    continue
            cursor = end
            continue
        cursor += 1
    return references


def validate_theme_resources(folder: Path, theme) -> None:
    """Validate optional resources attached to an extension-contributed theme."""
    root = folder.absolute()
    assets: set[str] = set()
    asset_root = root / ASSET_PREFIX
    if asset_root.exists():
        for path in asset_root.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            if asset_parts(relative):
                assets.add(relative)

    def read_regular(relative: str, max_bytes: int | None = None) -> bytes:
        path = root / relative
        try:
            metadata = regular_path_metadata(path, directory=False)
        except (OSError, ValueError) as exc:
            raise ValueError(f"主题资源不是普通文件：{relative}") from exc
        if max_bytes is not None and metadata.st_size > max_bytes:
            raise ValueError(f"主题资源过大：{relative}")
        with path.open("rb") as source:
            if max_bytes is not None:
                return source.read()
            return source.read(64 * 1024 if relative.lower().endswith(".png") else 12)

    if theme.background:
        if theme.background.file not in assets or not valid_media(
            theme.background.file, read_regular(theme.background.file)
        ):
            raise ValueError("主题背景资源不存在或格式无效")
    if theme.style_file:
        style_path = root / theme.style_file
        style = read_regular(theme.style_file, MAX_STYLESHEET_BYTES)
        try:
            source = style.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("theme.css 不是有效 UTF-8") from exc
        references = validate_stylesheet(source, assets)
        for name in references:
            if not valid_media(name, read_regular(name)):
                raise ValueError(f"主题资源格式无效：{name}")
        if not style_path.is_file():
            raise ValueError("theme.css 不存在")
    if theme.script_file:
        try:
            read_regular(theme.script_file, MAX_THEME_SCRIPT_BYTES).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("theme.js 不是有效 UTF-8") from exc
