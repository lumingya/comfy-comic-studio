"""Real candidate board interactions for the disposable creative browser check."""

from __future__ import annotations

from pathlib import Path

from creative_browser_common import EPISODE_ID, assert_fit, screenshot


def exercise_board(page, origin: str, shots: Path | None, name: str) -> dict:
    from playwright.sync_api import expect

    writes = []
    page.on(
        "request",
        lambda request: (
            writes.append(request.url.split("?")[0])
            if request.method == "POST" and "/takes/" in request.url
            else None
        ),
    )
    page.goto(f"{origin}/workshop/assembly/{EPISODE_ID}/board", wait_until="networkidle")
    expect(page.locator(".take[data-selection-id]")).to_have_count(9)
    expect(page.locator("html")).to_have_attribute("data-theme", name.rsplit("-", 1)[-1])
    page.get_by_role("switch", name="未采用分幕", exact=True).click()
    expect(page.locator(".board-row")).to_have_count(2)
    expect(page.locator(".panel-no")).to_have_text(["02", "03"])
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    screenshot(page, shots, name + "-board")
    page.locator(".take-image").first.click()
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()
    page.keyboard.press("c")
    expect(page.locator(".board-compare-side")).to_have_count(2)
    left = page.get_by_role("img", name="固定候选", exact=True)
    right = page.get_by_role("img", name="浏览候选", exact=True)
    expect(left).to_have_js_property("complete", True)
    expect(right).to_have_js_property("complete", True)
    first_left, first_right = left.get_attribute("src"), right.get_attribute("src")
    assert "?" not in first_left and "?" not in first_right
    page.keyboard.press("ArrowRight")
    expect(right).not_to_have_attribute("src", first_right)
    expect(left).to_have_attribute("src", first_left)
    page.keyboard.press("ArrowRight")
    expect(right).to_have_attribute("src", first_right)
    assert not writes, "Opening or browsing a comparison wrote candidate state"
    bounds = assert_fit(page, "#board-zoom")
    assert page.locator("#board-zoom").evaluate("d => d.scrollWidth <= d.clientWidth")
    screenshot(page, shots, name + "-compare")
    page.get_by_role("button", name="原图细节", exact=True).click()
    expect(page.locator(".board-compare")).to_have_attribute("data-detail", "true")
    dimensions = page.locator(".board-compare-viewport").evaluate_all(
        """items => items.map(view => {
        const image=view.querySelector('img'), rect=image.getBoundingClientRect();
        return {width:rect.width,height:rect.height,naturalWidth:image.naturalWidth,
          naturalHeight:image.naturalHeight,viewportWidth:view.clientWidth,
          scrollWidth:view.scrollWidth,scrollHeight:view.scrollHeight};
        })"""
    )
    for image in dimensions:
        assert image["width"] == image["naturalWidth"] == 960, image
        assert image["height"] == image["naturalHeight"] == 1280, image
        assert image["scrollWidth"] > image["viewportWidth"], image
    left_view = page.get_by_role("region", name="固定候选", exact=True)
    left_view.focus()
    page.keyboard.press("ArrowRight")
    expect(right).to_have_attribute("src", first_right)
    screenshot(page, shots, name + "-detail")
    page.keyboard.press("1")
    page.keyboard.press("a")
    expect(page.get_by_role("button", name="已采用", exact=True)).to_be_disabled()
    assert len(writes) == 1 and writes[0].endswith("/creative-take-1-2/adopt"), writes
    page.get_by_role("button", name="2 浏览候选", exact=True).click()
    page.keyboard.press("x")
    expect(page.get_by_role("button", name="撤销弃用", exact=True)).to_be_visible()
    assert len(writes) == 2 and writes[1].endswith("/creative-take-1-1/reject"), writes
    page.keyboard.press("c")
    expect(page.locator(".board-compare")).to_have_count(0)
    page.keyboard.press("Escape")
    expect(dialog).to_have_count(0)
    expect(page.locator(".board-row")).to_have_count(1)
    expect(page.locator(".panel-no")).to_have_text(["03"])
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    return {"board": "passed", "dialog_bounds": bounds, "originals": dimensions, "writes": 2}
