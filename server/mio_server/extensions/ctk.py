"""Opt-in, read-only static package and private-state diagnostics.

No package Python (including backup entries) is imported or executed. ZIP validation uses
the existing import authorities in disposable directories; source files are never rewritten.
Reports contain fixed codes and logical sources, never private values or exception text.
"""

from __future__ import annotations

import argparse
import json
import tempfile
import zipfile
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from ..backups.paths import sha_file
from ..backups.ui_data import TEMPORARY, wallpaper_container
from ..private_store import (
    MAX_WALLPAPER_RECORD,
    WALLPAPER_ID,
    PrivateStore,
    encode_json,
    read_json_file,
    regular_path,
    validate_identifier,
    validate_media_file,
    validate_wallpaper_record,
)
from ..theme_media import _skip_string, _strip_comments, validate_theme_resources
from ..theme_packages import _extract_zip_to_folder, _read_folder, _rebase_card_stylesheet
from ..themes import parse_theme
from .dependencies import _requirements
from .manifest import MANIFEST, SKIP_DIRS, digest, inside, read_manifest

Kind = Literal["extension", "theme", "private"]
MESSAGES = {
    "package.invalid": "Static package validation failed; package code was not executed.",
    "package.identity_mismatch": "The package ID does not match its installed directory.",
    "extension.digest.changed": "Package content differs from the reviewed activation digest.",
    "extension.runtime.failed": "The host recorded an extension activation failure.",
    "theme.card_css.filtered": "One or more card rules are excluded by the host isolation filter.",
    "private.path.invalid": "A private path is redirected, unsupported or unreadable.",
    "private.preferences.invalid": "Private preferences fail the shared strict JSON contract.",
    "private.settings.invalid": "SDK settings fail the shared strict JSON contract.",
    "private.legacy.fallback": "A registered legacy source is retained and used as a fallback.",
    "private.legacy.shadow": "A canonical value shadows an equivalent retained legacy copy.",
    "private.legacy.conflict": "Canonical and retained legacy values differ; neither was modified.",
    "private.wallpaper.invalid": "Wallpaper metadata, media pairing or signature is invalid.",
    "private.wallpaper.orphan": "Unindexed wallpaper files were found and left untouched.",
}
LIMITATIONS = [
    "Static validation does not execute Python, install dependencies, run visual scripts or test browsers.",
    "A valid report does not establish code trust, runtime compatibility or the absence of credentials.",
    "Concurrent external filesystem changes can invalidate this read-only observation.",
]


class Diagnostic(BaseModel):
    code: str
    severity: Literal["info", "warning", "error"]
    kind: Kind
    id: str | None = None
    source: str
    message: str


class ExtensionDiagnosticReport(BaseModel):
    format_version: Literal[1] = 1
    kind: Literal["extension", "theme", "workspace"]
    id: str | None = None
    valid: bool
    findings: list[Diagnostic]
    limitations: list[str] = Field(default_factory=lambda: list(LIMITATIONS))


def _id(value: str) -> str | None:
    try:
        validate_identifier(value)
    except ValueError:
        return None
    return value


def _finding(code: str, kind: Kind, identifier: str | None, source: str, severity="warning"):
    return Diagnostic(
        code=code,
        severity=severity,
        kind=kind,
        id=identifier,
        source=source,
        message=MESSAGES[code],
    )


def _report(kind, identifier, findings) -> ExtensionDiagnosticReport:
    # Aggregate repeated observations without exposing filenames or private record IDs.
    unique = {(item.code, item.kind, item.id, item.source): item for item in findings}
    values = sorted(unique.values(), key=lambda item: (item.source, item.id or "", item.code))
    return ExtensionDiagnosticReport(
        kind=kind,
        id=identifier,
        valid=all(item.severity != "error" for item in values),
        findings=values,
    )


def _card_blocks(source: str):
    """Find top-level blocks for diagnostics only; the host remains the filtering authority."""
    source = _strip_comments(source)
    start = cursor = depth = 0
    while cursor < len(source):
        char = source[cursor]
        if char in "\"'":
            cursor = _skip_string(source, cursor)
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                yield source[start : cursor + 1]
                start = cursor + 1
        elif char == ";" and depth == 0:
            start = cursor + 1
        cursor += 1


