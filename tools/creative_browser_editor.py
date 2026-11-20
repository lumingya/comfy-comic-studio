"""Create and edit a real storyboard, then render an explicitly assembled fake image task."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

from creative_browser_common import (
    WORKFLOW_ID,
    WORKSHOP_ID,
    assert_fit,
    fixture,
    get_json,
    screenshot,
)


def endpoint(response, method: str, path: str) -> bool:
    return response.request.method == method and urlsplit(response.url).path == path


def exercise_editor(page, origin: str, shots: Path | None, name: str, evidence) -> dict:
    from playwright.sync_api import expect

    page.goto(origin + "/workshop/story", wait_until="networkidle")
    page.get_by_role("button", name="新建分镜", exact=True).click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("textbox").fill("雨后创作链路")
    with page.expect_response(
        lambda response: endpoint(response, "POST", f"/api/series/{WORKSHOP_ID}/episodes")
    ) as created:
        dialog.get_by_role("button", name="新建", exact=True).click()
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
    expect(page.locator("button.cast-chip").filter(has_text="舟白")).to_have_attribute(
        "aria-pressed", "false"
    )
    prompt.fill("{林")
    expect(page.get_by_role("listbox")).to_be_visible()
    expect(page.get_by_role("listbox")).to_contain_text("设定集 · 林夏")
    assert_fit(page, "#prompt-completion")
    prompt.press("Enter")
    expect(prompt).to_have_value("{林夏}")
    prompt.fill("{林夏}, wearing {wardrobe}, neutral courtyard")
    page.locator("#workshop-frame-caption").fill("The rain is over.")
    source = get_json(page, origin, f"/api/episodes/{episode_id}")
    panel_id = source["panels"][0]["id"]
    patch_path = f"/api/episodes/{episode_id}/panels/{panel_id}"
    with page.expect_response(lambda response: endpoint(response, "PATCH", patch_path)) as saved:
        prompt.press("Control+s")
    assert saved.value.ok
    source = get_json(page, origin, f"/api/episodes/{episode_id}")
    assert [entry["character_id"] for entry in source["panels"][0]["characters"]] == [
        "creative-navigator"
    ]
    page.get_by_text("变量展开预览", exact=True).click()
    page.get_by_role("button", name="补齐 {wardrobe}", exact=True).click()
    variable = page.get_by_role("dialog", name="补齐本幕变量", exact=True)
    field = page.locator("#panel-variable-value")
    before = len(evidence.matching("PATCH", patch_path))
    field.fill("white jacket")
    assert len(evidence.matching("PATCH", patch_path)) == before, (
        "Typing a variable must not save it"
    )
    conflict = fixture(page, origin, f"source-conflict?episode_id={episode_id}")
    evidence.expected_conflicts.add(patch_path)
    with page.expect_response(lambda response: endpoint(response, "PATCH", patch_path)) as refused:
        variable.get_by_role("button", name="保存", exact=True).click()
    assert refused.value.status == 409
    expect(field).to_have_value("white jacket")
    expect(variable.get_by_role("button", name="保存", exact=True)).to_be_disabled()
    variable.get_by_role("button", name="重新读取", exact=True).click()
    expect(variable).to_contain_text("当前值：server blue")
    expect(field).to_have_value("white jacket")
    with page.expect_response(lambda response: endpoint(response, "PATCH", patch_path)) as repaired:
        variable.get_by_role("button", name="保存", exact=True).click()
    assert repaired.value.ok
    body = evidence.matching("PATCH", patch_path)[-1]["body"]
    assert body["revision"] == conflict["revision"]
    assert body["changes"]["overrides"]["values"]["$wardrobe"] == "white jacket"
    expect(variable).to_have_count(0)
    workshop = get_json(page, origin, f"/api/series/{WORKSHOP_ID}")
    assert workshop["variables"]["wardrobe"] == "" and len(workshop["bible"]["characters"]) == 2
    preview_path = f"/api/episodes/{episode_id}/panels/{panel_id}/prompt"
    assert not evidence.matching("GET", preview_path), "Reference discovery must remain on demand"
    with page.expect_response(lambda response: endpoint(response, "GET", preview_path)) as preview:
        page.get_by_role("button", name="预览参考图来源", exact=True).click()
    reference = preview.value.json()["references"]
    assert (
        len(reference) == 1
        and reference[0]["owner"] == "creative-navigator"
        and reference[0]["role"] == "front"
    )
    ref_dialog = page.get_by_role("dialog", name="预览参考图来源", exact=True)
    expect(ref_dialog.get_by_role("img", name="林夏 · front")).to_be_visible()
    expect(ref_dialog).to_contain_text(reference[0]["reason"])
    screenshot(page, shots, name + "-references")
    page.keyboard.press("Escape")
    page.locator("summary").filter(has_text="此幕画面参数").click()
    page.locator("summary").filter(has_text="本幕的 LoRA").click()
    page.get_by_label("覆写适用的工作流", exact=True).select_option(WORKFLOW_ID)
    page.get_by_role("combobox", name="neutral-a.safetensors", exact=True).select_option("off")
    expect(page.get_by_role("combobox", name="neutral-b.safetensors", exact=True)).to_have_value(
        "inherit"
    )
    with page.expect_response(lambda response: endpoint(response, "PATCH", patch_path)) as lora:
        prompt.press("Control+s")
    assert lora.value.ok
    source = get_json(page, origin, f"/api/episodes/{episode_id}")
    override = source["panels"][0]["overrides"]["slot_overrides"]
    loras = [entry for group in override["groups"] for entry in group["loras"]]
    assert (
        len(loras) == 1
        and loras[0]["name"] == "neutral-a.safetensors"
        and loras[0]["enabled"] is False
    )
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    screenshot(page, shots, name + "-storyboard")
    return create_rendered_album(page, origin, episode_id, evidence, shots, name)


def create_rendered_album(page, origin, storyboard_id, evidence, shots, name):
    from playwright.sync_api import expect

    page.goto(f"{origin}/workshop/assembly?story={storyboard_id}", wait_until="networkidle")
    dialog = page.get_by_role("dialog", name="新建生成任务", exact=True)
    expect(dialog).to_be_visible()
    dialog.get_by_label("出图工作流或云端服务", exact=True).select_option(f"workflow:{WORKFLOW_ID}")
    dialog.get_by_label("每幕生成张数", exact=True).fill("2")
    dialog.locator("summary").filter(has_text="本次任务的 LoRA").click()
    first = (
        dialog.locator(".lora-toggle-row")
        .filter(has_text="neutral-a.safetensors")
        .get_by_role("checkbox")
    )
    second = (
        dialog.locator(".lora-toggle-row")
        .filter(has_text="neutral-b.safetensors")
        .get_by_role("checkbox")
    )
    first.uncheck()
    expect(second).to_be_checked()
    dialog.get_by_role("button", name="下一步", exact=True).click()
    dialog.get_by_role("button", name="下一步", exact=True).click()
    with page.expect_response(
        lambda response: endpoint(response, "POST", "/api/workshop/assemble")
    ) as assembled:
        dialog.get_by_role("button", name="稍后生成", exact=True).click()
    assert assembled.value.ok
    made = assembled.value.json()
    episode_id, series_id = made["episode"]["id"], made["series"]["id"]
    page.goto(f"{origin}/workshop/assembly/{episode_id}/board", wait_until="networkidle")
    assert not page.locator(".take[data-selection-id]").count()
    with page.expect_response(
        lambda response: endpoint(response, "POST", f"/api/episodes/{episode_id}/render")
    ) as rendered:
        page.get_by_role("button", name="全部生成", exact=True).click()
    assert rendered.value.ok
    expect(page.locator(".take[data-selection-id]")).to_have_count(2, timeout=20000)
    current = get_json(page, origin, f"/api/episodes/{episode_id}")
    assert all(take["status"] == "candidate" for take in current["takes"]), (
        "Render must not silently adopt"
    )
    take_id = page.locator(".take[data-selection-id]").first.get_attribute("data-selection-id")
    with page.expect_response(
        lambda response: endpoint(
            response, "POST", f"/api/episodes/{episode_id}/takes/{take_id}/adopt"
        )
    ) as adopted:
        page.locator(".take[data-selection-id]").first.get_by_role(
            "button", name="采用", exact=True
        ).click()
    assert adopted.value.ok
    state = get_json(page, origin, "/__creative_fixture/state")
    assert len(state["graphs"]) == 2
    for graph in state["graphs"]:
        assert graph["first"]["strength_model"] == graph["first"]["strength_clip"] == 0
        assert graph["second"]["strength_model"] == 0.6 and graph["second"]["strength_clip"] == 0.4
        assert "white jacket" in graph["prompt"] and "neutral courtyard" in graph["prompt"]
    original = get_json(page, origin, f"/api/workflows/{WORKFLOW_ID}")["graph"]
    assert original["2"]["inputs"]["strength_model"] == 0.75
    assert not get_json(page, origin, f"/api/episodes/{storyboard_id}")["takes"]
    page.goto(f"{origin}/gallery/{series_id}/layout", wait_until="networkidle")
    with page.expect_response(
        lambda response: endpoint(response, "POST", f"/api/episodes/{episode_id}/strip/layout")
    ) as layout:
        page.get_by_role("button", name="自动排版", exact=True).click()
    assert layout.value.ok
    expect(page.locator(".konvajs-content")).to_be_visible()
    screenshot(page, shots, name + "-generated-canvas")
    return {
        "editor": "passed",
        "new_storyboard": True,
        "variable_CAS": "passed",
        "references": 1,
        "independent_loras": "passed",
        "mock_candidates": 2,
        "explicit_adoption": "passed",
        "canvas_chain": "passed",
    }
