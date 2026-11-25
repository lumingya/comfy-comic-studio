"""Real Chrome HTML import/privacy acceptance against a disposable neutral workspace.

Never builds dist, installs packages, contacts a paid service, or reads personal data.
UI changes use normal clicks, form controls, downloads and the browser file chooser.
GET requests observe imported state; fixture POST requests only reset the synthetic workspace.
"""

from __future__ import annotations

import argparse
import io
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
from urllib.parse import parse_qs, urlsplit

from check_roadmap_browser import dist_fingerprint
from creative_browser_common import EPISODE_ID, SERIES_ID, assert_fit, get_json

ROOT = Path(__file__).resolve().parents[1]
THEME = "album-neutral-dynamic"
CAPTION = "NEUTRAL HIDDEN CAPTION <script>inert text</script>"
PROMPT = "neutral geometry, blue rectangle, album import privacy marker"
CONSENT = "附带可回导资料（包含完整提示词及隐藏台词）"
WARNING = "任何拿到此 HTML 的人都能提取这些资料。仅在需要本地备份或回导时启用。"
SCOPE = "仅保留阅读页、完整台词和展开后的正向提示词；完整项目请导出可编辑源文件。"
IMPORT_PATH = "/api/imports/album-html"


def serve(port: int, data: Path) -> None:
    """Reuse the neutral roadmap fixture, adding only synthetic source text and a theme."""
    import roadmap_browser_fixture as fixture

    original = fixture.seed_workspace

    def seed(ctx):
        from mio_server.models import Dialogue
        from PIL import Image

        baseline = original(ctx)

        def source(episode):
            episode.panels[0].dialogues = [Dialogue(text=CAPTION, kind="narration")]
            episode.panels[0].overrides.raw_prompt = PROMPT

        ctx.store.update_episode(EPISODE_ID, source)
        baseline[EPISODE_ID] = ctx.store.get_episode(EPISODE_ID)
        theme = data / "themes" / THEME
        (theme / "assets").mkdir(parents=True)
        (theme / "mio-theme.json").write_text(
            json.dumps(
                {
                    "id": THEME,
                    "name": "Neutral album fixture",
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
                    "id": THEME,
                    "name": "Neutral album fixture",
                    "mode": "dark",
                    "background": {"kind": "image", "file": "assets/neutral.gif", "opacity": 0.3},
                }
            ),
            encoding="utf-8",
        )
        with Image.new("RGB", (48, 48), "#35454a") as first:
            with Image.new("RGB", (48, 48), "#455253") as second:
                first.save(
                    theme / "assets/neutral.gif",
                    save_all=True,
                    append_images=[second],
                    duration=500,
                    loop=0,
                )
        # The shared fixture creates AppContext before calling its seed hook.
        # Explicitly load only this newly generated neutral package into its registry.
        ctx.theme_packages.load_all()
        assert any(item.id == THEME for item in ctx.registry.all("theme"))
        return baseline

    fixture.seed_workspace = seed
    fixture.serve(port, data)


def metadata(document: str) -> dict:
    match = re.search(r'<script id="mio-album-data"[^>]*>(.*?)</script>', document, re.S)
    assert match, "Downloaded HTML has no Mio metadata"
    return json.loads(match[1])


class Evidence:
    def __init__(self, page, origin):
        self.requests, self.previews, self.errors, self.external = [], [], [], []
        self.expected_failures = []
        self.expect_invalid = False
        page.on("request", self.request)
        page.on("response", self.response)
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("console", self.console)

        def guard(route):
            if route.request.url.startswith((origin + "/", "data:", "blob:")):
                route.continue_()
            else:
                self.external.append(route.request.resource_type)
                route.abort()

        page.route("**/*", guard)

    def request(self, request):
        path = urlsplit(request.url).path
        if request.method == "POST" and path.startswith("/api/export/"):
            self.requests.append({"path": path, "body": request.post_data_json})

    def response(self, response):
        path = urlsplit(response.url).path
        if path == "/api/export/album" and response.request.method == "POST":
            if response.request.post_data_json.get("image_profile") == "preview":
                self.previews.append(response)
        if response.status >= 400:
            if self.expect_invalid and path == IMPORT_PATH and response.status == 400:
                self.expected_failures.append(response.status)
            else:
                self.errors.append(f"HTTP {response.status}: {path}")

    def console(self, event):
        if event.type == "error":
            if self.expect_invalid and "400" in event.text:
                return
            self.errors.append(event.text)


