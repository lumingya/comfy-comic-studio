"""Real-browser acceptance for the narrow creation slots; uses only disposable offline fixtures.

Run after the coordinated web build. No package or browser is installed. Screenshots are
temporary evidence: inspect them, then delete the requested screenshot directory.
"""

from __future__ import annotations

import argparse
import json
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

from check_professional_browser import browser_executable
from professional_browser_fixture import EPISODE, ROOT, SERIES, serve
from professional_browser_steps import fit, install

IDENTIFIER = "creation-inspector"
TITLE = "创作上下文"


def open_frame(page):
    from playwright.sync_api import expect

    dialog = page.get_by_role("dialog", name=TITLE, exact=True)
    expect(dialog).to_be_visible()
    iframe = dialog.locator("iframe.ext-frame")
    expect(iframe).to_have_attribute("sandbox", "allow-scripts")
    frame = dialog.frame_locator("iframe.ext-frame")
    expect(frame.locator("#status")).to_have_text("已接收宿主只读上下文。")
    expect(frame.locator("#episode")).to_have_text(EPISODE)
    assert int(frame.locator("#seq").inner_text()) > 0
    return dialog, frame


def capture(page, frame, folder, name):
    if folder:
        folder.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(folder / f"{name}.png"), animations="disabled")
    return fit(page, frame)


def scenario(browser, origin, archive, width, theme, screenshots):
    from playwright.sync_api import expect

    context = browser.new_context(
        viewport={"width": width, "height": 960 if width == 1440 else 844},
        color_scheme=theme,
        locale="zh-CN",
        reduced_motion="reduce",
    )
    context.add_init_script(
        "if(window===top){"
        "localStorage.setItem('mio.locale','zh-CN');"
        "localStorage.setItem('mio.ui',JSON.stringify({version:2,state:{theme:'system',reduceMotion:true}}));"
        "}"
    )
    page = context.new_page()
    page.set_default_timeout(12000)
    errors, external = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on(
        "response",
        lambda response: (
            errors.append(f"HTTP {response.status}: {response.url}")
            if response.status >= 400
            else None
        ),
    )
    page.on("console", lambda event: errors.append(event.text) if event.type == "error" else None)

    def guard(route):
        if route.request.url.startswith((origin + "/", "data:", "blob:")):
            route.continue_()
        else:
            external.append(route.request.resource_type)
            route.abort()

    page.route("**/*", guard)
    result = {"width": width, "theme": theme}
    name = f"creation-{width}-{theme}"
    try:
        reset = page.request.post(origin + "/__professional_fixture/reset")
        assert reset.ok, (reset.status, reset.text())
        install(page, origin, {IDENTIFIER: archive})
        page.goto(f"{origin}/workshop/assembly/{EPISODE}/script", wait_until="networkidle")
        expect(page.locator("html")).to_have_attribute("data-theme", theme)
        document = page.request.get(f"{origin}/api/episodes/{EPISODE}").json()
        first, second = [panel["id"] for panel in document["panels"][:2]]
        first_row = page.locator(f'.panel-row[data-selection-id="{first}"]')
        expect(first_row).to_have_class(re.compile(r"\bactive\b"))
        before = page.request.get(origin + "/__professional_fixture/stats").json()

        # Open the real global palette and choose the declared command, not a hidden route.
        page.keyboard.press("Control+k")
        command = page.locator("#command-dialog")
        expect(command).to_be_visible()
        command.locator("#command-input").fill(TITLE)
        command.get_by_role("option", name=re.compile(TITLE)).click()
        dialog, frame = open_frame(page)
        expect(frame.locator("#route")).to_have_text("script")
        expect(frame.locator("#selection li")).to_have_text([first])
        command_context = frame.locator("#context").inner_text()
        result["command_palette"] = capture(page, frame, screenshots, name + "-palette")
        dialog.get_by_role("button", name="关闭", exact=True).click()

        # Right-click B while editor A remains current. The invocation must capture B.
        second_row = page.locator(f'.panel-row[data-selection-id="{second}"]')
        second_row.click(button="right")
        page.get_by_role("menuitem", name=TITLE, exact=True).click()
        dialog, frame = open_frame(page)
        expect(frame.locator("#selection li")).to_have_text([second])
        expect(first_row).to_have_class(re.compile(r"\bactive\b"))
        assert frame.locator("#context").inner_text() != command_context
        frame.locator("#read").click()
        expect(frame.locator("#status")).to_have_text("只读核对完成，未修改作品。")
        expect(frame.locator("#read-result")).to_contain_text(EPISODE)
        result["right_click_target"] = capture(page, frame, screenshots, name + "-right-click")
        dialog.get_by_role("button", name="关闭", exact=True).click()

        # Fixture setup only: create saved layout locally, then use a real Konva pointer hit.
        layout = page.request.post(
            f"{origin}/api/episodes/{EPISODE}/strip/layout", data={"relayout_lettering": False}
        )
        assert layout.ok, layout.text()
        box = layout.json()["panel_boxes"][first]
        page.goto(f"{origin}/gallery/{SERIES}/layout", wait_until="networkidle")
        canvas = page.locator(".konvajs-content")
        expect(canvas).to_be_visible()
        scroll = page.locator(".canvas-scroll")
        point = {"x": (box[0] + box[2]) * 0.3, "y": (box[1] + box[3]) * 0.3}
        scroll.evaluate(
            """(element, point) => {
          element.scrollLeft=Math.max(0,point.x-element.clientWidth/2);
          element.scrollTop=Math.max(0,point.y-element.clientHeight/2);
        }""",
            point,
        )
        bounds = canvas.bounding_box()
        assert bounds
        page.mouse.click(bounds["x"] + point["x"], bounds["y"] + point["y"])
        inspector = page.locator(".canvas-inspector")
        inspector.get_by_role("button", name=TITLE, exact=True).click()
        dialog, frame = open_frame(page)
        expect(frame.locator("#route")).to_have_text("canvas")
        expect(frame.locator("#selection li")).to_have_text([first])
        assert frame.locator("#event").inner_text() in {
            "creation.context.changed",
            "selection.changed",
        }
        result["inspector"] = capture(page, frame, screenshots, name + "-inspector")
        dialog.get_by_role("button", name="关闭", exact=True).click()
        after = page.request.get(origin + "/__professional_fixture/stats").json()
        assert after["calls"] == before["calls"] and after["jobs"] == before["jobs"]

        # Disabling removes the opt-in controls and the old frame; no core tool is hardwired.
        page.goto(origin + "/extensions?tab=installed", wait_until="networkidle")
        card = page.locator(".ext-card").filter(has=page.locator(".mono", has_text=IDENTIFIER))
        card.get_by_role("button", name="停用", exact=True).click()
        expect(card.get_by_role("button", name="启用", exact=True)).to_be_visible()
        page.goto(f"{origin}/workshop/assembly/{EPISODE}/script", wait_until="networkidle")
        page.keyboard.press("Control+k")
        page.locator("#command-input").fill(TITLE)
        expect(page.locator("#command-results").get_by_role("option")).to_have_count(0)
        page.keyboard.press("Escape")
        assert not page.locator("iframe.ext-frame").count()
        assert not errors, errors
        assert not external, external
        result.update(status="passed", no_model_calls=True, console_errors=0, external_requests=0)
    except Exception as error:
        result.update(status="failed", error=str(error), console_errors=errors, external=external)
        if screenshots:
            screenshots.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(screenshots / f"{name}-failure.png"), animations="disabled")
    finally:
        page.request.post(f"{origin}/api/extensions/{IDENTIFIER}/disable")
        page.request.delete(f"{origin}/api/extensions/{IDENTIFIER}")
        context.close()
    return result


