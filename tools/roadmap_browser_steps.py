"""Real, local browser acceptance steps for shelf collections and storyboard authoring."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from creative_browser_common import EPISODE_ID, WORKSHOP_ID, assert_fit, get_json, screenshot


def exercise_collections(page, origin: str, shots: Path | None, name: str, evidence) -> dict:
    from playwright.sync_api import expect

    path = "/api/collections/memberships"
    page.goto(origin + "/gallery?q=合集验收", wait_until="networkidle")
    page.get_by_role("button", name="紧凑网格", exact=True).click()
    page.locator("#gallery-sort").select_option("createdAt")
    cards = page.locator('.shelf-item[data-shelf-id^="roadmap-shelf-"]')
    expect(cards).to_have_count(3)
    visible_ids = [item.get_attribute("data-shelf-id") for item in cards.all()]
    collections = {}
    for title in ("短篇", "长篇"):
        page.get_by_role("button", name="新建合集", exact=True).click()
        dialog = page.get_by_role("dialog", name="新建合集", exact=True)
        dialog.get_by_role("textbox", name="合集名称", exact=True).fill(title)
        with page.expect_response(
            lambda response: (
                response.request.method == "POST"
                and urlsplit(response.url).path == "/api/collections"
            )
        ) as created:
            dialog.get_by_role("button", name="保存", exact=True).click()
        assert created.value.ok
        collections[title] = created.value.json()["id"]
        expect(dialog).to_have_count(0)

    def cover(identifier):
        return page.locator(f'[data-shelf-id="{identifier}"] [data-shelf-open]').first

    def lift(identifier, title):
        target = page.locator(f'[data-shelf-collection="{collections[title]}"]')
        target.scroll_into_view_if_needed()
        source = cover(identifier)
        source.scroll_into_view_if_needed()
        box = source.bounding_box()
        assert box
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 7, y, steps=2)
        expect(page.locator(".shelf-drag-ghost")).to_be_visible()
        target_box = target.bounding_box()
        assert target_box
        if target_box["y"] < 0:
            main = page.locator("main").bounding_box()
            assert main
            page.mouse.move(x, max(0, main["y"]) + 5, steps=8)
            page.wait_for_function(
                "el => { const r = el.getBoundingClientRect(); "
                "return r.top >= 0 && r.bottom <= innerHeight; }",
                arg=target.element_handle(),
                timeout=5000,
            )
        target_box = target.bounding_box()
        assert target_box
        page.mouse.move(
            target_box["x"] + target_box["width"] / 2,
            target_box["y"] + target_box["height"] / 2,
            steps=12,
        )
        expect(target).to_have_class(re.compile(r"is-collection-drop-target"))

    def release():
        with page.expect_response(
            lambda response: (
                response.request.method == "POST" and urlsplit(response.url).path == path
            )
        ) as moved:
            page.mouse.up()
        assert moved.value.ok
        expect(page.locator(".shelf-drag-ghost")).to_have_count(0)
        return moved.value.json()

    def undo():
        with page.expect_response(
            lambda response: (
                response.request.method == "POST" and urlsplit(response.url).path == path
            )
        ) as undone:
            page.locator(".toasts").get_by_role("button", name="撤销", exact=True).last.click()
        assert undone.value.ok
        return undone.value.json()

    lift(visible_ids[0], "短篇")
    single = release()
    assert [entry["series_id"] for entry in single["changes"]] == [visible_ids[0]]
    assert single["changes"][0]["after"]["collection_id"] == collections["短篇"]
    assert not parse_qs(urlsplit(page.url).query).get("collection")
    page.locator(f'[data-shelf-collection="{collections["短篇"]}"]').click()
    expect(cards).to_have_count(1)
    page.get_by_role("button", name="精选展示", exact=True).click()
    expect(page.locator(".shelf-exhibit")).to_have_count(1)
    lift(visible_ids[0], "长篇")
    showcase = release()
    assert showcase["changes"][0]["before"]["collection_id"] == collections["短篇"]
    assert showcase["changes"][0]["after"]["collection_id"] == collections["长篇"]
    expect(page.locator(".shelf-exhibit")).to_have_count(0)
    restored = undo()
    assert restored["changes"][0]["after"]["collection_id"] == collections["短篇"]
    expect(page.locator(".shelf-exhibit")).to_have_count(1)
    cover(visible_ids[0]).click()
    expect(page.locator(".room-head")).to_be_visible()
    assert parse_qs(urlsplit(page.url).query).get("collection") == [collections["短篇"]]
    page.locator(".room-head button").first.click()
    expect(page.locator(".room-head")).to_have_count(0)
    assert urlsplit(page.url).path == "/gallery"
    assert parse_qs(urlsplit(page.url).query).get("collection") == [collections["短篇"]]
    expect(page.locator(".shelf-exhibit")).to_have_count(1)
    page.get_by_role("tab", name=re.compile(r"^全部\s*\d+$")).click()
    page.get_by_role("button", name="紧凑网格", exact=True).click()
    expect(cards).to_have_count(3)
    for identifier in reversed(visible_ids[:2]):
        cover(identifier).click(modifiers=["Control"])
    selected = page.locator('[data-shelf-id][aria-selected="true"]')
    expect(selected).to_have_count(2)
    lift(visible_ids[1], "长篇")
    expect(page.locator(".shelf-drag-ghost")).to_have_attribute("data-count", "2")
    screenshot(page, shots, name + "-collection-drag")
    group = release()
    assert [entry["series_id"] for entry in group["changes"]] == visible_ids[:2]
    assert all(entry["after"]["collection_id"] == collections["长篇"] for entry in group["changes"])
    undo_result = undo()
    assert [entry["after"]["collection_id"] for entry in undo_result["changes"]] == [
        entry["before"]["collection_id"] for entry in group["changes"]
    ]
    undo_body = evidence.matching("POST", path)[-1]["body"]["assignments"]
    assert [entry["expected_revision"] for entry in undo_body] == [
        entry["after"]["revision"] for entry in group["changes"]
    ]
    before_escape = len(evidence.matching("POST", path))
    lift(visible_ids[0], "短篇")
    page.keyboard.press("Escape")
    page.mouse.up()
    expect(page.locator(".shelf-drag-ghost,.is-collection-drop-target")).to_have_count(0)
    expect(selected).to_have_count(2)
    page.keyboard.press("Escape")
    expect(selected).to_have_count(0)
    assert len(evidence.matching("POST", path)) == before_escape

    coarse = page.evaluate("matchMedia('(pointer: coarse)').matches")
    source = cover(visible_ids[0] if coarse else visible_ids[2])
    if not coarse:
        source.scroll_into_view_if_needed()
    scroll_container = source.evaluate_handle(
        """el => {
            for (let parent = el.parentElement; parent; parent = parent.parentElement) {
                if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)
                    && parent.scrollHeight > parent.clientHeight) return parent;
            }
            return document.scrollingElement;
        }"""
    )
    if coarse:
        bounds = source.bounding_box()
        assert bounds
        page.mouse.move(bounds["x"] + bounds["width"] / 2, min(bounds["y"] + 20, 700))
        page.mouse.wheel(0, -5000)
        page.wait_for_function("el => el.scrollTop === 0", arg=scroll_container)
        assert scroll_container.evaluate("el => el.scrollHeight > el.clientHeight"), (
            scroll_container.evaluate(
                "el => ({tag: el.tagName, id: el.id, "
                "height: el.clientHeight, content: el.scrollHeight})"
            )
        )
    box = source.bounding_box()
    assert box
    scroll_before = scroll_container.evaluate("el => el.scrollTop")
    session = page.context.new_cdp_session(page)
    touch = {
        "x": box["x"] + box["width"] / 2,
        "y": min(box["y"] + box["height"] / 2, page.viewport_size["height"] - 40),
    }
    assert touch["y"] > box["y"] and touch["y"] > 200
    session.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [touch]})
    for step in range(1, 9):
        session.send(
            "Input.dispatchTouchEvent",
            {
                "type": "touchMove",
                "touchPoints": [{"x": touch["x"], "y": touch["y"] - step * 20}],
            },
        )
    session.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    session.detach()
    if coarse:
        page.wait_for_function(
            "({el, before}) => el.scrollTop > before",
            arg={"el": scroll_container, "before": scroll_before},
        )
    scroll_delta = scroll_container.evaluate("el => el.scrollTop") - scroll_before
    assert not coarse or scroll_delta > 0, "Touch swipe must actually scroll the mobile shelf"
    expect(page.locator(".shelf-drag-ghost")).to_have_count(0)
    assert len(evidence.matching("POST", path)) == before_escape
    if coarse:
        page.get_by_role("button", name="批量管理", exact=True).click()
        cover(visible_ids[2]).click()
    else:
        cover(visible_ids[2]).click(modifiers=["Control"])
    expect(selected).to_have_count(1)
    trigger = page.get_by_role("button", name="移至合集", exact=True)
    trigger.focus()
    page.keyboard.press("Enter")
    menu = page.get_by_role("menu")
    expect(menu).to_be_visible()
    expect(menu.get_by_role("menuitem", name="未归类", exact=True)).to_be_focused()
    page.keyboard.press("ArrowDown")
    expect(menu.get_by_role("menuitem", name="短篇", exact=True)).to_be_focused()
    with page.expect_response(
        lambda response: response.request.method == "POST" and urlsplit(response.url).path == path
    ) as keyboard_move:
        page.keyboard.press("Enter")
    assert keyboard_move.value.ok
    keyboard_change = keyboard_move.value.json()["changes"]
    assert [entry["series_id"] for entry in keyboard_change] == [visible_ids[2]]
    assert keyboard_change[0]["after"]["collection_id"] == collections["短篇"]
    expect(selected).to_have_count(1)
    screenshot(page, shots, name + "-collection-keyboard")
    return {
        "collections": 2,
        "single_drag": True,
        "Showcase_single_drag": True,
        "reader_return_keeps_collection": True,
        "stable_group_order": visible_ids[:2],
        "counted_ghost": 2,
        "undo_CAS": True,
        "escape_layers": True,
        "touch_swipe_without_move": True,
        "touch_scroll_delta": scroll_delta,
        "explicit_keyboard_move": True,
        "selection_mode": "touch-bulk" if coarse else "desktop-multiselect",
        "viewport": page.viewport_size,
    }


def exercise_completion(page, origin: str, shots: Path | None, name: str, evidence) -> dict:
    from playwright.sync_api import expect

    page.goto(origin + "/workshop/story", wait_until="networkidle")
    page.get_by_role("button", name="新建分镜", exact=True).click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("textbox").fill("本地补全验收")
    with page.expect_response(
        lambda response: (
            response.request.method == "POST"
            and urlsplit(response.url).path == f"/api/series/{WORKSHOP_ID}/episodes"
        )
    ) as created:
        dialog.get_by_role("button", name="新建", exact=True).click()
    assert created.value.ok
    episode_id = created.value.json()["id"]
    prompt = page.locator("#workshop-frame-prompt")
    expect(prompt).to_be_visible()
    page.get_by_text("设定与参考图", exact=True).click()
    search = page.get_by_role("searchbox", name="搜索角色", exact=True)
    search.fill("navigator")
    search.press("Enter")
    expect(page.locator("button.cast-chip").filter(has_text="林夏")).to_have_attribute(
        "aria-pressed", "true"
    )
    prompt.fill("")
    prompt.press_sequentially("{")
    popup = page.get_by_role("listbox", name="变量补全", exact=True)
    expect(popup).to_be_visible()
    expect(popup.get_by_role("option").nth(1)).to_be_visible()
    active = popup.locator('[role="option"][aria-selected="true"] .key')
    expect(active).to_have_text(re.compile(r"^\{.+\}$"))
    first = active.inner_text()
    prompt.press("ArrowDown")
    expect(active).not_to_have_text(first)
    prompt.press("ArrowUp")
    expect(active).to_have_text(first)
    assert_fit(page, "#prompt-completion")
    screenshot(page, shots, name + "-completion-popup")
    prompt.press("Enter")
    expect(prompt).to_have_value(first)
    expect(popup).to_have_count(0)
    prompt.fill("{ward")
    expect(popup).to_contain_text("{wardrobe}")
    prompt.press("Tab")
    expect(prompt).to_have_value("{wardrobe}")
    expect(prompt).to_be_focused()
    expect(popup).to_have_count(0)
    prompt.fill("")
    prompt.press_sequentially("{")
    expect(popup).to_be_visible()
    prompt.press("Escape")
    expect(popup).to_have_count(0)
    expect(prompt).to_have_value("{")
    expect(prompt).to_be_focused()

    caption = page.locator("#workshop-frame-caption")
    caption.fill("{林")
    expect(popup).to_contain_text("{林夏}")
    assert_fit(page, "#prompt-completion")
    caption.press("Tab")
    expect(caption).to_have_value("{林夏}")
    expect(caption).to_be_focused()
    caption.press("Tab")
    expect(caption).not_to_be_focused()
    prompt.fill("")
    prompt.press_sequentially("{")
    expect(popup).to_be_visible()
    session = page.context.new_cdp_session(page)
    session.send("Input.imeSetComposition", {"text": "林", "selectionStart": 1, "selectionEnd": 1})
    expect(popup).to_have_count(0)
    ime_before_enter = prompt.input_value()
    assert "林" in ime_before_enter
    page.keyboard.press("Enter")
    ime_after_enter = prompt.input_value()
    assert "{林夏}" not in ime_after_enter, "IME Enter must not accept a completion"
    session.send("Input.insertText", {"text": "林"})
    session.detach()
    assert "林" in prompt.input_value()
    expect(page.locator(".workshop-frames-list [data-selection-id]")).to_have_count(1)
    prompt.fill("neutral courtyard {wardrobe}")
    caption.fill("本地输入验收完成。")
    source = get_json(page, origin, f"/api/episodes/{episode_id}")
    panel_id = source["panels"][0]["id"]
    path = f"/api/episodes/{episode_id}/panels/{panel_id}"
    with page.expect_response(
        lambda response: response.request.method == "PATCH" and urlsplit(response.url).path == path
    ) as saved:
        caption.press("Control+s")
    assert saved.value.ok
    expect(page.locator(".workshop-page .save-state.saved")).to_be_visible()
    source = get_json(page, origin, f"/api/episodes/{episode_id}")
    assert source["panels"][0]["overrides"]["raw_prompt"] == "neutral courtyard {wardrobe}"
    assert source["panels"][0]["dialogues"][0]["text"] == "本地输入验收完成。"
    screenshot(page, shots, name + "-completion-saved")
    return {
        "episode_id": episode_id,
        "arrow_navigation": True,
        "enter_accept": first,
        "tab_accept_prompt": "{wardrobe}",
        "tab_accept_caption": "{林夏}",
        "tab_focus_after_completion": True,
        "escape_keeps_text": True,
        "IME_transport": "CDP Input.imeSetComposition",
        "IME_enter_not_completion": True,
        "IME_text_before_enter": ime_before_enter,
        "IME_text_after_enter": ime_after_enter,
        "saved_prompt_and_caption": True,
        "viewport": page.viewport_size,
    }


def exercise_story_import(page, origin: str, shots: Path | None, name: str, evidence) -> dict:
    from playwright.sync_api import expect

    page.goto(f"{origin}/workshop/assembly/{EPISODE_ID}/script", wait_until="networkidle")
    original = get_json(page, origin, f"/api/episodes/{EPISODE_ID}")
    original_ids = {panel["id"] for panel in original["panels"]}
    path = f"/api/episodes/{EPISODE_ID}/panels/import"
    before = len(evidence.matching("POST", path))
    page.get_by_role("button", name="从文本拆幕", exact=True).click()
    dialog = page.get_by_role("dialog", name="从故事文本拆幕", exact=True)
    expect(dialog).to_be_visible()
    text = "\n\n".join(
        f"# 本地分幕{i:03d}\n安静的庭院里，第{i}束阳光照在石阶上。\n旁白：这是第{i}幕的观察。"
        for i in range(1, 121)
    )
    dialog.get_by_role("textbox", name="从故事文本拆幕", exact=True).fill(text)
    expect(dialog.locator(".story-import-preview-head")).to_have_text("预览：120 幕")
    expect(dialog.locator(".story-import-preview > li")).to_have_count(24)
    expect(dialog.locator(".story-import-preview > li").first).to_contain_text("本地分幕001")
    expect(dialog.locator(".story-import-preview > li").first).to_contain_text("这是第1幕的观察。")
    expect(dialog.locator(".story-import-more")).to_contain_text("96")
    assert len(evidence.matching("POST", path)) == before, "Preview must not write panels"
    still_original = get_json(page, origin, f"/api/episodes/{EPISODE_ID}")
    assert still_original["panels"] == original["panels"]
    assert_fit(page, '[role="dialog"]')
    screenshot(page, shots, name + "-storyimport-preview")
    with page.expect_response(
        lambda response: response.request.method == "POST" and urlsplit(response.url).path == path
    ) as imported:
        dialog.get_by_role("button", name="导入 120 幕", exact=True).click()
    assert imported.value.ok
    expect(dialog).to_have_count(0)
    current = get_json(page, origin, f"/api/episodes/{EPISODE_ID}")
    panels = sorted(
        [panel for panel in current["panels"] if panel["id"] not in original_ids],
        key=lambda panel: panel["order"],
    )
    assert len(panels) == 120 and len(current["panels"]) == len(original["panels"]) + 120
    for number, panel in enumerate(panels, 1):
        assert panel["description"] == f"本地分幕{number:03d}"
        assert panel["overrides"]["append_prompt"] == (
            f"安静的庭院里，第{number}束阳光照在石阶上。"
        )
        assert panel["overrides"]["raw_prompt"] is None
        assert panel["dialogues"][0]["text"] == f"这是第{number}幕的观察。"
        assert panel["dialogues"][0]["kind"] == "narration"
    assert original_ids.issubset(panel["id"] for panel in current["panels"])
    assert current["takes"] == original["takes"]
    assert len(evidence.matching("POST", path)) == before + 1
    body = evidence.matching("POST", path)[-1]["body"]
    assert len(body["panels"]) == 120
    screenshot(page, shots, name + "-storyimport-complete")
    return {
        "previewed": True,
        "local_text_split": True,
        "preview_rows": 24,
        "panel_count": 120,
        "import_requests": 1,
        "original_panels_preserved": len(original["panels"]),
        "original_takes_preserved": True,
        "narration_and_visuals_preserved": True,
        "viewport": page.viewport_size,
    }
