"""Exercise six installable professional panels in installed Chrome with offline model fixtures.

Run after the coordinated web build:
    python tools/check_professional_browser.py --screenshots TEMP_DIRECTORY
This tool never installs browsers/packages, uses personal data, or calls a real model.
Screenshots are optional and must be visually inspected and deleted after review.
"""

from __future__ import annotations

import argparse
import hashlib
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
        try:
            frame.locator("img").evaluate_all(
                "images=>Promise.allSettled(images.filter(i=>i.currentSrc).map(i=>i.decode()))"
            )
            frame.locator("body").evaluate(
                "() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"
            )
        except Exception:
            # A detached/failed frame must not discard the original acceptance failure.
            pass
    target = folder / f"{name}.png"
    page.screenshot(path=str(target), animations="disabled")
    return str(target.resolve())


def matrix(browser, origin, archives, shots, widths, themes, only, locales):
    from playwright.sync_api import expect

    from professional_browser_steps import (
        EXERCISES,
        empty_and_error,
        fit,
        install,
        open_panel,
        uninstall,
    )

    cases = []
    for width in widths:
        for theme, locale in ((theme, locale) for theme in themes for locale in locales):
            mode = "dark" if theme == "dynamic" else theme
            context = browser.new_context(
                viewport={"width": width, "height": 900 if width == 1440 else 844},
                color_scheme=mode,
                locale=locale,
                reduced_motion="no-preference" if theme == "dynamic" else "reduce",
                accept_downloads=True,
            )
            context.add_init_script(
                "if(window===top){localStorage.setItem('mio.locale'," + json.dumps(locale) + ");"
                "localStorage.setItem('mio.ui',JSON.stringify({version:3,state:"
                + json.dumps(
                    {
                        "theme": "fixture-dynamic" if theme == "dynamic" else "system",
                        "reduceMotion": theme != "dynamic",
                        "wallpaperIdleTimeout": 0,
                        "pauseWallpaperWhenUnfocused": False,
                    }
                )
                + "}));}"
            )
            page = context.new_page()
            page.set_default_timeout(12000)
            errors, external, downloads = [], [], []
            pending_requests = set()
            responses = []

            def record_response(response):
                url = response.url.removeprefix(origin)
                if "/api/extension-panels/" not in url and response.status < 400:
                    return
                item = {
                    "status": response.status,
                    "method": response.request.method,
                    "url": url,
                    "type": response.headers.get("content-type"),
                    "panel_response": response.headers.get("x-mio-panel-response"),
                }
                if response.request.method == "POST" and url.endswith("/requests"):
                    item["request_id"] = response.request.post_data_json.get("request_id")
                responses.append(item)

            page.on("response", record_response)
            page.on("request", lambda request: pending_requests.add(request.url))
            page.on("requestfinished", lambda request: pending_requests.discard(request.url))
            page.on("requestfailed", lambda request: pending_requests.discard(request.url))
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
                expect(page.locator("html")).to_have_attribute("data-theme", mode)
                if theme == "dynamic":
                    expect(page.locator("html")).to_have_attribute(
                        "data-theme-dynamic-background", "true"
                    )
                    expect(page.locator(".theme-backdrop img")).to_have_js_property(
                        "naturalWidth", 48
                    )
                for identifier in only or PACKAGES:
                    frame = None
                    name = f"professional-{width}-{theme}-{locale}-{identifier}"
                    result = {
                        "width": width,
                        "height": 900 if width == 1440 else 844,
                        "theme": theme,
                        "locale": locale,
                        "package": identifier,
                    }
                    start_errors, start_external = len(errors), len(external)
                    start_responses = len(responses)
                    try:
                        reset = page.request.post(origin + "/__professional_fixture/reset")
                        assert reset.ok, reset.text()
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
                        after = page.request.get(origin + "/__professional_fixture/stats").json()
                        result["explicit_model_calls"] = {
                            kind: after["calls"][kind] - before["calls"][kind]
                            for kind in before["calls"]
                        }
                        result["result_fit"] = fit(page, frame)
                        target = {
                            "panel-retouch": "#before-image",
                            "finalize-studio": "#before-image",
                            "qa-review": "#panel-p02",
                            "script-assistant": "#status",
                            "variant-workshop": "#job",
                            "motion-studio": "#stage",
                        }[identifier]
                        frame.locator(target).scroll_into_view_if_needed()
                        assert len(errors) == start_errors, errors[start_errors:]
                        assert len(external) == start_external, external[start_external:]
                        result["screenshot"] = capture(page, frame, shots, name)
                        result["states"] = empty_and_error(page, origin, identifier)
                        result["expected_console_errors"] = [
                            error for error in errors[start_errors:] if "503" in error
                        ]
                        unexpected = [
                            error for error in errors[start_errors:] if "503" not in error
                        ]
                        assert not unexpected, unexpected
                        result["status"] = "passed"
                    except Exception as exc:
                        result.update(
                            status="failed",
                            error=str(exc),
                            error_type=type(exc).__name__,
                            traceback=traceback.format_exc(),
                            url=page.url.removeprefix(origin),
                            console_errors=errors[start_errors:],
                            host_text=page.locator("body").inner_text()[:3000],
                            responses=responses[start_responses:],
                        )
                        if frame:
                            try:
                                result["panel_text"] = frame.locator("body").inner_text(
                                    timeout=1000
                                )[:4000]
                            except Exception:
                                pass
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
                assert not [error for error in errors if "503" not in error], errors
                cases.append(
                    {
                        "width": width,
                        "theme": theme,
                        "locale": locale,
                        "package": "lifecycle",
                        "status": "passed",
                        "default_disabled_before_trust": True,
                        "digest_reviewed_before_activation": True,
                        "disabled_access_revoked": True,
                        "uninstalled": list(archives),
                    }
                )
            except Exception as exc:
                cases.append(
                    {
                        "width": width,
                        "theme": theme,
                        "locale": locale,
                        "package": "lifecycle",
                        "status": "failed",
                        "error": str(exc),
                        "console_errors": errors,
                        "traceback": traceback.format_exc(),
                        "pending_requests": sorted(pending_requests),
                        "host_text": page.locator("body").inner_text()[:3000],
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
                browser = playwright.chromium.launch(
                    executable_path=executable,
                    headless=True,
                    args=["--no-proxy-server"],
                )
                browser_version = browser.version
                try:
                    cases = matrix(
                        browser,
                        origin,
                        archives,
                        args.screenshots,
                        args.width or (1440, 390),
                        args.theme or ("light", "dark", "dynamic"),
                        args.only,
                        args.locale or ("zh-CN", "en"),
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
        "browser_version": browser_version,
        "web_build_sha256": hashlib.sha256((ROOT / "web/dist/index.html").read_bytes()).hexdigest(),
        "real_browser": True,
        "real_paid_models": False,
        "model_boundary": "Neutral local FakeLLM/FakeVLM/FakeComfy only; no real GPU or paid API",
        "official_package_source": "extensions/",
        "unrelated_bundled_packages": "Excluded in the disposable fixture process",
        "fixture_workspace_removed": True,
        "cases": cases,
        "passed": sum(case["status"] == "passed" for case in cases),
        "failed": sum(case["status"] == "failed" for case in cases),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser")
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    parser.add_argument("--theme", choices=("light", "dark", "dynamic"), action="append")
    parser.add_argument("--locale", choices=("zh-CN", "en"), action="append")
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
