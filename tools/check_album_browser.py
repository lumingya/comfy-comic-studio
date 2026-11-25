"""Exercise five offline album editions in an already installed Chromium browser.

Run locally: python tools/check_album_browser.py [--screenshots TEMP_DIRECTORY]
The default matrix covers 1440x900 / 390x844, light / dark, shipped artwork and nine
synthetic data cases. No browser/package is installed and no external request is allowed.
Only manifest-listed seed albums are copied; private workspace data is never read.
Optional screenshots require visual review and deletion after the run; never commit them.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = tuple(
    "export-" + name for name in ("monograph", "nocturne", "folio", "zine", "contact-sheet")
)
SCENARIOS = (
    "sample",
    "single",
    "twelve",
    "sixty",
    "one-twenty",
    "collection-long-titles",
    "image-only",
    "captions-off",
    "xss",
    "ultra-ratios",
)
TITLE = "雨停以后，信会抵达"
ATTACK = (
    '</script><img class="album-xss" src="https://album-xss.invalid/pixel" '
    'onerror="window.albumXss=1"><script>window.albumXss=2</script>{{title}} & 中文'
)
sys.path.insert(0, str(ROOT / "server"))


@dataclass
class Example:
    path: Path
    books: list
    captions: bool = True
    prompts: bool = False

    @property
    def count(self) -> int:
        return sum(len(book.frames) for book in self.books)


def specimen(width: int, height: int) -> str:
    """A neutral fixture with actual, rather than labelled, extreme dimensions."""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="#294f57"/>'
        '<path d="M0 0L0 40L40 40L40 0Z" fill="#eee2c8"/>'
        f'<path d="M0 {height}L{width} 0" stroke="#eee2c8" stroke-width="2"/></svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def scenario_books(name: str) -> list:
    from mio_server.album.render import Book, Frame

    sizes = ((1448, 1086), (768, 1024), (1024, 1024))
    if name == "ultra-ratios":
        sizes = ((1280, 64), (64, 2560), (64, 2560), (1280, 64))
    images = [specimen(w, h) for w, h in sizes]
    count = {"single": 1, "twelve": 12, "sixty": 60, "one-twenty": 120}.get(name, 4)
    if name == "collection-long-titles":
        count = 6
    frames = []
    for index in range(count):
        width, height = sizes[index % len(sizes)]
        image_only = name == "image-only"
        text = ATTACK if name == "xss" else f"第 {index + 1} 幕 / Frame {index + 1}"
        frames.append(
            Frame(
                ""
                if name == "collection-long-titles" and index == count - 1
                else images[index % len(images)],
                name="" if image_only else text,
                caption="" if image_only else text + " · 台词与说明",
                prompt="" if image_only else text + " neutral geometric study",
                width=width,
                height=height,
                palette=["#294f57", "#d9aa71", "#eee2c8"],
            )
        )
    title = "" if name == "image-only" else ATTACK if name == "xss" else "测试画册 / Test edition"
    synopsis = "" if name == "image-only" else ATTACK if name == "xss" else "离线中英混排验证"
    if name == "collection-long-titles":
        return [
            Book("超长中文标题" + "雨停以后信会抵达" * 40, frames[:3], synopsis="长中文简介" * 50),
            Book("LongUnbrokenEnglishTitle" * 45, frames[3:], synopsis="UnbrokenSynopsis" * 80),
        ]
    return [Book(title, frames, synopsis=synopsis)]


def export_examples(folder: Path, scenarios: list[str]) -> dict[tuple[str, str], Example]:
    from fastapi.testclient import TestClient
    from mio_server.album.build import episode_book
    from mio_server.album.render import AlbumOptions, render_album
    from mio_server.album.templates import builtin_templates
    from mio_server.api import create_app
    from mio_server.context import AppContext
    from tests.shipped_data_fixture import copy_shipped_data

    templates = {template.id: template for template in builtin_templates()}
    files = {}
    if "sample" in scenarios:
        seed = copy_shipped_data(folder / "seed", kinds=("albums",))
        ctx = AppContext.create(folder / "workspace", autostart=False, seed_instance=False)
        try:
            with TestClient(
                create_app(ctx, serve_web=False), base_url="http://127.0.0.1"
            ) as client:
                result = client.post("/api/legacy/import", json={"root": str(seed)})
                result.raise_for_status()
                assert not result.json()["warnings"], result.json()["warnings"]
                cards = client.get("/api/series").json()
                series = next(card for card in cards if card["title"] == TITLE)
                [episode] = client.get(f"/api/series/{series['id']}/episodes").json()["items"]
                book = episode_book(ctx, episode["id"], lettered=False, profile="archive")
                assert len(book.frames) == 4
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
                    path = folder / f"{identifier}-sample.html"
                    path.write_bytes(response.content)
                    files[identifier, "sample"] = Example(path, [book])
        finally:
            ctx.close()
    for scenario in scenarios:
        if scenario == "sample":
            continue
        books = scenario_books(scenario)
        options = AlbumOptions(
            show_captions=scenario not in ("captions-off", "image-only"),
            show_prompts=scenario == "xss",
            signature=ATTACK if scenario == "xss" else "",
        )
        for identifier in TEMPLATES:
            path = folder / f"{identifier}-{scenario}.html"
            path.write_text(render_album(templates[identifier], books, options), encoding="utf-8")
            files[identifier, scenario] = Example(
                path, books, options.show_captions, options.show_prompts
            )
    return files


def assert_fit(page, selector: str) -> dict:
    box = page.locator(selector).bounding_box()
    assert box, f"Missing visible region: {selector}"
    viewport = page.viewport_size
    assert box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1, box
    assert box["y"] >= -1 and box["y"] + box["height"] <= viewport["height"] + 1, box
    return {key: round(value, 1) for key, value in box.items()}


def settle(page) -> None:
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


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
    settle(page)
    metrics = page.evaluate(
        """() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        images:[...document.querySelectorAll('.cc-image')].map(i => {
          const s=getComputedStyle(i), r=i.getBoundingClientRect();
          // offset dimensions exclude a Zine leaf's intentional rotation.
          return {width:i.offsetWidth,height:i.offsetHeight,naturalWidth:i.naturalWidth,
            naturalHeight:i.naturalHeight,fit:s.objectFit,maxHeight:s.maxHeight,
            x:r.x,right:r.right,visible:!!i.getClientRects().length};
        }),overflow:[...document.querySelectorAll('h1,h2,p,pre,.running-head,.colophon')]
          .filter(e => e.getClientRects().length && e.getBoundingClientRect().width > 0)
          .filter(e => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX==='visible')
          .slice(0,5).map(e=>({tag:e.tagName,cls:e.className,
            width:e.clientWidth,scrollWidth:e.scrollWidth,text:e.textContent.slice(0,50)}))})"""
    )
    assert metrics["scrollWidth"] <= metrics["width"] + 1, metrics
    assert not metrics["overflow"], metrics["overflow"]
    for image in metrics["images"]:
        assert image["fit"] == "contain", image
        if image["visible"] and image["height"]:
            ratio = image["naturalWidth"] / image["naturalHeight"]
            # CSS sizes rounded by offsetWidth/Height are allowed; image crops are not.
            assert abs(image["width"] - image["height"] * ratio) <= max(2, ratio), image
            assert image["x"] >= -2 and image["right"] <= metrics["width"] + 2, image
    dimensions = sorted({(i["naturalWidth"], i["naturalHeight"]) for i in metrics["images"]})
    return {
        "images": count,
        "dimensions": dimensions,
        "visible": sum(i["visible"] for i in metrics["images"]),
        "scroll_width": metrics["scrollWidth"],
        "viewport_width": metrics["width"],
    }


def assert_payload(page, example: Example) -> dict:
    """Resolve browser-parsed interchange payloads, not a simulated importer result."""
    restored = page.evaluate(
        """() => {
        const payload=JSON.parse(document.getElementById('mio-album-data').textContent);
        const assets=new Map([...document.querySelectorAll('img[data-mio-asset]')]
          .map(i=>[i.dataset.mioAsset,i.getAttribute('src')]));
        document.getElementById('mio-shared-assets')?.content
          .querySelectorAll('img[data-mio-asset]').forEach(i=>
            assets.set(i.dataset.mioAsset,i.getAttribute('src')));
        for (const {album} of payload.books) for (const step of album.steps)
          if (step.image) step.image=assets.get(step.image.$mioImage) || 'UNRESOLVED';
        return payload;
        }"""
    )
    assert restored["schema"] == "mio.album-html.v1"
    assert len(restored["books"]) == len(example.books)
    for exported, book in zip(restored["books"], example.books, strict=True):
        album = exported["album"]
        assert album["title"] == book.title and album["synopsis"] == book.synopsis
        assert album["totalSteps"] == len(book.frames) == len(album["steps"])
        for index, (step, frame) in enumerate(zip(album["steps"], book.frames, strict=True)):
            assert step["stepIndex"] == index
            assert step["name"] == frame.name
            assert step["caption"] == (frame.caption if example.captions else "")
            assert step.get("prompt", "") == (frame.prompt if example.prompts else "")
            assert step["image"] == frame.image, f"Image payload differs at frame {index + 1}"
            if frame.width and frame.height:
                assert (step["width"], step["height"]) == (frame.width, frame.height)
    return {
        "schema": restored["schema"],
        "books": len(example.books),
        "restored_frames": example.count,
    }


def screenshot(page, directory: Path | None, name: str) -> None:
    if directory:
        directory.mkdir(parents=True, exist_ok=True)
        settle(page)
        page.screenshot(path=str(directory / f"{name}.png"), animations="disabled")


def exercise_directory(page, count: int, shots: Path | None, name: str) -> dict:
    from playwright.sync_api import expect

    counter = page.locator(".mio-progress")
    directory = page.get_by_role("button", name="目录", exact=True)
    directory.click()
    tray = page.locator(".mio-tray")
    expect(tray).to_be_visible()
    bounds = assert_fit(page, ".mio-tray")
    assert_fit(page, ".mio-controls")
    buttons = page.locator(".mio-thumbnails button")
    expect(buttons).to_have_count(count)
    expect(page.locator('.mio-thumbnails [aria-current="true"]')).to_be_focused()
    before = counter.inner_text()
    page.keyboard.press("ArrowRight")
    expect(counter).to_have_text(before)
    buttons.last.click()
    expect(tray).to_be_hidden()
    settle(page)
    expect(counter).to_have_text(f"{count} / {count}")
    expect(directory).to_be_focused()
    page.keyboard.press("g")
    expect(tray).to_be_visible()
    expect(buttons.last).to_be_focused()
    page.keyboard.press("Escape")
    expect(tray).to_be_hidden()
    expect(directory).to_be_focused()
    page.keyboard.press("g")
    expect(tray).to_be_visible()
    buttons.first.focus()
    page.keyboard.press("Enter")
    expect(tray).to_be_hidden()
    expect(counter).to_have_text(f"1 / {count}")
    expect(directory).to_be_focused()
    screenshot(page, shots, name + "-directory-return")
    return {"bounds": bounds, "thumbnails": count, "mouse_keyboard_focus": "passed"}


def set_mode(page, mode: str) -> None:
    from playwright.sync_api import expect

    control = page.get_by_role("button", name=re.compile("切换版式"))
    for _ in range(3):
        if control.inner_text() == mode:
            break
        control.click()
    expect(control).to_have_text(mode)
    settle(page)


def exercise_lightbox(page, count: int, *, keyboard=False) -> None:
    from playwright.sync_api import expect

    image = page.locator(".cc-image:visible").first
    trigger = (
        page.locator("[data-cc-frame]:visible").first
        if (page.locator("body").get_attribute("data-layout") == "contact")
        else image
    )
    dialog = page.locator(".cc-lightbox")
    if keyboard:
        trigger.focus()
        page.keyboard.press("Space" if keyboard == "Space" else "Enter")
    else:
        image.click()
    expect(dialog).to_be_visible()
    assert_fit(page, ".cc-lightbox-viewport")
    close = page.get_by_role("button", name="关闭画作预览", exact=True)
    expect(close).to_be_focused()
    assert page.locator("body > [inert]").count() > 0
    page.keyboard.press("Shift+Tab")
    assert dialog.evaluate("d => d.contains(document.activeElement)")
    page.keyboard.press("Tab")
    expect(close).to_be_focused()
    if count > 1:
        page.keyboard.press("ArrowRight")
        expect(dialog).to_have_attribute("aria-label", re.compile(f"2 / {count}$"))
        page.get_by_role("button", name="上一幅画作", exact=True).click()
        expect(dialog).to_have_attribute("aria-label", re.compile(f"1 / {count}$"))
    page.get_by_role("button", name="放大", exact=True).click()
    expect(page.locator(".cc-lightbox-viewport")).to_have_attribute("data-zoomed", "")
    page.get_by_role("button", name="适应窗口", exact=True).click()
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()
    expect(trigger).to_be_focused()
    assert page.locator("body > [inert]").count() == 0
    assert page.locator("body").evaluate("b=>b.style.overflow") != "hidden"


def swipe(page, *, right=False) -> None:
    session = page.context.new_cdp_session(page)
    try:
        for event, points in (
            ("touchStart", [{"x": 80 if right else 300, "y": 350}]),
            ("touchMove", [{"x": 300 if right else 80, "y": 350}]),
            ("touchEnd", []),
        ):
            session.send("Input.dispatchTouchEvent", {"type": event, "touchPoints": points})
    finally:
        session.detach()


def exercise_special(page, template: str, count: int) -> dict:
    from playwright.sync_api import expect

    details = {}
    direction_control = page.get_by_role("combobox", name="独立志阅读方向", exact=True)
    expect(direction_control).to_have_count(int(template == "export-zine"))
    if template == "export-contact-sheet":
        set_mode(page, "模板版式")
        page.keyboard.press("Home")
        frame = page.locator("[data-cc-frame]").nth(1)
        frame.locator(".film-stamp").click()
        dialog = page.locator(".cc-lightbox")
        expect(dialog).to_be_visible()
        expect(dialog).to_have_attribute("aria-label", re.compile(f"2 / {count}$"))
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        assert frame.evaluate("e=>e===document.activeElement||e.contains(document.activeElement)")
        details["contact_frame_number_click"] = "passed"
    if template == "export-zine":

        def select_direction(value):
            direction_control.focus()
            page.keyboard.press("Home")
            for _ in range({"webtoon": 0, "ltr": 1, "rtl": 2}[value]):
                page.keyboard.press("ArrowDown")
            page.keyboard.press("Enter")
            expect(direction_control).to_have_value(value)
            page.keyboard.press("Escape")
            page.keyboard.press("Tab")
            expect(direction_control).not_to_be_focused()

        page.emulate_media(reduced_motion="no-preference")
        styles = {}
        for reading, forward, backward in (
            ("ltr", "ArrowRight", "ArrowLeft"),
            ("rtl", "ArrowLeft", "ArrowRight"),
        ):
            select_direction(reading)
            set_mode(page, "双页")
            page.keyboard.press("Home")
            positions = page.locator("[data-cc-frame]:visible").evaluate_all(
                "frames=>frames.map(f=>f.getBoundingClientRect().x)"
            )
            assert (positions[0] < positions[1]) == (reading == "ltr"), positions
            for direction, key, index in (("next", forward, 3), ("previous", backward, 1)):
                page.keyboard.press(key)
                expect(page.locator(".mio-progress")).to_have_text(f"{index} / {count}")
                styles[reading + "-" + direction] = page.locator("[data-mio-enter]").evaluate(
                    "e=>({animation:getComputedStyle(e).animationName,origin:getComputedStyle(e).transformOrigin})"
                )
                assert styles[reading + "-" + direction]["animation"] != "none", styles
        assert styles["ltr-next"]["animation"] == styles["rtl-previous"]["animation"]
        assert styles["rtl-next"]["animation"] != styles["ltr-next"]["animation"]
        details["zine_turn_styles"] = styles
        page.emulate_media(reduced_motion="reduce")
        page.keyboard.press("ArrowLeft")
        assert page.locator("[data-mio-enter]").count() == 0
        set_mode(page, "单页")
        page.keyboard.press("Home")
        page.keyboard.press("ArrowLeft")
        expect(page.locator(".mio-progress")).to_have_text(f"2 / {count}")
        if page.viewport_size["width"] == 390:
            swipe(page, right=True)
            expect(page.locator(".mio-progress")).to_have_text(f"3 / {count}")
            details["zine_rtl_touch_swipe"] = "passed"
        select_direction("webtoon")
        assert page.locator("body").get_attribute("data-mio-paged") is None
        expect(page.locator("[data-cc-frame]:visible")).to_have_count(count)
        details["zine_ltr_rtl_webtoon"] = "passed"
    return details


def exercise_reader(page, template: str, example: Example, shots: Path | None, name: str) -> dict:
    from playwright.sync_api import expect

    count = example.count
    details = {}
    set_mode(page, "单页")
    page.keyboard.press("Home")
    expect(page.locator(".mio-progress")).to_have_text(f"1 / {count}")
    expect(page.locator("[data-cc-frame]:visible")).to_have_count(1)
    if count > 1:
        page.keyboard.press("ArrowRight")
        expect(page.locator(".mio-progress")).to_have_text(f"2 / {count}")
        page.get_by_role("button", name="上一页", exact=True).click()
        expect(page.locator(".mio-progress")).to_have_text(f"1 / {count}")
    set_mode(page, "双页")
    expect(page.locator("[data-cc-frame]:visible")).to_have_count(min(2, count))
    details["double_artwork"] = assert_artwork(page, count)
    screenshot(page, shots, name + "-double")
    set_mode(page, "单页")
    page.keyboard.press("Home")
    exercise_lightbox(page, count)
    exercise_lightbox(page, count, keyboard=True)
    if template == "export-contact-sheet":
        exercise_lightbox(page, count, keyboard="Space")
    if example.captions:
        page.get_by_role("button", name="无字", exact=True).click()
        expect(page.locator("[data-cc-caption]:visible")).to_have_count(0)
        page.locator(".cc-image:visible").first.click()
        expect(page.locator(".cc-lightbox figcaption")).to_have_text("")
        page.keyboard.press("Escape")
        page.get_by_role("button", name="无字", exact=True).click()
        assert page.locator("[data-cc-caption]:visible").count() > 0
    if template == "export-contact-sheet":
        details.update(exercise_special(page, template, count))
    if page.viewport_size["width"] == 390 and count > 1:
        set_mode(page, "单页")
        page.keyboard.press("Home")
        swipe(page)
        expect(page.locator(".mio-progress")).to_have_text(f"2 / {count}")
        details["cdp_touch_swipe"] = "passed"
    fullscreen = page.get_by_role("button", name="全屏", exact=True)
    if fullscreen.count():
        fullscreen.click()
        page.wait_for_function("() => document.fullscreenElement !== null")
        fullscreen.click()
        page.wait_for_function("() => document.fullscreenElement === null")
    if template != "export-contact-sheet":
        details.update(exercise_special(page, template, count))
    details["mouse_keyboard_lightbox_focus"] = "passed"
    return details


def exercise_case(
    page, template: str, scenario: str, example: Example, shots, name, directory_only, result
):
    from playwright.sync_api import expect

    page.goto(example.path.as_uri(), wait_until="load")
    result["stage"] = "initial-artwork"
    result["artwork"] = assert_artwork(page, example.count)
    expected_visible = example.count
    if template == "export-nocturne":
        expected_visible = 1
    elif template == "export-folio":
        expected_visible = min(
            len(example.books[0].frames), 2 if page.viewport_size["width"] > 680 else 1
        )
    assert result["artwork"]["visible"] == expected_visible, result["artwork"]
    result["stage"] = "interchange-payload"
    result["payload"] = assert_payload(page, example)
    result["stage"] = "inert-text"
    expect(page.locator(".album-xss")).to_have_count(0)
    assert page.evaluate("() => window.albumXss === undefined")
    if not example.captions:
        expect(page.locator("[data-cc-caption]:visible")).to_have_count(0)
        expect(page.locator("[data-cc-prompt]:visible")).to_have_count(0)
    result["stage"] = "directory"
    result["directory"] = exercise_directory(page, example.count, shots, name)
    if scenario in ("sixty", "one-twenty") and template in (
        "export-monograph",
        "export-zine",
        "export-contact-sheet",
    ):
        result["stage"] = "manual-scroll-after-explicit-navigation"
        page.get_by_role("button", name="目录", exact=True).click()
        page.locator(".mio-thumbnails button").last.click()
        settle(page)
        expect(page.locator(".mio-progress")).to_have_text(f"{example.count} / {example.count}")
        page.mouse.move(10, 350)
        page.mouse.wheel(0, -1000)
        page.wait_for_function(
            "last=>document.querySelector('.mio-progress').value!==last",
            arg=f"{example.count} / {example.count}",
        )
        result["manual_scroll_updates_progress"] = "passed"
    if directory_only:
        return result
    if scenario == "sample":
        result["stage"] = "reader-interactions"
        result["reader"] = exercise_reader(page, template, example, shots, name)
    else:
        result["stage"] = "end-home-navigation"
        set_mode(page, "单页")
        page.keyboard.press("End")
        expect(page.locator(".mio-progress")).to_have_text(f"{example.count} / {example.count}")
        result["last_artwork"] = assert_artwork(page, example.count)
        page.keyboard.press("Home")
        expect(page.locator(".mio-progress")).to_have_text(f"1 / {example.count}")
        if scenario == "ultra-ratios":
            exercise_lightbox(page, example.count)
            page.keyboard.press("ArrowRight")
            result["portrait_artwork"] = assert_artwork(page, example.count)
    screenshot(page, shots, name)
    result["stage"] = "completed"
    return result


def run(
    browser_path,
    shots,
    widths=None,
    directory_only=False,
    templates=None,
    scenarios=None,
    failed_report=None,
):
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
    scenarios = scenarios or (["sample"] if directory_only else list(SCENARIOS))
    replay = None
    if failed_report:
        previous = json.loads(failed_report.read_text(encoding="utf-8"))
        replay = {
            (case["template"], case["scenario"], case["width"], case["theme"])
            for case in previous["cases"]
            if case["status"] == "failed"
        }
    results = []
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="mio-album-check-") as temporary:
        files = export_examples(Path(temporary), scenarios)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=executable, headless=True)
            version = browser.version
            try:
                for width in widths or (1440, 390):
                    for theme in ("light", "dark"):
                        context = browser.new_context(
                            viewport={"width": width, "height": 900 if width == 1440 else 844},
                            color_scheme=theme,
                            reduced_motion="reduce",
                            service_workers="block",
                        )
                        try:
                            for template in templates or TEMPLATES:
                                for scenario in scenarios:
                                    if (
                                        replay is not None
                                        and (template, scenario, width, theme) not in replay
                                    ):
                                        continue
                                    name = f"{template}-{scenario}-{width}-{theme}"
                                    case = {
                                        "template": template,
                                        "scenario": scenario,
                                        "width": width,
                                        "height": 900 if width == 1440 else 844,
                                        "theme": theme,
                                    }
                                    page = context.new_page()
                                    page.set_default_timeout(5000)
                                    errors, external = [], []
                                    page.on("pageerror", lambda error: errors.append(str(error)))
                                    page.on(
                                        "console",
                                        lambda msg: (
                                            errors.append(msg.text) if msg.type == "error" else None
                                        ),
                                    )

                                    def route(request):
                                        if request.request.url.startswith(
                                            ("file:", "data:", "blob:")
                                        ):
                                            request.continue_()
                                        else:
                                            external.append(request.request.url)
                                            request.abort()

                                    page.route("**/*", route)
                                    try:
                                        case.update(
                                            exercise_case(
                                                page,
                                                template,
                                                scenario,
                                                files[template, scenario],
                                                shots,
                                                name,
                                                directory_only,
                                                case,
                                            )
                                        )
                                        assert not errors, errors
                                        assert not external, external
                                        case["status"] = "passed"
                                    except Exception as exc:
                                        case.update(
                                            status="failed", error=str(exc), failure_url=page.url
                                        )
                                        screenshot(page, shots, name + "-failure")
                                    finally:
                                        case["page_errors"] = errors
                                        case["external_requests"] = external
                                        page.close()
                                    results.append(case)
                                    print(f"{case['status']}: {name}", file=sys.stderr, flush=True)
                        finally:
                            context.close()
            finally:
                browser.close()
    return {
        "browser": executable,
        "browser_version": version,
        "sample": TITLE,
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "cases": results,
        "passed": sum(case["status"] == "passed" for case in results),
        "failed": sum(case["status"] == "failed" for case in results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser")
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument(
        "--report", type=Path, help="Optional JSON report; no album data is included"
    )
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    parser.add_argument("--template", choices=TEMPLATES, action="append")
    parser.add_argument("--scenario", choices=SCENARIOS, action="append")
    parser.add_argument("--directory-only", action="store_true")
    parser.add_argument(
        "--failed-report", type=Path, help="Replay only failures from a JSON report"
    )
    args = parser.parse_args()
    report = run(
        args.browser,
        args.screenshots,
        args.width,
        args.directory_only,
        args.template,
        args.scenario,
        args.failed_report,
    )
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(text + "\n", encoding="utf-8")
    print(text)
    return int(report["failed"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
