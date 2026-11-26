"""Disposable neutral fixtures for the real-browser professional-panel acceptance tool."""

from __future__ import annotations

import copy
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERIES = "professional-browser-series"
EPISODE = "professional-browser-episode"
PACKAGES = {
    "panel-retouch": ("retouch", "单格精修"),
    "finalize-studio": ("finalize", "成品精修"),
    "qa-review": ("review", "候选评审"),
    "script-assistant": ("assistant", "剧本助手"),
    "variant-workshop": ("variants", "变体工坊"),
    "motion-studio": ("motion", "Motion comics · 动态漫"),
}


def packages(folder: Path) -> dict[str, Path]:
    files = {}
    for identifier in PACKAGES:
        path = folder / f"{identifier}.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            source = ROOT / "extensions" / identifier
            for item in sorted(source.rglob("*")):
                if item.is_file() and item.suffix in {
                    ".json",
                    ".py",
                    ".js",
                    ".css",
                    ".html",
                    ".md",
                }:
                    if "__pycache__" not in item.parts:
                        archive.write(item, identifier + "/" + item.relative_to(source).as_posix())
        files[identifier] = path
    return files


def serve(port: int, data: Path) -> None:
    import uvicorn
    from PIL import Image, ImageDraw

    sys.path.insert(0, str(ROOT / "server"))
    from fastapi.routing import APIRoute
    from mio_server.api import create_app
    from mio_server.comfy.client import OutputImage, RunResult
    from mio_server.context import AppContext
    from mio_server.extensions import manager as extension_manager
    from mio_server.models import AssetRef, Series, Style, Take
    from mio_server.pipeline.story import from_story
    from mio_server.render_models import ComfyInstance, RenderStage
    from tests.api_harness import FakeComfy, FakeLLM
    from tests.story_fixture import make_story
    from tests.test_render_qa import FakeVLM

    # Install exactly the six reviewed archives. Do not hash unrelated development
    # dependencies (notably ai-assist/page/node_modules) as bundled package contents.
    extension_manager.BUILTIN_ROOT = data / "empty-bundled-extensions"

    # A two-frame, neutral local GIF exercises the actual dynamic-theme rendering path.
    theme = data / "themes" / "fixture-dynamic"
    theme.mkdir(parents=True)
    (theme / "assets").mkdir()
    (theme / "mio-theme.json").write_text(
        json.dumps(
            {
                "id": "fixture-dynamic",
                "name": "Neutral fixture",
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
                "id": "fixture-dynamic",
                "name": "Neutral fixture",
                "mode": "dark",
                "background": {"kind": "image", "file": "assets/neutral.gif", "opacity": 0.3},
            }
        ),
        encoding="utf-8",
    )
    with Image.new("RGB", (48, 48), "#35454a") as first:
        with Image.new("RGB", (48, 48), "#455253") as second:
            first.save(
                theme / "assets" / "neutral.gif",
                save_all=True,
                append_images=[second],
                duration=500,
                loop=0,
            )

    calls = {"comfy": 0, "vision": 0, "text": 0}

    def artwork(color, caption="Fixture"):
        with Image.new("RGB", (240, 320), color) as image:
            draw = ImageDraw.Draw(image)
            draw.rectangle((30, 40, 210, 280), outline="#eee5ce", width=5)
            draw.text((44, 68), caption, fill="white")
            output = io.BytesIO()
            image.save(output, "PNG")
            return output.getvalue()

    class LocalComfy(FakeComfy):
        def run(self, graph, outputs, on_event=None, timeout=0, on_queued=None, cancelled=None):
            calls["comfy"] += 1
            identifier = f"fixture-{calls['comfy']}"
            if on_queued:
                on_queued(identifier)
            if on_event:
                on_event({"type": "progress", "value": 1, "max": 1})
            image = artwork((90 + calls["comfy"] * 23 % 150, 73, 62), "Fake result")
            return RunResult(
                identifier, [OutputImage("9", "fixture.png", "", "output", image)], 0.01
            )

    class LocalLLM(FakeLLM):
        def chat_json(self, *args, **kwargs):
            calls["text"] += 1
            return super().chat_json(*args, **kwargs)

        def vision_json(self, *args, **kwargs):
            calls["vision"] += 1
            return super().vision_json(*args, **kwargs)

    def revise(story):
        if not story["panels"]:
            return story
        story["panels"][0]["description"] = "A calm blue window after the rain."
        story["panels"][1]["dialogue"][0]["text"] = "The rain has stopped."
        story["panels"][2]["description"] = "This locked suggestion is never applied."
        return story

    FakeLLM.edit = revise
    FakeVLM.identity = 2
    FakeVLM.dialogue_score = 2
    FakeVLM.dialogue_note = "The visible calm conflicts with the dialogue's urgency <unsafe>."
    ctx = AppContext.create(
        data,
        autostart=False,
        seed_instance=False,
        llm_factory=LocalLLM,
        comfy_client_factory=LocalComfy,
    )
    try:
        ctx.legacy_root = data / "empty-legacy"
        ctx.updater.startup_check = lambda _feed: None
        ctx.store.put_doc(ComfyInstance(id="fixture-local", base_url="http://fake", capacity=2))
        ctx.refresh_instances()
        series = Series(id=SERIES, title="专业扩展验收 · 雨后书页")
        bible, episode = from_story(make_story(3), series.id)
        series.bible = bible
        bible.styles = [Style(id="fixture-ink", name="墨色留白", tag_description=["ink drawing"])]
        reference = ctx.assets.put(artwork((65, 93, 104), "Reference"), source="browser-fixture")
        for character in bible.characters:
            character.references = [AssetRef(asset_id=reference.id, role="front")]
        episode.id, episode.title = EPISODE, "三个安静的片刻"
        episode.panels[2].locked = True
        for panel in episode.panels:
            for index in range(2):
                asset = ctx.assets.put(
                    artwork((44 + index * 28, 89, 108), panel.id), source="browser-fixture"
                )
                episode.takes.append(
                    Take(
                        id=f"fixture-{panel.id}-{index}",
                        panel_id=panel.id,
                        asset_id=asset.id,
                        status="adopted" if index == 0 else "candidate",
                        width=240,
                        height=320,
                        parameter_snapshot={"prompt": "a quiet room", "negative": ""},
                    )
                )
        ctx.store.create_series(series)
        ctx.store.create_episode(episode)
        profile = ctx.store.get_doc("profile", "profile_default")
        profile.name = "离线模拟 · 双阶段精修"
        profile.edits["edit"] = RenderStage(
            id="fixture-edit", kind="edit", workflow_id="builtin_i2i_tile"
        )
        profile.final.append(
            RenderStage(id="fixture-details", kind="refine", workflow_id="builtin_i2i_tile")
        )
        ctx.store.put_doc(profile)
        disabled = profile.model_copy(deep=True)
        disabled.id, disabled.name = "fixture-disabled", "Disabled Edit"
        for stage in disabled.edits.values():
            stage.enabled = False
        ctx.store.put_doc(disabled)
        original_series, original_episode = copy.deepcopy(series), copy.deepcopy(episode)
        app = create_app(ctx, serve_web=True)

        def reset(empty: bool = False):
            assert not ctx.engine.list(active_only=True), "Finish fixture jobs before reset"

            def reset_series(item):
                item.bible = original_series.bible.model_copy(deep=True)
                item.variants = []

            def reset_episode(item):
                item.panels = copy.deepcopy(original_episode.panels)
                item.takes = copy.deepcopy(original_episode.takes)
                item.strip = original_episode.strip.model_copy(deep=True)
                if empty:
                    item.panels = []
                    item.takes = []

            ctx.store.update_series(SERIES, reset_series)
            ctx.store.update_episode(EPISODE, reset_episode)
            return {"series_id": SERIES, "episode_id": EPISODE, "empty": empty}

        def stats():
            ep = ctx.store.get_episode(EPISODE)
            return {
                "calls": calls,
                "takes": len(ep.takes),
                "jobs": len(ctx.engine.list()),
                "active": len(ctx.engine.list(active_only=True)),
            }

        app.router.routes.insert(
            0, APIRoute("/__professional_fixture/reset", reset, methods=["POST"])
        )
        app.router.routes.insert(0, APIRoute("/__professional_fixture/stats", stats))
        ctx.engine.start()
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="critical")
    finally:
        ctx.close()
