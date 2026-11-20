"""Deterministic portable theme identities and streaming package export."""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from pathlib import Path

from . import theme_package_validation as validation
from .theme_media import _skip_string, _strip_comments
from .theme_package_validation import (
    MANIFEST,
    README,
    SCRIPT,
    SETTINGS_PAGE_NAME,
    STYLE,
    THEME_FILE,
    ThemePackageError,
    _validated_files,
    allowed_package_path,
)
from .themes import Theme, resolved

_CARD_ID_MARKER = "self"


def _rebase_card_stylesheet(data: bytes, old_id: str, new_id: str) -> bytes:
    """Rebind literal card scopes in rule selectors, never in declaration values."""
    try:
        source = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ThemePackageError("theme.css 不是有效 UTF-8") from exc
    prefix = '.theme-card[data-theme-id="'
    replacement = new_id
    edits: list[tuple[int, int]] = []

    def skip_comment(cursor: int) -> int:
        end = source.find("*/", cursor + 2)
        if end < 0:
            raise ThemePackageError("theme.css contains an unterminated comment")
        return end + 2

    def selector(start: int, end: int) -> None:
        cursor = start
        while cursor < end:
            if source.startswith("/*", cursor):
                cursor = skip_comment(cursor)
            elif source[cursor] in "\"'":
                cursor = _skip_string(source, cursor)
            elif source[cursor] == ".":
                # Comments may split selector tokens. Match their logical spelling,
                # but replace only the quoted identity and retain every comment.
                probe = cursor
                for expected in prefix:
                    while source.startswith("/*", probe):
                        probe = skip_comment(probe)
                    if probe >= end or source[probe] != expected:
                        break
                    probe += 1
                else:
                    identity_start = probe
                    identity_end = probe + len(old_id)
                    if source.startswith(old_id + '"', probe):
                        probe = identity_end + 1
                        while source.startswith("/*", probe):
                            probe = skip_comment(probe)
                        if probe < end and source[probe] == "]":
                            edits.append((identity_start, identity_end))
                            cursor = probe + 1
                            continue
                cursor += 1
            else:
                cursor += 1

    cursor = start = parentheses = brackets = 0
    skipped_blocks: list[bool] = []
    while cursor < len(source):
        char = source[cursor]
        if source.startswith("/*", cursor):
            cursor = skip_comment(cursor)
            continue
        if char in "\"'":
            cursor = _skip_string(source, cursor)
            continue
        if char == "(":
            parentheses += 1
        elif char == ")":
            parentheses -= 1
        elif char == "[":
            brackets += 1
        elif char == "]":
            brackets -= 1
        elif parentheses == 0 and brackets == 0:
            if char == "{":
                header = _strip_comments(source[start:cursor]).lstrip()
                # Custom properties can contain arbitrary balanced token blocks.
                skipped = bool(skipped_blocks and skipped_blocks[-1]) or bool(
                    re.match(r"--[A-Za-z0-9_-]+\s*:", header)
                )
                if not skipped and (
                    not header.startswith("@")
                    or re.match(r"@(?:scope|supports)\b", header, re.IGNORECASE)
                ):
                    selector(start, cursor)
                skipped_blocks.append(skipped)
                start = cursor + 1
            elif char in ";}":
                if char == "}" and skipped_blocks:
                    skipped_blocks.pop()
                start = cursor + 1
        cursor += 1

    parts: list[str] = []
    previous = 0
    for start, end in edits:
        parts.extend((source[previous:start], replacement))
        previous = end
    parts.append(source[previous:])
    return "".join(parts).encode("utf-8")


def _resource_identity(name: str, data: bytes, theme_id: str) -> bytes:
    # Re-exporting an already rebound card must retain the same content-derived ID.
    return _rebase_card_stylesheet(data, theme_id, _CARD_ID_MARKER) if name == STYLE else data


def package_theme(theme: Theme, resources: dict[str, bytes] | None = None) -> tuple[str, bytes]:
    """Package validated theme data and referenced assets without executing its script."""
    resources = resources or {}
    document = theme.model_dump(mode="json", exclude={"created_at"})
    document["tokens"] = resolved(theme)
    document.pop("id", None)
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    resource_ids = {
        name: hashlib.sha256(_resource_identity(name, data, theme.id)).hexdigest()
        for name, data in sorted(resources.items())
    }
    canonical += json.dumps(resource_ids, sort_keys=True, separators=(",", ":"))
    package_id = "theme-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    document["id"] = package_id
    manifest = {
        "id": package_id,
        "name": theme.name,
        "version": "1.0.0",
        "author": theme.author,
        "description": "",
        "theme_file": THEME_FILE,
    }
    readme = (
        f"# {theme.name}\n\n"
        "这是独立主题包，包含界面令牌和已声明资源；主题脚本只在隔离沙箱中运行。"
        "可在「设置 → 外观与阅读」导入 ZIP，然后选择主题。\n"
    )
    files = {
        MANIFEST: json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        THEME_FILE: json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        README: readme,
    }
    files.update(
        {
            name: _rebase_card_stylesheet(data, theme.id, "self") if name == STYLE else data
            for name, data in resources.items()
        }
    )
    _validated_files(
        {
            name: content if isinstance(content, bytes) else content.encode("utf-8")
            for name, content in files.items()
        }
    )
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(
                f"{package_id}/{name}",
                content if isinstance(content, bytes) else content.encode("utf-8"),
                compress_type=zipfile.ZIP_STORED
                if name.startswith("assets/")
                else zipfile.ZIP_DEFLATED,
            )
    result = payload.getvalue()
    if len(result) > validation.MAX_PACKAGE:
        raise ThemePackageError("主题 ZIP 超过 10 GiB")
    return package_id, result


