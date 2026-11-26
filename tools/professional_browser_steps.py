"""User-driven browser scenarios for six opt-in professional extension packages."""

from __future__ import annotations

import re
import time

from playwright.sync_api import expect

from professional_browser_fixture import EPISODE, PACKAGES, SERIES


def center(locator):
    """Keep iframe controls clear of the host's fixed mobile navigation."""
    owner = locator.element_handle().owner_frame()
    if owner.parent_frame:
        owner.frame_element().evaluate(
            "element => element.scrollIntoView({block: 'center', inline: 'nearest'})"
        )
    locator.evaluate("element => element.scrollIntoView({block: 'center', inline: 'nearest'})")
    if owner.parent_frame:
        box = locator.bounding_box()
        assert box, "Control has no visible bounds"
        hit = locator.page.evaluate(
            "point => { const e=document.elementFromPoint(point.x,point.y);"
            "return {tag:e?.tagName, text:e?.textContent?.slice(0,100)} }",
            {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2},
        )
        assert hit["tag"] == "IFRAME", {"bounds": box, "covered_by": hit}
    return locator


def document(page, origin):
    response = page.request.get(f"{origin}/api/episodes/{EPISODE}")
    assert response.ok
    return response.json()


def install(page, origin, archives):
    page.goto(origin + "/extensions?tab=installed", wait_until="domcontentloaded")
    for identifier, archive in archives.items():
        page.locator('input[type="file"][accept=".zip"]').set_input_files(str(archive))
        dialog = page.get_by_role("dialog")
        expect(dialog).to_be_visible()
        assert dialog.evaluate("element => element.scrollWidth <= element.clientWidth + 1")
        digest = dialog.locator(".secret-box").inner_text()
        assert re.fullmatch(r"[a-f0-9]{64}", digest), "Trust dialog must show the actual digest"
        installed = page.request.get(origin + "/api/extensions").json()["items"]
        info = next(item for item in installed if item["id"] == identifier)
        assert info["status"] == "disabled" and info["digest"] == digest, info
        assert not info["builtin"], "Official optional packages must retain digest trust"
        dialog.get_by_role("button", name=re.compile(r"^(信任并启用|Trust and enable)$")).click()
        expect(dialog).to_be_hidden()
        card = page.locator(".ext-card").filter(has=page.locator(".mono", has_text=identifier))
        expect(card.get_by_role("button", name=re.compile(r"^(停用|Disable)$"))).to_be_visible()
    panels = {p["extension"]: p for p in page.request.get(origin + "/api/extension-panels").json()}
    return panels


def open_panel(page, origin, identifier):
    panel_id, title = PACKAGES[identifier]
    page.goto(f"{origin}/workshop/assembly/{EPISODE}/board", wait_until="domcontentloaded")
    menu = page.locator("[data-episode-extension-menu]")
    menu.get_by_role("button", name=re.compile(r"^(扩展|Extensions)$")).click()
    page.get_by_role("menuitem", name=title, exact=True).click()
    expect(page).to_have_url(re.compile(rf"/ext/{re.escape(identifier)}\.{panel_id}$"))
    iframe = page.locator(f'iframe[title="{title}"]')
    expect(iframe).to_be_visible()
    expect(iframe).to_have_attribute("sandbox", "allow-scripts")
    frame = page.frame_locator(f'iframe[title="{title}"]')
    if identifier == "script-assistant":
        expect(frame.locator("#suggest-pacing")).to_be_enabled()
    else:
        expect(frame.locator("#load")).to_be_enabled()
    return frame


def fit(page, frame):
    main = page.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth})")
    nested = frame.locator("body").evaluate("""body => ({width:innerWidth,
        scroll:document.documentElement.scrollWidth,bodyWidth:body.scrollWidth})""")
    assert main["scroll"] <= main["width"] + 1, main
    assert nested["scroll"] <= nested["width"] + 1, nested
    assert nested["bodyWidth"] <= nested["width"] + 1, nested
    clipped = frame.locator("button").evaluate_all("""buttons => buttons.filter(button => {
        const box=button.getBoundingClientRect();
        return box.width && (box.left < -1 || box.right > innerWidth+1 ||
            button.scrollWidth > button.clientWidth+1);
        }).map(button=>({id:button.id,text:button.textContent}))""")
    assert not clipped, clipped
    appearance = frame.locator("html").evaluate("""root => ({
        theme: root.dataset.theme || root.style.colorScheme, lang: root.lang,
        background: getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color})""")
    host = page.locator("html").evaluate("root => ({theme: root.dataset.theme, lang: root.lang})")
    requested_locale = page.evaluate("navigator.language")
    assert host["lang"][:2].lower() == requested_locale[:2].lower(), {
        "requested_locale": requested_locale,
        "host": host,
    }
    assert appearance["theme"] == host["theme"], {"host": host, "panel": appearance}
    assert appearance["lang"].lower().startswith(host["lang"][:2].lower()), appearance
    return {"host": main, "panel": nested, "appearance": appearance}


