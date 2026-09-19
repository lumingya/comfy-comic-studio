"""Asset retention for content-addressed image pools.

Generated and imported images live in ``assets/images/<sha256>.<ext>`` (older
workspaces may still carry the legacy pools listed in
``mio_native_store.POOLS``). Every document that mentions an image — albums,
storyboards, presets, production tasks, preparation records, settings and
extension data — pins it by name. Anything nobody mentions for longer than the
grace period is an orphan and can be moved to ``.trash/assets/<batch>/``.

Album-owned files (``albums/<title--id>/images``) are never candidates: they
are part of the album, not of a pool.

CLI: ``python tools/gc_assets.py [--apply] [--grace-hours 24]``.
"""

import hashlib
import json
import os
import re
import shutil
import sqlite3
import time
from pathlib import Path

from backend.mio_library import LibraryError, owned_path
from backend.mio_native_store import POOLS

NAME = re.compile(r"[a-f0-9]{64}\.(?:png|jpe?g|webp|svg)")
GRACE_HOURS = 24
# Folders that hold caches, derived data or files awaiting deletion: nothing
# inside them may keep an asset alive.
SKIP_DIRS = {".cache", ".transactions", ".trash", "trash", "runtime/thumbnails", "runtime/assets", "runtime/staging", "runtime/execution", "assets"}
TRASH = ".trash/assets"


def _skip(relative):
    parts = relative.split("/")
    if parts[0] in SKIP_DIRS or "/".join(parts[:2]) in SKIP_DIRS:
        return True
    return len(parts) >= 3 and parts[0] == "extensions" and parts[2] in ("tmp", "cache")


def scan_references(root):
    """Map asset name -> sorted list of referrers (directory-level labels)."""
    root = Path(root)
    refs = {}
    for directory, dirs, files in os.walk(root):
        rel_dir = Path(directory).relative_to(root).as_posix()
        if rel_dir != "." and _skip(rel_dir):
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if not (Path(directory, d).is_symlink())]
        for name in files:
            if not name.endswith(".json") or name.startswith("."):
                continue
            path = Path(directory) / name
            try:
                if path.is_symlink() or path.stat().st_size > 64 * 1024 * 1024:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            label = rel_dir if rel_dir != "." else name
            for found in set(NAME.findall(text)):
                refs.setdefault(found, set()).add(label)
    db = root / "runtime/execution/jobs.sqlite3"
    if db.is_file():
        try:
            with sqlite3.connect("file:" + str(db) + "?mode=ro", uri=True) as conn:
                for table, column in (("jobs", "payload"), ("jobs", "results"), ("request_inputs", "input")):
                    try:
                        rows = conn.execute("SELECT " + column + " FROM " + table).fetchall()
                    except sqlite3.Error:
                        continue
                    for (value,) in rows:
                        if isinstance(value, (str, bytes)):
                            text = value.decode("utf-8", "ignore") if isinstance(value, bytes) else value
                            for found in set(NAME.findall(text)):
                                refs.setdefault(found, set()).add("runtime/execution/jobs")
        except sqlite3.Error:
            pass
    return {name: sorted(labels) for name, labels in refs.items()}


def pool_files(root):
    root = Path(root)
    for pool in POOLS:
        folder = root / pool
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if path.is_file() and not path.is_symlink() and NAME.fullmatch(path.name):
                yield pool, path


def inventory(root, grace_hours=GRACE_HOURS):
    root = Path(root)
    refs = scan_references(root)
    now = time.time()
    pools = {}
    orphans = []
    referenced = 0
    grace = 0
    total_bytes = 0
    for pool, path in pool_files(root):
        stat = path.stat()
        entry = pools.setdefault(pool, {"pool": pool, "files": 0, "bytes": 0})
        entry["files"] += 1
        entry["bytes"] += stat.st_size
        total_bytes += stat.st_size
        if path.name in refs:
            referenced += 1
            continue
        age_hours = (now - stat.st_mtime) / 3600
        if age_hours < grace_hours:
            grace += 1
            continue
        orphans.append({"name": path.name, "pool": pool, "url": "/images/assets/" + path.name, "bytes": stat.st_size, "ageHours": round(age_hours, 1)})
    orphans.sort(key=lambda o: o["name"])
    token = hashlib.sha256(json.dumps([[o["pool"], o["name"], o["bytes"]] for o in orphans]).encode()).hexdigest()
    return {
        "pools": sorted(pools.values(), key=lambda p: p["pool"]),
        "totalBytes": total_bytes,
        "referenced": referenced,
        "inGrace": grace,
        "orphans": orphans,
        "orphanBytes": sum(o["bytes"] for o in orphans),
        "graceHours": grace_hours,
        "token": token,
        "trash": list_trash(root),
    }


def collect(root, token, grace_hours=GRACE_HOURS, busy=lambda: False):
    """Move every orphan to .trash/assets/<batch>/. Requires the preview token."""
    root = Path(root)
    if busy():
        raise LibraryError("生成队列仍在运行；请先暂停或等待完成后再清理", 409)
    report = inventory(root, grace_hours)
    if token != report["token"]:
        raise LibraryError("资产引用已变化，请重新预览后再执行清理", 409)
    if not report["orphans"]:
        return {**report, "moved": [], "batch": None}
    batch = time.strftime("%Y%m%d-%H%M%S") + "-" + str(int(time.time() * 1000) % 1000)
    target = owned_path(root, TRASH + "/" + batch)
    target.mkdir(parents=True, exist_ok=True)
    moved = []
    for orphan in report["orphans"]:
        source = owned_path(root, orphan["pool"] + "/" + orphan["name"])
        try:
            os.replace(source, target / orphan["name"])
            moved.append(orphan["url"])
        except OSError:
            continue
    (target / "manifest.json").write_text(json.dumps({"batch": batch, "at": time.time(), "moved": moved}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {**inventory(root, grace_hours), "moved": moved, "batch": batch}


def list_trash(root):
    folder = Path(root) / TRASH
    items = []
    if folder.is_dir():
        for child in sorted(folder.iterdir()):
            if child.is_dir():
                files = [p for p in child.iterdir() if p.is_file() and NAME.fullmatch(p.name)]
                items.append({"batch": child.name, "files": len(files), "bytes": sum(p.stat().st_size for p in files)})
    return items


def restore(root, batch):
    """Move a trash batch back into the canonical pool."""
    root = Path(root)
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}-[0-9]{1,3}", str(batch)):
        raise LibraryError("Unknown trash batch", 404)
    folder = owned_path(root, TRASH + "/" + batch)
    if not folder.is_dir():
        raise LibraryError("Unknown trash batch", 404)
    pool = root / "assets/images"
    pool.mkdir(parents=True, exist_ok=True)
    restored = []
    for path in list(folder.iterdir()):
        if path.is_file() and NAME.fullmatch(path.name):
            if not (pool / path.name).exists():
                os.replace(path, pool / path.name)
            else:
                path.unlink()
            restored.append("/images/assets/" + path.name)
    shutil.rmtree(folder, ignore_errors=True)
    return {"restored": restored}


def purge_trash(root, older_than_days=30):
    """Permanently delete trash batches older than N days (explicit call only)."""
    root = Path(root)
    folder = root / TRASH
    removed = []
    if folder.is_dir():
        for child in list(folder.iterdir()):
            if child.is_dir() and time.time() - child.stat().st_mtime > older_than_days * 86400:
                shutil.rmtree(owned_path(root, TRASH + "/" + child.name), ignore_errors=True)
                removed.append(child.name)
    return {"removed": removed}
