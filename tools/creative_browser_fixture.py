"""Neutral, isolated fixtures and a fake image executor for real creative UI checks."""

from __future__ import annotations

import copy
import io
import sys
from pathlib import Path

from creative_browser_common import (
    CANVAS_ID,
    CANVAS_SERIES,
    EPISODE_ID,
    SERIES_ID,
    WORKFLOW_ID,
    WORKSHOP_ID,
)

ROOT = Path(__file__).resolve().parents[1]


def artwork(index: int = 0) -> bytes:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (960, 1280), ("#647f83", "#a17f65", "#81916e")[index % 3])
    draw = ImageDraw.Draw(image)
    for line in range(12):
        x = 30 + line * 80
        draw.line((x, 0, x, 1280), fill="#d8d0bb", width=3)
    draw.rectangle((110, 280, 850, 1000), outline="#f5f1e9", width=12)
    draw.text((145, 320), f"NEUTRAL CREATIVE FIXTURE {index}", fill="white")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


class NeutralComfy:
    graphs: list[dict] = []

    def __init__(self, base_url):
        if base_url.rstrip("/") != "http://fixture.invalid":
            raise ValueError("The creative fixture refuses real ComfyUI endpoints")

    def upload_image(self, data, filename, subfolder="mio"):
        return f"{subfolder}/{filename}"

    def run(self, graph, outputs, on_event=None, timeout=0, on_queued=None, cancelled=None):
        from mio_server.comfy.client import OutputImage, RunResult

        self.graphs.append(copy.deepcopy(graph))
        identifier = f"neutral-{len(self.graphs)}"
        if on_queued:
            on_queued(identifier)
        if on_event:
            on_event({"type": "progress", "value": 1, "max": 1})
        return RunResult(
            identifier,
            [OutputImage("9", "neutral.png", "", "output", artwork(len(self.graphs)))],
            0.01,
        )

    def system_stats(self):
        return {"system": {"os": "isolated fixture"}, "devices": []}

    def object_info(self, node_class=None):
        return {
            kind: {"input": {"required": {}}}
            for kind in (
                "CheckpointLoaderSimple",
                "LoraLoader",
                "CLIPTextEncode",
                "EmptyLatentImage",
                "KSampler",
                "VAEDecode",
                "LoadImage",
                "ImageBlend",
                "SaveImage",
            )
        }

    def history(self, prompt_id):
        return {"outputs": {"9": {"images": [{"filename": "neutral.png"}]}}}

    def interrupt(self):
        pass

    def delete_queued(self, prompt_id):
        pass


def seed_workspace(ctx):
    from mio_server.models import (
        AssetRef,
        Bible,
        Character,
        Episode,
        Face,
        LetteringLayer,
        Panel,
        Series,
        Strip,
        Take,
    )
    from mio_server.render_models import ComfyInstance, RenderProfile, RenderStage, WorkflowDoc

    assets = [
        ctx.assets.put(artwork(index), source="creative-browser-fixture") for index in range(3)
    ]
    graph = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "neutral.safetensors"},
        },
        "2": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["1", 1],
                "lora_name": "neutral-a.safetensors",
                "strength_model": 0.75,
                "strength_clip": 0.5,
            },
        },
        "3": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["2", 0],
                "clip": ["2", 1],
                "lora_name": "neutral-b.safetensors",
                "strength_model": 0.6,
                "strength_clip": 0.4,
            },
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["3", 1]},
            "_meta": {"title": "[mio:prompt]"},
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["3", 1]},
            "_meta": {"title": "[mio:negative]"},
        },
        "6": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 256, "height": 256, "batch_size": 1},
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["3", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
                "seed": 1,
                "steps": 2,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1,
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["1", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["11", 0]}},
        "10": {
            "class_type": "LoadImage",
            "inputs": {"image": "neutral.png"},
            "_meta": {"title": "[mio:ref:1]"},
        },
        "11": {
            "class_type": "ImageBlend",
            "inputs": {
                "image1": ["8", 0],
                "image2": ["10", 0],
                "blend_factor": 0.15,
                "blend_mode": "normal",
            },
        },
    }
    ctx.store.put_doc(WorkflowDoc(id=WORKFLOW_ID, name="中性隔离工作流", graph=graph))
    profile = RenderProfile(
        id="creative-neutral-profile",
        name="中性隔离方案",
        candidates=2,
        draft=[RenderStage(workflow_id=WORKFLOW_ID)],
        instances=["creative-comfy"],
    )
    ctx.store.put_doc(profile)
    ctx.store.put_doc(
        ComfyInstance(
            id="creative-comfy", name="隔离模拟器", base_url="http://fixture.invalid", capacity=1
        )
    )
    ctx.refresh_instances()
    bible = Bible(
        characters=[
            Character(
                id="creative-navigator",
                name="林夏",
                age=26,
                tag_description=["calm navigator", "short black hair"],
                references=[
                    AssetRef(asset_id=assets[0].id, role="front", label="neutral geometry")
                ],
            ),
            Character(
                id="creative-cartographer",
                name="舟白",
                age=28,
                tag_description=["quiet cartographer"],
            ),
        ]
    )
    ctx.store.create_series(
        Series(
            id=WORKSHOP_ID,
            title="创作工坊",
            kind="workshop",
            bible=bible,
            variables={"wardrobe": ""},
            default_profile_id=profile.id,
        )
    )
    ctx.store.create_series(
        Series(id=SERIES_ID, title="候选交互验收", default_profile_id=profile.id)
    )
    panels, takes = [], []
    for panel in range(3):
        panel_id = f"creative-panel-{panel}"
        panels.append(Panel(id=panel_id, order=panel, description=f"第 {panel + 1} 幕 · 雨后街景"))
        for candidate, asset in enumerate(assets):
            takes.append(
                Take(
                    id=f"creative-take-{panel}-{candidate}",
                    panel_id=panel_id,
                    asset_id=asset.id,
                    status="adopted" if panel == candidate == 0 else "candidate",
                    width=960,
                    height=1280,
                    created_at=f"2026-11-21T00:00:0{candidate}+00:00",
                )
            )
    ctx.store.create_episode(
        Episode(
            id=EPISODE_ID,
            series_id=SERIES_ID,
            title="候选挑图",
            order=0,
            panels=panels,
            takes=takes,
        )
    )
    ctx.store.create_series(
        Series(id=CANVAS_SERIES, title="画布交互验收", default_profile_id=profile.id)
    )
    canvas = Episode(
        id=CANVAS_ID,
        series_id=CANVAS_SERIES,
        title="画布",
        order=0,
        panels=[Panel(id="canvas-panel", order=0, description="Neutral garden")],
        takes=[
            Take(
                id="canvas-take",
                panel_id="canvas-panel",
                asset_id=assets[0].id,
                status="adopted",
                width=960,
                height=1280,
                faces=[Face(box=(0.2, 0.1, 0.5, 0.4))],
            )
        ],
        strip=Strip(
            width=800,
            height=1500,
            manual=True,
            panel_boxes={"canvas-panel": (0, 100, 800, 1100)},
            lettering=[
                LetteringLayer(
                    id="bubble",
                    panel_id="canvas-panel",
                    text="Hello",
                    box=(180, 250, 390, 370),
                    tail_to=(230, 420),
                    font_size=24,
                    locked=True,
                ),
                LetteringLayer(
                    id="caption",
                    panel_id="canvas-panel",
                    text="Keep",
                    kind="caption",
                    box=(400, 100, 700, 220),
                    font_size=18,
                    vertical=True,
                    locked=True,
                ),
                LetteringLayer(
                    id="untouched",
                    panel_id="canvas-panel",
                    text="Still",
                    kind="caption",
                    box=(40, 1200, 240, 1280),
                    font_size=30,
                    locked=True,
                ),
            ],
        ),
    )
    ctx.store.create_episode(canvas)
    return {EPISODE_ID: ctx.store.get_episode(EPISODE_ID), CANVAS_ID: canvas}


