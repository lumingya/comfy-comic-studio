"""User-driven browser scenarios for six opt-in professional extension packages."""

from __future__ import annotations

import re
import time

from playwright.sync_api import expect

from professional_browser_fixture import EPISODE, PACKAGES, SERIES


def document(page, origin):
    response = page.request.get(f"{origin}/api/episodes/{EPISODE}")
    assert response.ok
    return response.json()


def install(page, origin, archives):
    page.goto(origin + "/extensions?tab=installed", wait_until="networkidle")
    for identifier, archive in archives.items():
        page.locator('input[type="file"][accept=".zip"]').set_input_files(str(archive))
        dialog = page.get_by_role("dialog")
        expect(dialog).to_be_visible()
        assert dialog.evaluate("element => element.scrollWidth <= element.clientWidth + 1")
        digest = dialog.locator(".secret-box").inner_text()
        assert re.fullmatch(r"[a-f0-9]{64}", digest), "Trust dialog must show the actual digest"
        dialog.get_by_role("button", name="信任并启用", exact=True).click()
        expect(dialog).to_be_hidden()
        card = page.locator(".ext-card").filter(has=page.locator(".mono", has_text=identifier))
        expect(card.get_by_role("button", name="停用", exact=True)).to_be_visible()
    return {p["extension"]: p for p in page.request.get(origin + "/api/extension-panels").json()}


def open_panel(page, origin, identifier):
    panel_id, title = PACKAGES[identifier]
    page.goto(f"{origin}/workshop/assembly/{EPISODE}/board", wait_until="networkidle")
    menu = page.locator("[data-episode-extension-menu]")
    menu.get_by_role("button", name="扩展", exact=True).click()
    page.get_by_role("menuitem", name=title, exact=True).click()
    expect(page).to_have_url(re.compile(rf"/ext/{re.escape(identifier)}\.{panel_id}$"))
    iframe = page.locator(f'iframe[title="{title}"]')
    expect(iframe).to_be_visible()
    expect(iframe).to_have_attribute("sandbox", "allow-scripts")
    frame = page.frame_locator(f'iframe[title="{title}"]')
    expect(frame.locator("#status")).not_to_contain_text("正在连接")
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
    return {"host": main, "panel": nested}


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
    frame.get_by_text("用坐标精确编辑蒙版", exact=True).click()
    frame.locator("#mask-json").fill('{"boxes":[[0.1,0.1,0.7,0.8]],"polygons":[]}')
    frame.locator("#apply-mask").click()
    frame.locator("#submit").click()
    job = wait_job(page, origin, ids, "comfy.render")
    frame.locator("#job-refresh").click()
    expect(frame.locator("#job-state")).to_contain_text("已完成")
    after = image(frame, "#after-image")
    assert after["corner"] != before["corner"]
    stored = document(page, origin)
    assert (
        next(t for t in stored["takes"] if t["id"] == initial["takes"][0]["id"])["status"]
        == "adopted"
    )
    assert all(t["status"] == "candidate" for t in stored["takes"] if t["job_id"] == job["id"])
    frame.locator("#submit").click()
    expect(frame.locator("#submit")).to_be_enabled()
    assert job_ids(page, origin) == ids | {job["id"]}, (
        "Identical explicit retry created another job"
    )
    return {"job": job["state"], "source": before, "result": after, "adoption_preserved": True}


def finalize(page, frame, origin, _downloads, _folder):
    ids = job_ids(page, origin)
    frame.locator("#load").click()
    before = image(frame, "#source-image")
    frame.locator("#profile").select_option("profile_default")
    expect(frame.locator("#submit")).to_be_disabled()
    selected = frame.locator("#takes input").first
    selected.check()
    take_id = selected.input_value()
    expect(frame.locator("#submit")).to_be_disabled()
    frame.locator("#consent").check()
    frame.locator("#submit").click()
    job = wait_job(page, origin, ids, "comfy.render")
    frame.locator("#job-refresh").click()
    expect(frame.locator("#job-state")).to_contain_text("已完成")
    after = image(frame, "#after-image")
    assert before["corner"] != after["corner"]
    episode = document(page, origin)
    assert next(t for t in episode["takes"] if t["id"] == take_id)["status"] == "candidate"
    result = next(t for t in episode["takes"] if t["job_id"] == job["id"])
    assert result["stage"] == "final" and result["status"] == "adopted"
    assert len(job["items"][0]["input"]["stages"]) == 2
    return {"stages": 2, "consent_required": True, "original_retained": True, "result": after}


def qa(page, frame, origin, _downloads, _folder):
    ids = job_ids(page, origin)
    before = {t["id"]: t["status"] for t in document(page, origin)["takes"]}
    frame.locator("#load").click()
    frame.locator('input[value="fixture-p02-1"]').check()
    frame.locator("#review").click()
    job = wait_job(page, origin, ids, "qa.check")
    assert job["snapshot"]["auto_adopt"] is False
    frame.locator("#refresh-job").click()
    expect(frame.locator("#job")).to_contain_text("1/1")
    expect(frame.locator("#takes")).to_contain_text("一致性 2/5")
    frame.locator("#issues button").filter(has_text="一致性").first.click()
    expect(frame.locator("article:focus")).to_have_attribute("id", "panel-p02")
    assert before == {t["id"]: t["status"] for t in document(page, origin)["takes"]}
    return {"structured_score": True, "issue_location": True, "auto_adopt": False}


