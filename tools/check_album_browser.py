"""Check offline albums in installed Chromium, using only manifest-listed seed artwork.

Run locally: python tools/check_album_browser.py [--screenshots TEMP_DIRECTORY]
No browsers/packages are installed, no network services are contacted, and no local workspace
or seed data is changed. Optional screenshots are for manual visual review; delete after review.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ("export-monograph", "export-nocturne", "export-folio")
TITLE = "雨停以后，信会抵达"
sys.path.insert(0, str(ROOT / "server"))


def export_examples(folder: Path) -> dict[str, Path]:
    from fastapi.testclient import TestClient
    from mio_server.album.build import episode_book
    from mio_server.album.render import AlbumOptions, Book, Frame, render_album
    from mio_server.album.templates import builtin_templates
    from mio_server.api import create_app
    from mio_server.context import AppContext
    from tests.shipped_data_fixture import copy_shipped_data

    seed = copy_shipped_data(folder / "seed", kinds=("albums",))
    ctx = AppContext.create(folder / "workspace", autostart=False, seed_instance=False)
    try:
        with TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1") as client:
            result = client.post("/api/legacy/import", json={"root": str(seed)})
            result.raise_for_status()
            assert not result.json()["warnings"], result.json()["warnings"]
            cards = client.get("/api/series").json()
            series = next(card for card in cards if card["title"] == TITLE)
            [episode] = client.get(f"/api/series/{series['id']}/episodes").json()["items"]
            document = client.get(f"/api/episodes/{episode['id']}").json()
            assert len(document["panels"]) == len(document["takes"]) == 4
            files = {}
            for identifier in TEMPLATES:
                response = client.post(
                    "/api/export/album",
                    json={
                        "episode_ids": [episode["id"]],
                        "template_id": identifier,
                        "lettered": False,
                        "image_profile": "archive",
                        "signature": "Mio · 离线画册验收",
                    },
                )
                response.raise_for_status()
                path = folder / f"{identifier}.html"
                path.write_bytes(response.content)
                files[identifier] = path
            book = episode_book(ctx, episode["id"], lettered=False, profile="archive")
            extreme = Book(
                "长标题与缺图 / " + "雨停以后信会抵达" * 12,
                [book.frames[0], Frame("", name="尚未生成", caption="保留缺图位置")],
                synopsis="长词边界 " + "UnbrokenTitle" * 32,
            )
            for template in builtin_templates():
                if template.id not in TEMPLATES:
                    continue
                path = folder / f"{template.id}-extreme.html"
                path.write_text(
                    render_album(template, [book, extreme], AlbumOptions(signature="Mio")),
                    encoding="utf-8",
                )
                files[template.id + "-extreme"] = path
            return files
    finally:
        ctx.close()


def assert_fit(page, selector: str) -> dict:
    box = page.locator(selector).bounding_box()
    assert box, f"Missing visible region: {selector}"
    viewport = page.viewport_size
    assert box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1, box
    assert box["y"] >= -1 and box["y"] + box["height"] <= viewport["height"] + 1, box
    return {key: round(value, 1) for key, value in box.items()}


def assert_artwork(page, count: int) -> dict:
    page.locator(".cc-image").evaluate_all("images => images.forEach(i => i.loading='eager')")
    page.wait_for_function(
        """count => {
        const images = [...document.querySelectorAll('.cc-image')];
        return images.length === count && images.every(i => i.complete && i.naturalWidth > 0);
        }""",
        arg=count,
    )
    page.locator(".cc-image").evaluate_all("images => Promise.all(images.map(i => i.decode()))")
    metrics = page.evaluate(
        """() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        images:[...document.querySelectorAll('.cc-image')].map(i => {
          const s=getComputedStyle(i), r=i.getBoundingClientRect();
          return {width:r.width,height:r.height,naturalWidth:i.naturalWidth,
            naturalHeight:i.naturalHeight,fit:s.objectFit,maxHeight:s.maxHeight,
            visible:!!i.getClientRects().length};
        })})"""
    )
    assert metrics["scrollWidth"] <= metrics["width"], metrics
    for image in metrics["images"]:
        assert image["fit"] == "contain" and image["maxHeight"] == "none", image
        if image["visible"] and image["height"]:
            assert (
                abs(
                    image["width"] / image["height"]
                    - image["naturalWidth"] / image["naturalHeight"]
                )
                < 0.015
            ), image
    return metrics


def screenshot(page, directory: Path | None, name: str) -> None:
    if directory:
        directory.mkdir(parents=True, exist_ok=True)
        page.evaluate(
            "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
        )
        page.screenshot(path=str(directory / f"{name}.png"), animations="disabled")


def exercise_reader(page, template: str, shots: Path | None, name: str) -> dict:
    from playwright.sync_api import expect

    counter = page.locator(".mio-progress")
    initial_count = page.locator("[data-cc-frame]:visible").count()
    expected = 2 if template == "export-folio" and page.viewport_size["width"] > 680 else 1
    if template != "export-monograph":
        assert initial_count == expected, (initial_count, expected)
    initial_artwork = assert_artwork(page, 4)
    assert all(
        i["naturalWidth"] == 1448 and i["naturalHeight"] == 1086 for i in initial_artwork["images"]
    )
    screenshot(page, shots, name + "-initial")
    page.get_by_role("button", name="目录", exact=True).click()
    expect(page.locator(".mio-tray")).to_be_visible()
    tray = assert_fit(page, ".mio-tray")
    assert_fit(page, ".mio-controls")
    expect(page.locator(".mio-thumbnails button")).to_have_count(4)
    screenshot(page, shots, name + "-directory")
    page.locator(".mio-thumbnails button").last.click()
    expect(page.locator(".mio-tray")).to_be_hidden()
    expect(counter).to_have_text("4 / 4")
    page.keyboard.press("Home")
    expect(counter).to_have_text("1 / 4")
    page.keyboard.press("ArrowRight")
    expect(counter).to_have_text("3 / 4" if expected == 2 else "2 / 4")
    page.get_by_role("button", name="上一页", exact=True).click()
    expect(counter).to_have_text("1 / 4")
    mode = page.get_by_role("button", name=re.compile("切换版式"))
    mode.click()
    assert page.locator("[data-cc-frame]:visible").count() == 1
    mode.click()
    assert page.locator("[data-cc-frame]:visible").count() == 2
    assert_artwork(page, 4)
    screenshot(page, shots, name + "-double")
    mode.click()
    image = page.locator(".cc-image:visible").first
    image.click()
    dialog = page.locator(".cc-lightbox")
    expect(dialog).to_be_visible()
    assert_fit(page, ".cc-lightbox-viewport")
    expect(page.get_by_role("button", name="关闭画作预览")).to_be_focused()
    page.keyboard.press("Shift+Tab")
    assert dialog.evaluate("d => d.contains(document.activeElement)")
    page.keyboard.press("Tab")
    expect(page.get_by_role("button", name="关闭画作预览")).to_be_focused()
    page.keyboard.press("ArrowRight")
    expect(dialog).to_have_attribute("aria-label", re.compile("2 / 4"))
    page.get_by_role("button", name="放大", exact=True).click()
    expect(page.locator(".cc-lightbox-viewport")).to_have_attribute("data-zoomed", "")
    page.get_by_role("button", name="适应窗口", exact=True).click()
    screenshot(page, shots, name + "-lightbox")
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()
    expect(image).to_be_focused()
    page.get_by_role("button", name="无字", exact=True).click()
    assert page.locator("[data-cc-caption]:visible").count() == 0
    page.get_by_role("button", name="无字", exact=True).click()
    assert page.locator("[data-cc-caption]:visible").count() > 0
    page.keyboard.press("g")
    expect(page.locator(".mio-tray")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator(".mio-tray")).to_be_hidden()
    expect(page.get_by_role("button", name="目录", exact=True)).to_be_focused()
    fullscreen = page.get_by_role("button", name="全屏", exact=True)
    if fullscreen.count():
        fullscreen.click()
        page.wait_for_function("() => document.fullscreenElement !== null")
        fullscreen.click()
        page.wait_for_function("() => document.fullscreenElement === null")
    if page.viewport_size["width"] == 390:
        page.keyboard.press("Home")
        session = page.context.new_cdp_session(page)
        for event, points in (
            ("touchStart", [{"x": 300, "y": 350}]),
            ("touchMove", [{"x": 80, "y": 350}]),
            ("touchEnd", []),
        ):
            session.send("Input.dispatchTouchEvent", {"type": event, "touchPoints": points})
        session.detach()
        expect(counter).to_have_text("2 / 4")
    return {
        "initial_artwork": initial_artwork,
        "tray_bounds": tray,
        "initial_visible_frames": initial_count,
        "interactions": "passed",
    }


def exercise_motion(page) -> None:
    page.emulate_media(reduced_motion="no-preference")
    if page.locator("body").get_attribute("data-mio-paged") is None:
        page.get_by_role("button", name=re.compile("切换版式")).click()
    page.keyboard.press("Home")
    page.keyboard.press("ArrowRight")
    assert (
        page.locator("[data-mio-enter]:visible").evaluate("e=>getComputedStyle(e).animationName")
        == "mio-enter"
    )
    page.emulate_media(reduced_motion="reduce")


def exercise_extreme(page, path: Path, shots: Path | None, name: str) -> dict:
    from playwright.sync_api import expect

    page.goto(path.as_uri(), wait_until="load")
    assert_artwork(page, 6)
    page.get_by_role("button", name="目录", exact=True).click()
    expect(page.locator(".mio-thumbnails button")).to_have_count(6)
    page.locator(".mio-thumbnails button").nth(4).click()
    expect(page.locator(".mio-progress")).to_have_text("5 / 6")
    page.keyboard.press("End")
    expect(page.locator(".mio-progress")).to_have_text("6 / 6")
    assert_artwork(page, 6)
    screenshot(page, shots, name + "-extreme")
    assert page.locator(".cc-image").last.evaluate("i=>i.naturalWidth") == 768
    if page.locator("body").get_attribute("data-mio-paged") is not None:
        page.keyboard.press("ArrowLeft")
        assert page.locator("[data-mio-enter]").count() == 0
        assert page.locator("[data-cc-frame]:visible").evaluate_all(
            "frames=>frames.every(e=>getComputedStyle(e).animationName==='none')"
        )
    return {
        "frames": 6,
        "chapters": 2,
        "missing_placeholder": True,
        "long_title_overflow": False,
        "reduced_motion": "passed",
    }


def run(browser_path: str | None, shots: Path | None, widths: list[int] | None = None) -> dict:
    from playwright.sync_api import sync_playwright

    candidates = (
        [browser_path]
        if browser_path
        else [
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
            "/usr/bin/chromium",
            "/usr/bin/google-chrome",
        ]
    )
    executable = next((p for p in candidates if p and Path(p).is_file()), None)
    if not executable:
        raise RuntimeError("No installed Chromium found; pass --browser. Nothing was installed.")
    results = []
    with tempfile.TemporaryDirectory(prefix="mio-album-check-") as temporary:
        files = export_examples(Path(temporary))
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=executable, headless=True)
            try:
                for width in widths or (1440, 390):
                    for theme in ("light", "dark"):
                        context = browser.new_context(
                            viewport={"width": width, "height": 960 if width == 1440 else 844},
                            color_scheme=theme,
                            reduced_motion="reduce",
                        )
                        page = context.new_page()
                        page.set_default_timeout(6000)
                        errors, external = [], []
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        page.on(
                            "console",
                            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
                        )

                        def route(request):
                            if request.request.url.startswith(("file:", "data:", "blob:")):
                                request.continue_()
                            else:
                                external.append(request.request.url)
                                request.abort()

                        page.route("**/*", route)
                        for template in TEMPLATES:
                            name = f"{template}-{width}-{theme}"
                            case = {"template": template, "width": width, "theme": theme}
                            try:
                                page.goto(files[template].as_uri(), wait_until="load")
                                case.update(exercise_reader(page, template, shots, name))
                                case["extreme"] = exercise_extreme(
                                    page,
                                    files[template + "-extreme"],
                                    shots,
                                    name,
                                )
                                exercise_motion(page)
                                case["motion_preference_toggle"] = "passed"
                                assert not errors, errors
                                assert not external, external
                                case["status"] = "passed"
                            except Exception as exc:
                                case.update(status="failed", error=str(exc))
                                screenshot(page, shots, name + "-failure")
                            results.append(case)
                        context.close()
            finally:
                browser.close()
    return {
        "browser": executable,
        "sample": TITLE,
        "cases": results,
        "passed": sum(case["status"] == "passed" for case in results),
        "failed": sum(case["status"] == "failed" for case in results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser")
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    args = parser.parse_args()
    report = run(args.browser, args.screenshots, args.width)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return int(report["failed"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
