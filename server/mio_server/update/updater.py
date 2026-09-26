"""Check → download → stage → apply, for installs made from a release zip.

* **check** fetches the signed manifest and compares versions.
* **download** streams the zip into ``<data>/updates/`` and verifies size and sha256.
* **stage** unpacks it to ``<data>/updates/staged/<version>/`` and writes ``pending.json``.
* **apply** runs at the next start (``python -m mio_server.update apply``, called by the
  launchers) while nothing is loaded: program files are moved into
  ``<data>/updates/backup-<old>/`` and replaced.  User data (``data/``, ``server/data/``) is never
  touched.  If anything fails, the files moved so far are restored.

A git checkout (``.git`` present) is a developer install: staging and applying refuse, use git.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
import zipfile
from pathlib import Path, PurePosixPath

import httpx

from .. import __version__
from .keys import TRUSTED_KEYS
from .manifest import Manifest, UpdateError, parse_version, verify_manifest

DEFAULT_FEED = (
    "https://github.com/lumingya/comfy-comic-studio/releases/latest/download/mio-release.json"
)
RELEASES_PAGE = "https://github.com/lumingya/comfy-comic-studio/releases"
PRESERVE = {"data", "server/data", ".git", ".venv", "releases"}
MAX_MANIFEST = 1024 * 1024


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
        self.last_check: dict | None = None

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
        }

    # ----------------------------------------------------------------- steps
    def check(self, feed: str = "") -> dict:
        with self._http(30) as http:
            resp = http.get(feed or DEFAULT_FEED)
            if resp.status_code >= 400:
                raise UpdateError(f"获取更新清单失败：HTTP {resp.status_code}")
            if len(resp.content) > MAX_MANIFEST:
                raise UpdateError("更新清单过大")
        manifest = verify_manifest(resp.content, self.keys)
        newer = parse_version(manifest.version) > parse_version(self.current)
        self.manifest = manifest if newer else None
        self.last_check = {
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "latest": manifest.version,
            "available": newer,
            "notes": manifest.notes,
            "size": manifest.package.size,
        }
        return self.last_check

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
        if size != m.package.size or digest.hexdigest() != m.package.sha256:
            part.unlink(missing_ok=True)
            raise UpdateError("更新包校验失败（大小或 SHA-256 与签名清单不符），已删除")
        part.replace(target)
        return target

    def stage(self) -> dict:
        if self.dev_checkout:
            raise UpdateError("这是 git 开发目录，请用 git pull 更新")
        m = self._need_manifest()
        archive = self.dir / m.package.name
        if not archive.is_file() or _sha256(archive) != m.package.sha256:
            raise UpdateError("请先下载更新包")
        staged = self.dir / "staged" / m.version
        shutil.rmtree(staged, ignore_errors=True)
        _safe_extract(archive, staged)
        root = _package_root(staged)
        pending = {"version": m.version, "path": str(root), "from": self.current}
        (self.dir / "pending.json").write_text(json.dumps(pending), encoding="utf-8")
        return pending

    def apply_pending(self) -> dict | None:
        """Swap program files for the staged release; returns the applied record or None."""
        pending = self.pending()
        if pending is None:
            return None
        if self.dev_checkout:
            raise UpdateError("这是 git 开发目录，拒绝覆盖；已保留待安装的更新")
        source = Path(pending["path"])
        backup = self.dir / f"backup-{pending.get('from', 'old')}-{int(time.time())}"
        moved: list[str] = []
        try:
            for rel in _entries(source):
                current = self.root / rel
                if current.exists():
                    (backup / rel).parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(current), str(backup / rel))
                moved.append(rel)
                current.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source / rel), str(current))
        except Exception:
            for rel in reversed(moved):  # roll back
                shutil.rmtree(self.root / rel, ignore_errors=True)
                if (backup / rel).exists():
                    shutil.move(str(backup / rel), str(self.root / rel))
            raise
        (self.dir / "pending.json").unlink()
        shutil.rmtree(self.dir / "staged", ignore_errors=True)
        return {**pending, "backup": str(backup)}

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
