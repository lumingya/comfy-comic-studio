"""Signed release manifest (``mio-release.json``), published next to the release zip.

The signature is Ed25519 over the canonical JSON of the manifest without its ``signature``
field (sorted keys, no whitespace, UTF-8).  Only keys listed in :data:`keys.TRUSTED_KEYS` are
accepted; the zip itself is then checked against the manifest's sha256 and size.
"""

from __future__ import annotations

import json
import re

from pydantic import BaseModel, Field, ValidationError

from . import ed25519

SCHEMA = "mio.release.v1"
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$")


class UpdateError(ValueError):
    pass


class Package(BaseModel):
    name: str = Field(pattern=r"^[\w.-]+\.zip$")
    url: str = Field(pattern=r"^https://\S+$")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size: int = Field(gt=0, le=1024 * 1024 * 1024)


class Manifest(BaseModel):
    schema_: str = Field(alias="schema", default=SCHEMA)
    version: str = Field(pattern=VERSION_RE.pattern)
    published_at: str = ""
    notes: str = ""
    package: Package
    key_id: str = Field(pattern=r"^[0-9a-f]{16}$")
    signature: str = Field(default="", pattern=r"^([0-9a-f]{128})?$")


def canonical(data: dict) -> bytes:
    body = {k: v for k, v in data.items() if k != "signature"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def key_id(public_hex: str) -> str:
    return public_hex[:16]


def sign_manifest(data: dict, secret: bytes) -> dict:
    public = ed25519.public_key(secret).hex()
    data = {**data, "schema": SCHEMA, "key_id": key_id(public)}
    data["signature"] = ed25519.sign(secret, canonical(data)).hex()
    return data


def verify_manifest(raw: bytes, trusted: dict[str, str]) -> Manifest:
    """Parse and verify; raises :class:`UpdateError` with a user-facing reason."""
    if not trusted:
        raise UpdateError("此版本没有内置发布公钥，无法验证更新包；请到发布页手动下载")
    try:
        data = json.loads(raw)
        manifest = Manifest.model_validate(data)
    except (ValueError, ValidationError) as exc:
        raise UpdateError(f"更新清单格式不正确：{str(exc)[:200]}") from None
    if manifest.schema_ != SCHEMA:
        raise UpdateError(f"不支持的更新清单格式：{manifest.schema_}")
    public = trusted.get(manifest.key_id)
    if public is None:
        raise UpdateError(f"更新清单由未受信任的密钥签名（{manifest.key_id}）")
    ok = ed25519.verify(
        bytes.fromhex(public), canonical(data), bytes.fromhex(manifest.signature or "00" * 64)
    )
    if not ok:
        raise UpdateError("更新清单签名无效，已拒绝")
    return manifest


def parse_version(text: str) -> tuple:
    """Sortable key; a pre-release sorts before its release (4.1.0-beta < 4.1.0)."""
    match = VERSION_RE.match(text.strip().lstrip("v"))
    if not match:
        raise UpdateError(f"版本号格式不正确：{text}")
    major, minor, patch, pre = match.groups()
    return (int(major), int(minor), int(patch), 0 if pre else 1, pre or "")
