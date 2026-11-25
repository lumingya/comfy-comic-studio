"""Disposable, offline-only data for the roadmap browser performance measurements."""

from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERIES = "power-fixture-series"
EPISODE = "power-fixture-episode"
THEME = "power-fixture-video"


def create_video(target: Path) -> None:
    """Encode a neutral moving test pattern with an already-installed local encoder."""
    import imageio_ffmpeg

    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=30:duration=8",
            "-vf",
            "hue=s=0.15,boxblur=12:2",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(target),
        ],
        check=True,
        capture_output=True,
    )


def serve(port: int, data: Path) -> None:
    import uvicorn
    from PIL import Image, ImageDraw

    sys.path.insert(0, str(ROOT / "server"))
    from fastapi.responses import FileResponse, HTMLResponse
    from fastapi.routing import APIRoute
    from mio_server.api import create_app
    from mio_server.context import AppContext
    from mio_server.extensions import manager as extension_manager
    from mio_server.models import Episode, Panel, Series, Strip, Take

    extension_manager.BUILTIN_ROOT = data / "no-bundled-extensions"
    theme = data / "themes" / THEME
    video = theme / "assets" / "neutral.mp4"
    create_video(video)
    (theme / "mio-theme.json").write_text(
        json.dumps(
            {
                "id": THEME,
                "name": "Neutral encoded video",
                "version": "1.0.0",
                "author": "Measurement fixture",
                "description": "Locally encoded H.264 test pattern; no user media",
                "theme_file": "theme.json",
            }
        ),
        encoding="utf-8",
    )
    (theme / "theme.json").write_text(
        json.dumps(
            {
                "id": THEME,
                "name": "Neutral encoded video",
                "mode": "dark",
                "background": {"kind": "video", "file": "assets/neutral.mp4", "opacity": 0.4},
            }
        ),
        encoding="utf-8",
    )
    ctx = AppContext.create(data, autostart=False, seed_instance=False)
    try:
        ctx.legacy_root = data / "no-legacy-data"
        ctx.updater.startup_check = lambda _feed: None
        series = Series(id=SERIES, title="Offline performance fixture")
        assets = []
        for index in range(12):
            with Image.new("RGB", (480, 640), (55 + index * 8, 80 + index * 5, 110)) as im:
                draw = ImageDraw.Draw(im)
                draw.rectangle((30, 30, 450, 610), outline="white", width=4)
                draw.text((50, 70), f"Neutral candidate {index + 1}", fill="white")
                stream = io.BytesIO()
                im.save(stream, "PNG")
                assets.append(ctx.assets.put(stream.getvalue(), source="power-fixture"))
        episode = Episode(
            id=EPISODE,
            series_id=SERIES,
            title="120 quiet scenes",
            order=0,
            panels=[
                Panel(id=f"power-panel-{i:03}", order=i, description=f"A quiet room, scene {i + 1}")
                for i in range(120)
            ],
            strip=Strip(
                width=800,
                height=120 * 620 + 24,
                manual=True,
                panel_boxes={
                    f"power-panel-{i:03}": (24, 24 + i * 620, 776, 600 + i * 620)
                    for i in range(120)
                },
            ),
        )
        for panel in episode.panels:
            for index, asset in enumerate(assets):
                episode.takes.append(
                    Take(
                        id=f"{panel.id}-take-{index:02}",
                        panel_id=panel.id,
                        asset_id=asset.id,
                        status="adopted" if index == 0 else "candidate",
                        width=480,
                        height=640,
                    )
                )
        ctx.store.create_series(series)
        ctx.store.create_episode(episode)
        app = create_app(ctx, serve_web=True)
        app.router.routes.insert(
            0,
            APIRoute(
                "/__power_fixture/video.mp4", lambda: FileResponse(video, media_type="video/mp4")
            ),
        )
        app.router.routes.insert(
            0,
            APIRoute(
                "/__power_fixture/clean",
                lambda: HTMLResponse(
                    '<!doctype html><html><meta charset="utf-8"><title>Video reference</title>'
                    "<style>body{margin:0;background:#222}video{position:fixed;inset:0;"
                    "width:100%;height:100%;object-fit:cover}</style>"
                    '<video autoplay muted loop playsinline src="/__power_fixture/video.mp4">'
                    "</video></html>"
                ),
            ),
        )
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="critical")
    finally:
        ctx.close()
