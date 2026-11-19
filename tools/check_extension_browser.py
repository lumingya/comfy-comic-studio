"""Real Chromium checks in a disposable workspace; never install browsers or packages.

Run after `npm --prefix web run build`: python tools/check_extension_browser.py
Requires an already installed Python Playwright and Chrome/Edge (or --browser PATH).
The CSP result reports self-navigation separately instead of treating connect-src as proof.
"""

from __future__ import annotations

import argparse
import io
import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from contextlib import nullcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def serve(port: int, data_dir: Path) -> None:
    sys.path.insert(0, str(ROOT / "server"))
    import uvicorn
    from mio_server.api import create_app
    from mio_server.context import AppContext

    def package(ctx, identifier, **resources):
        document = {"id": identifier, "name": identifier, "mode": "light"}
        if "theme.css" in resources:
            document["style_file"] = "theme.css"
        if "settings.html" in resources:
            document["settings_page"] = "settings.html"
        files = {
            "theme.json": json.dumps(document),
            "mio-theme.json": json.dumps(
                {
                    "id": identifier,
                    "name": identifier,
                    "version": "1",
                    "author": "Fixture",
                    "description": "Isolated browser fixture",
                    "theme_file": "theme.json",
                }
            ),
            **resources,
        }
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name, content in files.items():
                archive.writestr(name, content)
        ctx.theme_packages.install_package(buffer.getvalue())

    # The parent owns cleanup: Windows TerminateProcess does not run child finally blocks.
    with nullcontext(data_dir) as temporary:
        ctx = AppContext.create(temporary, autostart=False, seed_instance=False)
        try:
            folder = ctx.extensions.root / "browser-pet"
            folder.mkdir(parents=True)
            (folder / "pet.html").write_text(
                "<!doctype html><body>Browser pet</body>", encoding="utf-8"
            )
            (folder / "mio-extension.json").write_text(
                json.dumps(
                    {
                        "id": "browser-pet",
                        "name": "Browser pet",
                        "version": "1",
                        "contributes": {
                            "floating_surfaces": [
                                {
                                    "id": "pet",
                                    "title": "Browser pet",
                                    "entry": "pet.html",
                                    "global": True,
                                    "transparent": True,
                                    "default_position": {"x": 100, "y": 100},
                                }
                            ]
                        },
                    }
                ),
                encoding="utf-8",
            )
            ctx.extensions.enable("browser-pet", ctx.extensions.info("browser-pet").digest)
            package(
                ctx,
                "browser-obscured",
                **{
                    "theme.css": (
                        'body::before { content:"shield"; position:fixed; inset:0; '
                        "z-index:2147483647; background:#234; pointer-events:auto; }"
                    )
                },
            )
            package(
                ctx,
                "browser-settings",
                **{
                    "settings.html": """<!doctype html><body>
<script>addEventListener('message', async e => {
  if (!['fetch','image','navigate','top'].includes(e.data)) return;
  const target='/__browser_probe?kind='+e.data;
  if(e.data==='fetch') { try { await fetch(target) } catch {} }
  if(e.data==='image') new Image().src=target;
  if(e.data==='navigate') location.href=target;
  if(e.data==='top') { try { top.location.href=target } catch {} }
  parent.postMessage({probeDone:e.data},'*');
});parent.postMessage({probeReady:true},'*');</script></body>"""
                },
            )
            app = create_app(ctx, serve_web=True)
            counts: dict[str, int] = {}

            # Fixture routes precede the production SPA fallback, in this process only.
            from fastapi.routing import APIRoute

            def probe(kind: str = "unknown"):
                counts[kind] = counts.get(kind, 0) + 1
                return {"fixture": True}

            def state():
                return counts

            app.router.routes.insert(0, APIRoute("/__browser_probe", probe))
            app.router.routes.insert(0, APIRoute("/__browser_state", state))
            uvicorn.run(app, host="127.0.0.1", port=port, log_level="critical")
        finally:
            ctx.close()