def package_theme_to_file(theme: Theme, resources: dict[str, Path], destination: Path) -> str:
    """Write a validated theme ZIP while streaming resource files from disk."""
    document = theme.model_dump(mode="json", exclude={"created_at"})
    document["tokens"] = resolved(theme)
    document.pop("id", None)
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    sizes: dict[str, int] = {}
    samples: dict[str, bytes] = {}
    resource_hashes = {}
    total_size = 0
    for name, path in resources.items():
        if not allowed_package_path(name) or not path.is_file():
            raise ThemePackageError("主题包包含不支持或不存在的资源")
        size = path.stat().st_size
        total_size += size
        if size > validation.MAX_FILE or total_size > validation.MAX_PACKAGE:
            raise ThemePackageError("主题包超过 10 GiB")
        sizes[name] = size
        digest = hashlib.sha256()
        with path.open("rb") as source:
            sample_size = (
                validation.MAX_METADATA
                if name == STYLE
                else validation.MAX_SCRIPT
                if name == SCRIPT
                else validation.MAX_SETTINGS_PAGE
                if SETTINGS_PAGE_NAME.fullmatch(name)
                else 64 * 1024
                if name.lower().endswith(".png")
                else 12
            )
            samples[name] = source.read(sample_size)
            source.seek(0)
            while chunk := source.read(validation.COPY_CHUNK_SIZE):
                digest.update(chunk)
        resource_hashes[name] = digest.hexdigest()
        if name == STYLE and (
            len(samples[name]) != size
            or hashlib.sha256(samples[name]).hexdigest() != resource_hashes[name]
        ):
            raise ThemePackageError("主题样式在导出期间发生变化或超过大小限制")
    identity_hashes = {
        name: hashlib.sha256(_resource_identity(name, samples[name], theme.id)).hexdigest()
        if name == STYLE
        else digest
        for name, digest in resource_hashes.items()
    }
    canonical += json.dumps(identity_hashes, sort_keys=True, separators=(",", ":"))
    package_id = "theme-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    document["id"] = package_id
    overrides = (
        {STYLE: _rebase_card_stylesheet(samples[STYLE], theme.id, "self")}
        if STYLE in samples
        else {}
    )
    source_sizes = dict(sizes)
    files = {
        MANIFEST: json.dumps(
            {
                "id": package_id,
                "name": theme.name,
                "version": "1.0.0",
                "author": theme.author,
                "description": "",
                "theme_file": THEME_FILE,
            },
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")
        + b"\n",
        THEME_FILE: json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8") + b"\n",
        README: (
            f"# {theme.name}\n\n"
            "这是独立主题包，包含界面令牌和已声明资源；主题脚本只在隔离沙箱中运行。"
            "可在「设置 → 外观与阅读」导入 ZIP，然后选择主题。\n"
        ).encode("utf-8"),
        **samples,
        **overrides,
    }
    sizes.update({name: len(files[name]) for name in (MANIFEST, THEME_FILE, README)})
    sizes.update({name: len(data) for name, data in overrides.items()})
    _validated_files(files, file_names=set(sizes), file_sizes=sizes)
    try:
        with zipfile.ZipFile(
            destination, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True
        ) as archive:
            for name, data in files.items():
                if name in resources:
                    continue
                archive.writestr(
                    f"{package_id}/{name}",
                    data,
                    compress_type=(
                        zipfile.ZIP_STORED if name.startswith("assets/") else zipfile.ZIP_DEFLATED
                    ),
                )
            for name, path in resources.items():
                info = zipfile.ZipInfo(f"{package_id}/{name}")
                info.compress_type = (
                    zipfile.ZIP_STORED if name.startswith("assets/") else zipfile.ZIP_DEFLATED
                )
                with archive.open(info, "w", force_zip64=True) as target, path.open("rb") as source:
                    digest = hashlib.sha256()
                    copied = 0
                    if name in overrides:
                        target.write(overrides[name])
                    while chunk := source.read(validation.COPY_CHUNK_SIZE):
                        copied += len(chunk)
                        digest.update(chunk)
                        if name not in overrides:
                            target.write(chunk)
                    if copied != source_sizes[name] or digest.hexdigest() != resource_hashes[name]:
                        raise ThemePackageError("主题资源在导出期间发生变化")
        if destination.stat().st_size > validation.MAX_PACKAGE:
            raise ThemePackageError("主题 ZIP 超过 10 GiB")
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return package_id