def serve(port: int, data_dir: Path) -> None:
    import uvicorn

    sys.path.insert(0, str(ROOT / "server"))
    from fastapi.routing import APIRoute
    from mio_server.api import create_app
    from mio_server.context import AppContext

    ctx = AppContext.create(
        data_dir, autostart=False, seed_instance=False, comfy_client_factory=NeutralComfy
    )
    try:
        ctx.updater.startup_check = lambda _feed: None
        ctx.legacy_root = data_dir / "empty"
        baseline = seed_workspace(ctx)
        app = create_app(ctx, serve_web=True)

        def restore(episode_id):
            saved = baseline[episode_id]

            def apply(episode):
                for field in ("panels", "takes", "strip"):
                    setattr(episode, field, copy.deepcopy(getattr(saved, field)))

            ctx.store.update_episode(episode_id, apply)
            return {"episode_id": episode_id}

        def reset():
            NeutralComfy.graphs.clear()
            for series in ctx.store.list_series():
                if series.id not in {WORKSHOP_ID, SERIES_ID, CANVAS_SERIES}:
                    ctx.store.delete_series(series.id)
            for episode in ctx.store.list_episodes(WORKSHOP_ID):
                ctx.store.delete_episode(episode.id)
            for episode_id in baseline:
                restore(episode_id)
            return {"workspace": "disposable", "workshop_id": WORKSHOP_ID}

        def source_conflict(episode_id: str):
            def apply(episode):
                episode.panels[0].overrides.values["$wardrobe"] = "server blue"

            ctx.store.update_episode(episode_id, apply)
            return {"revision": ctx.store.get_episode(episode_id).revision}

        def block_canvas():
            restore(CANVAS_ID)

            def apply(episode):
                episode.strip.lettering[0].box = (0, 100, 800, 1100)

            ctx.store.update_episode(CANVAS_ID, apply)
            return {"episode_id": CANVAS_ID}

        def canvas_conflict():
            ctx.store.update_episode(
                CANVAS_ID, lambda episode: setattr(episode.strip, "background", "#aabbcc")
            )
            return {"revision": ctx.store.get_episode(CANVAS_ID).revision}

        def state():
            return {
                "graphs": [
                    {
                        "prompt": graph["4"]["inputs"]["text"],
                        "first": graph["2"]["inputs"],
                        "second": graph["3"]["inputs"],
                    }
                    for graph in NeutralComfy.graphs
                ]
            }

        for path, endpoint, methods in (
            ("reset", reset, ["POST"]),
            ("canvas-reset", lambda: restore(CANVAS_ID), ["POST"]),
            ("canvas-block", block_canvas, ["POST"]),
            ("canvas-conflict", canvas_conflict, ["POST"]),
            ("source-conflict", source_conflict, ["POST"]),
            ("state", state, ["GET"]),
        ):
            app.router.routes.insert(
                0, APIRoute("/__creative_fixture/" + path, endpoint, methods=methods)
            )
        ctx.engine.start()
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="critical")
    finally:
        ctx.close()
