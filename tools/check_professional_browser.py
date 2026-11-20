"""Exercise six installable professional panels in installed Chrome with offline model fixtures.

Run after the coordinated web build:
    python tools/check_professional_browser.py --screenshots TEMP_DIRECTORY
This tool never installs browsers/packages, uses personal data, or calls a real model.
Screenshots are optional and must be visually inspected and deleted after review.
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

from professional_browser_fixture import PACKAGES, ROOT, packages, serve


def browser_executable(value: str | None) -> str:
    candidates = (
        [value]
        if value
        else [
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
            "/usr/bin/chromium",
            "/usr/bin/google-chrome",
        ]
    )
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError("Supply an existing Chrome/Edge with --browser. Nothing was installed.")


def capture(page, frame, folder: Path | None, name: str):
    if not folder:
        return None
    folder.mkdir(parents=True, exist_ok=True)
    if frame:
        frame.locator("img").evaluate_all(
            "images=>Promise.all(images.filter(i=>i.currentSrc).map(i=>i.decode()))"
        )
        frame.locator("body").evaluate(
            "() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"
        )
    target = folder / f"{name}.png"
    page.screenshot(path=str(target), full_page=True, animations="disabled")
    return str(target.resolve())


def matrix(browser, origin, archives, shots, widths, themes, only):
    from playwright.sync_api import expect

    from professional_browser_steps import EXERCISES, fit, install, open_panel, uninstall

    cases = []
    for width in widths:
        for theme in themes:
            context = browser.new_context(
                viewport={"width": width, "height": 960 if width == 1440 else 844},
                color_scheme=theme,
                locale="zh-CN",
                reduced_motion="reduce",
                accept_downloads=True,
            )
            context.add_init_script(
                "if(window===top){localStorage.setItem('i18nextLng','zh-CN');"
                "localStorage.setItem('mio.ui',JSON.stringify({version:2,state:{theme:'system',reduceMotion:true}}));}"
            )
            page = context.new_page()
            page.set_default_timeout(12000)
            errors, external, downloads = [], [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on(
                "console",
                lambda event: errors.append(event.text) if event.type == "error" else None,
            )
            page.on("download", lambda download: downloads.append(download))

            def guard(route):
                if route.request.url.startswith((origin + "/", "data:", "blob:")):
                    route.continue_()
                else:
                    external.append(route.request.resource_type)
                    route.abort()

            page.route("**/*", guard)
            panels = {}
            try:
                reset = page.request.post(origin + "/__professional_fixture/reset")
                assert reset.ok, reset.text()
                panels = install(page, origin, archives)
                expect(page.locator("html")).to_have_attribute("data-theme", theme)
                for identifier in only or PACKAGES:
                    frame = None
                    name = f"professional-{width}-{theme}-{identifier}"
                    result = {"width": width, "theme": theme, "package": identifier}
                    start_errors, start_external = len(errors), len(external)
                    try:
                        before = page.request.get(origin + "/__professional_fixture/stats").json()
                        frame = open_panel(page, origin, identifier)
                        inert = page.request.get(origin + "/__professional_fixture/stats").json()
                        assert inert["calls"] == before["calls"], "Opening a panel invoked a model"
                        assert inert["jobs"] == before["jobs"], "Opening a panel submitted work"
                        result["entry_fit"] = fit(page, frame)
                        with tempfile.TemporaryDirectory(prefix="mio-panel-download-") as temporary:
                            result["interaction"] = EXERCISES[identifier](
                                page, frame, origin, downloads, Path(temporary)
                            )
                        result["result_fit"] = fit(page, frame)
                        target = {
                            "panel-retouch": "#before-image",
                            "finalize-studio": "#before-image",
                            "qa-review": "#panel-p02",
                            "script-review": "#status",
                            "variant-workshop": "#comparison",
                            "motion-studio": "#stage",
                        }[identifier]
                        frame.locator(target).scroll_into_view_if_needed()
                        assert len(errors) == start_errors, errors[start_errors:]
                        assert len(external) == start_external, external[start_external:]
                        result["screenshot"] = capture(page, frame, shots, name)
                        result["status"] = "passed"
                    except Exception as exc:
                        result.update(
                            status="failed",
                            error=str(exc),
                            error_type=type(exc).__name__,
                            traceback=traceback.format_exc(),
                            console_errors=errors[start_errors:],
                        )
                        result["screenshot"] = capture(page, frame, shots, name + "-failure")
                    cases.append(result)
                    print(
                        json.dumps(
                            {
                                "case": name,
                                "status": result["status"],
                                "error": result.get("error"),
                            },
                            ensure_ascii=True,
                        ),
                        flush=True,
                    )
                assert not external, external
                uninstall(page, origin, panels)
                assert not page.request.get(origin + "/api/extension-panels").json()
                assert not page.locator("iframe.ext-frame").count()
                assert not errors, errors
            except Exception as exc:
                cases.append(
                    {
                        "width": width,
                        "theme": theme,
                        "package": "lifecycle",
                        "status": "failed",
                        "error": str(exc),
                    }
                )
                capture(page, None, shots, f"professional-{width}-{theme}-lifecycle-failure")
                # Remove only these disposable fixture packages before another matrix cell.
                for identifier in panels:
                    if identifier in PACKAGES:
                        page.request.post(f"{origin}/api/extensions/{identifier}/disable")
                        page.request.delete(f"{origin}/api/extensions/{identifier}")
            finally:
                context.close()
    return cases


def run(args):
    from playwright.sync_api import sync_playwright

    if not (ROOT / "web/dist/index.html").is_file():
        raise RuntimeError("Run the coordinated web build before browser acceptance.")
    executable = browser_executable(args.browser)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    with (
        tempfile.TemporaryDirectory(prefix="mio-professional-browser-") as temporary,
        tempfile.TemporaryFile() as log,
    ):
        folder = Path(temporary)
        archives = packages(folder)
        if args.only:
            archives = {identifier: archives[identifier] for identifier in args.only}
        process = subprocess.Popen(
            [
                sys.executable,
                "-X",
                "utf8",
                str(Path(__file__).resolve()),
                "--serve",
                str(port),
                "--data",
                str(folder / "workspace"),
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
                        "Fixture startup failed: "
                        + log.read().decode("utf-8", errors="replace")[-5000:]
                    )
                try:
                    with urllib.request.urlopen(origin + "/healthz", timeout=1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Disposable professional fixture did not become ready")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=executable, headless=True)
                try:
                    cases = matrix(
                        browser,
                        origin,
                        archives,
                        args.screenshots,
                        args.width or (1440, 390),
                        args.theme or ("light", "dark"),
                        args.only,
                    )
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
        "real_paid_models": False,
        "cases": cases,
        "passed": sum(case["status"] == "passed" for case in cases),
        "failed": sum(case["status"] == "failed" for case in cases),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser")
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    parser.add_argument("--theme", choices=("light", "dark"), action="append")
    parser.add_argument("--only", choices=tuple(PACKAGES), action="append")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--serve", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--data", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        if args.data is None:
            parser.error("Fixture service requires a parent-owned --data directory")
        serve(args.serve, args.data)
        return 0
    report = run(args)
    content = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(content + "\n", encoding="utf-8")
    print(content)
    return int(report["failed"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
