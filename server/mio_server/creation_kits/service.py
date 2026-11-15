"""Creation kits preserve their own bible, defaults and presets as reusable resources."""

from __future__ import annotations

import base64
import binascii
import hashlib

from ..assembly import build_snapshot, inspect_snapshot
from ..asset_refs import referenced_assets
from ..assets import sniff
from ..generation import profile_for
from ..models import Episode, Series, new_id, now_iso
from ..pipeline.variables import PATTERN
from ..render_models import Asset, WorkflowDoc
from ..storage import Conflict, NotFound
from .archive import MAX_ARCHIVE, pack, request_hash, unpack
from .models import (
    ExternalRequirement,
    KitAssembly,
    KitImport,
    KitImported,
    KitInspection,
    KitPayload,
    KitSelection,
)


def export_kit(ctx, selection: KitSelection) -> bytes:
    with ctx.store.lock:
        series = ctx.store.get_series(selection.series_id).model_copy(deep=True)
        if len(set(selection.episode_ids)) != len(selection.episode_ids):
            raise ValueError("分镜选择重复")
        if len(set(selection.preset_ids)) != len(selection.preset_ids):
            raise ValueError("预设选择重复")
        by_id = {p.id: p for p in series.presets}
        if not set(selection.preset_ids) <= set(by_id):
            raise ValueError("所选预设不存在")
        series.presets = [by_id[pid] for pid in selection.preset_ids]
        series.default_profile_id = (
            str(series.generation.profile["id"])
            if series.generation
            else series.default_profile_id or "profile_default"
        )
        episodes = []
        for order, eid in enumerate(selection.episode_ids):
            ep = ctx.store.get_episode(eid).model_copy(deep=True)
            if ep.series_id != series.id:
                raise ValueError("所选分镜必须来自同一作品或工坊")
            for panel in ep.panels:
                for control in panel.controls:
                    if control.source == "take":
                        take = ep.take(control.take_id)
                        if take is None or take.panel_id != panel.id:
                            raise ValueError("控制图引用的候选不存在或不属于当前分幕")
                        control.source, control.asset_id, control.take_id = (
                            "asset",
                            take.asset_id,
                            None,
                        )
            ep.takes, ep.order, ep.revision = [], order, 0
            episodes.append(ep)
        profile_ids = {series.default_profile_id}
        profile_ids.update(v.profile_id for v in series.variants if v.profile_id)
        profile_ids.update(
            p.overrides.profile_id for e in episodes for p in e.panels if p.overrides.profile_id
        )
        profiles = [
            profile_for(ctx.store, series, pid).model_copy(deep=True) for pid in sorted(profile_ids)
        ]
        workflow_ids = {
            s.workflow_id for p in profiles for s in [*p.draft, *p.final, *p.edits.values()]
        }
        workflows = [
            WorkflowDoc.model_validate(series.generation.workflows[wid])
            if series.generation and wid in series.generation.workflows
            else ctx.store.get_doc("workflow", wid).model_copy(deep=True)
            for wid in sorted(workflow_ids)
        ]
        external = [
            ExternalRequirement(
                profile_id=p.id, local=not p.cloud_shape or p.cloud_refine, cloud=p.cloud_shape
            )
            for p in profiles
        ]
        for profile in profiles:
            profile.instances, profile.cloud_channel = [], ""
        # A reusable kit must use its explicit destination bindings, never a source task snapshot.
        series.generation = None
        ids = referenced_assets(series, episodes, [*profiles, *workflows])
        blobs = {aid: ctx.assets.read(aid) for aid in sorted(ids)}
        payload = KitPayload(
            title=selection.title or series.title,
            series=series,
            episodes=episodes,
            profiles=profiles,
            workflows=workflows,
            external=external,
            assets=sorted(ids),
        )
        return pack(payload, blobs)


def inspect_kit(data: bytes) -> KitInspection:
    payload, _ = unpack(data)
    return KitInspection(
        title=payload.title,
        sha256=hashlib.sha256(data).hexdigest(),
        episodes=[
            {"id": e.id, "title": e.title, "panels": len(e.panels)} for e in payload.episodes
        ],
        presets=[{"id": p.id, "title": p.title} for p in payload.series.presets],
        profiles=[{"id": p.id, "name": p.name} for p in payload.profiles],
        workflows=[{"id": w.id, "name": w.name} for w in payload.workflows],
        asset_count=len(payload.assets),
        external=payload.external,
        warnings=["导入使用新的 ID；实例和云端渠道需显式绑定，不随套装携带。"],
    )


def _destinations(ctx, payload, bindings):
    requirements = {r.profile_id: r for r in payload.external}
    if set(bindings) != set(requirements):
        raise ValueError("请为套装中的每个出图配置明确提供目标服务绑定")
    channels = {c.id for c in ctx.settings().image_channels}
    for pid, req in requirements.items():
        dest = bindings[pid]
        if dest.unbound:
            if dest.instances or dest.cloud_channel:
                raise ValueError("待配置导入不能同时指定服务绑定")
            continue
        if req.local and not dest.instances:
            raise ValueError("本地出图配置须明确选择至少一个目标实例")
        for iid in dest.instances or []:
            instance = ctx.store.get_doc("instance", iid)
            if not instance.enabled:
                raise ValueError("所选实例已停用")
        if req.cloud and (not dest.cloud_channel or dest.cloud_channel not in channels):
            raise ValueError("云端出图配置须明确选择存在的目标渠道")
        if dest.cloud_channel and dest.cloud_channel not in channels:
            raise ValueError("所选云端渠道不存在")


