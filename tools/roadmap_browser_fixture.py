"""Synthetic isolated workspace for the reproducible roadmap browser acceptance tool."""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

from creative_browser_common import WORKSHOP_ID
from creative_browser_fixture import NeutralComfy, seed_workspace

ROOT = Path(__file__).resolve().parents[1]
SHELF_IDS = tuple(f"roadmap-shelf-{index}" for index in range(3))
THEME = "roadmap-neutral-dynamic"
LONG_PRESET_TITLE = "长篇角色预设设定集LongPresetTitle" * 4
LONG_PRESET_KEY = "layout_probe"


def serve(port: int, data_dir: Path) -> None:
    import uvicorn
    from PIL import Image

    if data_dir.exists() and any(data_dir.iterdir()):
        raise RuntimeError("The synthetic fixture requires an empty disposable data directory")
    sys.path.insert(0, str(ROOT / "server"))
    from fastapi.routing import APIRoute
    from mio_server.api import create_app
    from mio_server.collection_models import CollectionLibrary
    from mio_server.context import AppContext
    from mio_server.extensions import manager as extension_manager
    from mio_server.models import Episode, Panel, Preset, PresetEntry, Series, Take

    extension_manager.BUILTIN_ROOT = data_dir / "empty-bundled-extensions"
    theme = data_dir / "themes" / THEME
    (theme / "assets").mkdir(parents=True)
    (theme / "mio-theme.json").write_text(
        json.dumps(
            {
                "id": THEME,
                "name": "Neutral roadmap fixture",
                "version": "1.0.0",
                "author": "Fixture",
                "description": "Synthetic neutral local wallpaper",
                "theme_file": "theme.json",
            }
        ),
        encoding="utf-8",
    )
    (theme / "theme.json").write_text(
        json.dumps(
            {
                "id": THEME,
                "name": "Neutral roadmap fixture",
                "mode": "dark",
                "background": {"kind": "image", "file": "assets/neutral.gif", "opacity": 0.3},
            }
        ),
        encoding="utf-8",
    )
    with Image.new("RGB", (48, 48), "#35454a") as first:
        with Image.new("RGB", (48, 48), "#455253") as second:
            first.save(
                theme / "assets/neutral.gif",
                save_all=True,
                append_images=[second],
                duration=500,
                loop=0,
            )
    ctx = AppContext.create(
        data_dir, autostart=False, seed_instance=False, comfy_client_factory=NeutralComfy
    )
    try:
        ctx.updater.startup_check = lambda _feed: None
        ctx.legacy_root = data_dir / "no-personal-data"
        baseline = seed_workspace(ctx)

        def long_preset(workshop):
            workshop.presets.append(
                Preset(
                    id="roadmap-long-title-preset",
                    title=LONG_PRESET_TITLE,
                    entries=[PresetEntry(key=LONG_PRESET_KEY, value="Neutral layout marker")],
                )
            )

        ctx.store.update_series(WORKSHOP_ID, long_preset)
        asset = next(iter(baseline.values())).takes[0].asset_id
        for index, title in enumerate(("合集验收甲册", "合集验收乙册", "合集验收丙册")):
            identifier = SHELF_IDS[index]
            ctx.store.create_series(
                Series(
                    id=identifier,
                    title=title,
                    created_at=f"2026-11-{25 - index:02}T00:00:00+00:00",
                )
            )
            episode = Episode(
                id=f"{identifier}-episode",
                series_id=identifier,
                title=title,
                order=0,
                panels=[Panel(id=f"{identifier}-panel", order=0, description="Neutral geometry")],
                takes=[
                    Take(
                        id=f"{identifier}-take",
                        panel_id=f"{identifier}-panel",
                        asset_id=asset,
                        status="adopted",
                        width=960,
                        height=1280,
                    )
                ],
            )
            ctx.store.create_episode(episode)
            baseline[episode.id] = copy.deepcopy(episode)
        baseline_series = {series.id for series in ctx.store.list_series()}

        def reset():
            NeutralComfy.graphs.clear()
            ctx.store.put_doc(CollectionLibrary())
            for series in ctx.store.list_series():
                if series.id not in baseline_series:
                    ctx.store.delete_series(series.id)
                else:
                    for episode in ctx.store.list_episodes(series.id):
                        if episode.id not in baseline:
                            ctx.store.delete_episode(episode.id)
            for identifier, saved in baseline.items():

                def restore(episode, source=saved):
                    for field in ("title", "panels", "takes", "strip", "base_prompt"):
                        setattr(episode, field, copy.deepcopy(getattr(source, field)))

                ctx.store.update_episode(identifier, restore)
            return {"fixture": "roadmap", "workspace": "disposable", "shelf_ids": SHELF_IDS}

        app = create_app(ctx, serve_web=True)
        app.router.routes.insert(0, APIRoute("/__roadmap_fixture/reset", reset, methods=["POST"]))
        ctx.engine.start()
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="critical")
    finally:
        ctx.close()
