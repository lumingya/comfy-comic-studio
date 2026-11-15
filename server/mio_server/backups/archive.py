"""Stream and verify a bounded archive; never extract arbitrary archive paths or SQL."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path

from ..jobs.types import JOB_SCHEMA_VERSION
from ..storage import SCHEMA_VERSION
from .database import readonly, validate_databases
from .extension_data import MAX_EXTENSION_JSON, allowed_extension_path, regular_path, settings_files
from .models import BackupInspection, BackupManifest
from .paths import sha_file

MAX_ARCHIVE = 2 * 1024**3
MAX_UNPACKED = 4 * 1024**3
MAX_DATABASE = 256 * 1024**2
MAX_MANIFEST = 32 * 1024**2
MAX_ENTRIES = 100_000
ASSET_PATH = re.compile(r"assets/([0-9a-f]{2})/([0-9a-f]{64})\.(png|jpg|webp|gif|json|bin)")
DATABASES = {"mio.sqlite3", "jobs.sqlite3"}
WARNINGS = [
    "Restoration replaces this workspace after the next restart.",
    "Extensions, ComfyUI instances, webhooks and the workshop queue remain disabled or paused.",
    "Extension packages, models, ComfyUI plug-ins and external server files are not included.",
]


def allowed_path(name: str) -> bool:
    if name in DATABASES or allowed_extension_path(name):
        return True
    match = ASSET_PATH.fullmatch(name)
    return bool(match and match[1] == match[2][:2])


def inspect_archive(path: Path, extract_to: Path | None = None) -> BackupInspection:
    if path.stat().st_size > MAX_ARCHIVE:
        raise ValueError("workspace archive exceeds 2 GiB")
    if extract_to is None:
        with tempfile.TemporaryDirectory(prefix="mio-backup-verify-") as temporary:
            return inspect_archive(path, Path(temporary))
    extract_to.mkdir(parents=True, exist_ok=True)
    if any(extract_to.iterdir()):
        raise ValueError("archive extraction requires an empty directory")
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(entries) > MAX_ENTRIES or len(set(names)) != len(names):
                raise ValueError("workspace archive contains too many or duplicate entries")
            if sum(entry.file_size for entry in entries) > MAX_UNPACKED:
                raise ValueError("workspace archive expands beyond 4 GiB")
            for entry in entries:
                mode = entry.external_attr >> 16
                if entry.is_dir() or stat.S_ISLNK(mode) or entry.flag_bits & 1:
                    raise ValueError(
                        "workspace archive contains a link, directory or encrypted entry"
                    )
                if entry.filename != "manifest.json" and not allowed_path(entry.filename):
                    raise ValueError("workspace archive contains a forbidden path")
                limit = (
                    MAX_MANIFEST
                    if entry.filename == "manifest.json"
                    else MAX_DATABASE
                    if entry.filename in DATABASES
                    else MAX_EXTENSION_JSON
                    if allowed_extension_path(entry.filename)
                    else MAX_UNPACKED
                )
                if entry.file_size > limit:
                    raise ValueError("workspace archive member exceeds its size limit")
            manifest_data = json.loads(archive.read("manifest.json"))
            if (
                not isinstance(manifest_data, dict)
                or manifest_data.get("jobs_schema_version") != JOB_SCHEMA_VERSION
            ):
                raise ValueError(
                    "workspace archive jobs schema does not match this version; executor identities cannot be inferred"
                )
            manifest = BackupManifest.model_validate(manifest_data)
            if manifest.schema_version != SCHEMA_VERSION:
                raise ValueError("workspace archive schema does not match this version")
            by_name = {entry.path: entry for entry in manifest.entries}
            if len(by_name) != len(manifest.entries) or set(names) != {"manifest.json", *by_name}:
                raise ValueError("workspace archive manifest does not match its files")
            if not DATABASES <= by_name.keys() or not all(allowed_path(name) for name in by_name):
                raise ValueError("workspace archive does not contain the required files")
            for name, expected in by_name.items():
                entry = archive.getinfo(name)
                if entry.file_size != expected.size:
                    raise ValueError("workspace archive size mismatch")
                target = extract_to / name
                target.parent.mkdir(parents=True, exist_ok=True)
                digest, count = hashlib.sha256(), 0
                with archive.open(entry) as source, target.open("xb") as output:
                    while chunk := source.read(1024 * 1024):
                        count += len(chunk)
                        if count > expected.size:
                            raise ValueError("workspace archive exceeds its declared size")
                        digest.update(chunk)
                        output.write(chunk)
                if count != expected.size or digest.hexdigest() != expected.sha256:
                    raise ValueError("workspace archive checksum mismatch")
            counts = verify_workspace(extract_to, manifest)
        return BackupInspection(
            sha256=sha_file(path),
            size=path.stat().st_size,
            manifest=manifest,
            **counts,
            warnings=WARNINGS,
        )
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as exc:
        raise ValueError("invalid workspace archive") from exc


def verify_workspace(root: Path, manifest: BackupManifest) -> dict:
    expected = {entry.path: entry for entry in manifest.entries}
    regular_path(root)
    pending = [root]
    while pending:
        for path in pending.pop().iterdir():
            regular_path(path)
            if path.is_dir():
                pending.append(path)
    extensions = {
        name for name, _ in settings_files(root, include_credentials=manifest.includes_credentials)
    }
    actual = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
    if any(path.is_symlink() for path in root.rglob("*")):
        raise ValueError("staged workspace contains a link")
    if actual != set(expected):
        raise ValueError("staged workspace files do not match its manifest")
    for name, entry in expected.items():
        target = root / name
        if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
            raise ValueError("staged workspace contains a link")
        if target.stat().st_size != entry.size or sha_file(target) != entry.sha256:
            raise ValueError("staged workspace checksum mismatch")
    store, jobs = readonly(root / "mio.sqlite3"), readonly(root / "jobs.sqlite3")
    try:
        counts, assets = validate_databases(store, jobs)
        if set(expected) != DATABASES | assets.keys() | extensions:
            raise ValueError("workspace asset files do not match asset metadata")
        for name, asset in assets.items():
            if expected[name].sha256 != asset.id or expected[name].size != asset.size:
                raise ValueError("workspace asset content hash or size is invalid")
        return counts
    finally:
        store.close()
        jobs.close()


def pack(root: Path, manifest: BackupManifest, destination: Path) -> None:
    temporary = destination.with_suffix(".partial")
    try:
        with zipfile.ZipFile(temporary, "w", allowZip64=True) as archive:
            archive.writestr("manifest.json", manifest.model_dump_json())
            for entry in manifest.entries:
                archive.write(root / entry.path, entry.path, compress_type=zipfile.ZIP_STORED)
        if temporary.stat().st_size > MAX_ARCHIVE:
            raise ValueError("workspace archive exceeds 2 GiB")
        shutil.move(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