def _remap(payload, bindings):
    p = payload.model_copy(deep=True)
    ids: dict[str, dict[str, str]] = {}
    for kind, items, prefix in (
        ("series", [p.series], "series"),
        ("episodes", p.episodes, "episode"),
        ("profiles", p.profiles, "profile"),
        ("workflows", p.workflows, "wf"),
        ("presets", p.series.presets, "preset"),
        ("variants", p.series.variants, "var"),
        ("characters", p.series.bible.characters, "char"),
        ("locations", p.series.bible.locations, "loc"),
        ("props", p.series.bible.props, "prop"),
        ("styles", p.series.bible.styles, "style"),
    ):
        ids[kind] = {item.id: new_id(prefix) for item in items}
    series = p.series
    series.id, series.title, series.kind = ids["series"][series.id], p.title, "kit"
    series.status, series.deleted_at = "draft", None
    series.created_at = series.updated_at = now_iso()
    series.default_profile_id = ids["profiles"].get(series.default_profile_id)
    # Character IDs can also be variable tokens. Explicit user variables keep precedence.
    shadowed = set(series.variables) | {e.key for preset in series.presets for e in preset.entries}

    def tokens(value, extra=()):
        if isinstance(value, str):
            return PATTERN.sub(
                lambda m: (
                    "{" + ids["characters"][m[1]] + "}"
                    if m[1] in ids["characters"] and m[1] not in shadowed and m[1] not in extra
                    else m[0]
                ),
                value,
            )
        if isinstance(value, dict):
            return {k: tokens(v, extra) for k, v in value.items()}
        if isinstance(value, list):
            return [tokens(v, extra) for v in value]
        return value

    series.variables = tokens(series.variables)
    for key in ("characters", "locations", "props", "styles"):
        for item in getattr(series.bible, key):
            item.id = ids[key][item.id]
    for preset in series.presets:
        preset.id = ids["presets"][preset.id]
        groups = {group.id: new_id("group") for group in preset.groups}
        for group in preset.groups:
            group.id = groups[group.id]
        for entry in preset.entries:
            entry.id, entry.group_id = new_id("entry"), groups.get(entry.group_id)
            entry.value = tokens(entry.value)
        for binding in preset.bindings:
            if (
                binding.source == "variable"
                and binding.value in ids["characters"]
                and binding.value not in shadowed
            ):
                binding.value = ids["characters"][binding.value]
            elif binding.source == "literal":
                binding.value = tokens(binding.value)
    for variant in series.variants:
        variant.id = ids["variants"][variant.id]
        variant.style_id = ids["styles"].get(variant.style_id)
        variant.profile_id = ids["profiles"].get(variant.profile_id)
        variant.characters = {
            ids["characters"][cid]: {
                **patch,
                **({"id": ids["characters"][cid]} if "id" in patch else {}),
            }
            for cid, patch in variant.characters.items()
        }
    ids["panels"] = {}
    for ep in p.episodes:
        old_id = ep.id
        panels = {panel.id: new_id("panel") for panel in ep.panels}
        ids["panels"].update({f"{old_id}/{old}": new for old, new in panels.items()})
        ep.id, ep.series_id = ids["episodes"][old_id], series.id
        ep.created_at = ep.updated_at = now_iso()
        ep.revision = 0
        ep.base_prompt, ep.synopsis = tokens(ep.base_prompt), tokens(ep.synopsis)
        for panel in ep.panels:
            panel.id = panels[panel.id]
            panel.location_id = ids["locations"].get(panel.location_id)
            panel.props = [ids["props"][pid] for pid in panel.props]
            panel.overrides.profile_id = ids["profiles"].get(panel.overrides.profile_id)
            for character in panel.characters:
                character.character_id = ids["characters"][character.character_id]
            for dialogue in panel.dialogues:
                dialogue.speaker_id = ids["characters"].get(dialogue.speaker_id)
                dialogue.text = tokens(
                    dialogue.text, {k[1:] for k in panel.overrides.values if k.startswith("$")}
                )
            panel.overrides = panel.overrides.model_validate(
                tokens(
                    panel.overrides.model_dump(),
                    {k[1:] for k in panel.overrides.values if k.startswith("$")},
                )
            )
            panel.description = tokens(panel.description)
        ep.strip.panel_boxes = {panels[k]: v for k, v in ep.strip.panel_boxes.items()}
        ep.strip.crops = {panels[k]: v for k, v in ep.strip.crops.items()}
        for layer in ep.strip.lettering:
            layer.id = new_id("letter")
            layer.panel_id, layer.bridge_to = (
                panels.get(layer.panel_id),
                panels.get(layer.bridge_to),
            )
            layer.speaker_id = ids["characters"].get(layer.speaker_id)
            layer.text = tokens(layer.text)
    for workflow in p.workflows:
        workflow.id, workflow.source = ids["workflows"][workflow.id], "import"
        workflow.created_at = workflow.updated_at = now_iso()
    for profile in p.profiles:
        dest = bindings[profile.id]
        profile.id = ids["profiles"][profile.id]
        profile.instances = list(dest.instances or [f"unbound-{profile.id}"])
        profile.cloud_channel = dest.cloud_channel or f"unbound-{profile.id}"
        profile.binding_required = dest.unbound
        profile.created_at = profile.updated_at = now_iso()
        for stage in [*profile.draft, *profile.final, *profile.edits.values()]:
            stage.id, stage.workflow_id = new_id("stage"), ids["workflows"][stage.workflow_id]
    p.series = Series.model_validate(series.model_dump())
    p.episodes = [Episode.model_validate(e.model_dump()) for e in p.episodes]
    return p, ids


