"""Exercise roadmap UI in installed Chrome against an isolated synthetic workspace.

Build web/dist first. No packages or browsers are installed and external requests are blocked.
Use --report and --screenshots with temporary paths, inspect images, then delete those images.
Every scenario uses real browser input; API requests only seed/reset or observe fixture state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from pathlib import Path

from creative_browser_common import Evidence, screenshot
from roadmap_browser_fixture import serve

ROOT = Path(__file__).resolve().parents[1]
SUITES = (
    "collections",
    "completion",
    "story-import",
    "candidate-compare",
    "onboarding",
    "template",
)


def dist_fingerprint():
    """Bind evidence to the actual public build, including uncommitted local builds."""
    root = ROOT / "web/dist"
    digest = hashlib.sha256()
    paths = sorted(path for path in root.rglob("*") if path.is_file())
    for path in paths:
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(65536), b""):
                digest.update(chunk)
    return {"sha256": digest.hexdigest(), "file_count": len(paths)}


def exercise_candidate_compare(page, origin, shots, name, evidence):
    from playwright.sync_api import expect

    from creative_browser_common import EPISODE_ID, assert_fit

    page.goto(f"{origin}/workshop/assembly/{EPISODE_ID}/board", wait_until="networkidle")
    trigger = page.locator('.take[data-selection-id="creative-take-0-0"] .take-image')
    trigger.focus()
    trigger.click()
    dialog = page.locator("#board-zoom[open]")
    expect(dialog).to_be_visible()
    page.keyboard.press("c")
    viewport = dialog.locator(".board-split-viewport")
    expect(viewport).to_be_visible()
    candidate = dialog.get_by_role("img", name="浏览候选", exact=True)
    reference = dialog.get_by_role("img", name="固定候选", exact=True)
    candidate_src = candidate.get_attribute("src")
    reference_src = reference.get_attribute("src")
    handle = dialog.locator(".board-split-handle")
    divider = dialog.locator('.board-split-controls input[aria-label="分割位置"]')
    handle.focus()
    handle.press("ArrowRight")
    expect(handle).to_have_attribute("aria-valuenow", "52")
    handle.press("Shift+ArrowRight")
    expect(divider).to_have_value("62")
    handle.press("Home")
    expect(divider).to_have_value("0")
    handle.press("End")
    expect(divider).to_have_value("100")
    divider.press("Home")
    for _ in range(5):
        divider.press("Shift+ArrowRight")
    expect(handle).to_have_attribute("aria-valuenow", "50")
    expect(candidate).to_have_attribute("src", candidate_src)
    handle.scroll_into_view_if_needed()
    bounds = viewport.bounding_box()
    knob = handle.bounding_box()
    assert bounds and knob
    page.mouse.move(knob["x"] + knob["width"] / 2, knob["y"] + knob["height"] / 2)
    page.mouse.down()
    page.mouse.move(bounds["x"] + bounds["width"] * 0.35, knob["y"] + knob["height"] / 2, steps=8)
    page.mouse.up()
    dragged_divider = float(handle.get_attribute("aria-valuenow"))
    assert 30 <= dragged_divider <= 40, dragged_divider

    page.evaluate(
        """() => {
          const probe = {active:false, intervals:[]};
          let previous = performance.now();
          const tick = now => {
            if (probe.active) probe.intervals.push(now - previous);
            previous = now;
            requestAnimationFrame(tick);
          };
          window.__roadmapFrameProbe = probe;
          requestAnimationFrame(tick);
        }"""
    )

    def measure_frames(action):
        start = page.evaluate(
            "() => { const p = window.__roadmapFrameProbe; p.active = true; return p.intervals.length; }"
        )
        action()
        return page.evaluate(
            """async start => {
              const p = window.__roadmapFrameProbe;
              await new Promise(requestAnimationFrame);
              p.active = false;
              await new Promise(requestAnimationFrame);
              return p.intervals.splice(start);
            }""",
            start,
        )

    def frame_summary(samples):
        values = sorted(samples)
        assert values, "The browser did not produce animation-frame samples during input"
        count = len(values)
        median = (
            values[count // 2] if count % 2 else (values[count // 2 - 1] + values[count // 2]) / 2
        )
        p95 = values[(95 * count + 99) // 100 - 1]
        return {
            "cycles": 20,
            "samples": count,
            "median_ms": round(median, 3),
            "p95_ms": round(p95, 3),
            "max_ms": round(values[-1], 3),
            "over_50ms": sum(value > 50 for value in values),
        }

    divider_intervals = []
    for target in [70, 30] * 10:

        def drag_to_target(target=target):
            knob = handle.bounding_box()
            assert knob
            y = knob["y"] + knob["height"] / 2
            start_x = knob["x"] + knob["width"] / 2
            end_x = bounds["x"] + bounds["width"] * target / 100
            page.mouse.move(start_x, y)
            page.mouse.down()
            page.mouse.move(end_x, y, steps=8)
            page.mouse.up()

        divider_intervals.extend(measure_frames(drag_to_target))
    divider_frame_metrics = frame_summary(divider_intervals)

    zoom = dialog.locator('.board-split-controls input[aria-label="同步缩放"]')
    zoom.press("Home")
    for _ in range(10):
        zoom.press("ArrowRight")
    expect(zoom).to_have_value("2")
    frames = dialog.locator(".board-split-frame")
    transforms = frames.evaluate_all("items => items.map(item => item.style.transform)")
    assert transforms == ["translate(0px, 0px) scale(2)"] * 2, transforms
    viewport.scroll_into_view_if_needed()
    bounds = viewport.bounding_box()
    assert bounds
    x, y = bounds["x"] + bounds["width"] * 0.75, bounds["y"] + bounds["height"] * 0.35
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 25, y + 18, steps=6)
    page.mouse.up()
    panned = frames.evaluate_all("items => items.map(item => item.style.transform)")
    assert panned[0] == panned[1] and panned[0] != transforms[0], panned

    pan_intervals = []
    for dx, dy in [(24, 16), (-24, -16)] * 10:

        def pan_by(dx=dx, dy=dy):
            x = bounds["x"] + bounds["width"] * 0.75
            y = bounds["y"] + bounds["height"] * 0.35
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + dx, y + dy, steps=6)
            page.mouse.up()

        pan_intervals.extend(measure_frames(pan_by))
    pan_frame_metrics = frame_summary(pan_intervals)
    screenshot(page, shots, name + "-split")
    zoom.press("Home")
    expect(frames.nth(0)).to_have_attribute("style", "transform: translate(0px, 0px) scale(1);")
    # Sliders own arrow keys, while the choice restores board navigation shortcuts.
    dialog.locator(".board-compare-choice").nth(1).click()
    page.keyboard.press("ArrowRight")
    expect(reference).to_have_attribute("src", reference_src)
    expect(candidate).not_to_have_attribute("src", candidate_src)
    writes = [item for item in evidence.requests if item["method"] == "POST"]
    assert not writes, "Comparing, sliding, zooming and panning must not adopt or reject"
    adopt = dialog.get_by_role("button", name="采用 · 浏览候选", exact=True)
    adopt.click()
    expect(adopt).to_be_disabled()
    writes = [item for item in evidence.requests if item["method"] == "POST"]
    assert len(writes) == 1 and writes[0]["path"].endswith("/adopt"), writes
    bounds = assert_fit(page, "#board-zoom")
    page.keyboard.press("Escape")
    expect(dialog).to_have_count(0)
    expect(trigger).to_be_focused()
    return {
        "divider_keyboard": [52, 62, 0, 100, 50],
        "divider_mouse": dragged_divider,
        "divider_rAF_intervals": divider_frame_metrics,
        "sync_pan": panned,
        "sync_pan_rAF_intervals": pan_frame_metrics,
        "adopt_writes": 1,
        "escape_focus_restored": True,
        "dialog_bounds": bounds,
    }


def open_quick_start(page):
    from playwright.sync_api import expect

    for _ in range(3):
        if not page.locator("dialog[open], [role=dialog]").count():
            break
        page.keyboard.press("Escape")
    page.locator('#topbar button[aria-haspopup="dialog"]').click()
    page.locator("#help-drawer").get_by_role("button", name="快速开始教程", exact=True).click()
    guide = page.locator("#guide-dialog[open]")
    expect(guide).to_be_visible()
    expect(guide.locator(".quickstart-steps > li")).to_have_count(4)
    assert guide.locator(".quickstart-steps > li").evaluate_all(
        "items => items.map(item => item.dataset.check)"
    ) == ["service", "workflow", "reader", "create"]
    return guide


def exercise_onboarding(page, origin, shots, name, evidence):
    from playwright.sync_api import expect

    page.goto(origin + "/", wait_until="networkidle")
    actions = []
    for step in ("service", "workflow", "reader", "create"):
        guide = open_quick_start(page)
        if step == "reader":
            screenshot(page, shots, name + "-four-steps")
        guide.locator(f'[data-check="{step}"] button').click()
        if step == "service":
            expect(page).to_have_url(re.compile(r"/engine\?tab=(instances|profiles|channels)"))
        elif step == "workflow":
            expect(page).to_have_url(re.compile(r"/workshop/assembly\?new=1"))
        elif step == "reader":
            expect(page).to_have_url(re.compile(r"/gallery/[^/?]+$"))
        else:
            expect(page).to_have_url(origin + "/workshop/story")
        actions.append({"step": step, "path": page.url.removeprefix(origin)})
    guide = open_quick_start(page)
    expect(guide.locator('[data-check="reader"]')).to_have_class(re.compile("is-done"))
    expect(guide.locator('[data-check="reader"]')).to_contain_text("已打开这本示例画册")
    assert not [
        item for item in evidence.requests if item["method"] == "POST" and "/render" in item["path"]
    ], "Entry checks must not submit generation"
    return {"steps": actions, "reader_completion_visible": True, "generation_submitted": False}


def exercise_template(page, origin, shots, name, evidence):
    from playwright.sync_api import expect

    page.goto(origin + "/gallery/roadmap-shelf-0/export", wait_until="networkidle")
    page.locator(".export-template-card").filter(has_text="典藏画集").click()
    page.get_by_text("自定义与导入版式", exact=True).click()
    page.locator(".presentation-tools").get_by_role("button", name="自定义", exact=True).click()
    studio = page.locator("dialog.template-dialog[open]")
    expect(studio).to_be_visible()
    subtitle = "Neutral roadmap live preview"
    studio.locator("#et-subtitle").fill(subtitle)
    frame = page.frame_locator("#template-preview")
    expect(frame.locator(".edition-heading .synopsis")).to_have_text(subtitle)
    expect(frame.locator(".edition-heading .synopsis")).to_be_visible()
    studio.locator("#et-cover-crop").check()
    expect(frame.locator(".edition-cover")).to_be_visible()
    x = studio.locator("#et-cover-focus-x")
    y = studio.locator("#et-cover-focus-y")
    x.press("Home")
    for _ in range(24):
        x.press("ArrowRight")
    y.press("End")
    for _ in range(24):
        y.press("ArrowLeft")
    expect(frame.locator(".edition-cover")).to_have_css("object-position", "24% 76%")
    expect(frame.locator(".chapter-header")).to_be_visible()
    studio.locator("#et-chapter-header").uncheck()
    expect(frame.locator(".chapter-header")).to_be_hidden()
    studio.locator("#template-preview").scroll_into_view_if_needed()
    frame.locator(".edition-heading .synopsis").scroll_into_view_if_needed()
    screenshot(page, shots, name + "-live-preview")
    studio.get_by_role("button", name="全屏试读", exact=True).click()
    full = page.locator("dialog.album-preview-dialog[open]")
    expect(full).to_be_visible()
    full_subtitle = page.frame_locator("dialog.album-preview-dialog[open] iframe").locator(
        ".edition-heading .synopsis"
    )
    expect(full_subtitle).to_have_text(subtitle)
    full_subtitle.scroll_into_view_if_needed()
    screenshot(page, shots, name + "-fullscreen")
    page.keyboard.press("Escape")
    expect(full).to_have_count(0)
    expect(studio).to_be_visible()
    studio.get_by_role("button", name="手机预览", exact=True).click()
    expect(studio.locator(".preview-viewport")).to_have_class(re.compile("mobile"))
    previews = [
        item
        for item in evidence.matching("POST", "/api/export/album")
        if item["body"].get("template", {}).get("options", {}).get("subtitle") == subtitle
    ]
    assert previews, "Live preview must use the edited template in a real preview request"
    return {
        "subtitle": subtitle,
        "focal_position": "24% 76%",
        "chapter_header_hidden": True,
        "fullscreen_synced": True,
        "mobile_preview": True,
        "preview_requests": len(previews),
    }


def run(browser_path=None, shots=None, widths=None, themes=None, suites=None):
    from playwright.sync_api import sync_playwright

    from roadmap_browser_steps import (
        exercise_collections,
        exercise_completion,
        exercise_story_import,
    )

    if not (ROOT / "web/dist/index.html").is_file():
        raise RuntimeError(
            "Build web/dist first; this tool never builds or changes application code"
        )
    dist = dist_fingerprint()
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
    executable = next((str(path) for path in candidates if path and Path(path).is_file()), None)
    if not executable:
        raise RuntimeError("Pass an already installed Chrome/Edge using --browser")
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    cases = []
    with (
        tempfile.TemporaryDirectory(prefix="mio-roadmap-") as temporary,
        tempfile.TemporaryFile() as log,
    ):
        process = subprocess.Popen(
            [
                sys.executable,
                str(Path(__file__).resolve()),
                "--serve",
                str(port),
                "--data",
                str(Path(temporary) / "workspace"),
            ],
            cwd=ROOT,
            stdout=log,
            stderr=log,
        )
        try:
            for _ in range(100):
                if process.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(
                        "Fixture startup failed: " + log.read().decode("utf-8", "replace")[-2500:]
                    )
                try:
                    with urllib.request.urlopen(origin + "/healthz", timeout=1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Fixture did not become ready")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=executable, headless=True)
                browser_version = browser.version
                try:
                    for width in widths or (1440, 390):
                        for theme in themes or ("light", "dark"):
                            for suite in suites or SUITES:
                                context = browser.new_context(
                                    viewport={
                                        "width": width,
                                        "height": 900 if width == 1440 else 844,
                                    },
                                    color_scheme=theme,
                                    locale="zh-CN",
                                    reduced_motion="reduce",
                                    has_touch=width == 390,
                                    is_mobile=width == 390,
                                )
                                context.add_init_script(
                                    "if (window === window.top) {"
                                    "localStorage.setItem('i18nextLng','zh-CN');"
                                    "localStorage.setItem('mio.ui',JSON.stringify({version:2,"
                                    "state:{theme:'system',reduceMotion:true,worksView:'grid',shelfSort:'createdAt'}}));"
                                    "}"
                                )
                                page = context.new_page()
                                page.set_default_timeout(8000)
                                evidence = Evidence(page, origin)
                                case = {
                                    "width": width,
                                    "height": 900 if width == 1440 else 844,
                                    "theme": theme,
                                    "suite": suite,
                                }
                                name = f"roadmap-{suite}-{width}-{theme}"
                                print(f"Running {name}", file=sys.stderr, flush=True)
                                started = time.monotonic()
                                try:
                                    response = page.request.post(
                                        origin + "/__roadmap_fixture/reset"
                                    )
                                    assert response.ok, response.status
                                    if suite == "collections":
                                        value = exercise_collections(
                                            page, origin, shots, name, evidence
                                        )
                                    elif suite == "completion":
                                        value = exercise_completion(
                                            page, origin, shots, name, evidence
                                        )
                                    elif suite == "story-import":
                                        value = exercise_story_import(
                                            page, origin, shots, name, evidence
                                        )
                                    else:
                                        value = (
                                            exercise_candidate_compare(
                                                page, origin, shots, name, evidence
                                            )
                                            if suite == "candidate-compare"
                                            else exercise_onboarding(
                                                page, origin, shots, name, evidence
                                            )
                                            if suite == "onboarding"
                                            else exercise_template(
                                                page, origin, shots, name, evidence
                                            )
                                        )
                                    case.update(status="passed", facts=value)
                                except Exception as error:
                                    case.update(
                                        status="failed",
                                        error=str(error),
                                        trace=traceback.format_exc(limit=4),
                                    )
                                    screenshot(page, shots, name + "-failure")
                                case["seconds"] = round(time.monotonic() - started, 2)
                                case["unexpected_errors"] = evidence.errors
                                case["external_requests"] = evidence.external
                                case["api_writes"] = [
                                    {"method": item["method"], "path": item["path"]}
                                    for item in evidence.requests
                                    if item["method"] not in {"GET", "HEAD"}
                                ]
                                if evidence.errors or evidence.external:
                                    case["status"] = "failed"
                                cases.append(case)
                                context.close()
                finally:
                    browser.close()
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    return {
        "browser": executable,
        "browser_version": browser_version,
        "dist": dist,
        "dist_unchanged": dist == dist_fingerprint(),
        "real_browser": True,
        "isolated_fixture": True,
        "private_data": False,
        "paid_services": False,
        "cases": cases,
        "passed": sum(case["status"] == "passed" for case in cases),
        "failed": sum(case["status"] != "passed" for case in cases),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser")
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    parser.add_argument("--theme", choices=("light", "dark"), action="append")
    parser.add_argument("--suite", choices=SUITES, action="append")
    parser.add_argument("--serve", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--data", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        if args.data is None:
            parser.error("Fixture server requires a parent-owned --data directory")
        serve(args.serve, args.data)
        return 0
    report = run(args.browser, args.screenshots, args.width, args.theme, args.suite)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + "\n", encoding="utf-8")
    print(output)
    return int(report["failed"] > 0 or not report["dist_unchanged"])


if __name__ == "__main__":
    raise SystemExit(main())