def script(page, frame, origin, _downloads, _folder):
    before = document(page, origin)
    frame.locator("#instruction").fill("Shorten dialogue and keep locked scenes unchanged.")
    frame.locator("#propose").click()
    expect(frame.locator("#ops article")).to_have_count(3)
    expect(frame.locator("#ops input:checked")).to_have_count(0)
    expect(frame.locator("#ops input:disabled")).to_have_count(1)
    expect(frame.locator("#ops")).to_contain_text("The rain has stopped.")
    frame.locator("#ops article").filter(has_text="The rain has stopped.").locator("input").check()
    frame.locator("#apply").click()
    expect(frame.locator("#status")).to_contain_text("已应用 1 条")
    stored = document(page, origin)
    assert stored["panels"][1]["dialogues"][0]["text"] == "The rain has stopped."
    assert stored["panels"][0]["description"] == before["panels"][0]["description"]
    assert stored["takes"] == before["takes"]
    frame.locator("#propose").click()
    expect(frame.locator("#ops article")).to_have_count(2)
    frame.locator("#ops input:not(:disabled)").first.check()
    current = document(page, origin)
    conflict = page.request.patch(
        f"{origin}/api/episodes/{EPISODE}/panels/p01",
        data={"changes": {"description": "Concurrent human edit"}, "revision": current["revision"]},
    )
    assert conflict.ok
    frame.locator("#apply").click()
    expect(frame.locator("#status")).to_contain_text("作品已变更")
    expect(frame.locator("#revision")).to_contain_text(
        f"当前已读版本 {conflict.json()['revision']}"
    )
    expect(frame.locator("#apply")).to_be_disabled()
    return {"sentence_diff": True, "explicit_subset": True, "stale_blocked": True}


def save_download(page, frame, action, downloads, folder, marker):
    count = len(downloads)
    action()
    button = page.get_by_role("button", name="下载", exact=True)
    expect(button).to_be_visible()
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
    frame.locator("#styles input").first.check()
    frame.locator("#derive").click()
    expect(frame.locator("#versions input")).to_have_count(1)
    ids = job_ids(page, origin)
    frame.locator("#render").click()
    job = wait_job(page, origin, ids, "comfy.render")
    assert not job["snapshot"].get("auto_adopt")
    frame.locator("#refresh").click()
    expect(frame.locator("#job")).to_contain_text("完成 3/3")
    expect(frame.locator("#job")).not_to_contain_text("undefined")
    frame.locator("#version").select_option("*")
    frame.locator("#show").click()
    frame.locator(".take").filter(has_text="原版").first.locator("input").check()
    frame.locator(".take").filter(has_text="浏览器验收").first.locator("input").check()
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
        .first.get_by_role("button", name="采用此图")
    )
    adopt.click()
    expect(frame.locator(".take").filter(has_text="浏览器验收").first).to_contain_text("已采用")
    expect(adopt).to_be_disabled()
    current = document(page, origin)
    assert next(t for t in current["takes"] if t["id"] == original)["status"] == "adopted"
    identifier = page.request.get(f"{origin}/api/series/{SERIES}").json()["variants"][0]["id"]
    assert any(t["variant_id"] == identifier and t["status"] == "adopted" for t in current["takes"])
    frame.locator("#version").select_option(identifier)
    html = save_download(
        page,
        frame,
        lambda: frame.locator("#export").click(),
        downloads,
        folder,
        b"mio.album-html.v1",
    )
    frame.locator("#format").select_option("pdf")
    pdf = save_download(
        page, frame, lambda: frame.locator("#export").click(), downloads, folder, b"%PDF-"
    )
    return {
        "generated": job["state"],
        "original_adoption_retained": True,
        "comparison": pictures,
        "downloads": [html, pdf],
    }


def motion(page, frame, origin, downloads, folder):
    frame.locator("#load").click()
    before = image(frame, "#image")
    frame.locator("#move").select_option("pan_left")
    frame.locator("#hold").fill("4.5")
    expect(frame.locator("#export")).to_be_disabled()
    frame.locator("#save").click()
    expect(frame.locator("#status")).to_contain_text("镜头已保存")
    saved = document(page, origin)["panels"][0]["motion"]
    assert saved == {"move": "pan_left", "hold": 4.5}
    frame.locator("#play").click()
    frame.locator("#scrub").press("End")
    expect(frame.locator("#scrub")).to_have_value("100")
    frame.locator("#aspect").select_option("landscape")
    frame.locator("#lettered").uncheck()
    download = save_download(
        page, frame, lambda: frame.locator("#export").click(), downloads, folder, b'id="mio-motion"'
    )
    return {"saved": saved, "image": before, "scrub": 100, "download": download}


EXERCISES = {
    "panel-retouch": retouch,
    "finalize-studio": finalize,
    "qa-review": qa,
    "script-review": script,
    "variant-workshop": variants,
    "motion-studio": motion,
}


def uninstall(page, origin, panels):
    page.goto(origin + "/extensions?tab=installed", wait_until="networkidle")
    for identifier, panel in panels.items():
        if identifier not in PACKAGES:
            continue
        card = page.locator(".ext-card").filter(has=page.locator(".mono", has_text=identifier))
        card.get_by_role("button", name="停用", exact=True).click()
        expect(card.get_by_role("button", name="启用", exact=True)).to_be_visible()
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
        card.get_by_role("button", name="卸载", exact=True).click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_role("button", name="卸载", exact=True).click()
        expect(card).to_have_count(0)