def run(browser_path: str | None) -> dict:
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
    executable = next((p for p in candidates if p and Path(p).is_file()), None)
    if not executable:
        raise RuntimeError("No existing Chromium found; pass --browser. No browser was installed.")
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"

    def state():
        with urllib.request.urlopen(origin + "/__browser_state", timeout=2) as response:
            return json.load(response)

    with (
        tempfile.TemporaryDirectory(prefix="mio-browser-check-") as temporary,
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
                    raise RuntimeError("Disposable browser fixture server failed")
                try:
                    state()
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Disposable fixture did not become ready")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=executable, headless=True)
                try:
                    page = browser.new_page(viewport={"width": 1280, "height": 900})
                    page.set_default_timeout(8000)
                    browser_errors = []
                    page.on(
                        "console",
                        lambda message: (
                            browser_errors.append(message.text[:500])
                            if message.type == "error"
                            else None
                        ),
                    )
                    # Guard against accidental public service traffic, not the loopback CSP probes.
                    page.route(
                        "**/*",
                        lambda route: (
                            route.continue_()
                            if route.request.url.startswith(origin)
                            or route.request.url.startswith(("data:", "blob:"))
                            else route.abort()
                        ),
                    )
                    page.goto(origin, wait_until="networkidle")
                    floating = page.locator(".workspace-extension-floating")
                    floating.wait_for(state="visible")
                    box = page.get_by_title("Browser pet").bounding_box()
                    assert box
                    point = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
                    page.evaluate(
                        """point => {
                      window.underlayClicks=0;
                      const button=document.createElement('button');
                      button.id='browser-underlay'; button.textContent='Underlying control';
                      Object.assign(button.style,{position:'fixed',left:(point.x-30)+'px',
                        top:(point.y-20)+'px',width:'60px',height:'40px',zIndex:'1',pointerEvents:'auto'});
                      button.onclick=()=>window.underlayClicks++;
                      document.querySelector('.workspace-extension-floating').parentElement.append(button);
                    }""",
                        point,
                    )
                    toggle = floating.locator("header button[aria-pressed]")
                    toggle.click()
                    assert floating.get_attribute("data-click-through") == "true"
                    page.mouse.click(point["x"], point["y"])
                    assert page.evaluate("window.underlayClicks") == 1, (
                        "Content did not hit underlying button"
                    )
                    toggle.click()
                    assert floating.get_attribute("data-click-through") is None, (
                        "Titlebar lost interaction"
                    )

                    page.evaluate("""() => {
                      window.probeDone=[];
                      addEventListener('message',e=>{
                        if(e.data?.probeDone)window.probeDone.push(e.data.probeDone);
                        if(e.data?.probeReady)window.probeReady=true;
                      });
                      const f=document.createElement('iframe'); f.id='security-probe';
                      f.sandbox='allow-scripts'; f.referrerPolicy='no-referrer';
                      f.src='/api/themes/browser-settings/settings-page#mio-theme-session=browser-fixture-session-12345';
                      document.body.append(f);
                    }""")
                    security = page.frame_locator("#security-probe")
                    security.locator("body").wait_for(state="attached")
                    try:
                        page.wait_for_function("window.probeReady===true", timeout=8000)
                    except Exception:
                        raise RuntimeError(
                            json.dumps(
                                {
                                    "fixture_ready": False,
                                    "browser_errors": browser_errors[-6:],
                                    "frames": [frame.url for frame in page.frames],
                                },
                                ensure_ascii=False,
                            )
                        ) from None
                    for kind in ("fetch", "image", "top", "navigate"):
                        page.evaluate(
                            "kind=>document.querySelector('#security-probe').contentWindow.postMessage(kind,'*')",
                            kind,
                        )
                        page.wait_for_function("kind=>window.probeDone.includes(kind)", arg=kind)
                    page.wait_for_timeout(350)
                    observed = state()
                    for kind in ("fetch", "image", "top"):
                        assert observed.get(kind, 0) == 0, f"CSP/sandbox allowed {kind} probe"

                    page.evaluate("""() => {
                      const value=JSON.parse(localStorage.getItem('mio.ui')||'{}');
                      value.state={...value.state,theme:'browser-obscured'};value.version=2;
                      localStorage.setItem('mio.ui',JSON.stringify(value));
                    }""")
                    page.reload(wait_until="networkidle")
                    page.wait_for_selector(
                        'link[data-mio-theme="browser-obscured"]', state="attached"
                    )
                    page.keyboard.press("Control+Shift+Digit0")
                    page.wait_for_function(
                        "JSON.parse(localStorage.getItem('mio.ui')).state.theme==='system'"
                    )
                    return {
                        "browser": browser.version,
                        "real_browser": True,
                        "content_hit_underlying_control": True,
                        "titlebar_retained_interaction": True,
                        "fetch_image_top_navigation_blocked": True,
                        "escape_shortcut": True,
                        "self_navigation_blocked": observed.get("navigate", 0) == 0,
                        "self_navigation_probe_requests": observed.get("navigate", 0),
                    }
                finally:
                    browser.close()
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", help="Existing Chrome/Edge/Chromium executable")
    parser.add_argument("--serve", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--data", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--require-navigation-blocked", action="store_true")
    args = parser.parse_args()
    if args.serve:
        if args.data is None:
            parser.error("the internal fixture server requires a parent-owned --data path")
        serve(args.serve, args.data)
        return 0
    result = run(args.browser)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if args.require_navigation_blocked and not result["self_navigation_blocked"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
