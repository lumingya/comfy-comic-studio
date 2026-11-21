"""Stable, standard-library-only release installation and crash recovery host.

This file and start.bat/start.sh are installation infrastructure, not application
payload. They survive application upgrades and downgrades. Journal schema 1 is
owned by this host; recovery restores local backups and never executes a package.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path, PurePosixPath

PRESERVE = {
    "data",
    "server/data",
    ".git",
    ".venv",
    "releases",
    ".mio-update",
    "mio_update_bootstrap.py",
    "start.bat",
    "start.sh",
}
_owners: dict[str, tuple[int, int, object]] = {}
_owners_guard = threading.Lock()
PROGRAM_ENTRIES = {"web", "clients", "extensions", "themes", "README.md", "LICENSE"}
SERVER_ENTRIES = {
    "mio_server",
    "bootstrap.py",
    "requirements.txt",
    "requirements-dev.txt",
    "pyproject.toml",
    "fixtures",
}


class InstallError(ValueError):
    pass


class RecoveryError(InstallError):
    pass


class BusyError(RecoveryError):
    pass


def _linked(path: Path) -> bool:
    try:
        return path.is_symlink() or bool(
            getattr(path.lstat(), "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        )
    except FileNotFoundError:
        return False


def _workspace(data: Path) -> Path:
    if not data.is_absolute() or any(_linked(p) for p in (data, *data.parents)):
        raise RecoveryError("工作区路径不能包含链接或相对路径")
    # Check the supplied path for links before canonicalizing it. Root and program
    # entries already use resolved paths; compare the workspace in the same form
    # so Windows 8.3 names and '..' cannot hide an overlapping program directory.
    return data.resolve()


def workspace_updates(data: Path) -> Path:
    data = _workspace(Path(data).absolute())
    updates = _plain(data / "updates", data)
    if updates.exists():
        for child in updates.iterdir():
            _plain(child, data)
    return updates


def _plain(path: Path, root: Path) -> Path:
    """Reject links/reparse points and paths escaping their recorded owner."""
    if not path.is_relative_to(root):
        raise RecoveryError("更新路径超出安装目录")
    for part in (path, *path.parents):
        if _linked(part):
            raise RecoveryError("更新路径不能包含链接")
        if part == root:
            break
    if not path.resolve().is_relative_to(root.resolve()):
        raise RecoveryError("更新路径归属不正确")
    return path


@contextmanager
def installation_lease(root: Path):
    root = Path(root).resolve()
    key, owner = str(root), threading.get_ident()
    with _owners_guard:
        previous = _owners.get(key)
        if previous:
            if previous[0] != owner:
                raise BusyError("已有更新操作正在进行")
            _owners[key] = (owner, previous[1] + 1, previous[2])
        else:
            directory = _plain(root / ".mio-update", root)
            directory.mkdir(exist_ok=True)
            path = _plain(directory / "lock", root)
            stream = path.open("a+b")
            try:
                if os.name == "nt":
                    import msvcrt

                    if stream.seek(0, os.SEEK_END) == 0:
                        stream.write(b"\0")
                        stream.flush()
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                stream.close()
                raise BusyError("已有更新操作正在进行") from None
            _owners[key] = (owner, 1, stream)
    try:
        yield
    finally:
        with _owners_guard:
            _, depth, stream = _owners[key]
            if depth > 1:
                _owners[key] = (owner, depth - 1, stream)
            else:
                # Closing releases the OS lease even on abrupt process exit. Never unlink
                # the lock: a waiter may still hold its inode/Windows file handle.
                stream.close()
                del _owners[key]


def _sync(directory: Path) -> None:
    if os.name != "nt":
        fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def atomic_json(path: Path, value: dict) -> None:
    fd, name = tempfile.mkstemp(prefix="write-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _sync(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _move(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    source.replace(target)
    _sync(source.parent)
    _sync(target.parent)


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _entry(rel: str) -> bool:
    if not isinstance(rel, str):
        return False
    parts = PurePosixPath(rel).parts
    return (
        "\\" not in rel
        and ":" not in rel
        and all(p not in {".", ".."} for p in parts)
        and not rel.startswith("/")
        and rel not in PRESERVE
        and (
            len(parts) == 1
            and parts[0] in PROGRAM_ENTRIES
            or len(parts) == 2
            and parts[0] == "server"
            and parts[1] in SERVER_ENTRIES
        )
    )


def entries(source: Path) -> list[str]:
    result = []
    for item in sorted(source.iterdir()):
        if item.name == "server" and item.is_dir():
            result.extend(f"server/{c.name}" for c in sorted(item.iterdir()) if c.name != "data")
        elif item.name not in PRESERVE:
            result.append(item.name)
    if any(not _entry(rel) for rel in result):
        raise InstallError("更新包包含不支持的程序路径")
    return result


def safe_extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True)
    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            name = PurePosixPath(info.filename.replace("\\", "/"))
            if name.is_absolute() or ".." in name.parts or ":" in str(name):
                raise InstallError("更新包包含越界路径")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise InstallError("更新包包含符号链接")
        zf.extractall(destination)


def package_root(staged: Path) -> Path:
    for candidate in [staged, *[p for p in staged.iterdir() if p.is_dir()]]:
        if (candidate / "server/mio_server/__init__.py").is_file():
            return candidate
    raise InstallError("更新包里没有找到 server/mio_server")


def _journal(root: Path) -> tuple[Path, dict] | None:
    path = _plain(root / ".mio-update/journal.json", root)
    if not path.exists():
        return None
    try:
        value = json.loads(path.read_text("utf-8"))
        valid = (
            value["schema"] == 1
            and value["root"] == str(root)
            and re.fullmatch(r"tx-[a-f0-9]{32}", value["transaction"])
            and value["phase"] in {"installing", "committed"}
            and isinstance(value["entries"], list)
            and type(value["started"]) is int
            and 0 <= value["started"] <= len(value["entries"])
            and Path(value["data"]).is_absolute()
            and re.fullmatch(r"[a-f0-9]{64}", value["pending_sha256"])
        )
        if not valid:
            raise ValueError("invalid journal")
        seen = set()
        for item in value["entries"]:
            rel = item["path"]
            if not _entry(rel) or rel in seen or type(item["existed"]) is not bool:
                raise ValueError("invalid entry")
            seen.add(rel)
            _plain(root / rel, root)
            data = _workspace(Path(value["data"]))
            if data == root / rel or data.is_relative_to(root / rel):
                raise ValueError("workspace overlaps program")
        transaction = _plain(root / ".mio-update" / value["transaction"], root)
        for item in value["entries"]:
            _plain(transaction / "backup" / item["path"], root)
        return path, value
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise RecoveryError("安装恢复日志无效，已停止启动并保留恢复文件") from exc


def _recover(root: Path) -> bool:
    """Idempotently restore a whole old app, or finalize a committed whole new app."""
    root = Path(root).resolve()
    # An ordinary start without an unfinished transaction must not write to the root.
    if _journal(root) is None:
        return False
    with installation_lease(root):
        record = _journal(root)
        if record is None:
            return False
        path, value = record
        transaction = root / ".mio-update" / value["transaction"]
        if value["phase"] == "installing":
            for item in reversed(value["entries"][: value["started"]]):
                target = _plain(root / item["path"], root)
                backup = _plain(transaction / "backup" / item["path"], root)
                if backup.exists():
                    _remove(target)
                    _move(backup, target)
                elif not item["existed"]:
                    _remove(target)
                # An existing entry with no backup was never moved, or has already
                # been restored before a second crash. Keep it in either case.
        else:
            updates = workspace_updates(Path(value["data"]))
            pending = updates / "pending.json"
            if pending.is_file() and sha256(pending) == value["pending_sha256"]:
                pending.unlink()
                shutil.rmtree(updates / "staged", ignore_errors=True)
        path.unlink()
        _sync(path.parent)
        shutil.rmtree(transaction / "verified", ignore_errors=True)
        return value["phase"] == "installing"


def recover(root: Path) -> bool:
    try:
        return _recover(root)
    except RecoveryError:
        raise
    except Exception as exc:
        raise RecoveryError("更新恢复未完成，已停止启动并保留恢复文件") from exc


def apply_pending(root: Path, data: Path, verify, validate=None) -> dict | None:
    root, data = Path(root).resolve(), _workspace(Path(data).absolute())
    with installation_lease(root):
        recover(root)
        updates = workspace_updates(data)
        path = updates / "pending.json"
        if not path.is_file():
            return None
        if (root / ".git").exists():
            raise InstallError("这是 git 开发目录，拒绝覆盖；已保留待安装的更新")
        raw = path.read_bytes()
        pending = json.loads(raw)
        manifest = verify(json.dumps(pending.get("manifest", {})).encode())
        if manifest.version != pending["version"]:
            raise InstallError("待安装版本与签名清单不一致")
        archive = updates / manifest.package.name
        if (
            not archive.is_file()
            or archive.stat().st_size != manifest.package.size
            or sha256(archive) != manifest.package.sha256
        ):
            raise InstallError("待安装包校验失败，未改动当前版本")
        transaction = root / ".mio-update" / f"tx-{uuid.uuid4().hex}"
        verified = transaction / "verified"
        safe_extract(archive, verified)
        source = package_root(verified)
        items = []
        for rel in entries(source):
            target = _plain(root / rel, root)
            if data == target or data.is_relative_to(target):
                raise InstallError("工作区不能位于待替换的程序目录中")
            items.append({"path": rel, "existed": target.exists()})
        value = {
            "schema": 1,
            "root": str(root),
            "data": str(data),
            "transaction": transaction.name,
            "phase": "installing",
            "started": 0,
            "entries": items,
            "pending_sha256": hashlib.sha256(raw).hexdigest(),
        }
        journal = root / ".mio-update/journal.json"
        atomic_json(journal, value)
        try:
            for index, item in enumerate(items):
                value["started"] = index + 1
                atomic_json(journal, value)
                rel = item["path"]
                target = root / rel
                if item["existed"]:
                    _move(target, transaction / "backup" / rel)
                _move(source / rel, target)
            if validate:
                validate()
        except Exception:
            try:
                recover(root)
                if value["started"] and validate:
                    validate()
            except Exception as exc:
                raise RecoveryError("已保留安装恢复文件，请重新启动以恢复原程序和依赖") from exc
            raise
        value["phase"] = "committed"
        atomic_json(journal, value)
        recover(root)
        return {**pending, "backup": str(transaction / "backup")}


def launch_data(argv: list[str], root: Path) -> Path:
    parser = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("--data", default=os.environ.get("MIO_V3_DATA", "data/runtime/v3"))
    args, _ = parser.parse_known_args(argv)
    path = Path(args.data)
    return (path if path.is_absolute() else root / "server" / path).absolute()


def prepare_dependencies(root: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(root / "server/bootstrap.py")],
        cwd=root,
        env={**os.environ, "MIO_SKIP_WEB_BUILD": "1", "PYTHONUTF8": "1"},
        check=False,
    )
    if result.returncode:
        raise RuntimeError("版本依赖安装失败")


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    root = Path(__file__).resolve().parent
    try:
        if argv == ["recover"]:
            try:
                recover(root)
            except Exception as exc:
                raise RecoveryError("更新恢复未完成，已停止启动并保留恢复文件") from exc
            return 0
        if not argv or argv.pop(0) != "apply":
            raise InstallError("expected recover or apply")
        data = launch_data(argv, root)
        with installation_lease(root):
            recover(root)
            # Lock before importing mutable modules: another installer may have
            # moved the entire package while this launcher was bootstrapping.
            sys.path.insert(0, str(root / "server"))
            from mio_server.update.keys import TRUSTED_KEYS
            from mio_server.update.manifest import verify_manifest

            applied = apply_pending(
                root,
                data,
                lambda raw: verify_manifest(raw, TRUSTED_KEYS),
                lambda: prepare_dependencies(root),
            )
        if applied:
            print(f"[mio] 已更新到 {applied['version']}（旧版本备份在 {applied['backup']}）")
        return 0
    except RecoveryError as exc:
        print(f"[mio] {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"[mio] 更新安装失败，继续使用当前版本：{exc}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.modules["mio_update_bootstrap"] = sys.modules[__name__]
    raise SystemExit(main())