def import_kit(ctx, request: KitImport) -> KitImported:
    if len(request.archive_base64) > ((MAX_ARCHIVE + 2) // 3) * 4:
        raise ValueError("创作套装超过 64 MB")
    try:
        data = base64.b64decode(request.archive_base64, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("套装必须是合法的 base64 数据") from None
    payload, blobs = unpack(data)
    sha = request_hash(
        {
            "archive": hashlib.sha256(data).hexdigest(),
            "profiles": {k: v.model_dump() for k, v in request.profiles.items()},
        }
    )
    with ctx.store.tx() as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS kit_receipts (key TEXT PRIMARY KEY, sha TEXT NOT NULL, result_json TEXT NOT NULL)"
        )
        receipt = db.execute(
            "SELECT sha,result_json FROM kit_receipts WHERE key=?", (request.idempotency_key,)
        ).fetchone()
        if receipt:
            if receipt["sha"] != sha:
                raise Conflict("套装导入幂等键已被不同请求使用")
            result = KitImported.model_validate_json(receipt["result_json"])
            ctx.store.get_series(result.series_id)
            for eid in result.episode_ids:
                ctx.store.get_episode(eid)
            return result
        _destinations(ctx, payload, request.profiles)
        imported, ids = _remap(payload, request.profiles)
        # Blobs are content-addressed; rollback leaves no visible asset metadata or partial kit.
        for aid, blob in blobs.items():
            mime, width, height = sniff(blob)
            asset = Asset(
                id=aid, mime=mime, size=len(blob), width=width, height=height, source="creation-kit"
            )
            target = ctx.assets.path(asset)
            if not target.exists():
                ctx.assets._write(target, blob)
            ctx.store.put_asset(asset)
        for doc in [*imported.workflows, *imported.profiles]:
            ctx.store.put_doc(doc)
        ctx.store.create_series(imported.series)
        for episode in imported.episodes:
            ctx.store.create_episode(episode)
        result = KitImported(
            series_id=imported.series.id,
            episode_ids=[e.id for e in imported.episodes],
            preset_ids=[p.id for p in imported.series.presets],
            id_map=ids,
            unbound_profile_ids=[
                ids["profiles"][pid] for pid, dest in request.profiles.items() if dest.unbound
            ],
        )
        db.execute(
            "INSERT INTO kit_receipts VALUES (?,?,?)",
            (request.idempotency_key, sha, result.model_dump_json()),
        )
        return result


def kit(ctx, series_id):
    series = ctx.store.get_series(series_id)
    if series.kind != "kit":
        raise NotFound("创作套装不存在")
    return series


def _assembly_snapshot(ctx, series_id: str, request: KitAssembly):
    from .. import generation as G

    source = kit(ctx, series_id)
    episode = ctx.store.get_episode(request.episode_id)
    snapshot = build_snapshot(
        source,
        episode,
        request.preset_ids,
        request.title,
        profile_id=request.profile_id,
        variables=request.variables,
    )
    G.attach(ctx.store, snapshot.series, snapshot.episode, request.generation)
    return snapshot


def preview_kit(ctx, series_id: str, request: KitAssembly):
    with ctx.store.lock:
        snapshot = _assembly_snapshot(ctx, series_id, request)
        return inspect_snapshot(ctx.store, snapshot, request.episode_id)


def assemble_kit(ctx, series_id: str, request: KitAssembly):
    from .. import generation as G

    sha = request_hash(
        {
            "series_id": series_id,
            **request.model_dump(exclude={"idempotency_key"}, exclude_unset=True),
        }
    )
    key = "kit-assemble:" + hashlib.sha256(request.idempotency_key.encode()).hexdigest()
    with ctx.store.tx():
        previous = ctx.store.assembly_receipt(key, sha)
        if previous:
            return previous
        snapshot = _assembly_snapshot(ctx, series_id, request)
        result = ctx.store.create_assembly(
            snapshot.series, snapshot.episode, idempotency_key=key, request_sha=sha
        )
        G.remember(ctx.store, snapshot.series.generation)
        return result
