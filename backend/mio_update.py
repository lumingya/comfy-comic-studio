"""Version check and in-place program update from GitHub Releases.

Rules that keep user data safe:

* Only program files are replaced. The workspace (``data/`` or ``MIO_DATA_DIR``)
  is never written by the updater, with two deliberate exceptions inside the
  shipped ``data/`` folder: ``catalog/`` (UI text the app cannot boot without)
  and ``distribution.json`` (its manifest). A pristine shipped ``data/`` that was
  never used as a workspace is refreshed completely so new installs stay valid.
* Every replaced or removed program file is copied to ``.mio-updates/backup-*``
  first, so the previous version can be restored with one call.
* Nothing is installed unless the archive checksum matches the published
  ``.sha256`` (or the asset digest) and every packaged file matches
  ``PACKAGE_MANIFEST.json``.

Release assets are produced by ``tools/package_project.py`` and published by
``.github/workflows/release.yml`` on every ``v*`` tag.
"""
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from functools import cmp_to_key
from pathlib import Path

from backend.mio_paths import inside_repository_subfolder

REPO = os.environ.get("MIO_UPDATE_REPO", "lumingya/comfy-comic-studio")
API_BASE = os.environ.get("MIO_UPDATE_API", "https://api.github.com")
RELEASES_PAGE = f"https://github.com/{REPO}/releases"
USER_AGENT = "Mio-Updater (+https://github.com/" + REPO + ")"
ASSET_PATTERN = re.compile(r"^mio-(?P<version>[0-9A-Za-z.+-]+)-source\.zip$")
MAX_ASSET_BYTES = 400 * 1024 * 1024
MAX_JSON_BYTES = 5 * 1024 * 1024
UPDATE_DIR = ".mio-updates"
KEEP_BACKUPS = 2
# Never written by the updater whatever the package contains: user data,
# generated media, dependencies, the git checkout and our own working folder.
PROTECTED_TOP_LEVEL = {
    "data", "images", "releases", "node_modules", ".git", ".venv", "venv",
    UPDATE_DIR, "secrets.json", "comfy_comic_data.json", "test-results", "build", "dist",
}
DATA_ALWAYS_REFRESHED = ("data/catalog/", "data/distribution.json")
VERSION_RE = re.compile(
    r"^(?P<major>\d+)(?:\.(?P<minor>\d+))?(?:\.(?P<patch>\d+))?"
    r"(?:-(?P<pre>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


class UpdateError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ------------------------------------------------------------------ versions
def parse_version(text):
    """Return ((major, minor, patch), prerelease_identifiers) or None."""
    value = str(text or "").strip()
    if value[:1] in ("v", "V"):
        value = value[1:]
    match = VERSION_RE.match(value)
    if not match:
        return None
    release = tuple(int(match.group(part) or 0) for part in ("major", "minor", "patch"))
    pre = tuple(match.group("pre").split(".")) if match.group("pre") else ()
    return release, pre


def _compare_identifier(left, right):
    left_num, right_num = left.isdigit(), right.isdigit()
    if left_num and right_num:
        return (int(left) > int(right)) - (int(left) < int(right))
    if left_num != right_num:
        return -1 if left_num else 1  # numeric identifiers sort before alphanumeric ones
    return (left > right) - (left < right)


def compare_versions(left, right):
    """Semantic comparison of two version strings: -1, 0 or 1. Unparseable sorts lowest."""
    a, b = parse_version(left), parse_version(right)
    if a is None or b is None:
        return (a is not None) - (b is not None)
    if a[0] != b[0]:
        return 1 if a[0] > b[0] else -1
    if not a[1] and not b[1]:
        return 0
    if not a[1] or not b[1]:
        return 1 if not a[1] else -1  # a release outranks any pre-release of the same number
    for x, y in zip(a[1], b[1]):
        result = _compare_identifier(x, y)
        if result:
            return result
    return (len(a[1]) > len(b[1])) - (len(a[1]) < len(b[1]))


def normalize_version(text):
    value = str(text or "").strip()
    return value[1:] if value[:1] in ("v", "V") else value


def is_prerelease(text):
    parsed = parse_version(text)
    return bool(parsed and parsed[1])


# -------------------------------------------------------------- install facts
def current_version(base_dir):
    for name in ("package.json", "PACKAGE_MANIFEST.json"):
        try:
            data = json.loads((Path(base_dir) / name).read_text("utf-8"))
            version = str(data.get("version") or "").strip()
            if version:
                return version
        except (OSError, ValueError, AttributeError):
            continue
    return "0.0.0"


def install_kind(base_dir):
    base = Path(base_dir)
    if getattr(sys, "frozen", False):
        return "frozen"
    if (base / ".git").exists():
        return "git"
    if (base / "PACKAGE_MANIFEST.json").is_file():
        return "package"
    return "source"


def _writable(base_dir):
    try:
        folder = Path(base_dir) / UPDATE_DIR
        folder.mkdir(exist_ok=True)
        probe = folder / (".probe-" + str(os.getpid()))
        probe.write_bytes(b"ok")
        probe.unlink()
        return True
    except OSError:
        return False


def install_facts(base_dir, data_dir):
    kind = install_kind(base_dir)
    blockers = []
    if kind == "frozen":
        blockers.append("打包的可执行程序无法就地更新，请下载新版本后替换程序目录。")
    if not _writable(base_dir):
        blockers.append("程序目录不可写，请检查文件夹权限后再试。")
    if inside_repository_subfolder(base_dir):
        blockers.append("旧版代码已移入仓库的 legacy/ 目录作为只读参考，不支持就地更新。")
    if not (Path(base_dir) / "server.py").is_file() and kind != "frozen":
        blockers.append("程序目录里找不到 server.py，无法确认安装位置。")
    return {
        "kind": kind,
        "programDir": str(Path(base_dir)),
        "dataDir": str(Path(data_dir)),
        "dataInsideProgram": Path(data_dir).resolve() == (Path(base_dir) / "data").resolve(),
        "canApply": not blockers,
        "blockers": blockers,
        "platform": sys.platform,
    }


# ---------------------------------------------------------------- GitHub API
def _open(url, timeout=20, accept="application/vnd.github+json"):
    parsed = urllib.parse.urlparse(url)
    loopback = parsed.hostname in ("127.0.0.1", "localhost", "::1")
    if not parsed.hostname or parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise UpdateError("仅允许通过 HTTPS 访问更新源。")  # plain HTTP only for a loopback test server (MIO_UPDATE_API)
    headers = {"User-Agent": USER_AGENT, "Accept": accept, "X-GitHub-Api-Version": "2022-11-28"}
    token = os.environ.get("MIO_GITHUB_TOKEN", "").strip()
    if token and parsed.hostname.endswith("github.com"):
        headers["Authorization"] = "Bearer " + token
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout)