def image(frame, selector):
    target = frame.locator(selector)
    expect(target).to_have_attribute("src", re.compile(r"^blob:"))
    expect(target).to_have_js_property("naturalWidth", 240)
    expect(target).to_have_js_property("naturalHeight", 320)
    target.evaluate("img => img.decode()")
    return target.evaluate("""img => {const canvas=document.createElement('canvas');
        canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
        const c=canvas.getContext('2d'); c.drawImage(img,0,0);
        return {width:img.naturalWidth,height:img.naturalHeight,
            corner:[...c.getImageData(0,0,1,1).data]};} """)


def wait_job(page, origin, existing, kind):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        jobs = page.request.get(origin + "/api/jobs").json()
        matching = [job for job in jobs if job["id"] not in existing and job["kind"] == kind]
        if matching:
            job = page.request.get(f"{origin}/api/jobs/{matching[0]['id']}").json()
            assert job["state"] not in {"failed", "canceled", "blocked"}, job
            if job["state"] == "completed":
                return job
        page.wait_for_timeout(100)
    raise AssertionError("Explicit fixture job did not complete")


def job_ids(page, origin):
    return {job["id"] for job in page.request.get(origin + "/api/jobs").json()}


def retouch(page, frame, origin, _downloads, _folder):
    initial = document(page, origin)
    ids = job_ids(page, origin)
    frame.locator("#load").click()
    before = image(frame, "#source-image")
    assert before["corner"] == [44, 89, 108, 255]
    frame.locator("#kind").select_option("edit")
    assert "Disabled Edit" not in frame.locator("#profile").inner_text()
    frame.locator("#kind").select_option("inpaint")
    frame.locator('[data-tool="rectangle"]').click()
    canvas = frame.locator("#mask-canvas")
    canvas.scroll_into_view_if_needed()
    box = canvas.bounding_box()
    assert box and box["width"] > 30 and box["height"] > 30, box
    page.mouse.move(box["x"] + box["width"] * 0.2, box["y"] + box["height"] * 0.2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.7, box["y"] + box["height"] * 0.7, steps=8)
    page.mouse.up()
    expect(frame.locator("#undo")).to_be_enabled()
    canvas.press("Control+z")
    expect(frame.locator("#redo")).to_be_enabled()
    canvas.press("Control+Shift+z")
    expect(frame.locator("#clear-mask")).to_be_enabled()
    center(frame.locator("#submit")).click()
    job = wait_job(page, origin, ids, "comfy.render")
    center(frame.locator("#job-refresh")).click()
    expect(frame.locator("#job-state")).to_contain_text(re.compile("已完成|Completed"))
    after = image(frame, "#after-image")
    assert after["corner"] != before["corner"]
    stored = document(page, origin)
    assert (
        next(t for t in stored["takes"] if t["id"] == initial["takes"][0]["id"])["status"]
        == "adopted"
    )
    assert all(t["status"] == "candidate" for t in stored["takes"] if t["job_id"] == job["id"])
    center(frame.locator("#submit")).click()
    expect(frame.locator("#submit")).to_be_enabled()
    assert job_ids(page, origin) == ids | {job["id"]}, (
        "Identical explicit retry created another job"
    )
    center(frame.locator("#compare-slider")).press("End")
    expect(frame.locator("#compare-slider")).to_have_value("100")
    center(frame.locator("#adopt")).click()
    expect(frame.locator("#adopt-confirmation")).to_be_visible()
    frame.locator("#cancel-adopt").press("Escape")
    expect(frame.locator("#adopt-confirmation")).to_be_hidden()
    assert (
        next(t for t in document(page, origin)["takes"] if t["id"] == initial["takes"][0]["id"])[
            "status"
        ]
        == "adopted"
    )
    center(frame.locator("#adopt")).click()
    center(frame.locator("#confirm-adopt")).click()
    expect(frame.locator("#status")).to_contain_text(re.compile("候选已采用|Candidate adopted"))
    adopted = document(page, origin)
    assert next(t for t in adopted["takes"] if t["job_id"] == job["id"])["status"] == "adopted"
    assert (
        next(t for t in adopted["takes"] if t["id"] == initial["takes"][0]["id"])["status"]
        == "candidate"
    )
    return {
        "job": job["state"],
        "source": before,
        "result": after,
        "original_retained_until_explicit_adoption": True,
        "cancel_adoption_preserved_original": True,
        "explicit_adoption": True,
        "mouse_mask_and_keyboard_undo_redo": True,
    }


