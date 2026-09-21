"""Production-owned immutable records with an atomic per-task commit pointer.

Snapshots, preparation results, pages and individual attempts are separate JSON
objects. A failed write cannot expose half a new task revision. Old objects are
retained: no automatic eviction of potentially paid results.
"""

import copy
import hashlib
import json
import os
from pathlib import Path
import threading
from backend.mio_library import atomic_write, LibraryError, owned_path


class TaskStore:
    def __init__(self, root):
        self.root = Path(root)
        self.lock = threading.RLock()

    def file(self, key):
        if (
            not isinstance(key, str)
            or not key.startswith("assembly-")
            or len(key) > 100
            or not all(c.isalnum() or c == "-" for c in key)
        ):
            raise LibraryError("Invalid production identity")
        return owned_path(self.root, key + ".json")

    def _put(self, value):
        raw = json.dumps(
            value, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode()
        if len(raw) > 32 * 1024 * 1024:
            raise LibraryError("单个生产记录超过 32 MiB；请缩短提示词或输出")
        key = hashlib.sha256(raw).hexdigest()
        path = owned_path(self.root, "objects/" + key + ".json")
        if not path.exists():
            atomic_write(path, raw)
            os.chmod(path, 0o600)
        return key

    def _read(self, key):
        if (
            not isinstance(key, str)
            or len(key) != 64
            or any(c not in "0123456789abcdef" for c in key)
        ):
            raise LibraryError("Invalid production object")
        raw = owned_path(self.root, "objects/" + key + ".json").read_bytes()
        if hashlib.sha256(raw).hexdigest() != key:
            raise LibraryError("生产记录校验失败；未使用损坏的输入")
        return json.loads(raw)

    @staticmethod
    def page_summary(page):
        result = page.get("result")
        return {
            "index": page["index"], "state": page["state"],
            "result": {k: v for k, v in result.items() if k in ("image", "name")} if result else None,
            "attemptCount": len(page["attempts"]),
            "attempts": [{k: v for k, v in a.items() if k in ("status", "phase", "error", "upstream")}
                         for a in page["attempts"][-3:]],
        }

    def set(self, key, value):
        with self.lock:
            manifest = {
                k: copy.deepcopy(v)
                for k, v in value.items()
                if k not in ("snapshot", "prepared", "pages")
            }
            manifest["format"] = 1
            manifest["snapshotRef"] = self._put(value["snapshot"])
            manifest["preparedRef"] = self._put(value.get("prepared"))
            snapshot = value["snapshot"]
            manifest["sourceSummary"] = {
                "story": {"title": snapshot["story"].get("title", "")},
                "presets": [
                    {"title": p.get("title", "")} for p in snapshot.get("presets", [])
                ],
                "channel": {"title": snapshot.get("channel", {}).get("title", ""), "provider": snapshot.get("channel", {}).get("provider", "")},
                "overrides": copy.deepcopy(snapshot.get("overrides")) or None,
                "projectId": snapshot.get("projectId"),
            }
            refs = []
            for page in value["pages"]:
                record = {
                    k: v
                    for k, v in page.items()
                    if k not in ("attempts", "attemptCount")
                }
                record["attemptRefs"] = [self._put(a) for a in page["attempts"]]
                refs.append(self._put(record))
            manifest["pageRefs"] = refs
            manifest["pageSummaries"] = [self.page_summary(p) for p in value["pages"]]
            atomic_write(
                self.file(key),
                json.dumps(manifest, ensure_ascii=False, allow_nan=False).encode(),
            )
            os.chmod(self.file(key), 0o600)
        return value

    def get(self, key, default=None, summary=False):
        with self.lock:
            file = self.file(key)
            if not file.exists():
                return default
            manifest = json.loads(file.read_text(encoding="utf-8"))
            if manifest.get("format") != 1:
                raise LibraryError("生产记录不是当前格式；请使用新的生产目录")
            result = {
                k: v
                for k, v in manifest.items()
                if k
                not in (
                    "format",
                    "snapshotRef",
                    "preparedRef",
                    "pageRefs",
                    "pageSummaries",
                    "sourceSummary",
                )
            }
            result["snapshot"] = (
                manifest["sourceSummary"]
                if summary
                else self._read(manifest["snapshotRef"])
            )
            result["prepared"] = (
                None if summary else self._read(manifest["preparedRef"])
            )
            if summary and "pageSummaries" in manifest:
                result["pages"] = manifest["pageSummaries"]
                return result
            result["pages"] = []
            for ref in manifest["pageRefs"]:
                page = self._read(ref)
                attempts = page.pop("attemptRefs")
                page["attempts"] = [
                    self._read(a) for a in (attempts[-3:] if summary else attempts)
                ]
                if summary:
                    page["attemptCount"] = len(attempts)
                    if page.get("result"):
                        page["result"] = {
                            k: v
                            for k, v in page["result"].items()
                            if k in ("image", "name")
                        }
                    for attempt in page["attempts"]:
                        attempt.pop("rawError", None)
                        if attempt.get("result"):
                            attempt["result"] = {
                                k: v
                                for k, v in attempt["result"].items()
                                if k in ("image", "name")
                            }
                result["pages"].append(page)
            if summary:
                # One-time, atomic cache upgrade for existing tasks, never re-run providers.
                manifest["pageSummaries"] = [self.page_summary(p) for p in result["pages"]]
                for cached, page in zip(manifest["pageSummaries"], result["pages"]):
                    cached["attemptCount"] = page.get("attemptCount", cached["attemptCount"])
                atomic_write(file, json.dumps(manifest, ensure_ascii=False, allow_nan=False).encode())
                result["pages"] = manifest["pageSummaries"]
            return result

    def delete(self, key):
        with self.lock:
            self.file(key).unlink(missing_ok=True)