def _network_error(exc):
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code == 403 and exc.headers.get("X-RateLimit-Remaining") == "0":
            reset = exc.headers.get("X-RateLimit-Reset")
            when = ""
            if reset and reset.isdigit():
                when = datetime.fromtimestamp(int(reset)).strftime(" %H:%M")
            return UpdateError("GitHub 接口访问次数已用完，请" + (when + " 后" if when else "稍后") + "再试。", 429)
        if exc.code == 404:
            return UpdateError("GitHub 上还没有这个仓库的发布记录。", 404)
        return UpdateError(f"GitHub 返回 HTTP {exc.code}，请稍后再试。", 502)
    if isinstance(exc, urllib.error.URLError):
        return UpdateError("无法连接 GitHub：" + str(getattr(exc, "reason", exc)), 503)
    if isinstance(exc, TimeoutError):
        return UpdateError("连接 GitHub 超时，请检查网络后再试。", 504)
    return UpdateError("检查更新失败：" + str(exc)[:300], 502)


def fetch_json(url, max_bytes=MAX_JSON_BYTES):
    try:
        with _open(url) as response:
            raw = response.read(max_bytes + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise _network_error(exc) from exc
    if len(raw) > max_bytes:
        raise UpdateError("GitHub 响应超出大小限制。", 502)
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError as exc:
        raise UpdateError("GitHub 响应不是有效的 JSON。", 502) from exc


def describe_release(release):
    asset = checksum = None
    for item in release.get("assets") or []:
        name = str(item.get("name") or "")
        if ASSET_PATTERN.match(name):
            asset = item
        elif name.endswith(".zip.sha256"):
            checksum = item
    tag = str(release.get("tag_name") or "")
    return {
        "tag": tag,
        "version": normalize_version(tag),
        "name": str(release.get("name") or tag),
        "publishedAt": release.get("published_at"),
        "prerelease": bool(release.get("prerelease")),
        "notes": str(release.get("body") or "")[:20000],
        "url": release.get("html_url") or RELEASES_PAGE,
        "asset": {
            "name": asset.get("name"),
            "size": int(asset.get("size") or 0),
            "url": asset.get("browser_download_url"),
            "digest": asset.get("digest"),
        } if asset else None,
        "checksumUrl": checksum.get("browser_download_url") if checksum else None,
    }


def select_release(releases, include_prerelease):
    candidates = []
    for release in releases or []:
        if release.get("draft"):
            continue
        tag = release.get("tag_name") or ""
        if parse_version(tag) is None:
            continue
        if release.get("prerelease") and not include_prerelease:
            continue
        candidates.append(release)
    if not candidates:
        return None
    candidates.sort(key=cmp_to_key(lambda a, b: compare_versions(a.get("tag_name"), b.get("tag_name"))))
    return candidates[-1]


def check_for_update(base_dir, data_dir, include_prerelease=None, fetch=fetch_json):
    current = current_version(base_dir)
    if include_prerelease is None:
        include_prerelease = is_prerelease(current)
    url = f"{API_BASE}/repos/{REPO}/releases?per_page=30"
    releases = fetch(url)
    if not isinstance(releases, list):
        raise UpdateError("GitHub 返回了意外的发布列表。", 502)
    chosen = select_release(releases, include_prerelease)
    latest = describe_release(chosen) if chosen else None
    available = bool(latest and compare_versions(latest["version"], current) > 0)
    facts = install_facts(base_dir, data_dir)
    blockers = list(facts["blockers"])
    if latest and available and not latest["asset"]:
        blockers.append("该版本没有附带程序包，可前往 GitHub 手动下载。")
    if latest and available and latest["asset"] and not (latest["checksumUrl"] or latest["asset"].get("digest")):
        blockers.append("该版本缺少校验文件，为安全起见不会自动安装。")
    return {
        "current": current,
        "currentPrerelease": is_prerelease(current),
        "includePrerelease": include_prerelease,
        "latest": latest,
        "updateAvailable": available,
        "releaseCount": len([r for r in releases if not r.get("draft")]),
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "releasesPage": RELEASES_PAGE,
        "install": facts,
        "canApply": available and not blockers,
        "blockers": blockers,
    }


# ---------------------------------------------------------------- archive I/O
def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url, target, expected_size=0, progress=None, opener=_open):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    try:
        with opener(url, timeout=60, accept="application/octet-stream") as response, open(partial, "wb") as handle:
            total = int(response.headers.get("Content-Length") or expected_size or 0)
            if total > MAX_ASSET_BYTES:
                raise UpdateError("程序包超过大小上限，已停止下载。")
            received = 0
            while True:
                chunk = response.read(256 * 1024)
                if not chunk:
                    break
                received += len(chunk)
                if received > MAX_ASSET_BYTES:
                    raise UpdateError("程序包超过大小上限，已停止下载。")
                handle.write(chunk)
                if progress:
                    progress(received, total)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        partial.unlink(missing_ok=True)
        raise _network_error(exc) from exc
    except UpdateError:
        partial.unlink(missing_ok=True)
        raise
    os.replace(partial, target)
    return target