def finalize(page, frame, origin, _downloads, _folder):
    ids = job_ids(page, origin)
    frame.locator("#load").click()
    before = image(frame, "#source-image")
    frame.locator("#profile").select_option("profile_default")
    expect(frame.locator("#submit")).to_be_disabled()
    selected = frame.locator("#takes input").first
    center(selected).check()
    take_id = selected.input_value()
    expect(frame.locator("#submit")).to_be_disabled()
    center(frame.locator("#consent")).check()
    center(frame.locator("#submit")).click()
    job = wait_job(page, origin, ids, "comfy.render")
    center(frame.locator("#job-refresh")).click()
    expect(frame.locator("#job-state")).to_contain_text(re.compile("已完成|Completed"))
    after = image(frame, "#after-image")
    assert before["corner"] != after["corner"]
    episode = document(page, origin)
    assert next(t for t in episode["takes"] if t["id"] == take_id)["status"] == "candidate"
    result = next(t for t in episode["takes"] if t["job_id"] == job["id"])
    assert result["stage"] == "final" and result["status"] == "adopted"
    assert len(job["items"][0]["input"]["stages"]) == 2
    center(frame.locator("#compare-range")).press("End")
    expect(frame.locator("#compare-range")).to_have_value("90")
    center(frame.locator("#rollback")).click()
    expect(frame.locator("#status")).to_contain_text(
        re.compile("已恢复原草稿|original draft is adopted")
    )
    restored = document(page, origin)
    assert next(t for t in restored["takes"] if t["id"] == take_id)["status"] == "adopted"
    return {
        "stages": 2,
        "consent_required": True,
        "original_retained": True,
        "explicit_rollback": True,
        "result": after,
    }


def qa(page, frame, origin, _downloads, _folder):
    ids = job_ids(page, origin)
    before = {t["id"]: t["status"] for t in document(page, origin)["takes"]}
    frame.locator("#load").click()
    frame.locator('input[value="fixture-p02-1"]').check()
    frame.locator("#review-selected").click()
    expect(frame.locator("#confirmation")).to_be_visible()
    frame.locator("#cancel-action").press("Escape")
    expect(frame.locator("#confirmation")).to_be_hidden()
    assert job_ids(page, origin) == ids, "Canceling confirmation submitted a review"
    frame.locator("#review-selected").click()
    frame.locator("#confirm-action").click()
    job = wait_job(page, origin, ids, "qa.check")
    assert job["snapshot"]["auto_adopt"] is False
    result = job["items"][0]["result"]["qa"]
    lines = job["items"][0]["input"]["panel"]["dialogue"]
    assert lines and lines[0]["speaker"] == "lin" and lines[0]["kind"] == "speech"
    assert result["dialogue_status"] == "assessed"
    assert result["dialogue_score"] == 2 and result["dialogue_votes"] == 3
    assert lines[0]["text"] in result["dialogue_note"]
    assert result["passed"] is False
    assert any("台词契合度" in issue for issue in result["issues"])
    frame.locator("#refresh-job").click()
    expect(frame.locator("#job")).to_contain_text("1/1")
    expect(frame.locator("#takes")).to_contain_text(re.compile("一致性 2/5|identity 2/5", re.I))
    expect(frame.locator("#takes")).to_contain_text(result["dialogue_note"])
    expect(frame.locator("#takes")).to_contain_text(
        re.compile("台词契合度.*2/5|dialogue fit.*2/5", re.I)
    )
    expect(frame.locator("#takes unsafe")).to_have_count(0)
    frame.locator("#issues button").filter(
        has_text=re.compile("一致性|identity", re.I)
    ).first.click()
    expect(frame.locator("article:focus")).to_have_attribute("id", "panel-p02")
    assert before == {t["id"]: t["status"] for t in document(page, origin)["takes"]}
    severities = frame.locator("[data-severity]").evaluate_all(
        "items => items.map(item => item.dataset.severity)"
    )
    assert len(set(severities)) > 1, severities
    frame.locator("#severity-filter").select_option("high")
    expect(frame.locator("[data-severity]")).to_have_count(severities.count("high"))
    expect(frame.locator('[data-severity]:not([data-severity="high"])')).to_have_count(0)
    frame.locator("#severity-filter").select_option("all")
    return {
        "structured_score": True,
        "native_dialogue_score": result["dialogue_score"],
        "dialogue_votes": result["dialogue_votes"],
        "dialogue_explanation_from_model": result["dialogue_note"],
        "issue_location": True,
        "auto_adopt": False,
        "severity_filter": True,
    }