def visible_control(page, locator):
    """Assert the real control can be reached and fits inside the current viewport."""
    from playwright.sync_api import expect

    locator.scroll_into_view_if_needed()
    expect(locator).to_be_visible()
    box = locator.bounding_box()
    assert box
    viewport = page.viewport_size
    assert 0 <= box["x"] and box["x"] + box["width"] <= viewport["width"] + 1, box
    assert 0 <= box["y"] and box["y"] + box["height"] <= viewport["height"] + 1, box
    return {key: round(value, 1) for key, value in box.items()}


def download_html(page, button, path):
    with page.expect_download(timeout=30000) as pending:
        button.click()
    pending.value.save_as(path)
    assert pending.value.failure() is None
    document = path.read_text(encoding="utf-8")
    return document, metadata(document)


def choose_file(page, dialog, path):
    with page.expect_file_chooser() as chooser:
        dialog.get_by_role("button", name="选择 HTML 文件", exact=True).click()
    chooser.value.set_files(path)


def open_import(page, origin):
    from playwright.sync_api import expect

    page.goto(origin + "/gallery", wait_until="networkidle")
    page.get_by_role("button", name="导入 HTML 画册", exact=True).click()
    dialog = page.get_by_role("dialog", name="导入离线画册", exact=True)
    expect(dialog).to_be_visible()
    expect(dialog).to_contain_text("未归类")
    expect(dialog).to_contain_text(".mio.zip")
    return dialog


def import_file(page, origin, path, expected, *, dialog=None):
    from playwright.sync_api import expect

    dialog = dialog or open_import(page, origin)
    choose_file(page, dialog, path)
    expect(dialog.get_by_role("alert")).to_have_count(0)
    before = page.evaluate("window.__albumImportObserved.length")
    with page.expect_response(
        lambda response: (
            response.request.method == "POST" and urlsplit(response.url).path == IMPORT_PATH
        )
    ) as imported:
        dialog.get_by_role("button", name="导入画册", exact=True).click()
    response = imported.value
    assert response.status == 201, response.text()[:400]
    page.wait_for_function("n => window.__albumImportObserved.length > n", arg=before)
    result = page.evaluate("window.__albumImportObserved.at(-1)")
    for key, value in expected.items():
        assert result[key] == value, (key, result)
    summary = (
        f"已导入 {result['imported_books']} 本画册、{result['imported_frames']} 个阅读页、"
        f"{result['imported_assets']} 份素材。"
    )
    expect(dialog.get_by_role("status")).to_have_text(summary)
    visible_control(page, dialog.get_by_role("status"))
    if result["source_data_used"]:
        expect(dialog).to_contain_text("已恢复文件附带的完整台词和展开后的正向提示词。")
    else:
        expect(dialog).to_contain_text("仅恢复阅读页和可见文字。")
        expect(dialog.get_by_role("region", name="导入提示")).to_contain_text(
            "hidden captions and prompts cannot be recovered"
        )
    dialog.get_by_role("button", name="打开首本画册", exact=True).click()
    expect(page.locator(".room-head")).to_be_visible()
    assert urlsplit(page.url).path == "/gallery/" + result["series_ids"][0]
    assert parse_qs(urlsplit(page.url).query).get("collection") == ["unfiled"]
    return result


