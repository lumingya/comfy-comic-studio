"""Check real creative UI interactions in installed Chromium and a disposable workspace.

Build web/dist first, then: python tools/check_creative_browser.py --screenshots TEMP_DIRECTORY
No packages/browsers are installed and every image request uses an in-process neutral fake.
Never point this check at a personal workspace. Inspect and delete temporary screenshots.
"""

from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from pathlib import Path

from creative_browser_board import exercise_board
from creative_browser_canvas import exercise_canvas
from creative_browser_common import Evidence, fixture, screenshot
from creative_browser_editor import exercise_editor
from creative_browser_fixture import serve

ROOT = Path(__file__).resolve().parents[1]


def run(browser_path, shots, widths=None, themes=None, suites=None) -> dict:
    from playwright.sync_api import sync_playwright

    if not (ROOT / "web/dist/index.html").is_file():
        raise RuntimeError("Build web/dist first: npm --prefix web run build")
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
    executable = next((path for path in candidates if path and Path(path).is_file()), None)
    if not executable:
        raise RuntimeError("Pass an existing Chromium with --browser. Nothing was installed.")
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    results = []
    with (
        tempfile.TemporaryDirectory(prefix="mio-creative-check-") as temporary,
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
                        "Disposable creative fixture failed: "
                        + log.read().decode("utf-8", "replace")[-2000:]
                    )
                try:
                    with urllib.request.urlopen(origin + "/healthz", timeout=1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("The disposable creative fixture did not become ready")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=executable, headless=True)
                try:
                    for width in widths or (1440, 390):
                        for theme in themes or ("light", "dark"):
                            context = browser.new_context(
                                viewport={"width": width, "height": 960 if width == 1440 else 844},
                                color_scheme=theme,
                                locale="zh-CN",
                                reduced_motion="reduce",
                            )
                            context.add_init_script(
                                "localStorage.setItem('i18nextLng','zh-CN');"
                                "localStorage.setItem('mio.ui',JSON.stringify({version:2,"
                                "state:{theme:'system',reduceMotion:true}}));"
                            )
                            page = context.new_page()
                            page.set_default_timeout(8000)
                            evidence = Evidence(page, origin)
                            fixture(page, origin, "reset")
                            case = {"width": width, "theme": theme, "suites": {}}
                            for suite in suites or ("board", "editor", "canvas"):
                                name = f"{suite}-{width}-{theme}"
                                try:
                                    if suite == "board":
                                        value = exercise_board(page, origin, shots, name)
                                    elif suite == "editor":
                                        value = exercise_editor(page, origin, shots, name, evidence)
                                    else:
                                        value = exercise_canvas(page, origin, shots, name, evidence)
                                    case["suites"][suite] = {"status": "passed", **value}
                                except Exception as error:
                                    case["suites"][suite] = {
                                        "status": "failed",
                                        "error": str(error),
                                        "trace": traceback.format_exc(limit=3),
                                    }
                                    screenshot(page, shots, name + "-failure")
                                    break
                            case["expected_conflicts"] = len(evidence.conflicts)
                            case["unexpected_errors"] = evidence.errors
                            case["external_requests"] = evidence.external
                            case["status"] = (
                                "passed"
                                if (
                                    all(
                                        value["status"] == "passed"
                                        for value in case["suites"].values()
                                    )
                                    and not evidence.errors
                                    and not evidence.external
                                )
                                else "failed"
                            )
                            results.append(case)
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
        "real_browser": True,
        "cases": results,
        "passed": sum(case["status"] == "passed" for case in results),
        "failed": sum(case["status"] == "failed" for case in results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", help="Existing Chrome/Edge/Chromium executable")
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    parser.add_argument("--theme", choices=("light", "dark"), action="append")
    parser.add_argument("--suite", choices=("board", "editor", "canvas"), action="append")
    parser.add_argument("--serve", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--data", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        if args.data is None:
            parser.error("the fixture server requires a parent-owned --data directory")
        serve(args.serve, args.data)
        return 0
    report = run(args.browser, args.screenshots, args.width, args.theme, args.suite)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return int(report["failed"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
