"""Recycle bin over ``.trash/`` (UX A8).

Every entity removal (``NativeStore.apply`` and ``FileLibrary.delete``) already
moves the JSON file, its ``.assets`` sidecar or the whole album folder into
``.trash/<32 hex>/`` next to a ``receipt.json``::

    {"kind": "albums", "id": "...", "original": "albums/x--id/album.json", "deletedAt": ms}

This module lists those entries, moves them back, and deletes them for good.
Two more kinds of batch share the same folder:

* ``.trash/assets/<batch>/``  orphan pool images moved by ``mio_assets.collect``;
* ``.trash/files/<ns>/``      legacy ``/images/`` files recycled by
  ``mio_foundation.cleanup`` (``manifest.json`` lists the original paths).

Nothing here deletes anything unless it is called explicitly; automatic purge is
driven by the retention setting the browser sends (default 30 days).
"""

import json
import os
import re
import shutil
import sqlite3
import time
from contextlib import closing
from pathlib import Path, PurePosixPath

from backend.mio_library import KINDS, LibraryError, decode, encode, owned_path

ENTRY = re.compile(r"[0-9a-f]{32}")
FILES = ".trash/files"
FILE_BATCH = re.compile(r"[0-9]{6,24}")
# Kinds a person deletes on purpose. Generation tasks, character records and
# assistant conversations are removed in bulk as side effects and would bury
# the useful entries; they stay restorable by id and are counted separately.
USER_KINDS = ("albums", "storyboards", "characters", "scenes", "collections", "layouts", "workflows", "plans")
RETENTION_DAYS = (0, 7, 30, 90)
DEFAULT_RETENTION = 30


def _trash(root):
    return Path(root) / ".trash"


def _size(path):
    if path.is_file():
        return path.stat().st_size
    total = 0
    for directory, _, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(directory, name)).st_size
            except OSError:
                pass
    return total


def _receipt(root, entry):
    if not ENTRY.fullmatch(str(entry)):
        raise LibraryError("回收站里没有这一项", 404, "not_found")
    folder = owned_path(Path(root), ".trash/" + entry)
    try:
        receipt = decode((folder / "receipt.json").read_bytes())
    except (OSError, ValueError):
        raise LibraryError("回收站里没有这一项", 404, "not_found") from None
    kind, original = receipt.get("kind"), receipt.get("original")
    if kind not in KINDS or not isinstance(original, str) or not isinstance(receipt.get("id"), str):
        raise LibraryError("回收记录已损坏，只能永久删除", 409, "invalid_receipt")
    prefix = PurePosixPath(KINDS[kind][0])
    rel = PurePosixPath(original)
    if rel.parts[: len(prefix.parts)] != prefix.parts or ".." in rel.parts:
        raise LibraryError("回收记录指向资源目录之外，只能永久删除", 409, "invalid_receipt")
    return folder, receipt


def _moves(root, folder, receipt):
    """(source in trash, original target) pairs for one receipt."""
    original = Path(root) / receipt["original"]
    if receipt["kind"] == "albums":
        pairs = [(folder / original.parent.name, original.parent)]
        document = folder / original.parent.name / "album.json"
    else:
        pairs = [(folder / original.name, original)]
        sidecar = original.with_suffix(".assets")
        if (folder / sidecar.name).exists():
            pairs.append((folder / sidecar.name, sidecar))
        document = folder / original.name
    return pairs, document