def run(args):
    from playwright.sync_api import sync_playwright

    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    with (
        tempfile.TemporaryDirectory(prefix="mio-creation-browser-") as temporary,
        tempfile.TemporaryFile() as log,
    ):
        root = Path(temporary)
        archive = root / "creation-inspector.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            for path in sorted((ROOT / "examples/extensions/creation-inspector").iterdir()):
                if path.is_file():
                    output.write(path, f"creation-inspector/{path.name}")
        process = subprocess.Popen(
            [
                sys.executable,
                "-X",
                "utf8",
                str(Path(__file__).resolve()),
                "--serve",
                str(port),
                "--data",
                str(root / "workspace"),
            ],
            cwd=ROOT,
            stdout=log,
            stderr=log,
        )
        try:
            for _ in range(100):
                if process.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read().decode("utf-8", errors="replace")[-3000:])
                try:
                    with urllib.request.urlopen(origin + "/healthz", timeout=1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Disposable fixture startup timed out")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    executable_path=browser_executable(args.browser), headless=True
                )
                try:
                    cases = []
                    for width in args.width or (1440, 390):
                        for theme in args.theme or ("light", "dark"):
                            result = scenario(
                                browser, origin, archive, width, theme, args.screenshots
                            )
                            cases.append(result)
                            print(json.dumps(result, ensure_ascii=True), flush=True)
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
        "real_browser": True,
        "real_paid_models": False,
        "cases": cases,
        "passed": sum(case["status"] == "passed" for case in cases),
        "failed": sum(case["status"] == "failed" for case in cases),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser")
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    parser.add_argument("--theme", choices=("light", "dark"), action="append")
    parser.add_argument("--serve", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--data", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        if args.data is None:
            parser.error("Fixture service requires parent-owned data")
        serve(args.serve, args.data)
        return 0
    report = run(args)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(text + "\n", encoding="utf-8")
    print(text)
    return int(report["failed"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