def observe_source(page, origin, result, payload):
    """Observe the UI-created records and compare them to the actual downloaded file."""
    from PIL import Image

    restored = []
    for series_id, episode_id, source in zip(
        result["series_ids"], result["episode_ids"], payload["sourceData"]["books"], strict=True
    ):
        series = get_json(page, origin, "/api/series/" + series_id)
        episode = get_json(page, origin, "/api/episodes/" + episode_id)
        assert series["title"] == source["title"]
        assert episode["synopsis"] == source["synopsis"]
        assert episode["title"] == (source["storyTitle"] or source["title"])
        assert len(episode["panels"]) == len(source["frames"])
        for panel, frame in zip(episode["panels"], source["frames"], strict=True):
            assert panel["description"] == frame["name"]
            assert "\n".join(item["text"] for item in panel["dialogues"]) == frame["caption"]
            assert panel["overrides"]["raw_prompt"] == frame["prompt"]
            projected = {key: panel["album_source"][key] for key in frame}
            assert projected == frame
            if frame["image"]:
                take = next(take for take in episode["takes"] if take["panel_id"] == panel["id"])
                asset = page.request.get(origin + "/api/assets/" + take["asset_id"])
                assert asset.ok
                with Image.open(io.BytesIO(asset.body())) as image:
                    assert list(image.size) == [frame["width"], frame["height"]]
        restored.append({"books": 1, "frames": len(source["frames"])})
    page.locator(".room-head button").first.click()
    from playwright.sync_api import expect

    expect(page.locator(".room-head")).to_have_count(0)
    assert parse_qs(urlsplit(page.url).query).get("collection") == ["unfiled"]
    for identifier in result["series_ids"]:
        expect(page.locator(f'[data-shelf-id="{identifier}"]')).to_have_count(1)
    return restored


