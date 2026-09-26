"""Build the release zip and its signed manifest.

    npm --prefix web run build
    python tools/build_release.py [--out releases] [--key-file ~/mio-release.key]

Writes ``releases/mio-studio-<version>.zip`` (reproducible: sorted entries, fixed timestamps) and
``releases/mio-release.json``.  The manifest is signed when a key is given (``--key-file`` or the
``MIO_RELEASE_KEY`` environment variable, 64 hex chars); without one it is written unsigned and
the in-app updater will refuse it — users can still download the zip by hand.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from mio_server import __version__  # noqa: E402
from mio_server.update.manifest import SCHEMA, sign_manifest  # noqa: E402

REPO = "https://github.com/lumingya/comfy-comic-studio"
INCLUDE = ["server", "web/dist", "clients", "start.bat", "start.sh", "README.md", "LICENSE"]
SKIP_PARTS = {"__pycache__", ".ruff_cache", ".pytest_cache", "data", "tests", ".venv"}
SKIP_SUFFIXES = {".pyc", ".pyo"}
FIXED_TIME = (2020, 1, 1, 0, 0, 0)


def files() -> list[Path]:
    out = []
    for entry in INCLUDE:
        path = ROOT / entry
        if path.is_file():
            out.append(path)
            continue
        for item in sorted(path.rglob("*")):
            rel = item.relative_to(ROOT)
            if (
                item.is_file()
                and not (set(rel.parts) & SKIP_PARTS)
                and item.suffix not in SKIP_SUFFIXES
            ):
                out.append(item)
    return sorted(out, key=lambda p: p.relative_to(ROOT).as_posix())


def build_zip(target: Path, version: str) -> None:
    top = f"mio-studio-{version}"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in files():
            rel = path.relative_to(ROOT).as_posix()
            info = zipfile.ZipInfo(f"{top}/{rel}", FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            executable = rel.endswith(".sh")
            info.external_attr = (0o100755 if executable else 0o100644) << 16
            zf.writestr(info, path.read_bytes())


def load_key(key_file: str | None) -> bytes | None:
    text = os.environ.get("MIO_RELEASE_KEY", "")
    if key_file:
        text = Path(key_file).expanduser().read_text(encoding="utf-8")
    text = text.strip()
    if not text:
        return None
    key = bytes.fromhex(text)
    if len(key) != 32:
        raise SystemExit("release key must be 32 bytes (64 hex characters)")
    return key


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(ROOT / "releases"))
    parser.add_argument("--key-file")
    parser.add_argument("--tag", default=os.environ.get("GITHUB_REF_NAME", ""))
    parser.add_argument("--notes", default="")
    args = parser.parse_args()

    version = __version__
    web_version = json.loads((ROOT / "web" / "package.json").read_text("utf-8"))["version"]
    if web_version != version:
        raise SystemExit(f"web/package.json version {web_version} != server {version}")
    if args.tag.startswith("v") and args.tag != f"v{version}":
        raise SystemExit(f"tag {args.tag} does not match version v{version}")
    if not (ROOT / "web" / "dist" / "index.html").is_file():
        raise SystemExit("web/dist is missing — run: npm --prefix web run build")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    name = f"mio-studio-{version}.zip"
    archive = out / name
    build_zip(archive, version)
    data = archive.read_bytes()
    manifest = {
        "schema": SCHEMA,
        "version": version,
        "published_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "notes": args.notes or f"{REPO}/releases/tag/v{version}",
        "package": {
            "name": name,
            "url": f"{REPO}/releases/download/v{version}/{name}",
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
        },
    }
    key = load_key(args.key_file)
    if key:
        manifest = sign_manifest(manifest, key)
    else:
        print("warning: no release key — manifest is unsigned; in-app update will refuse it")
    (out / "mio-release.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / f"{name}.sha256").write_text(f"{manifest['package']['sha256']}  {name}\n", "utf-8")
    print(f"{archive}  {len(data)} bytes  sha256 {manifest['package']['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