def _mentions_card(source: str) -> bool:
    cursor = 0
    while cursor < len(source):
        if source[cursor] in "\"'":
            cursor = _skip_string(source, cursor)
        elif source.startswith(".theme-card", cursor):
            return True
        else:
            cursor += 1
    return False


def _card_findings(folder: Path, theme, source: str):
    if not theme.style_file:
        return []
    # Lazy import avoids coupling API router construction to this diagnostic module.
    from ..api.theme_packages import _card_scoped_rules

    stylesheet = inside(folder, theme.style_file).read_bytes()
    bound = _rebase_card_stylesheet(stylesheet, "self", theme.id).decode("utf-8")
    if any(
        _mentions_card(block) and not _card_scoped_rules(block, theme.id)
        for block in _card_blocks(bound)
    ):
        return [_finding("theme.card_css.filtered", "theme", theme.id, source)]
    return []


def _extension_paths(folder: Path):
    """Validate the same non-cache package tree used by the review digest, without following links."""
    from .manager import MAX_ENTRIES, MAX_UNPACKED

    regular_path(folder, directory=True, missing=False)
    pending, count, total = [folder], 0, 0
    while pending:
        for path in sorted(pending.pop().iterdir()):
            if path.name in SKIP_DIRS:
                continue
            regular_path(path, missing=False)
            if path.is_dir():
                pending.append(path)
            else:
                count += 1
                total += path.stat().st_size
                if count > MAX_ENTRIES or total > MAX_UNPACKED:
                    raise ValueError("extension package exceeds its import limits")


def _extension_folder(folder: Path, source: str):
    from ..album.templates import parse_template
    from ..models import LetterStyle
    from ..pipeline.export import SlicePreset
    from .manager import MAX_MANIFEST_BYTES

    _extension_paths(folder)
    if (folder / MANIFEST).stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("extension manifest exceeds its import limit")
    manifest = read_manifest(folder)
    validate_identifier(manifest.id)
    entries = [
        manifest.main,
        manifest.backup,
        manifest.workspace.entry if manifest.workspace else None,
        *(panel.entry for panel in manifest.contributes.panels),
        *(surface.entry for surface in manifest.contributes.floating_surfaces),
    ]
    for entry in entries:
        if entry:
            regular_path(inside(folder, entry), directory=False, missing=False)
    _requirements(folder)  # Parse declarations only. Never call ensure_requirements/pip.
    findings = []
    for relative in manifest.contributes.themes:
        theme = parse_theme(read_json_file(inside(folder, relative)))
        validate_theme_resources(folder, theme)
        findings.extend(_card_findings(folder, theme, source))
    for relative in manifest.contributes.album_templates:
        parse_template(read_json_file(inside(folder, relative)))
    for name, style in manifest.contributes.sfx_presets.items():
        LetterStyle.model_validate({**style, "preset": name})
    for preset in manifest.contributes.slice_presets:
        SlicePreset(**preset.model_dump())
    return manifest.id, findings


def _theme_folder(folder: Path, source: str, *, enforce_folder_name: bool = True):
    _, theme, _ = _read_folder(folder, enforce_folder_name=enforce_folder_name)
    return theme.id, _card_findings(folder, theme, source)


def check_package(path: str | Path, kind: Literal["extension", "theme"], *, source="package"):
    """Validate a folder or ZIP in isolation, returning no untrusted exception text."""
    path = Path(path).absolute()
    identifier = None
    try:
        regular_path(path, missing=False)
        if path.is_dir():
            identifier, findings = (
                _extension_folder(path, source)
                if kind == "extension"
                else _theme_folder(path, source)
            )
        elif kind == "theme":
            with tempfile.TemporaryDirectory(prefix="mio-ctk-theme-") as temporary:
                folder = Path(temporary) / "package"
                folder.mkdir()
                _, theme = _extract_zip_to_folder(path, folder)
                identifier = theme.id
                _, findings = _theme_folder(folder, source, enforce_folder_name=False)
        else:
            from ..context import AppContext

            with tempfile.TemporaryDirectory(prefix="mio-ctk-extension-") as temporary:
                ctx = AppContext.create(
                    Path(temporary) / "workspace", autostart=False, seed_instance=False
                )
                try:
                    info = ctx.extensions.install_path(path)
                    identifier, findings = _extension_folder(info.folder, source)
                finally:
                    ctx.close()
        return _report(kind, identifier, findings)
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, zipfile.LargeZipFile):
        return _report(
            kind, identifier, [_finding("package.invalid", kind, identifier, source, "error")]
        )