def script(page, frame, origin, _downloads, _folder):
    before = document(page, origin)
    frame.locator("#instruction").fill("Shorten dialogue and keep locked scenes unchanged.")
    frame.locator("#propose").click()
    expect(frame.locator("#ops article")).to_have_count(3)
    expect(frame.locator("#ops input:checked")).to_have_count(0)
    expect(frame.locator("#ops input:disabled")).to_have_count(1)
    expect(frame.locator("#ops")).to_contain_text("The rain has stopped.")
    center(
        frame.locator("#ops article").filter(has_text="The rain has stopped.").locator("input")
    ).check()
    center(frame.locator("#apply")).click()
    expect(frame.locator("#status")).to_contain_text(re.compile("已应用 1 条|Applied 1"))
    stored = document(page, origin)
    assert stored["panels"][1]["dialogues"][0]["text"] == "The rain has stopped."
    assert stored["panels"][0]["description"] == before["panels"][0]["description"]
    assert stored["takes"] == before["takes"]
    frame.locator("#propose").click()
    expect(frame.locator("#ops article")).to_have_count(2)
    center(frame.locator("#ops input:not(:disabled)").first).check()
    current = document(page, origin)
    conflict = page.request.patch(
        f"{origin}/api/episodes/{EPISODE}/panels/p01",
        data={"changes": {"description": "Concurrent human edit"}, "revision": current["revision"]},
    )
    assert conflict.ok
    center(frame.locator("#apply")).click()
    expect(frame.locator("#status")).to_contain_text(re.compile("作品已变更|changed"))
    expect(frame.locator("#revision")).to_contain_text(
        re.compile(rf"(当前已读版本 |current )?{conflict.json()['revision']}")
    )
    expect(frame.locator("#apply")).to_be_disabled()
    center(frame.locator("#suggest-pacing")).click()
    expect(frame.locator("#suggest-pacing")).to_be_enabled()
    expect(frame.locator("#pacing-status")).to_contain_text(re.compile("建议|suggestions", re.I))
    count = frame.locator("#pacing-ops input").count()
    if count:
        center(frame.locator("#pacing-ops input").first).check()
        center(frame.locator("#apply-pacing")).click()
        expect(frame.locator("#pacing-status")).to_contain_text(re.compile("已应用|Applied"))
    return {
        "sentence_diff": True,
        "explicit_subset": True,
        "stale_blocked": True,
        "checkpoint_before_apply": True,
        "pacing_suggestions": count,
    }


def save_download(page, frame, action, downloads, folder, marker):
    count = len(downloads)
    action()
    button = page.get_by_role("button", name=re.compile("^(下载|Download)$"))
    expect(button).to_be_visible(timeout=20000)
    assert len(downloads) == count, "The panel silently triggered a browser download"
    with page.expect_download() as event:
        button.click()
    download = event.value
    path = folder / f"{count}-{download.suggested_filename}"
    download.save_as(str(path))
    content = path.read_bytes()
    assert marker in content, (download.suggested_filename, len(content))
    assert len(downloads) == count + 1
    path.unlink()
    return {
        "filename": download.suggested_filename,
        "bytes": len(content),
        "explicit_host_click": True,
    }