def expected_checksum(release, opener=_open):
    """Published ``.sha256`` first, the GitHub asset digest as a fallback."""
    if release.get("checksumUrl"):
        try:
            with opener(release["checksumUrl"], timeout=20, accept="text/plain") as response:
                text = response.read(4096).decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise _network_error(exc) from exc
        token = text.strip().split()[0].lower() if text.strip() else ""
        if re.fullmatch(r"[0-9a-f]{64}", token):
            return token
        raise UpdateError("校验文件内容无法识别，已停止安装。")
    digest = str((release.get("asset") or {}).get("digest") or "")
    if digest.lower().startswith("sha256:") and re.fullmatch(r"[0-9a-f]{64}", digest[7:].lower()):
        return digest[7:].lower()
    raise UpdateError("该版本缺少校验信息，已停止安装。")


def safe_extract(archive_path, destination):
    """Extract a single-root ZIP, rejecting absolute paths, traversal and links."""
    destination = Path(destination)
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip():
            raise UpdateError("程序包 CRC 校验失败，已停止安装。")
        roots = set()
        for info in archive.infolist():
            name = info.filename.replace("\\", "/")
            parts = [p for p in name.split("/") if p]
            if not parts or name.startswith("/") or ".." in parts or re.match(r"^[A-Za-z]:", name):
                raise UpdateError("程序包包含不安全的路径：" + name)
            if stat.S_ISLNK(info.external_attr >> 16):
                raise UpdateError("程序包包含符号链接，已停止安装。")
            roots.add(parts[0])
            if info.is_dir():
                continue
            target = destination.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, open(target, "wb") as handle:
                shutil.copyfileobj(source, handle, 1024 * 1024)
        if len(roots) != 1:
            raise UpdateError("程序包应只包含一个顶层目录。")
    root = destination / next(iter(roots))
    manifest_path = root / "PACKAGE_MANIFEST.json"
    if not manifest_path.is_file() or not (root / "server.py").is_file():
        raise UpdateError("程序包缺少 PACKAGE_MANIFEST.json 或 server.py，不是 Mio 发布包。")
    try:
        manifest = json.loads(manifest_path.read_text("utf-8"))
        files = manifest["files"]
        assert isinstance(files, dict) and files
    except (ValueError, KeyError, AssertionError) as exc:
        raise UpdateError("程序包清单无法读取。") from exc
    for rel, checksum in files.items():
        parts = rel.split("/")
        if rel.startswith("/") or ".." in parts or not rel.strip():
            raise UpdateError("程序包清单包含不安全的路径：" + rel)
        path = root.joinpath(*parts)
        if not path.is_file() or sha256_file(path) != checksum:
            raise UpdateError("程序包内容与清单不符：" + rel)
    return root, manifest