def exercise(page, origin, folder, evidence):
    from playwright.sync_api import expect

    page.goto(f"{origin}/gallery/{SERIES_ID}/export", wait_until="networkidle")
    drawer = page.locator("#presentation-drawer")
    expect(drawer).to_be_visible()
    drawer.locator(".export-template-card").filter(has_text="典藏画集").click()
    consent = drawer.get_by_role("checkbox", name=CONSENT, exact=True)
    expect(consent).not_to_be_checked()
    bounds = {"consent": visible_control(page, consent)}
    for text in (WARNING, SCOPE):
        visible_control(page, drawer.get_by_text(text, exact=True))
    drawer.get_by_role("checkbox", name="包含旁白与台词", exact=True).uncheck()
    default_path, source_path = folder / "default.html", folder / "source.html"
    default_document, default = download_html(
        page, drawer.locator("footer").get_by_role("button", name="导出", exact=True), default_path
    )
    assert "sourceData" not in default
    assert CAPTION not in default_document and PROMPT not in default_document
    consent.check()
    expect(consent).to_be_checked()
    stored = page.evaluate("JSON.parse(localStorage.getItem('mio.reader.export'))")
    assert "includeSourceData" not in stored and "include_source_data" not in stored
    drawer.get_by_role("button", name="全屏试读", exact=True).click()
    full = page.locator("dialog.album-preview-dialog[open]")
    expect(full).to_be_visible()
    expect(full.locator("iframe")).to_be_visible()
    preview_documents = []

    def preview_document(frame):
        expect(frame).to_have_attribute("srcdoc", re.compile("mio-album-data"))
        document = frame.get_attribute("srcdoc")
        assert "sourceData" not in metadata(document)
        assert CAPTION not in document and PROMPT not in document
        preview_documents.append(True)

    preview_document(full.locator("iframe"))
    bounds["preview"] = assert_fit(page, "dialog.album-preview-dialog[open]")
    page.keyboard.press("Escape")
    expect(full).to_have_count(0)
    drawer.get_by_text("自定义与导入版式", exact=True).click()
    drawer.locator(".presentation-tools").get_by_role("button", name="自定义", exact=True).click()
    studio = page.locator("dialog.template-dialog[open]")
    expect(studio).to_be_visible()
    expect(studio.locator("#template-preview")).to_be_visible()
    page.frame_locator("#template-preview").locator("body").wait_for()
    preview_document(studio.locator("#template-preview"))
    page.keyboard.press("Escape")
    expect(studio).to_have_count(0)
    for frame in page.locator("iframe[srcdoc]").all():
        if frame.is_visible():
            preview_document(frame)
    source_document, source = download_html(
        page, drawer.locator("footer").get_by_role("button", name="导出", exact=True), source_path
    )
    assert source["sourceData"]["schema"] == "mio.album-source.v1"
    assert source["sourceData"]["books"][0]["frames"][0]["caption"] == CAPTION
    assert source["sourceData"]["books"][0]["frames"][0]["prompt"] == PROMPT
    jobs = [item["body"] for item in evidence.requests if item["path"].endswith("/jobs/album")]
    assert [body["include_source_data"] for body in jobs] == [False, True]
    assert all(body["show_prompts"] is False for body in jobs)
    drawer.get_by_role("button", name="收起模板与导出", exact=True).click()
    page.locator(".room-head").get_by_role("button", name="导出", exact=True).click()
    expect(consent).not_to_be_checked()
    # Import the opt-in file via the actual file chooser, then observe the created records.
    imported = import_file(
        page,
        origin,
        source_path,
        {"imported_books": 1, "imported_frames": 3, "imported_assets": 1, "source_data_used": True},
    )
    readback = observe_source(page, origin, imported, source)
    # A default sharing export is valid legacy input, with an explicit visible recovery warning.
    legacy = import_file(page, origin, default_path, {"source_data_used": False})
    legacy_episode = get_json(page, origin, "/api/episodes/" + legacy["episode_ids"][0])
    assert all(not panel["dialogues"] for panel in legacy_episode["panels"])
    assert all(not panel["overrides"]["raw_prompt"] for panel in legacy_episode["panels"])
    # Select two real shelf covers and verify batch consent and combined download.
    page.goto(origin + "/gallery?q=合集验收", wait_until="networkidle")
    page.get_by_role("button", name="紧凑网格", exact=True).click()
    for identifier in ("roadmap-shelf-0", "roadmap-shelf-1"):
        page.locator(f'[data-shelf-id="{identifier}"] [data-shelf-open]').first.click(
            modifiers=["Control"]
        )
    toolbar = page.locator(".shelf-selection-status")
    expect(page.locator('[data-shelf-id][aria-selected="true"]')).to_have_count(2)

    def batch_open():
        toolbar.get_by_role("button", name="导出", exact=True).click()
        dialog = page.get_by_role("dialog", name="导出 2 本画册", exact=True)
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("checkbox", name=CONSENT, exact=True)).not_to_be_checked()
        return dialog

    batch = batch_open()
    visible_control(page, batch.get_by_text(WARNING, exact=True))
    _, batch_default = download_html(
        page, batch.get_by_role("button", name="导出", exact=True), folder / "batch-default.html"
    )
    assert "sourceData" not in batch_default
    expect(batch).to_have_count(0)
    batch = batch_open()
    batch.get_by_role("checkbox", name=CONSENT, exact=True).check()
    batch_path = folder / "batch-source.html"
    _, batch_source = download_html(
        page, batch.get_by_role("button", name="导出", exact=True), batch_path
    )
    expect(batch).to_have_count(0)
    batch = batch_open()
    batch.get_by_role("button", name="取消", exact=True).click()
    batch_import = import_file(
        page,
        origin,
        batch_path,
        {"imported_books": 2, "imported_frames": 2, "imported_assets": 1, "source_data_used": True},
    )
    observe_source(page, origin, batch_import, batch_source)
    # The uploaded HTML is parsed as data, including active-looking markup.
    malicious = folder / "inert-active-markup.html"
    attack = (
        '<script>window.__album_import_attack=true;fetch("https://album-fixture.invalid/script")'
        '</script><img src="https://album-fixture.invalid/image" '
        'onerror="window.__album_import_attack=true">'
    )
    malicious.write_text(source_document.replace("</body>", attack + "</body>"), encoding="utf-8")
    assert attack in malicious.read_text(encoding="utf-8")
    import_file(page, origin, malicious, {"source_data_used": True})
    assert page.evaluate("window.__album_import_attack === true") is False
    assert not evidence.external
    # Both local filename validation and backend parsing failures clear on a fresh choice.
    bad_type = folder / "wrong.txt"
    bad_type.write_text("neutral", encoding="utf-8")
    invalid = folder / "invalid.html"
    invalid.write_text("<!doctype html><p>No Mio metadata</p>", encoding="utf-8")
    dialog = open_import(page, origin)
    choose_file(page, dialog, bad_type)
    expect(dialog.get_by_role("alert")).to_have_text("请选择 .html 或 .htm 画册文件。")
    expect(dialog.get_by_role("button", name="导入画册", exact=True)).to_be_disabled()
    choose_file(page, dialog, invalid)
    expect(dialog.get_by_role("alert")).to_have_count(0)
    evidence.expect_invalid = True
    with page.expect_response(lambda response: urlsplit(response.url).path == IMPORT_PATH) as bad:
        dialog.get_by_role("button", name="导入画册", exact=True).click()
    assert bad.value.status == 400
    expect(dialog.get_by_role("alert")).to_be_visible()
    error_text = dialog.get_by_role("alert").inner_text()
    visible_control(page, dialog.get_by_role("alert"))
    import_file(page, origin, source_path, {"source_data_used": True}, dialog=dialog)
    evidence.expect_invalid = False
    assert len(evidence.expected_failures) == 1
    assert len(evidence.previews) >= 3, "Reader, full-screen and studio must render real previews"
    for response in evidence.previews:
        body = response.request.post_data_json
        assert body["include_source_data"] is False
    return {
        "reader_export_source_flags": [False, True],
        "reader_reopen_consent_reset": True,
        "source_consent_not_persisted": True,
        "warning_and_scope_visible": True,
        "batch_export_source_flags": [False, True],
        "batch_reopen_consent_reset": True,
        "preview_requests_forced_false": len(evidence.previews),
        "preview_document_source_absent": True,
        "preview_iframe_documents_inspected": len(preview_documents),
        "source_import_ui_counts": {key: imported[key] for key in expected_count_keys()},
        "batch_import_ui_counts": {key: batch_import[key] for key in expected_count_keys()},
        "open_first_and_unfiled_visible": True,
        "observed_get_source_field_readback": readback,
        "legacy_warning_visible": True,
        "legacy_hidden_text_absent": True,
        "active_html_not_executed": True,
        "invalid_file_error_cleared_and_retry_succeeded": True,
        "expected_invalid_error": error_text,
        "control_bounds": bounds,
        "pixel_scope": "UI-generated HTML imported unchanged; dimensions observed. Exact RGBA pixel proof belongs to backend roundtrip suite.",
    }