def variants(page, frame, origin, downloads, folder):
    frame.locator("#load").click()
    expect(frame.locator("#workspace")).to_be_visible()
    frame.locator("#prefix").fill("浏览器验收")
    center(frame.locator("#styles input").first).check()
    center(frame.locator("#derive")).click()
    expect(frame.locator("#versions input")).to_have_count(2)
    expect(frame.locator("#versions input:checked")).to_have_count(1)
    ids = job_ids(page, origin)
    center(frame.locator("#render")).click()
    job = wait_job(page, origin, ids, "comfy.render")
    assert not job["snapshot"].get("auto_adopt")
    center(frame.locator("#refresh")).click()
    expect(frame.locator("#job")).to_contain_text(re.compile("完成 3/3|complete 3/3"))
    expect(frame.locator("#job")).not_to_contain_text("undefined")
    frame.locator("#version").select_option("*")
    center(frame.locator("#show")).click()
    center(
        frame.locator(".take").filter(has_text=re.compile("原版|Original")).first.locator("input")
    ).check()
    center(frame.locator(".take").filter(has_text="浏览器验收").first.locator("input")).check()
    expect(frame.locator("#comparison img")).to_have_count(2)
    pictures = [image(frame, f"#comparison figure:nth-child({n}) img") for n in (1, 2)]
    assert pictures[0]["corner"] != pictures[1]["corner"]
    original = next(
        t["id"]
        for t in document(page, origin)["takes"]
        if t["panel_id"] == "p01" and t["variant_id"] is None and t["status"] == "adopted"
    )
    adopt = (
        frame.locator(".take")
        .filter(has_text="浏览器验收")
        .first.get_by_role("button", name=re.compile("采用此图|Adopt"))
    )
    center(adopt).click()
    expect(frame.locator(".take").filter(has_text="浏览器验收").first).to_contain_text(
        re.compile("已采用|Adopted")
    )
    expect(adopt).to_be_disabled()
    current = document(page, origin)
    assert next(t for t in current["takes"] if t["id"] == original)["status"] == "adopted"
    identifier = page.request.get(f"{origin}/api/series/{SERIES}").json()["variants"][0]["id"]
    assert any(t["variant_id"] == identifier and t["status"] == "adopted" for t in current["takes"])
    frame.locator("#version").select_option(identifier)
    html = save_download(
        page,
        frame,
        lambda: center(frame.locator("#export")).click(),
        downloads,
        folder,
        b"mio.album-html.v1",
    )
    frame.locator("#format").select_option("pdf")
    pdf = save_download(
        page, frame, lambda: center(frame.locator("#export")).click(), downloads, folder, b"%PDF-"
    )
    return {
        "generated": job["state"],
        "original_adoption_retained": True,
        "comparison": pictures,
        "downloads": [html, pdf],
    }


def motion(page, frame, origin, downloads, folder):
    expect(frame.locator("#discard-confirm")).to_have_js_property("hidden", True)
    expect(frame.locator("#discard-confirm")).to_have_css("display", "none")
    frame.locator("#load").click()
    before = image(frame, "#image")
    frame.locator("#move").select_option("pan_left")
    frame.locator("#hold").fill("4.5")
    frame.locator("#transition").select_option("slide")
    expect(frame.locator("#export")).to_be_disabled()
    center(frame.locator("#load")).click()
    expect(frame.locator("#discard-confirm")).to_have_js_property("hidden", False)
    expect(frame.locator("#discard-confirm")).to_be_visible()
    center(frame.locator("#keep")).click()
    expect(frame.locator("#discard-confirm")).to_have_js_property("hidden", True)
    expect(frame.locator("#discard-confirm")).to_have_css("display", "none")
    expect(frame.locator("#hold")).to_have_value("4.5")
    center(frame.locator("#save")).click()
    expect(frame.locator("#status")).to_contain_text(re.compile("镜头已保存|Shot saved"))
    saved = document(page, origin)["panels"][0]["motion"]
    assert saved == {"move": "pan_left", "hold": 4.5, "transition": "slide"}, saved
    center(frame.locator("#scrub")).press("End")
    expect(frame.locator("#scrub")).to_have_value("100")
    center(frame.locator("#play")).click()
    frame.locator("#aspect").select_option("landscape")
    center(frame.locator("#lettered")).uncheck()
    download = save_download(
        page,
        frame,
        lambda: center(frame.locator("#export")).click(),
        downloads,
        folder,
        b'id="mio-motion"',
    )
    return {
        "saved": saved,
        "image": before,
        "scrub": 100,
        "unsaved_reload_confirmation_cancelled": True,
        "hidden_confirmation_display_none": True,
        "download": download,
    }


EXERCISES = {
    "panel-retouch": retouch,
    "finalize-studio": finalize,
    "qa-review": qa,
    "script-assistant": script,
    "variant-workshop": variants,
    "motion-studio": motion,
}