# -------------------------------------------------------------- install plan
def data_policy(base_dir, data_dir):
    """'refresh' when the shipped data/ was never a workspace, else 'catalog'."""
    shipped = Path(base_dir) / "data"
    if Path(data_dir).resolve() == shipped.resolve():
        return "catalog"
    if (shipped / "runtime" / "content-installed.json").exists() or (shipped / ".cache").exists():
        return "catalog"
    return "refresh"


def plan_install(base_dir, data_dir, new_manifest, old_manifest=None):
    policy = data_policy(base_dir, data_dir)
    base = Path(base_dir)
    writes, removals = [], []
    for rel in sorted(new_manifest["files"]):
        top = rel.split("/")[0]
        if top == "data":
            if policy != "refresh" and not rel.startswith(DATA_ALWAYS_REFRESHED):
                continue
        elif top in PROTECTED_TOP_LEVEL:
            continue
        writes.append(rel)
    if old_manifest and isinstance(old_manifest.get("files"), dict):
        for rel in sorted(old_manifest["files"]):
            top = rel.split("/")[0]
            if rel in new_manifest["files"] or top in PROTECTED_TOP_LEVEL or top == "data":
                continue
            if (base / rel).is_file():
                removals.append(rel)
    return {"policy": policy, "writes": writes, "removals": removals}


def _copy_preserving(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".mio-tmp")
    shutil.copyfile(source, temporary)
    os.replace(temporary, target)