def _owner_folders(workspace: Path, area: str, findings):
    root = workspace / area
    try:
        if not regular_path(root, directory=True):
            return []
        result = []
        for folder in sorted(root.iterdir()):
            identifier = _id(folder.name)
            if identifier is None:
                findings.append(_finding("private.path.invalid", "private", None, area, "error"))
                continue
            try:
                regular_path(folder, directory=True, missing=False)
            except (OSError, ValueError):
                findings.append(
                    _finding("private.path.invalid", "private", identifier, area, "error")
                )
                continue
            result.append(folder)
        return result
    except (OSError, ValueError):
        findings.append(_finding("private.path.invalid", "private", None, area, "error"))
        return []


def _preferences(store: PrivateStore, findings):
    values = []
    for path in store.sources("preferences.json"):
        source = path.parent.parent.name
        try:
            if regular_path(path, directory=False):
                values.append((source, read_json_file(path)))
        except (OSError, ValueError):
            findings.append(
                _finding(
                    "private.preferences.invalid", "private", store.identifier, source, "error"
                )
            )
    if store.kind == "extension":
        settings = store.file("settings.json")
        try:
            if regular_path(settings, directory=False):
                read_json_file(settings)
        except (OSError, ValueError):
            findings.append(
                _finding(
                    "private.settings.invalid",
                    "private",
                    store.identifier,
                    "extensions_data",
                    "error",
                )
            )
    if len(values) == 2:
        code = (
            "private.legacy.shadow"
            if encode_json(values[0][1]) == encode_json(values[1][1])
            else "private.legacy.conflict"
        )
        findings.append(_finding(code, "private", store.identifier, "extension_data"))
    elif values and values[0][0] == "extension_data":
        findings.append(
            _finding(
                "private.legacy.fallback", "private", store.identifier, "extension_data", "info"
            )
        )


def _wallpaper_records(folder: Path, owner: str, source: str, findings):
    try:
        if not regular_path(folder, directory=True):
            return {}
        paths = {}
        for path in sorted(folder.iterdir()):
            regular_path(path, directory=False, missing=False)
            if not TEMPORARY.fullmatch(path.name):
                paths[path.name] = path
        records, used = {}, set()
        for name, metadata in paths.items():
            if metadata.suffix != ".json" or not WALLPAPER_ID.fullmatch(metadata.stem):
                continue
            try:
                record = validate_wallpaper_record(
                    read_json_file(metadata, limit=MAX_WALLPAPER_RECORD), metadata.stem
                )
                media = folder / f"{record['id']}.{record['suffix']}"
                validate_media_file(media, record["suffix"])
                records[record["id"]] = (record, media)
                used.update((name, media.name))
            except (OSError, ValueError):
                findings.append(
                    _finding("private.wallpaper.invalid", "private", owner, source, "error")
                )
        if paths.keys() - used:
            findings.append(_finding("private.wallpaper.orphan", "private", owner, source))
        return records
    except (OSError, ValueError):
        findings.append(_finding("private.path.invalid", "private", owner, source, "error"))
        return {}


def _wallpapers(store: PrivateStore, findings):
    canonical, legacy = (
        _wallpaper_records(path, store.identifier, source, findings)
        for path, source in zip(store.sources("wallpapers"), ("theme_data", "themes"))
    )
    for identifier, (record, media) in legacy.items():
        current = canonical.get(identifier)
        code = "private.legacy.fallback"
        if current:
            current_record, current_media = current
            same = encode_json(record) == encode_json(current_record) and sha_file(
                media
            ) == sha_file(current_media)
            code = "private.legacy.shadow" if same else "private.legacy.conflict"
        findings.append(
            _finding(
                code,
                "private",
                store.identifier,
                "themes",
                "info" if code.endswith("fallback") else "warning",
            )
        )


