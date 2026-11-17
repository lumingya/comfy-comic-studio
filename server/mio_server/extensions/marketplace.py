"""A small, replaceable directory of portable extension packages.

Browsing never activates code. Installing pins both the selected directory and the package
checksum; the existing extension manager still requires a separate review/enable operation.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import threading
import time
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..models import now_iso
from ..storage import Conflict, NotFound
from .manager import BUILTIN_ROOT, MAX_ZIP, ExtensionError
from .manifest import MANIFEST, Manifest, read_manifest

CATALOG_LIMIT = 2 * 1024 * 1024
CACHE_SECONDS = 600
_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def web_url(value: str) -> str:
    """Only public-form HTTP URLs; credentials must never enter a stored directory."""
    value = value.strip()
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme.lower() in {"http", "https"}
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and not any(c.isspace() or ord(c) < 32 for c in value)
        )
        _ = parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("地址须为不含用户名或密码的 HTTP / HTTPS 地址")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc, parsed.path, parsed.query, ""))


class Entry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,47}$")
    name: str = Field(min_length=1, max_length=200)
    version: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=4000)
    author: str = Field(default="", max_length=200)
    homepage: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list, max_length=30)
    package_url: str
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")

    @field_validator("package_url")
    @classmethod
    def package_address(cls, value: str) -> str:
        return web_url(value)

    @field_validator("sha256")
    @classmethod
    def checksum(cls, value: str) -> str:
        return value.lower()


class Catalog(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format_version: int = Field(default=1, ge=1, le=1)
    items: list[Entry] = Field(max_length=500)

    @field_validator("items")
    @classmethod
    def unique_ids(cls, value: list[Entry]) -> list[Entry]:
        if len({item.id for item in value}) != len(value):
            raise ValueError("扩展目录中存在重复 ID")
        return value


def _download(url: str, limit: int) -> bytes:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        with client.stream("GET", url) as response:
            web_url(str(response.url))
            response.raise_for_status()
            length = response.headers.get("content-length", "")
            if length.isdigit() and int(length) > limit:
                raise ValueError("下载内容超过大小限制")
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > limit:
                    raise ValueError("下载内容超过大小限制")
            return bytes(content)


def _package_manifest(data: bytes) -> Manifest:
    """Read exactly the manifest the ZIP importer will use, without writing anything."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = [name for name in archive.namelist() if not name.endswith("/")]
            roots = {PurePosixPath(name).parts[0] for name in names if name}
            prefix = ""
            if len(roots) == 1 and all("/" in name for name in names):
                prefix = next(iter(roots)) + "/"
            manifest = archive.getinfo(prefix + MANIFEST)
            if manifest.file_size > CATALOG_LIMIT:
                raise ValueError("扩展清单过大")
            return Manifest.model_validate_json(archive.read(manifest))
    except (zipfile.BadZipFile, KeyError, ValueError, RuntimeError, NotImplementedError) as exc:
        raise ValueError("扩展包缺少有效的 mio-extension.json") from exc


