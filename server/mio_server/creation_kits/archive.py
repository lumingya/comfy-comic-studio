"""Validate the entire portable archive before any destination writes."""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from urllib.parse import parse_qs, urlsplit

from PIL import Image

from ..asset_refs import referenced_assets
from .models import KitPayload

MAX_ARCHIVE = 64 * 1024 * 1024
MAX_UNPACKED = 128 * 1024 * 1024
MAX_ENTRIES = 5000
HASH = re.compile(r"^[0-9a-f]{64}$")
SECRET_KEYS = {"api_key", "apikey", "access_token", "authorization", "cookie", "password", "secret"}


def check_portable(value):
    """Workflows can contain custom credentials; reject those instead of sharing them."""
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in SECRET_KEYS and child:
                raise ValueError("套装包含凭据字段，请先从工作流或预设中移除凭据")
            check_portable(child)
    elif isinstance(value, list):
        for child in value:
            check_portable(child)
    elif isinstance(value, str) and value.startswith(("http://", "https://")):
        url = urlsplit(value)
        if url.username or url.password or SECRET_KEYS.intersection(parse_qs(url.query)):
            raise ValueError("套装包含带凭据的地址，请先移除凭据")


def unique(items, label):
    ids = [item.id for item in items]
    if len(set(ids)) != len(ids):
        raise ValueError(f"套装包含重复的 {label} ID")
    return set(ids)


def validate_payload(p: KitPayload):
    check_portable(p.model_dump(mode="json"))
    unique(p.episodes, "episode")
    unique(p.series.presets, "preset")
    unique(p.series.variants, "variant")
    for preset in p.series.presets:
        groups = unique(preset.groups, "preset group")
        unique(preset.entries, "preset entry")
        if any(entry.group_id and entry.group_id not in groups for entry in preset.entries):
            raise ValueError("预设变量引用了不存在的分组")
    profile_ids = unique(p.profiles, "profile")
    workflow_ids = unique(p.workflows, "workflow")
    chars = {c.id for c in p.series.bible.characters}
    locations = {c.id for c in p.series.bible.locations}
    props = {c.id for c in p.series.bible.props}
    styles = {c.id for c in p.series.bible.styles}
    required_profiles = {p.series.default_profile_id}
    for variant in p.series.variants:
        if not set(variant.characters) <= chars or (
            variant.style_id and variant.style_id not in styles
        ):
            raise ValueError("套装变体引用了不存在的角色或画风")
        required_profiles.add(variant.profile_id)
        for cid, changes in variant.characters.items():
            original = p.series.bible.character(cid)
            original.model_validate({**original.model_dump(), **changes, "id": cid})
    for episode in p.episodes:
        if episode.series_id != p.series.id or episode.takes or episode.deleted_at:
            raise ValueError("套装分镜必须属于来源作品，且不含候选或回收站内容")
        for panel in episode.panels:
            if not {c.character_id for c in panel.characters} <= chars:
                raise ValueError("套装分幕引用了不存在的角色")
            if panel.location_id and panel.location_id not in locations:
                raise ValueError("套装分幕引用了不存在的场景")
            if not set(panel.props) <= props:
                raise ValueError("套装分幕引用了不存在的道具")
            if any(d.speaker_id and d.speaker_id not in chars for d in panel.dialogues):
                raise ValueError("套装对白引用了不存在的角色")
            if any(c.source == "take" or c.take_id for c in panel.controls):
                raise ValueError("套装控制图必须转换为独立素材")
            if any(c.source == "asset" and not c.asset_id for c in panel.controls):
                raise ValueError("套装控制图缺少素材")
            required_profiles.add(panel.overrides.profile_id)
        panel_ids = {panel.id for panel in episode.panels}
        if (
            not set(episode.strip.panel_boxes) <= panel_ids
            or not set(episode.strip.crops) <= panel_ids
        ):
            raise ValueError("套装画布引用了不存在的分幕")
        for layer in episode.strip.lettering:
            if (layer.panel_id and layer.panel_id not in panel_ids) or (
                layer.bridge_to and layer.bridge_to not in panel_ids
            ):
                raise ValueError("套装文字层引用了不存在的分幕")
            if layer.speaker_id and layer.speaker_id not in chars:
                raise ValueError("套装文字层引用了不存在的角色")
    if not (required_profiles - {None}) <= profile_ids:
        raise ValueError("套装缺少出图配置")
    for profile in p.profiles:
        stages = [*profile.draft, *profile.final, *profile.edits.values()]
        if not {s.workflow_id for s in stages} <= workflow_ids:
            raise ValueError("套装缺少工作流")
        if profile.instances or profile.cloud_channel:
            raise ValueError("套装不能携带已绑定的实例或云端渠道")
    requirements = {r.profile_id: r for r in p.external}
    if len(requirements) != len(p.external) or set(requirements) != profile_ids:
        raise ValueError("套装外部依赖清单不完整")
    for profile in p.profiles:
        req = requirements[profile.id]
        if (req.local, req.cloud) != (
            not profile.cloud_shape or profile.cloud_refine,
            profile.cloud_shape,
        ):
            raise ValueError("套装外部依赖与出图路线不一致")
    if len(set(p.assets)) != len(p.assets) or any(not HASH.fullmatch(a) for a in p.assets):
        raise ValueError("套装素材清单不合法")
    if set(p.assets) != referenced_assets(p.series, p.episodes, [*p.profiles, *p.workflows]):
        raise ValueError("套装素材清单与文档引用不一致")


def unpack(data: bytes) -> tuple[KitPayload, dict[str, bytes]]:
    if len(data) > MAX_ARCHIVE:
        raise ValueError("创作套装超过 64 MB")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            entries = zf.infolist()
            names = [e.filename for e in entries]
            if len(names) > MAX_ENTRIES or len(names) != len(set(names)):
                raise ValueError("套装文件过多或包含重复路径")
            if sum(e.file_size for e in entries) > MAX_UNPACKED:
                raise ValueError("套装解压后超过 128 MB")
            if any(
                n.startswith("/") or "\\" in n or ":" in n or ".." in n.split("/") for n in names
            ):
                raise ValueError("套装文件路径不安全")
            payload = KitPayload.model_validate_json(zf.read("kit.json"))
            validate_payload(payload)
            if set(names) != {"kit.json", *(f"assets/{aid}" for aid in payload.assets)}:
                raise ValueError("套装包含未声明文件或缺少素材")
            blobs = {}
            for aid in payload.assets:
                blob = zf.read(f"assets/{aid}")
                if hashlib.sha256(blob).hexdigest() != aid:
                    raise ValueError("套装素材校验失败")
                with Image.open(io.BytesIO(blob)) as image:
                    image.verify()
                blobs[aid] = blob
            return payload, blobs
    except (zipfile.BadZipFile, KeyError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("无效的创作套装或图片数据") from exc


def pack(payload: KitPayload, blobs: dict[str, bytes]) -> bytes:
    validate_payload(payload)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("kit.json", payload.model_dump_json())
        for aid in payload.assets:
            zf.writestr(f"assets/{aid}", blobs[aid], compress_type=zipfile.ZIP_STORED)
    data = out.getvalue()
    unpack(data)
    return data


def request_hash(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
