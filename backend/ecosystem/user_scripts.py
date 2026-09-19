"""Mio User Scripts (应用内动态脚本).

Single ES-module user scripts that require no packaging or zip bundles.
Each script gets a full extension context (`ctx.core`, `ctx.mounts`, `ctx.around`,
`ctx.keymap`, `ctx.events`, `ctx.styles`, `ctx.albums`) and a declarative cleanup
function returned upon execution.
"""

import json
import re
import threading
import time
import uuid
from pathlib import Path
from backend.mio_library import LibraryError, atomic_write
from .storage import owned

SCRIPT_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
MAX_SOURCE = 8 * 1024 * 1024  # 8 MiB per script file


def slug(text, fallback="script"):
    s = re.sub(r"[^a-z0-9_-]+", "-", str(text or "").lower()).strip("-")
    if not s or not re.match(r"^[a-z0-9]", s):
        s = fallback + "-" + uuid.uuid4().hex[:8]
    return s[:64]
TEMPLATE = (
    "/* 用户脚本：export default function(ctx) { ... }，可返回清理函数。\n"
    "   ctx 与扩展完全相同：ctx.core / ctx.slots / ctx.mount / ctx.events / ctx.keys / ctx.styles / ctx.albums … */\n"
    "export default function (ctx) {\n"
    "  ctx.ui.toast('用户脚本已加载');\n"
    "  return () => {};\n"
    "}\n"
)


class UserScripts:
    """Manages user-defined standalone ES modules in <data>/scripts."""

    def __init__(self, data_dir):
        self.root = Path(data_dir) / "scripts"
        self.root.mkdir(parents=True, exist_ok=True)
        self.registry_file = self.root / "registry.json"
        self.lock = threading.RLock()

    def _file(self, script_id):
        if not SCRIPT_ID.fullmatch(str(script_id)):
            raise LibraryError("Invalid script id: " + str(script_id), 400)
        return owned(self.root, str(script_id) + ".js")

    def registry(self):
        with self.lock:
            if not self.registry_file.is_file():
                return []
            try:
                data = json.loads(self.registry_file.read_text(encoding="utf-8"))
                return data if isinstance(data, list) else []
            except (ValueError, OSError):
                return []

    def _save_registry(self, rows):
        with self.lock:
            atomic_write(self.registry_file, json.dumps(rows, ensure_ascii=False, indent=2).encode("utf-8"))

    def _source(self, script_id):
        path = self._file(script_id)
        if not path.is_file():
            return TEMPLATE
        try:
            return path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return path.read_bytes().decode("utf-8", errors="replace")

    def url(self, item):
        return "/user-scripts/" + item["id"] + ".js?v=" + str(int(item.get("updatedAt", 0)))

    def list(self, with_source=False):
        rows = []
        raw_list = sorted(self.registry(), key=lambda x: (x.get("order", 0), x.get("createdAt", 0)))
        for index, item in enumerate(raw_list):
            path = self._file(item["id"])
            row = {
                **item,
                "order": index,
                "size": path.stat().st_size if path.is_file() else 0,
                "url": self.url(item),
            }
            if with_source:
                row["source"] = self._source(item["id"])
            rows.append(row)
        return rows

    def get(self, script_id):
        item = next((x for x in self.registry() if x["id"] == script_id), None)
        if not item:
            raise LibraryError("User script not found: " + str(script_id), 404)
        return {**item, "source": self._source(script_id), "url": self.url(item)}

    def enabled(self):
        return [row for row in self.list(with_source=True) if row.get("enabled")]

    def save(self, body):
        body = body if isinstance(body, dict) else {}
        with self.lock:
            rows = self.registry()
            now = time.time()
            script_id = body.get("id")
            item = next((x for x in rows if x["id"] == script_id), None) if script_id else None

            if item is None:
                name = str(body.get("name") or "新用户脚本")[:80]
                base = (
                    script_id
                    if isinstance(script_id, str) and SCRIPT_ID.fullmatch(script_id)
                    else slug(name, "script")
                )
                candidate, n = base, 2
                existing = {x["id"] for x in rows}
                while candidate in existing:
                    candidate = base[:28] + "-" + str(n)
                    n += 1
                item = {
                    "id": candidate,
                    "name": name,
                    "enabled": body.get("enabled", True) is not False,
                    "order": len(rows),
                    "createdAt": now,
                    "updatedAt": now,
                }
                rows.append(item)
                if "source" not in body:
                    body["source"] = TEMPLATE

            if "name" in body and isinstance(body["name"], str) and body["name"].strip():
                item["name"] = body["name"].strip()[:80]
            if "enabled" in body:
                item["enabled"] = bool(body["enabled"])
            if "source" in body:
                source = body["source"]
                if not isinstance(source, str):
                    raise LibraryError("source must be text")
                raw = source.encode("utf-8")
                if len(raw) > MAX_SOURCE:
                    raise LibraryError("Script source exceeds 8 MiB", 413)
                atomic_write(self._file(item["id"]), raw)
                item["updatedAt"] = now
            if "note" in body:
                item["note"] = str(body.get("note") or "")[:400]

            self._save_registry(rows)
            return self.get(item["id"])

    def delete(self, script_id):
        with self.lock:
            rows = self.registry()
            rows = [x for x in rows if x["id"] != script_id]
            self._save_registry(rows)
            path = self._file(script_id)
            if path.exists():
                path.unlink()
            return self.list(with_source=False)

    def reorder(self, ids):
        with self.lock:
            rows = self.registry()
            by_id = {x["id"]: x for x in rows}
            ordered = [by_id[i] for i in ids if isinstance(i, str) and i in by_id]
            ordered += [x for x in rows if x not in ordered]
            for index, item in enumerate(ordered):
                item["order"] = index
            self._save_registry(ordered)
            return self.list(with_source=False)

    def disable_all(self):
        with self.lock:
            rows = self.registry()
            for item in rows:
                item["enabled"] = False
            self._save_registry(rows)

    def script_path(self, filename_or_id):
        clean = str(filename_or_id).split("?")[0].strip()
        if clean.endswith(".js"):
            clean = clean[:-3]
        if not SCRIPT_ID.fullmatch(clean):
            raise LibraryError("Script not found", 404)
        path = self._file(clean)
        if not path.is_file():
            raise LibraryError("Script file not found", 404)
        return path
