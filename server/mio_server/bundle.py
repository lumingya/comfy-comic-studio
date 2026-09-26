"""``.mio.zip``: a self-contained series bundle (series, episodes, assets, workflows, profiles).

Layout::

    manifest.json          {"format": "mio.bundle", "version": 1, "series_id", "counts", ...}
    series.json            the Series document
    episodes/<id>.json     every live episode (the trash is not exported)
    workflows/<id>.json    workflows referenced by the profiles below (builtins excluded)
    profiles/<id>.json     render profiles referenced by the series / its panels / variants
    assets/<sha256>.<ext>  every referenced asset, verified against its hash on import

Importing never overwrites: a series id that already exists gets fresh series / episode ids.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

from .models import Episode, Series, new_id
from .render_models import RenderProfile, WorkflowDoc
from .storage import NotFound

FORMAT = "mio.bundle"
VERSION = 1
MAX_ENTRIES = 20000
MAX_UNPACKED = 4 * 1024**3  # zip-bomb guard: total uncompressed bytes


class BundleError(ValueError):
    pass


def _asset_ids(series: Series, episodes: list[Episode]) -> set[str]:
    ids: set[str] = set()
    b = series.bible
    for item in [*b.characters, *b.locations, *b.props, *b.styles]:
        ids.update(r.asset_id for r in item.references)
    for ep in episodes:
        for p in ep.panels:
            ids.update(r.asset_id for r in p.references)
        for t in ep.takes:
            ids.add(t.asset_id)
            for e in t.edits:
                mask = e.params.get("mask_asset_id")
                if isinstance(mask, str):
                    ids.add(mask)
    return ids


def _profile_ids(series: Series, episodes: list[Episode]) -> set[str]:
    ids = {series.default_profile_id} | {v.profile_id for v in series.variants}
    for ep in episodes:
        ids |= {p.overrides.profile_id for p in ep.panels}
    return {i for i in ids if i}


def export_series(store, assets, series_id: str) -> bytes:
    series = store.get_series(series_id)
    episodes = store.list_episodes(series_id)
    profiles: list[RenderProfile] = []
    for pid in sorted(_profile_ids(series, episodes)):
        try:
            profiles.append(store.get_doc("profile", pid))
        except NotFound:
            pass
    wf_ids = {s.workflow_id for p in profiles for s in [*p.draft, *p.final, *p.edits.values()]}
    workflows: list[WorkflowDoc] = []
    for wid in sorted(wf_ids):
        try:
            doc = store.get_doc("workflow", wid)
        except NotFound:
            continue
        if doc.source != "builtin":
            workflows.append(doc)
    buf = io.BytesIO()
    asset_count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("series.json", series.model_dump_json(indent=1))
        for ep in episodes:
            z.writestr(f"episodes/{ep.id}.json", ep.model_dump_json(indent=1))
        for doc in workflows:
            z.writestr(f"workflows/{doc.id}.json", doc.model_dump_json(indent=1))
        for prof in profiles:
            z.writestr(f"profiles/{prof.id}.json", prof.model_dump_json(indent=1))
        for aid in sorted(_asset_ids(series, episodes)):
            try:
                path = assets.path(aid)
            except NotFound:
                continue
            if path.exists():
                z.write(path, f"assets/{path.name}", compress_type=zipfile.ZIP_STORED)
                asset_count += 1
        manifest = {
            "format": FORMAT,
            "version": VERSION,
            "series_id": series.id,
            "title": series.title,
            "counts": {
                "episodes": len(episodes),
                "assets": asset_count,
                "workflows": len(workflows),
                "profiles": len(profiles),
            },
        }
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
    return buf.getvalue()


def import_series(store, assets, data: bytes) -> dict:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise BundleError("不是有效的 .mio.zip 文件") from None
    with z:
        names = z.namelist()
        if len(names) > MAX_ENTRIES or any(
            n.startswith("/") or ".." in n.split("/") for n in names
        ):
            raise BundleError("压缩包里的路径不安全或文件过多")
        if sum(i.file_size for i in z.infolist()) > MAX_UNPACKED:
            raise BundleError("压缩包解压后超过 4 GB")
        try:
            manifest = json.loads(z.read("manifest.json"))
        except (KeyError, ValueError):
            raise BundleError("缺少 manifest.json") from None
        if manifest.get("format") != FORMAT or int(manifest.get("version", 0)) > VERSION:
            raise BundleError("不支持的包格式或版本，请升级 Mio")
        bad = []
        for name in names:
            if name.startswith("assets/") and not name.endswith("/"):
                blob = z.read(name)
                sha = name.split("/")[-1].split(".")[0]
                if hashlib.sha256(blob).hexdigest() != sha:
                    bad.append(name)
                    continue
                assets.put(blob, source="bundle")
        for name in names:
            if name.startswith("workflows/") and name.endswith(".json"):
                doc = WorkflowDoc.model_validate_json(z.read(name))
                if not _exists(store, "workflow", doc.id):
                    store.put_doc(doc)
            elif name.startswith("profiles/") and name.endswith(".json"):
                prof = RenderProfile.model_validate_json(z.read(name))
                if not _exists(store, "profile", prof.id):
                    store.put_doc(prof)
        series = Series.model_validate_json(z.read("series.json"))
        episodes = [
            Episode.model_validate_json(z.read(n))
            for n in names
            if n.startswith("episodes/") and n.endswith(".json")
        ]
    renamed = False
    try:
        store.get_series(series.id, include_deleted=True)
        renamed = True
    except NotFound:
        pass
    if renamed:
        series = series.model_copy(
            update={"id": new_id("series"), "title": series.title + "（导入）"}
        )
    series.deleted_at = None
    store.create_series(series)
    for ep in sorted(episodes, key=lambda e: e.order):
        update = {"series_id": series.id, "revision": 0}
        if renamed or _episode_exists(store, ep.id):
            update["id"] = new_id("episode")
        store.create_episode(ep.model_copy(update=update))
    return {
        "series_id": series.id,
        "episodes": len(episodes),
        "renamed": renamed,
        "bad_assets": bad,
    }


def _exists(store, kind: str, doc_id: str) -> bool:
    try:
        store.get_doc(kind, doc_id)
        return True
    except NotFound:
        return False


def _episode_exists(store, episode_id: str) -> bool:
    try:
        store.get_episode(episode_id, include_deleted=True)
        return True
    except NotFound:
        return False