def _title(document, fallback):
    try:
        doc = json.loads(document.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback, None
    title = doc.get("title") or doc.get("name") or doc.get("bookTitle") or doc.get("character") or fallback
    return str(title)[:200], doc.get("projectId") if isinstance(doc.get("projectId"), str) else None


def _catalog_has(library, kind, id):
    if library is None:
        return False
    with library.cache_lock:
        return bool(library.db.execute("SELECT 1 FROM catalog WHERE kind=? AND id=?", (kind, id)).fetchone())


def _entry(root, child, library=None):
    folder, receipt = _receipt(root, child.name)
    pairs, document = _moves(root, folder, receipt)
    title, project = _title(document, receipt["id"])
    conflict = ""
    if not all(source.exists() for source, _ in pairs[:1]):
        conflict = "missing"
    elif any(target.exists() for _, target in pairs):
        conflict = "path"
    elif _catalog_has(library, receipt["kind"], receipt["id"]):
        conflict = "id"
    return {
        "trashId": child.name,
        "kind": receipt["kind"],
        "id": receipt["id"],
        "title": title,
        "projectId": project,
        "original": receipt["original"],
        "deletedAt": int(receipt.get("deletedAt") or child.stat().st_mtime * 1000),
        "bytes": _size(folder),
        "conflict": conflict,
    }


def _file_batches(root):
    folder = Path(root) / FILES
    out = []
    if folder.is_dir():
        for child in sorted(folder.iterdir()):
            if not child.is_dir() or not FILE_BATCH.fullmatch(child.name):
                continue
            try:
                manifest = json.loads((child / "manifest.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                manifest = {}
            moved = manifest.get("moved") if isinstance(manifest.get("moved"), list) else []
            out.append({
                "batch": child.name,
                "files": len(moved),
                "bytes": _size(child),
                "deletedAt": int(float(manifest.get("at") or child.stat().st_mtime) * 1000),
            })
    return out


def list_items(root, library=None, all_kinds=False):
    """Everything restorable, newest first, plus totals for hidden kinds."""
    from backend import mio_assets

    items, hidden = [], {"count": 0, "bytes": 0}
    trash = _trash(root)
    if trash.is_dir():
        for child in trash.iterdir():
            if not child.is_dir() or not ENTRY.fullmatch(child.name):
                continue
            try:
                item = _entry(root, child, library)
            except LibraryError as exc:
                items.append({"trashId": child.name, "kind": "unknown", "id": "", "title": str(exc), "original": "",
                              "deletedAt": int(child.stat().st_mtime * 1000), "bytes": _size(child), "conflict": "invalid"})
                continue
            if all_kinds or item["kind"] in USER_KINDS:
                items.append(item)
            else:
                hidden["count"] += 1
                hidden["bytes"] += item["bytes"]
    items.sort(key=lambda item: item["deletedAt"], reverse=True)
    assets = []
    for batch in mio_assets.list_trash(root):
        try:
            at = int((trash / "assets" / batch["batch"]).stat().st_mtime * 1000)
        except OSError:
            at = 0
        assets.append({**batch, "deletedAt": at})
    return {"items": items, "hidden": hidden, "assets": assets, "files": _file_batches(root),
            "retentionDays": list(RETENTION_DAYS), "defaultRetentionDays": DEFAULT_RETENTION}


def _newest(root, kind, id):
    best = None
    trash = _trash(root)
    if trash.is_dir():
        for child in trash.iterdir():
            if not child.is_dir() or not ENTRY.fullmatch(child.name):
                continue
            try:
                _, receipt = _receipt(root, child.name)
            except LibraryError:
                continue
            if receipt["kind"] == kind and receipt["id"] == id:
                at = receipt.get("deletedAt") or 0
                if best is None or at > best[0]:
                    best = (at, child.name)
    if best is None:
        raise LibraryError("回收站里找不到这一项，可能已被永久删除", 404, "not_found")
    return best[1]


def undelete_albums(root, ids):
    """Drop durable album tombstones so a restored album is visible again."""
    path = Path(root) / "runtime" / "execution" / "jobs.sqlite3"
    if not ids or not path.is_file():
        return
    with closing(sqlite3.connect(str(path), timeout=30)) as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='deleted_albums'").fetchone():
            with db:
                db.executemany("DELETE FROM deleted_albums WHERE id=?", [(i,) for i in ids])


def restore(store, trash_id=None, kind=None, id=None, before_commit=None):
    """Move one entry back to its original path and re-index it.

    ``store`` is the NativeStore. Pass either ``trash_id`` or ``kind`` + ``id``
    (the newest matching receipt is used, which is what "undo" wants).
    """
    root = store.root
    library = store.library
    with library.writer():
        library._recover()
        if not trash_id:
            if kind not in KINDS or not isinstance(id, str):
                raise LibraryError("缺少要恢复的项目", 400)
            trash_id = _newest(root, kind, id)
        folder, receipt = _receipt(root, trash_id)
        pairs, document = _moves(root, folder, receipt)
        kind, id = receipt["kind"], receipt["id"]
        if not pairs[0][0].exists():
            raise LibraryError("回收站里的文件已经不在了，只能永久删除这条记录", 409, "missing")
        if any(target.exists() for _, target in pairs):
            raise LibraryError("原位置已经有同名文件，没有覆盖任何内容。请先改名或移走原位置的文件", 409, "path_conflict")
        if _catalog_has(library, kind, id):
            raise LibraryError("已存在同一 ID 的内容（可能已经恢复过），没有覆盖任何内容", 409, "id_conflict")
        title, project = _title(document, id)
        if before_commit:
            before_commit(kind, id)
        revision = max(int(time.time() * 1000), store.revision() + 1)
        operations = [
            {"type": "move", "source": source.relative_to(root).as_posix(), "path": target.relative_to(root).as_posix()}
            for source, target in pairs
        ]
        operations.append(("runtime/revision.json", encode({"value": revision})))
        library._commit(operations)
        library._record(kind, Path(root) / receipt["original"])
        shutil.rmtree(folder, ignore_errors=True)
        return {"restored": {"trashId": trash_id, "kind": kind, "id": id, "title": title, "projectId": project},
                "revision": revision}


def purge(root, trash_id):
    """Delete one entry (entity receipt, asset batch or legacy file batch) for good."""
    root = Path(root)
    if ENTRY.fullmatch(str(trash_id)):
        folder = owned_path(root, ".trash/" + trash_id)
    elif re.fullmatch(r"assets:[0-9]{8}-[0-9]{6}-[0-9]{1,3}", str(trash_id)):
        folder = owned_path(root, ".trash/assets/" + trash_id.split(":", 1)[1])
    elif re.fullmatch(r"files:[0-9]{6,24}", str(trash_id)):
        folder = owned_path(root, FILES + "/" + trash_id.split(":", 1)[1])
    else:
        raise LibraryError("回收站里没有这一项", 404, "not_found")
    if not folder.is_dir():
        raise LibraryError("回收站里没有这一项", 404, "not_found")
    size = _size(folder)
    shutil.rmtree(folder)
    return {"purged": [trash_id], "bytes": size}


def _all_ids(root, older_than_ms=None):
    listing = list_items(root, all_kinds=True)
    ids = [(i["trashId"], i["deletedAt"]) for i in listing["items"]]
    ids += [("assets:" + b["batch"], b["deletedAt"]) for b in listing["assets"]]
    ids += [("files:" + b["batch"], b["deletedAt"]) for b in listing["files"]]
    return [i for i, at in ids if older_than_ms is None or at < older_than_ms]


def empty(root):
    purged, size = [], 0
    for trash_id in _all_ids(root):
        try:
            result = purge(root, trash_id)
        except (LibraryError, OSError):
            continue
        purged += result["purged"]
        size += result["bytes"]
    return {"purged": purged, "bytes": size}


def auto_purge(root, days):
    """Purge entries deleted more than ``days`` ago. 0 means never."""
    if not isinstance(days, int) or isinstance(days, bool) or days not in RETENTION_DAYS:
        raise ValueError("保留天数只能是 0（不自动清理）、7、30 或 90")
    if days == 0:
        return {"purged": [], "bytes": 0}
    cutoff = int(time.time() * 1000) - days * 86400 * 1000
    purged, size = [], 0
    for trash_id in _all_ids(root, cutoff):
        try:
            result = purge(root, trash_id)
        except (LibraryError, OSError):
            continue
        purged += result["purged"]
        size += result["bytes"]
    return {"purged": purged, "bytes": size}


def restore_files(root, batch, resolve):
    """Move a legacy ``.trash/files/<batch>`` back. ``resolve(url)`` -> path."""
    root = Path(root)
    if not FILE_BATCH.fullmatch(str(batch)):
        raise LibraryError("回收站里没有这一项", 404, "not_found")
    folder = owned_path(root, FILES + "/" + batch)
    try:
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise LibraryError("回收站里没有这一项", 404, "not_found") from None
    restored, skipped = [], []
    for item in manifest.get("moved", []):
        url, stored = item.get("url"), item.get("stored")
        if not isinstance(url, str) or not isinstance(stored, str):
            continue
        source = owned_path(folder, stored)
        try:
            target = Path(resolve(url))
        except (ValueError, OSError):
            skipped.append(url)
            continue
        if not source.exists() or target.exists():
            skipped.append(url)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, target)
        restored.append(url)
    if not skipped:
        shutil.rmtree(folder, ignore_errors=True)
    return {"restored": restored, "skipped": skipped}