def empty_and_error(page, origin, identifier):
    """Exercise real empty documents and an intercepted, recoverable HTTP 503."""
    page.goto(origin + "/extensions?tab=installed", wait_until="domcontentloaded")
    reset = page.request.post(origin + "/__professional_fixture/reset?empty=true")
    assert reset.ok, reset.text()
    frame = open_panel(page, origin, identifier)
    before = page.request.get(origin + "/__professional_fixture/stats").json()

    def load():
        if identifier == "script-assistant":
            frame.locator("#instruction").fill("Review this quiet empty storyboard.")
            center(frame.locator("#propose")).click()
        else:
            center(frame.locator("#load")).click()

    load()
    if identifier == "panel-retouch":
        expect(frame.locator("#status")).to_contain_text(re.compile("没有候选图|No candidate"))
        expect(frame.locator("#submit")).to_be_disabled()
    elif identifier == "finalize-studio":
        expect(frame.locator("#takes")).to_contain_text(re.compile("没有已采用|No adopted"))
        expect(frame.locator("#submit")).to_be_disabled()
    elif identifier == "qa-review":
        expect(frame.locator("#takes")).to_contain_text(re.compile("没有分幕|no panels", re.I))
        expect(frame.locator("#review-selected")).to_be_disabled()
    elif identifier == "script-assistant":
        expect(frame.locator("#ops")).to_contain_text(re.compile("无需|没有|no changes", re.I))
        expect(frame.locator("#apply")).to_be_disabled()
    elif identifier == "variant-workshop":
        expect(frame.locator("#workspace")).to_be_visible()
        center(frame.locator("#show")).click()
        expect(frame.locator("#takes")).to_contain_text(re.compile("没有候选图|No candidates"))
    else:
        expect(frame.locator("#status")).to_contain_text(re.compile("没有分镜|no storyboard", re.I))
        expect(frame.locator("#editor")).to_be_hidden()
    empty_fit = fit(page, frame)
    after = page.request.get(origin + "/__professional_fixture/stats").json()
    assert before["calls"]["comfy"] == after["calls"]["comfy"]
    assert before["calls"]["vision"] == after["calls"]["vision"]
    assert before["calls"]["text"] == after["calls"]["text"], "Empty state called a text model"
    assert before["jobs"] == after["jobs"], "Empty state submitted generation"
    intercepted = []
    pattern = f"**/api/extension-panels/{identifier}/**/requests"

    def unavailable(route):
        payload = route.request.post_data_json if route.request.method == "POST" else {}
        if payload.get("request_id") == "episode":
            intercepted.append(route.request.url)
            route.fulfill(status=503, json={"detail": "Fixture unavailable (503)"})
        else:
            route.continue_()

    page.route(pattern, unavailable)
    try:
        load()
        expect(frame.locator("#status")).to_contain_text("Fixture unavailable (503)")
        expect(
            frame.locator("#propose" if identifier == "script-assistant" else "#load")
        ).to_be_enabled()
        assert len(intercepted) == 1, intercepted
        error_fit = fit(page, frame)
    finally:
        page.unroute(pattern, unavailable)
    load()
    expect(frame.locator("#status")).not_to_contain_text("Fixture unavailable (503)")
    expect(
        frame.locator("#propose" if identifier == "script-assistant" else "#load")
    ).to_be_enabled()
    return {
        "empty_document": True,
        "image_or_vision_generation_not_started": True,
        "explicit_text_calls": after["calls"]["text"] - before["calls"]["text"],
        "http_503": True,
        "no_automatic_retry": len(intercepted) == 1,
        "manual_retry_recovered": True,
        "empty_fit": empty_fit,
        "error_fit": error_fit,
    }


def uninstall(page, origin, panels):
    page.goto(origin + "/extensions?tab=installed", wait_until="domcontentloaded")
    for identifier, panel in panels.items():
        if identifier not in PACKAGES:
            continue
        card = page.locator(".ext-card").filter(has=page.locator(".mono", has_text=identifier))
        card.get_by_role("button", name=re.compile("^(停用|Disable)$")).click()
        expect(card.get_by_role("button", name=re.compile("^(启用|Enable)$"))).to_be_visible()
        response = page.request.post(
            f"{origin}/api/extension-panels/{identifier}/{panel['id']}/requests",
            data={
                "activation": panel["activation"],
                "digest": panel["digest"],
                "request_id": "episode",
                "path_params": {"episode_id": EPISODE},
            },
        )
        assert response.status == 404, "Disabled activation still accepts requests"
        card.get_by_role("button", name=re.compile("^(卸载|Uninstall)$")).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("button", name=re.compile("^(卸载|Uninstall)$")).click()
        expect(card).to_have_count(0)
