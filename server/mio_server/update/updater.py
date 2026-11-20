"""Check → download → stage → apply, for installs made from a release zip.

* **check** fetches the signed manifest and compares versions.
* **download** streams the zip into ``<data>/updates/`` and verifies size and sha256.
* **stage** unpacks it to ``<data>/updates/staged/<version>/`` and writes ``pending.json``.
* **apply** runs at the next start through the stable root installation host.
  Signed program entries are exchanged under an installation-root OS lease and a
  persistent journal; backups live in ``<install>/.mio-update/tx-*/backup/``.
  The stable host and launchers, and user data (``data/``, ``server/data/``), are
  preserved. Interrupted exchanges restore the whole previous application before
  dependencies or application modules are loaded on the next launch.

A git checkout (``.git`` present) is a developer install: staging and applying refuse, use git.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import threading
import time
import zipfile
from collections.abc import Callable
from functools import wraps
from pathlib import Path, PurePosixPath

import httpx

from .. import __version__
from . import catalog
from .keys import TRUSTED_KEYS
from .manifest import Manifest, UpdateError, parse_version, verify_manifest
from .recovery import host

DEFAULT_FEED = (
    "https://github.com/lumingya/comfy-comic-studio/releases/latest/download/mio-release.json"
)
RELEASES_PAGE = catalog.RELEASES_PAGE
PRESERVE = host.PRESERVE
MAX_MANIFEST = 1024 * 1024


class UpdateRecoveryError(UpdateError):
    """Program files were restored but the previous runtime could not be prepared."""


def serialized(operation):
    @wraps(operation)
    def guarded(self, *args, **kwargs):
        if not self._execution.acquire(blocking=False):
            raise UpdateError("已有更新操作正在进行")
        try:
            return operation(self, *args, **kwargs)
        finally:
            self._execution.release()

    return guarded


def installation_serialized(operation):
    @serialized
    @wraps(operation)
    def guarded(self, *args, **kwargs):
        try:
            with host.installation_lease(self.root):
                host.recover(self.root)
                host.workspace_updates(self.dir.parent)
                return operation(self, *args, **kwargs)
        except host.RecoveryError as exc:
            raise UpdateRecoveryError(str(exc)) from exc
        except host.InstallError as exc:
            raise UpdateError(str(exc)) from exc

    return guarded


class Updater:
    def __init__(
        self,
        data_dir: Path,
        install_root: Path,
        *,
        current: str = __version__,
        keys: dict[str, str] | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        self.dir = Path(data_dir) / "updates"
        self.root = Path(install_root)
        self.current = current
        self.keys = TRUSTED_KEYS if keys is None else keys
        self.transport = transport
        self.manifest: Manifest | None = None
        saved = self._read_state()
        self.last_check: dict | None = saved.get("last_check")
        self.auto_check = saved.get("auto_check", True)
        self.activity: dict = {"phase": "idle", "error": ""}
        self._lock = threading.Lock()
        self._execution = threading.RLock()
        self._worker: threading.Thread | None = None
        self._started = False
        self._catalog_cache: dict[tuple[int, int], tuple[float, dict]] = {}

    def _read_state(self) -> dict:
        try:
            value = json.loads((self.dir / "state.json").read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save_state(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        target = self.dir / "state.json"
        temporary = target.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"last_check": self.last_check, "auto_check": self.auto_check}),
            encoding="utf-8",
        )
        temporary.replace(target)

    # ------------------------------------------------------------------ info
    @property
    def dev_checkout(self) -> bool:
        return (self.root / ".git").exists()

    def pending(self) -> dict | None:
        path = self.dir / "pending.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None

    def status(self) -> dict:
        return {
            "current": self.current,
            "dev_checkout": self.dev_checkout,
            "keys_configured": bool(self.keys),
            "releases_page": RELEASES_PAGE,
            "last_check": self.last_check,
            "pending": self.pending(),
            "auto_check": self.auto_check,
            "activity": dict(self.activity),
        }

    def preferences(self, auto_check: bool) -> dict:
        with self._lock:
            self.auto_check = auto_check
            self._save_state()
        return self.status()

    def releases(self, page: int = 1, per_page: int = 20, *, refresh: bool = False) -> dict:
        key = (page, per_page)
        cached = self._catalog_cache.get(key)
        if cached and not refresh and time.monotonic() - cached[0] < 300:
            result = cached[1]
        else:
            try:
                with self._http(20) as http:
                    result = catalog.page(http, page, per_page)
            except httpx.HTTPError:
                raise UpdateError("无法连接版本服务器，请检查网络后重试") from None
            self._catalog_cache[key] = (time.monotonic(), result)
        return {**result, "items": [self._release_status(item) for item in result["items"]]}

    def _release_status(self, release: dict) -> dict:
        reason = ""
        if not release["version"]:
            reason = "这个版本不支持应用内安装"
        elif self.dev_checkout:
            reason = "开发目录不切换程序版本"
        elif not release["has_manifest"]:
            reason = "此版本尚未提供签名安装包"
        elif not self.keys:
            reason = "当前安装未配置发布验证公钥"
        return {**release, "installable": not reason, "unavailable_reason": reason}

    def startup_check(self, feed: str = "") -> None:
        """Called once by the server lifespan; never delay startup for the network."""
        if self._started:
            return
        self._started = True
        if self.auto_check:
            self.start_check(feed)

    def start_check(self, feed: str = "") -> dict:
        self._launch("checking", lambda: self.check(feed))
        return self.status()

    def _launch(self, phase: str, operation) -> None:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                raise UpdateError("已有更新操作正在进行")
            self.activity = {"phase": phase, "error": ""}

            def run():
                try:
                    self._execute(operation)
                    self.activity = {"phase": "ready" if self.pending() else "idle", "error": ""}
                except Exception as exc:
                    message = (
                        str(exc)
                        if isinstance(exc, UpdateError)
                        else "更新操作未完成，请检查网络与磁盘空间后重试"
                    )
                    self.activity = {"phase": "failed", "error": message}

            self._worker = threading.Thread(target=run, name="mio-update", daemon=True)
            self._worker.start()

    @serialized
    def _execute(self, operation):
        return operation()

    def install(self, tag: str) -> dict:
        if self.dev_checkout:
            raise UpdateError("开发目录不切换程序版本；请使用正式发行版")
        if not self.keys:
            raise UpdateError("当前安装未配置发布验证公钥，无法安装版本")
        if self.pending():
            raise UpdateError("已有待安装版本，请先取消或重启应用")

        def prepare():
            with self._http(30) as http:
                release = catalog.by_tag(http, tag)
                if not release["version"] or not release["has_manifest"]:
                    raise UpdateError("此版本没有可用的签名安装包")
                manifest = self._fetch_manifest(http, release["manifest_url"])
            if manifest.version != release["version"]:
                raise UpdateError("安装包版本与所选版本不一致，已拒绝")
            self.manifest = manifest
            self.activity = {"phase": "downloading", "version": manifest.version, "error": ""}
            self.download()
            self.activity = {"phase": "staging", "version": manifest.version, "error": ""}
            self.stage()

        self._launch("preparing", prepare)
        return self.status()

    def install_checked(self) -> dict:
        if self.dev_checkout:
            raise UpdateError("开发目录不切换程序版本；请使用正式发行版")
        if self.pending():
            raise UpdateError("已有待安装版本，请先取消或重启应用")
        self._need_manifest()

        def prepare():
            self.download()
            self.activity = {"phase": "staging", "error": ""}
            self.stage()

        self._launch("preparing", prepare)
        return self.status()

    @installation_serialized
    def cancel_pending(self) -> dict:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                raise UpdateError("请等待当前更新操作结束")
            (self.dir / "pending.json").unlink(missing_ok=True)
            shutil.rmtree(self.dir / "staged", ignore_errors=True)
            self.activity = {"phase": "idle", "error": ""}
        return self.status()

    # ----------------------------------------------------------------- steps
    @serialized
    def check(self, feed: str = "") -> dict:
        if feed:
            with self._http(30) as http:
                manifest = self._fetch_manifest(http, feed)
            newer = parse_version(manifest.version) > parse_version(self.current)
            self.manifest = manifest if newer else None
            result = {
                "latest": manifest.version,
                "available": newer,
                "notes": manifest.notes,
                "size": manifest.package.size,
                "source": "feed",
            }
        else:
            self.manifest = None
            latest = None
            number = 1
            while True:
                releases = self.releases(number, 30, refresh=True)
                for release in releases["items"]:
                    if (
                        release["version"]
                        and not release["prerelease"]
                        and (
                            latest is None
                            or parse_version(release["version"]) > parse_version(latest["version"])
                        )
                    ):
                        latest = release
                if not releases["has_more"]:
                    break
                number += 1
                if number > 50:
                    raise UpdateError("版本目录过大，请在版本列表中选择版本")
            result = {
                "latest": latest["version"] if latest else None,
                "available": bool(
                    latest and parse_version(latest["version"]) > parse_version(self.current)
                ),
                "notes": latest["notes"] if latest else "",
                "size": 0,
                "source": "github",
            }
        with self._lock:
            self.last_check = {**result, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
            self._save_state()
        return self.last_check

    def _fetch_manifest(self, http: httpx.Client, url: str) -> Manifest:
        data, _ = catalog.read_json(http, url, MAX_MANIFEST)
        if not isinstance(data, dict):
            raise UpdateError("更新清单格式不正确")
        return verify_manifest(json.dumps(data).encode(), self.keys)

    @installation_serialized
    def download(self) -> Path:
        m = self._need_manifest()
        self.dir.mkdir(parents=True, exist_ok=True)
        target = self.dir / m.package.name
        part = target.with_suffix(".part")
        digest, size = hashlib.sha256(), 0
        with self._http(600) as http, http.stream("GET", m.package.url) as resp:
            if resp.status_code >= 400:
                raise UpdateError(f"下载更新包失败：HTTP {resp.status_code}")
            with part.open("wb") as fh:
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > m.package.size:
                        break
                    digest.update(chunk)
                    fh.write(chunk)
                    self.activity = {
                        "phase": "downloading",
                        "version": m.version,
                        "received": size,
                        "total": m.package.size,
                        "error": "",
                    }
        if size != m.package.size or digest.hexdigest() != m.package.sha256:
            part.unlink(missing_ok=True)
            raise UpdateError("更新包校验失败（大小或 SHA-256 与签名清单不符），已删除")
        part.replace(target)
        return target

    @installation_serialized
    def download_and_stage(self) -> dict:
        if self.dev_checkout:
            raise UpdateError("开发目录不切换程序版本；请使用正式发行版")
        if self.pending():
            raise UpdateError("已有待安装版本，请先取消或重启应用")
        self.download()
        return self.stage()

    @installation_serialized
    def stage(self) -> dict:
        if self.dev_checkout:
            raise UpdateError("这是 git 开发目录，请用 git pull 更新")
        if self.pending():
            raise UpdateError("已有待安装版本，请先取消或重启应用")
        m = self._need_manifest()
        archive = self.dir / m.package.name
        if not archive.is_file() or _sha256(archive) != m.package.sha256:
            raise UpdateError("请先下载更新包")
        staged = self.dir / "staged" / m.version
        shutil.rmtree(staged, ignore_errors=True)
        _safe_extract(archive, staged)
        root = _package_root(staged)
        pending = {
            "version": m.version,
            "path": str(root),
            "from": self.current,
            "manifest": m._signed_data,
        }
        temporary = self.dir / "pending.tmp"
        temporary.write_text(json.dumps(pending), encoding="utf-8")
        temporary.replace(self.dir / "pending.json")
        return pending

    @installation_serialized
    def apply_pending(self, validate: Callable[[], None] | None = None) -> dict | None:
        """Swap program files for the staged release; returns the applied record or None."""
        return host.apply_pending(
            self.root,
            self.dir.parent,
            lambda raw: verify_manifest(raw, self.keys),
            validate,
        )

    # --------------------------------------------------------------- helpers
    def _need_manifest(self) -> Manifest:
        if self.manifest is None:
            raise UpdateError("没有可用的更新，请先检查更新")
        return self.manifest

    def _http(self, timeout: float) -> httpx.Client:
        headers = {"User-Agent": f"mio-updater/{self.current}"}
        return httpx.Client(
            timeout=timeout, headers=headers, follow_redirects=True, transport=self.transport
        )


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _safe_extract(archive: Path, dest: Path) -> None:
    dest.mkdir(parents=True)
    root = dest.resolve()
    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            name = PurePosixPath(info.filename.replace("\\", "/"))
            target = (root / name).resolve()
            if name.is_absolute() or (target != root and root not in target.parents):
                raise UpdateError(f"更新包包含越界路径：{info.filename}")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise UpdateError(f"更新包包含符号链接：{info.filename}")
        zf.extractall(root)


def _package_root(staged: Path) -> Path:
    """The folder holding ``server/mio_server`` (zips usually wrap everything in one folder)."""
    for candidate in [staged, *[p for p in staged.iterdir() if p.is_dir()]]:
        if (candidate / "server" / "mio_server" / "__init__.py").is_file():
            return candidate
    raise UpdateError("更新包里没有找到 server/mio_server，可能不是 Mio 的发布包")


def _entries(source: Path) -> list[str]:
    """Top-level program entries to replace; ``server`` is replaced child by child so that
    ``server/data`` (the default data directory) stays where it is."""
    out = []
    for item in sorted(source.iterdir()):
        if item.name == "server" and item.is_dir():
            out += [f"server/{c.name}" for c in sorted(item.iterdir()) if c.name != "data"]
        elif item.name not in PRESERVE:
            out.append(item.name)
    return [rel for rel in out if rel not in PRESERVE]