def apply_plan(base_dir, package_root, plan, backup_dir, new_manifest, old_version, new_version):
    base, root, backup = Path(base_dir), Path(package_root), Path(backup_dir)
    backup.mkdir(parents=True, exist_ok=True)
    replaced, added = [], []
    for rel in plan["writes"]:
        target = base.joinpath(*rel.split("/"))
        if target.is_file():
            _copy_preserving(target, backup.joinpath(*rel.split("/")))
            replaced.append(rel)
        else:
            added.append(rel)
    for rel in plan["removals"]:
        _copy_preserving(base.joinpath(*rel.split("/")), backup.joinpath(*rel.split("/")))
    record = {
        "schema": "mio.update-backup.v1", "from": old_version, "to": new_version,
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "replaced": replaced, "added": added, "removed": list(plan["removals"]),
    }
    manifest_target = base / "PACKAGE_MANIFEST.json"
    if manifest_target.is_file():
        _copy_preserving(manifest_target, backup / "PACKAGE_MANIFEST.json")
        record["hadManifest"] = True
    (backup / "backup.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), "utf-8")
    for rel in plan["writes"]:
        source, target = root.joinpath(*rel.split("/")), base.joinpath(*rel.split("/"))
        mode = target.stat().st_mode if target.is_file() else None
        _copy_preserving(source, target)
        if mode is not None:
            os.chmod(target, stat.S_IMODE(mode))
        elif rel.endswith(".sh") or rel == "server.py":
            os.chmod(target, 0o755)
    for rel in plan["removals"]:
        try:
            base.joinpath(*rel.split("/")).unlink()
        except OSError:
            pass
    _copy_preserving(root / "PACKAGE_MANIFEST.json", manifest_target)
    return record


def rollback(base_dir, backup_dir):
    backup = Path(backup_dir)
    record = json.loads((backup / "backup.json").read_text("utf-8"))
    base = Path(base_dir)
    for rel in record.get("replaced", []) + record.get("removed", []):
        source = backup.joinpath(*rel.split("/"))
        if source.is_file():
            _copy_preserving(source, base.joinpath(*rel.split("/")))
    for rel in record.get("added", []):
        try:
            base.joinpath(*rel.split("/")).unlink()
        except OSError:
            pass
    if record.get("hadManifest") and (backup / "PACKAGE_MANIFEST.json").is_file():
        _copy_preserving(backup / "PACKAGE_MANIFEST.json", base / "PACKAGE_MANIFEST.json")
    else:
        (base / "PACKAGE_MANIFEST.json").unlink(missing_ok=True)
    return record


def prune_backups(update_dir, keep=KEEP_BACKUPS):
    folders = sorted((p for p in Path(update_dir).glob("backup-*") if p.is_dir()), key=lambda p: p.stat().st_mtime)
    for folder in folders[:-keep] if keep else folders:
        shutil.rmtree(folder, ignore_errors=True)


# ------------------------------------------------------------------- service
class UpdateService:
    """One per process. Holds the last check, the running job and restart state."""

    def __init__(self, base_dir, data_dir):
        self.base_dir = str(base_dir)
        self.data_dir = str(data_dir)
        self.lock = threading.Lock()
        self.last_check = None
        self.job = None
        self.restart_requested = threading.Event()
        self.server = None

    # ---- state
    @property
    def update_dir(self):
        return Path(self.base_dir) / UPDATE_DIR

    def last_update(self):
        try:
            return json.loads((self.update_dir / "last-update.json").read_text("utf-8"))
        except (OSError, ValueError):
            return None

    def status(self):
        with self.lock:
            job = dict(self.job) if self.job else None
        return {
            "current": current_version(self.base_dir),
            "install": install_facts(self.base_dir, self.data_dir),
            "lastCheck": self.last_check,
            "job": job,
            "lastUpdate": self.last_update(),
            "restartPending": self.restart_requested.is_set(),
            "releasesPage": RELEASES_PAGE,
        }

    def check(self, include_prerelease=None):
        result = check_for_update(self.base_dir, self.data_dir, include_prerelease)
        with self.lock:
            self.last_check = result
        return result

    def _set(self, **fields):
        with self.lock:
            if self.job is not None:
                self.job.update(fields)
                self.job["updatedAt"] = time.time()

    # ---- apply
    def start(self, version):
        with self.lock:
            if self.job and self.job.get("phase") not in ("done", "failed"):
                raise UpdateError("已有更新正在进行。", 409)
            check = self.last_check
            latest = check and check.get("latest")
            if not latest or normalize_version(version) != latest["version"]:
                raise UpdateError("请先检查更新，再安装检查到的版本。", 409)
            if not check.get("canApply"):
                raise UpdateError("；".join(check.get("blockers") or ["当前无法安装更新。"]), 409)
            self.job = {
                "phase": "queued", "progress": 0, "message": "准备下载",
                "version": latest["version"], "from": check["current"], "startedAt": time.time(), "error": None,
                "restartRequired": False, "backupDir": None,
            }
            release = dict(latest)
        threading.Thread(target=self._run, args=(release,), name="mio-update", daemon=True).start()
        return self.status()

    def _run(self, release):
        version = release["version"]
        update_dir = self.update_dir
        stage = update_dir / "stage"
        archive = update_dir / "downloads" / release["asset"]["name"]
        try:
            update_dir.mkdir(exist_ok=True)
            self._set(phase="download", message="下载 " + release["asset"]["name"], progress=0)

            def progress(received, total):
                fraction = received / total if total else 0
                self._set(progress=round(min(fraction, 1) * 0.6, 3), message=f"下载中 {received / 1048576:.1f} MB" + (f" / {total / 1048576:.1f} MB" if total else ""))

            download(release["asset"]["url"], archive, release["asset"].get("size") or 0, progress)
            self._set(phase="verify", message="校验程序包", progress=0.62)
            expected = expected_checksum(release)
            actual = sha256_file(archive)
            if actual != expected:
                archive.unlink(missing_ok=True)
                raise UpdateError("程序包校验失败（SHA-256 不匹配），已删除下载的文件。")
            self._set(phase="extract", message="解压并核对清单", progress=0.7)
            root, manifest = safe_extract(archive, stage)
            package_version = normalize_version(manifest.get("version") or version)
            if package_version != version:
                raise UpdateError(f"程序包版本 {package_version} 与发布 {version} 不一致，已停止安装。")
            old_manifest = None
            try:
                old_manifest = json.loads((Path(self.base_dir) / "PACKAGE_MANIFEST.json").read_text("utf-8"))
            except (OSError, ValueError):
                pass
            plan = plan_install(self.base_dir, self.data_dir, manifest, old_manifest)
            old_version = current_version(self.base_dir)
            backup_dir = update_dir / ("backup-" + re.sub(r"[^0-9A-Za-z.-]", "_", old_version) + "-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
            self._set(phase="install", message=f"备份并替换 {len(plan['writes'])} 个程序文件", progress=0.85, backupDir=str(backup_dir))
            record = apply_plan(self.base_dir, root, plan, backup_dir, manifest, old_version, version)
            summary = {
                "schema": "mio.last-update.v1", "from": old_version, "to": version, "at": record["at"],
                "backupDir": str(backup_dir), "policy": plan["policy"],
                "replaced": len(record["replaced"]), "added": len(record["added"]), "removed": len(record["removed"]),
                "rolledBack": False,
            }
            (update_dir / "last-update.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), "utf-8")
            shutil.rmtree(stage, ignore_errors=True)
            archive.unlink(missing_ok=True)
            prune_backups(update_dir)
            self._set(phase="done", message=f"已安装 v{version}，重启后生效", progress=1, restartRequired=True, finishedAt=time.time())
        except UpdateError as exc:
            shutil.rmtree(stage, ignore_errors=True)
            self._set(phase="failed", error=str(exc), message="更新未完成", finishedAt=time.time())
        except Exception as exc:  # noqa: BLE001 - surfaced to the UI, never crashes the server
            shutil.rmtree(stage, ignore_errors=True)
            self._set(phase="failed", error="更新失败：" + str(exc)[:400], message="更新未完成", finishedAt=time.time())

    # ---- rollback / restart
    def rollback(self):
        with self.lock:
            if self.job and self.job.get("phase") not in ("done", "failed", None):
                raise UpdateError("更新正在进行，暂时不能回退。", 409)
        last = self.last_update()
        if not last or last.get("rolledBack") or not last.get("backupDir"):
            raise UpdateError("没有可以回退的更新记录。", 404)
        backup_dir = Path(last["backupDir"])
        if not (backup_dir / "backup.json").is_file():
            raise UpdateError("备份目录已不存在，无法回退。", 404)
        record = rollback(self.base_dir, backup_dir)
        last.update(rolledBack=True, rolledBackAt=datetime.now(timezone.utc).isoformat(timespec="seconds"))
        (self.update_dir / "last-update.json").write_text(json.dumps(last, ensure_ascii=False, indent=2), "utf-8")
        with self.lock:
            self.job = {"phase": "done", "progress": 1, "message": f"已回退到 v{record['from']}，重启后生效", "version": record["from"], "from": record["to"], "restartRequired": True, "error": None, "rollback": True}
        return self.status()

    def request_restart(self, delay=0.6):
        if getattr(sys, "frozen", False):
            raise UpdateError("打包的可执行程序请手动重新启动。", 409)
        if self.restart_requested.is_set():
            return
        self.restart_requested.set()

        def later():
            time.sleep(delay)
            server = self.server
            if server is not None:
                server.shutdown()  # serve_forever() returns; main() performs reexec()
            else:
                reexec(self.base_dir)

        threading.Thread(target=later, name="mio-restart", daemon=True).start()


def reexec(base_dir):
    """Replace this process with a fresh server using the same interpreter, arguments and environment."""
    arguments = [sys.executable] + sys.argv
    sys.stdout.flush()
    sys.stderr.flush()
    if os.name == "nt":
        flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        subprocess.Popen(arguments, cwd=str(base_dir), close_fds=True, creationflags=flags)
        os._exit(0)
    os.chdir(str(base_dir))
    os.execv(sys.executable, arguments)


# ---------------------------------------------------------------------- HTTP
_services = {}


def service(host):
    key = (str(host.BASE_DIR), str(host.DATA_DIR))
    if key not in _services:
        _services[key] = UpdateService(host.BASE_DIR, host.DATA_DIR)
    return _services[key]


def dispatch(handler, host, path):
    if not path.startswith("/api/update/"):
        return False
    route = path[len("/api/update/"):]
    svc = service(host)
    try:
        if handler.command == "GET" and route == "status":
            handler.send_json(200, {"data": svc.status()})
        elif handler.command == "POST" and route == "check":
            body = _body(handler)
            prerelease = body.get("prerelease")
            handler.send_json(200, {"data": svc.check(None if prerelease is None else bool(prerelease))})
        elif handler.command == "POST" and route == "apply":
            body = _body(handler)
            handler.send_json(202, {"data": svc.start(str(body.get("version") or ""))})
        elif handler.command == "POST" and route == "rollback":
            _body(handler)
            handler.send_json(200, {"data": svc.rollback()})
        elif handler.command == "POST" and route == "restart":
            _body(handler)
            svc.request_restart()
            handler.send_json(200, {"data": {"restarting": True, "current": current_version(svc.base_dir)}})
        else:
            handler.send_json(404, {"error": "Unknown update route"})
    except UpdateError as exc:
        handler.send_json(exc.status, {"error": str(exc)})
    except Exception as exc:  # noqa: BLE001
        handler.send_json(500, {"error": "更新服务异常：" + str(exc)[:300]})
    return True


def _body(handler):
    if int(handler.headers.get("Content-Length") or 0) <= 0:
        return {}
    body = handler.read_json_body(max_bytes=4096)
    return body if isinstance(body, dict) else {}