class Marketplace:
    def __init__(self, ctx):
        self.ctx = ctx
        self.path = Path(ctx.data_dir) / "extension-market.json"
        with _locks_guard:
            self.lock = _locks.setdefault(str(self.path.resolve()), threading.RLock())

    def _read(self) -> dict:
        if not self.path.exists():
            return {"url": "", "catalog": [], "checked_at": "", "fetched_at": 0, "error": ""}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError("扩展市场设置无效")
            return value
        except (OSError, ValueError) as exc:
            raise ValueError("无法读取扩展市场设置") from exc

    def _save(self, state: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)

    def set_source(self, url: str) -> dict:
        url = web_url(url) if url.strip() else ""
        with self.lock:
            old = self._read()
            if old.get("url", "") != url:
                # Never reuse installable packages from the previous source.
                self._save(
                    {"url": url, "catalog": [], "checked_at": "", "fetched_at": 0, "error": ""}
                )
            return self.catalog(refresh=True)

    def _bundled(self) -> list[dict]:
        directory = json.loads((BUILTIN_ROOT / "catalog.json").read_text(encoding="utf-8"))
        items = []
        for entry in directory["items"]:
            ext_id = entry["id"]
            if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,47}", ext_id):
                continue
            folder = BUILTIN_ROOT / ext_id
            if not (folder / MANIFEST).is_file():
                continue
            manifest = read_manifest(folder)
            items.append(
                {
                    **{
                        key: getattr(manifest, key)
                        for key in ("id", "name", "version", "description", "author", "homepage")
                    },
                    "tags": entry.get("tags", []),
                    "source": "bundled",
                    "package_url": "",
                    "sha256": "",
                }
            )
        return items

    def catalog(self, *, refresh: bool = False) -> dict:
        with self.lock:
            state = self._read()
            url = state.get("url", "")
            if url and (refresh or time.time() - state.get("fetched_at", 0) >= CACHE_SECONDS):
                state["checked_at"] = now_iso()
                state["fetched_at"] = time.time()
                try:
                    directory = Catalog.model_validate_json(_download(url, CATALOG_LIMIT))
                    state["catalog"] = [item.model_dump() for item in directory.items]
                    state["error"] = ""
                except (httpx.HTTPError, ValueError, OSError):
                    state["error"] = "暂时无法获取扩展目录，可重试或更换目录地址"
                self._save(state)
            items = {item["id"]: item for item in self._bundled()}
            if url:
                for entry in Catalog(items=state.get("catalog", [])).items:
                    items[entry.id] = {**entry.model_dump(), "source": "remote"}
            entries = list(items.values())
            encoded = json.dumps(
                {"url": url, "items": entries}, ensure_ascii=False, sort_keys=True
            ).encode("utf-8")
            digest = hashlib.sha256(encoded).hexdigest()
            installed = {info.id: info for info in self.ctx.extensions.list()}
            for item in entries:
                info = installed.get(item["id"])
                item["installed"] = (
                    {
                        "version": info.manifest.version if info.manifest else "",
                        "status": info.status,
                        "digest": info.digest,
                        "builtin": info.builtin,
                    }
                    if info
                    else None
                )
                if not info:
                    action = "install"
                elif item["source"] == "remote" and (
                    not info.manifest or info.manifest.version != item["version"]
                ):
                    action = "update"
                elif info.manifest and info.manifest.version != item["version"]:
                    action = "installed"
                else:
                    action = "installed" if info.status == "active" else "enable"
                item["action"] = action
            return {
                "source": {
                    "url": url,
                    "builtin": not bool(url),
                    "checked_at": state.get("checked_at", ""),
                    "error": state.get("error", ""),
                },
                "catalog_digest": digest,
                "items": entries,
            }

    def install(self, ext_id: str, catalog_digest: str, sha256: str) -> dict:
        with self.lock:
            catalog = self.catalog()
            if catalog["catalog_digest"] != catalog_digest:
                raise Conflict("扩展目录已更改，请刷新后重新选择")
            item = next((item for item in catalog["items"] if item["id"] == ext_id), None)
            if not item:
                raise NotFound("扩展不在当前目录中")
            if item["source"] != "remote":
                raise ValueError("随包扩展已安装，请查看并启用")
            if item["sha256"] != sha256.lower():
                raise Conflict("所选扩展包已更改，请刷新后重试")
            try:
                payload = _download(item["package_url"], MAX_ZIP)
            except (httpx.HTTPError, OSError) as exc:
                raise ValueError("无法下载扩展包，请稍后重试") from exc
            if hashlib.sha256(payload).hexdigest() != item["sha256"]:
                raise ValueError("扩展包 SHA256 校验失败，未安装")
            manifest = _package_manifest(payload)
            if (manifest.id, manifest.version) != (ext_id, item["version"]):
                raise ValueError("扩展包的 ID 或版本与目录不一致，未安装")
            try:
                self.ctx.extensions.info(ext_id)
                replace = True
            except ExtensionError:
                replace = False
            return self.ctx.extensions.install(payload, replace=replace).to_json()