def expected_count_keys():
    return ("imported_books", "imported_frames", "imported_assets", "source_data_used")


def run(args):
    from playwright.sync_api import expect, sync_playwright

    if not (ROOT / "web/dist/index.html").is_file():
        raise RuntimeError("Build web/dist first; this tool does not change the application build")
    executable = Path(args.browser)
    if not executable.is_file():
        raise RuntimeError("Pass an already installed Chrome with --browser")
    before = dist_fingerprint()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    cases = []
    with tempfile.TemporaryDirectory(prefix="mio-album-browser-") as temporary:
        folder = Path(temporary)
        with tempfile.TemporaryFile() as log:
            process = subprocess.Popen(
                [
                    sys.executable,
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
                for _ in range(120):
                    if process.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(log.read().decode("utf-8", "replace")[-2500:])
                    try:
                        with urllib.request.urlopen(origin + "/healthz", timeout=1):
                            break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError("Disposable fixture did not start")
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(
                        executable_path=str(executable), headless=True
                    )
                    version = browser.version
                    try:
                        for width in args.width or (1440, 390):
                            for theme in args.theme or ("light", "dark", "dynamic"):
                                height = 900 if width == 1440 else 844
                                context = browser.new_context(
                                    viewport={"width": width, "height": height},
                                    locale="zh-CN",
                                    color_scheme="light" if theme == "light" else "dark",
                                    reduced_motion="no-preference"
                                    if theme == "dynamic"
                                    else "reduce",
                                    accept_downloads=True,
                                    has_touch=width == 390,
                                    is_mobile=width == 390,
                                )
                                context.add_init_script(
                                    "if(window===top){localStorage.setItem('mio.locale','zh-CN');"
                                    "localStorage.setItem('mio.ui',JSON.stringify({version:3,state:"
                                    + json.dumps(
                                        {
                                            "theme": THEME if theme == "dynamic" else "system",
                                            "reduceMotion": theme != "dynamic",
                                            "worksView": "grid",
                                            "wallpaperIdleTimeout": 0,
                                            "pauseWallpaperWhenUnfocused": False,
                                        }
                                    )
                                    + "}));}"
                                )
                                # Observe a clone of the real import response before Chrome may
                                # evict it from DevTools. The application gets its unchanged Response.
                                context.add_init_script(
                                    "if(window===top){window.__albumImportObserved=[];"
                                    "const originalFetch=window.fetch;window.fetch=async(...args)=>{"
                                    "const response=await originalFetch(...args);"
                                    "if(response.ok&&response.url.endsWith('/api/imports/album-html'))"
                                    "{response.clone().json().then(value=>window.__albumImportObserved.push(value));}"
                                    "return response;};}"
                                )
                                page = context.new_page()
                                page.set_default_timeout(10000)
                                evidence = Evidence(page, origin)
                                case = {"width": width, "height": height, "theme": theme}
                                started = time.monotonic()
                                print(
                                    f"Running album HTML {width} {theme}",
                                    file=sys.stderr,
                                    flush=True,
                                )
                                try:
                                    reset = page.request.post(origin + "/__roadmap_fixture/reset")
                                    assert reset.ok
                                    page.goto(origin + "/gallery", wait_until="networkidle")
                                    expect(page.locator("html")).to_have_attribute(
                                        "data-theme", "light" if theme == "light" else "dark"
                                    )
                                    if theme == "dynamic":
                                        expect(page.locator("html")).to_have_attribute(
                                            "data-theme-dynamic-background", "true"
                                        )
                                        expect(
                                            page.locator(".theme-backdrop img")
                                        ).to_have_js_property("naturalWidth", 48)
                                    facts = exercise(page, origin, folder, evidence)
                                    assert not evidence.errors, evidence.errors
                                    assert not evidence.external, evidence.external
                                    case.update(status="passed", facts=facts)
                                except Exception as error:
                                    case.update(
                                        status="failed",
                                        error=str(error),
                                        trace=traceback.format_exc(limit=5),
                                    )
                                finally:
                                    case.update(
                                        seconds=round(time.monotonic() - started, 2),
                                        unexpected_errors=evidence.errors,
                                        external_requests=evidence.external,
                                    )
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
    after = dist_fingerprint()
    return {
        "browser": str(executable),
        "browser_version": version,
        "dist_before": before,
        "dist_after": after,
        "dist_unchanged": before == after,
        "real_browser": True,
        "isolated_fixture": True,
        "private_data": False,
        "paid_services": False,
        "screenshots_created": 0,
        "temporary_workspace_removed": not folder.exists(),
        "cases": cases,
        "passed": sum(case["status"] == "passed" for case in cases),
        "failed": sum(case["status"] != "passed" for case in cases),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--browser", default="C:/Program Files/Google/Chrome/Application/chrome.exe"
    )
    parser.add_argument("--report", type=Path)
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    parser.add_argument("--theme", choices=("light", "dark", "dynamic"), action="append")
    parser.add_argument("--serve", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--data", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        if args.data is None:
            parser.error("Fixture server requires a disposable --data path")
        serve(args.serve, args.data)
        return 0
    report = run(args)
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(output + "\n", encoding="utf-8")
    print(output)
    return int(bool(report["failed"]) or not report["dist_unchanged"])


if __name__ == "__main__":
    raise SystemExit(main())