def diagnose_workspace(
    workspace: str | Path,
    *,
    extension_roots: list[tuple[str, Path]] | None = None,
    theme_roots: list[tuple[str, Path]] | None = None,
    expected_digests: dict[str, str] | None = None,
    failed_extensions: set[str] | None = None,
) -> ExtensionDiagnosticReport:
    """Read known ownership areas only; no AppContext, package activation or migration."""
    workspace = Path(workspace).absolute()
    findings = []
    try:
        regular_path(workspace, directory=True, missing=False)
    except (OSError, ValueError):
        return _report(
            "workspace",
            None,
            [_finding("private.path.invalid", "private", None, "workspace", "error")],
        )
    areas = {
        area: _owner_folders(workspace, area, findings)
        for area in ("extensions_data", "extension_data", "theme_data", "themes")
    }
    for kind, identifiers in (
        (
            "extension",
            {
                folder.name
                for area in ("extensions_data", "extension_data")
                for folder in areas[area]
            },
        ),
        ("theme", {folder.name for area in ("theme_data", "themes") for folder in areas[area]}),
    ):
        for identifier in sorted(identifiers):
            try:
                store = PrivateStore(workspace, kind, identifier)
                _preferences(store, findings)
                if kind == "theme":
                    _wallpapers(store, findings)
            except (OSError, ValueError):
                findings.append(
                    _finding("private.path.invalid", "private", identifier, "workspace", "error")
                )
    extension_roots = (
        extension_roots
        if extension_roots is not None
        else [("installed", workspace / "extensions")]
    )
    theme_roots = (
        theme_roots if theme_roots is not None else [("theme-package", workspace / "themes")]
    )
    seen_extension_ids = set()
    for kind, roots in (("extension", extension_roots), ("theme", theme_roots)):
        for source, root in roots:
            try:
                if not regular_path(root, directory=True):
                    continue
                for folder in sorted(root.iterdir()):
                    if folder.name.startswith("."):
                        continue
                    identifier = _id(folder.name)
                    try:
                        regular_path(folder, directory=True, missing=False)
                        if identifier is None:
                            raise ValueError("invalid package folder identity")
                    except (OSError, ValueError):
                        findings.append(
                            _finding("package.invalid", kind, identifier, source, "error")
                        )
                        continue
                    if (
                        kind == "theme"
                        and not (folder / "mio-theme.json").exists()
                        and wallpaper_container(folder)
                    ):
                        continue
                    report = check_package(folder, kind, source=source)
                    findings.extend(report.findings)
                    if report.id is not None and report.id != identifier:
                        findings.append(
                            _finding("package.identity_mismatch", kind, report.id, source, "error")
                        )
                    if kind == "extension" and identifier:
                        selected = (
                            identifier not in seen_extension_ids and (folder / MANIFEST).is_file()
                        )
                        if selected:
                            seen_extension_ids.add(identifier)
                        expected = (expected_digests or {}).get(identifier) if selected else None
                        if report.valid and expected and digest(folder) != expected:
                            findings.append(
                                _finding("extension.digest.changed", kind, identifier, source)
                            )
                        if selected and identifier in (failed_extensions or set()):
                            findings.append(
                                _finding(
                                    "extension.runtime.failed", kind, identifier, source, "error"
                                )
                            )
            except (OSError, ValueError):
                findings.append(_finding("package.invalid", kind, None, source, "error"))
    return _report("workspace", None, findings)


def main(argv=None, *, kind=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    if kind is None:
        parser.add_argument("kind", choices=("extension", "theme", "workspace"))
    parser.add_argument("path", type=Path)
    args = parser.parse_args(argv)
    selected = kind or args.kind
    report = (
        diagnose_workspace(args.path)
        if selected == "workspace"
        else check_package(args.path, selected)
    )
    print(json.dumps(report.model_dump(mode="json"), ensure_ascii=True, sort_keys=True))
    return 0 if report.valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
