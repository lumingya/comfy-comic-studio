"""Real Konva selection, text tools, pacing and conflict checks in an isolated canvas."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlsplit

from creative_browser_common import CANVAS_ID, CANVAS_SERIES, fixture, get_json, screenshot


def endpoint(response, method, path):
    return response.request.method == method and urlsplit(response.url).path == path


def canvas_episode(page, origin):
    return get_json(page, origin, f"/api/episodes/{CANVAS_ID}")


def save_canvas(page):
    from playwright.sync_api import expect

    button = page.locator(".canvas-layout").get_by_role("button", name="保存", exact=True)
    expect(button).to_be_enabled()
    path = f"/api/episodes/{CANVAS_ID}/strip"
    with page.expect_response(lambda response: endpoint(response, "PUT", path)) as saved:
        button.click()
    assert saved.value.ok
    expect(button).to_be_disabled()
    return saved.value.request.post_data_json


def click_canvas(page, x: float, y: float):
    """Hit the real canvas after scrolling the chosen logical point into the viewport."""
    scroll = page.locator(".canvas-scroll")
    scroll.scroll_into_view_if_needed()
    # Initial application scale is 60%; these are actual browser pointer coordinates.
    point = {"x": x * 0.6, "y": y * 0.6}
    scroll.evaluate(
        """(element, point) => {
      element.scrollLeft=Math.max(0,point.x-element.clientWidth/2);
      element.scrollTop=Math.max(0,point.y-element.clientHeight/2);
    }""",
        point,
    )
    box = page.locator(".konvajs-content").bounding_box()
    assert box
    page.mouse.click(box["x"] + point["x"], box["y"] + point["y"])


def exercise_pacing(page, origin, shots, name, evidence):
    from playwright.sync_api import expect

    path = f"/api/episodes/{CANVAS_ID}/pacing/suggest"
    results = {}
    for preset, title in (
        ("compact", "紧凑条漫"),
        ("lyrical", "抒情留白"),
        ("cinematic", "电影宽银幕"),
    ):
        before = canvas_episode(page, origin)
        page.get_by_role("button", name="自动节奏", exact=True).click()
        dialog = page.get_by_role("dialog", name="自动节奏", exact=True)
        with page.expect_response(
            lambda response: endpoint(response, "POST", path) and f"preset={preset}" in response.url
        ) as suggested:
            dialog.get_by_role("combobox").select_option(preset)
        preview = suggested.value.json()
        assert preview["revision"] == before["revision"] and preview["suggestions"]
        assert canvas_episode(page, origin) == before, "Pacing preview must not write the episode"
        expect(dialog.get_by_role("combobox")).to_have_value(preset)
        expect(dialog.get_by_role("combobox")).to_contain_text(title)
        screenshot(page, shots, name + "-pacing-" + preset)
        with page.expect_response(
            lambda response: endpoint(response, "POST", f"/api/episodes/{CANVAS_ID}/strip/layout")
        ) as layout:
            with page.expect_response(
                lambda response: endpoint(
                    response, "POST", f"/api/episodes/{CANVAS_ID}/pacing/apply"
                )
            ) as applied:
                dialog.get_by_role("button", name=re.compile("应用选中的.*格")).click()
        assert applied.value.ok and layout.value.ok
        body = applied.value.request.post_data_json
        assert body["base_revision"] == preview["revision"]
        after = canvas_episode(page, origin)
        by_id = {panel["id"]: panel for panel in after["panels"]}
        for patch in body["patches"]:
            for key, value in patch["changes"].items():
                if value is not None:
                    assert by_id[patch["panel_id"]][key] == value
        actual = by_id[body["patches"][0]["panel_id"]]
        results[preset] = {key: actual[key] for key in ("gap_after", "aspect_ratio", "width_mode")}
    assert results["compact"]["gap_after"] < results["lyrical"]["gap_after"]
    assert results["cinematic"]["aspect_ratio"] == "16:9"
    return results


def exercise_canvas(page, origin: str, shots: Path | None, name: str, evidence) -> dict:
    from playwright.sync_api import expect

    page.goto(f"{origin}/gallery/{CANVAS_SERIES}/layout", wait_until="networkidle")
    expect(page.locator(".konvajs-content")).to_be_visible()
    pacing = exercise_pacing(page, origin, shots, name, evidence)
    fixture(page, origin, "canvas-reset")
    page.reload(wait_until="networkidle")
    expect(page.locator(".konvajs-content")).to_be_visible()
    click_canvas(page, 285, 310)
    expect(page.get_by_label("字号", exact=True)).to_have_value("24")
    page.get_by_text("多选文字与气泡", exact=True).click()
    page.get_by_role("checkbox", name="选择第 2 个文字：Keep", exact=True).check()
    expect(page.get_by_text("已选 2 个文字", exact=True)).to_be_visible()
    screenshot(page, shots, name + "-selected-text")
    names = ("左对齐", "水平居中", "右对齐", "顶对齐", "垂直居中", "底对齐")
    for index, label in enumerate(names):
        before = canvas_episode(page, origin)["strip"]
        page.get_by_role("group", name="对齐", exact=True).get_by_role(
            "button", name=label, exact=True
        ).click()
        sent = save_canvas(page)
        first, second, untouched = sent["lettering"]
        a, b = first["box"], second["box"]
        values = (
            (a[0], b[0]),
            (a[0] + a[2], b[0] + b[2]),
            (a[2], b[2]),
            (a[1], b[1]),
            (a[1] + a[3], b[1] + b[3]),
            (a[3], b[3]),
        )
        assert values[index][0] == values[index][1], (label, a, b)
        assert untouched == before["lettering"][2], "Alignment touched an unselected layer"
        assert canvas_episode(page, origin)["strip"] == sent
        page.get_by_role("button", name="撤销", exact=True).click()
        restored = save_canvas(page)
        assert restored == before, (label, "Undo did not restore the exact strip")
    before = canvas_episode(page, origin)["strip"]
    page.get_by_role("button", name="同步当前文字样式", exact=True).click()
    sent = save_canvas(page)
    assert sent["lettering"][0] == before["lettering"][0]
    assert sent["lettering"][2] == before["lettering"][2]
    assert sent["lettering"][1]["font_size"] == 24 and sent["lettering"][1]["vertical"] is False
    page.get_by_role("button", name="撤销", exact=True).click()
    assert save_canvas(page) == before
    page.get_by_role("checkbox", name="选择第 2 个文字：Keep", exact=True).uncheck()
    strip_path = f"/api/episodes/{CANVAS_ID}/strip"
    writes = len(evidence.matching("PUT", strip_path))
    with page.expect_response(
        lambda response: endpoint(response, "POST", strip_path + "/avoid-lettering")
    ) as avoided:
        page.get_by_role("button", name="避让气泡", exact=True).click()
    preview = avoided.value.json()
    assert preview["unresolved"] == []
    assert preview["strip"]["lettering"][0]["box"] != before["lettering"][0]["box"]
    assert preview["strip"]["lettering"][1:] == before["lettering"][1:]
    assert avoided.value.request.post_data_json["layer_ids"] == ["bubble"]
    assert len(evidence.matching("PUT", strip_path)) == writes
    screenshot(page, shots, name + "-avoidance")
    page.get_by_role("button", name="撤销", exact=True).click()
    expect(
        page.locator(".canvas-layout").get_by_role("button", name="保存", exact=True)
    ).to_be_disabled()
    fixture(page, origin, "canvas-block")
    page.reload(wait_until="networkidle")
    click_canvas(page, 400, 600)
    with page.expect_response(
        lambda response: endpoint(response, "POST", strip_path + "/avoid-lettering")
    ) as blocked:
        page.get_by_role("button", name="避让气泡", exact=True).click()
    no_solution = blocked.value.json()
    assert no_solution["unresolved"] == ["bubble"]
    assert no_solution["strip"] == blocked.value.request.post_data_json["strip"]
    expect(page.get_by_text("1 个气泡没有安全位置，已保留原位", exact=True)).to_be_visible()
    expect(
        page.locator(".canvas-layout").get_by_role("button", name="保存", exact=True)
    ).to_be_disabled()
    click_canvas(page, 20, 20)
    width = page.locator(".canvas-inspector").get_by_label("宽度（像素）", exact=True)
    width.fill("900")
    conflict = fixture(page, origin, "canvas-conflict")
    evidence.expected_conflicts.add(strip_path)
    with page.expect_response(lambda response: endpoint(response, "PUT", strip_path)) as refused:
        page.locator(".canvas-layout").get_by_role("button", name="保存", exact=True).click()
    assert refused.value.status == 409
    assert "base_revision=" in refused.value.request.url
    assert canvas_episode(page, origin)["revision"] == conflict["revision"]
    expect(width).to_have_value("900")
    expect(
        page.locator(".canvas-layout").get_by_role("button", name="保存", exact=True)
    ).to_be_enabled()
    assert canvas_episode(page, origin)["strip"]["width"] == 800
    screenshot(page, shots, name + "-CAS-draft")
    page.get_by_role("button", name="撤销", exact=True).click()
    expect(width).to_have_value("800")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    return {
        "canvas": "passed",
        "pacing": pacing,
        "alignments": 6,
        "style_sync": "passed",
        "undo": "passed",
        "face_avoidance": "passed",
        "no_solution_preserved": True,
        "conflict_draft_preserved": True,
    }
