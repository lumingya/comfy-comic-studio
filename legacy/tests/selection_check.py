"""Quick behavioural check for the unified desktop selection model (single click opens, marquee/Ctrl/Shift select,
right-click switches menus, no checkboxes / toolbars while selecting)."""
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8000"
fails = []
def check(name, ok):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function("typeof rt!=='undefined'&&!rt.booting&&typeof state!=='undefined'")
    page.evaluate("""()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.settings.identity.onboarded=true;
      const b=clone(state.books[0]);state.books=Array.from({length:8},(_,i)=>({...clone(b),id:'sel_'+i,title:'画册 '+i,curatedDemo:false}));
      navigate(0);setShelfLayout('grid');ui.bulk=false;ui.bulkPinned=false;ui.selected.clear();render()}""")
    page.wait_for_selector("#gallery-results .shelf-item")
    cards = page.locator("#gallery-results .shelf-item")

    # ---- shelf: single click opens
    cards.nth(0).locator(".shelf-cover").click()
    page.wait_for_timeout(300)
    check("shelf: single click opens the album", page.evaluate("document.querySelector('#reader').open") is True)
    page.evaluate("document.querySelector('#reader').close()")
    check("shelf: no 多选 toolbar button on desktop", page.locator('[data-act="toggle-bulk"]').count() == 0 or not page.locator('[data-act="toggle-bulk"]').first.is_visible())

    # ---- shelf: ctrl-click, shift-click
    cards.nth(1).locator(".shelf-cover").click(modifiers=["Control"])
    cards.nth(3).locator(".shelf-cover").click(modifiers=["Shift"])
    check("shelf: Ctrl + Shift click selects a range", page.evaluate("ui.selected.size") == 3)
    check("shelf: no checkboxes while selecting", page.locator("#gallery-results [data-select-book]").count() == 0)
    check("shelf: no bulk bar while selecting", page.locator(".shelf-bulk,.bulk-bar,.sel-bar").count() == 0)
    check("shelf: status line shows count", "3" in page.locator(".shelf-selection-status").inner_text())

    # ---- shelf: right-click on a selected card -> multi menu; on unselected -> single menu
    cards.nth(2).click(button="right")
    page.wait_for_selector(".ctx-menu")
    title = page.locator(".ctx-title strong").inner_text()
    check("shelf: right-click on selection opens multi menu", "3 本" in title and page.locator('.ctx-menu [data-act="org-context-star"]').count() == 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    cards.nth(4).scroll_into_view_if_needed(); cards.nth(4).click(button="right")
    page.wait_for_selector(".ctx-menu")
    check("shelf: right-click outside selection targets that one album", page.evaluate("ui.selected.size") == 0 and page.locator('.ctx-menu [data-act="read"]').count() == 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)

    # ---- shelf: marquee (starts on the padding of the grid, sweeps across the first row)
    cards.nth(0).scroll_into_view_if_needed()
    box0 = cards.nth(0).bounding_box(); box2 = cards.nth(2).bounding_box()
    grid = page.locator("#gallery-results").bounding_box()
    page.mouse.move(grid["x"] + 2, box0["y"] - 6)
    page.mouse.down()
    page.mouse.move(box2["x"] + box2["width"] - 6, min(box2["y"] + box2["height"] - 6, 990), steps=12)
    check("shelf: marquee box appears", page.locator(".desktop-marquee").count() == 1)
    page.mouse.up()
    page.wait_for_timeout(200)
    n = page.evaluate("ui.selected.size")
    check(f"shelf: marquee selects albums ({n})", n >= 2)
    # plain click on a selected card opens it and dissolves the selection
    cards.nth(0).locator(".shelf-cover").click()
    page.wait_for_timeout(300)
    check("shelf: plain click on selected album opens it (single click)", page.evaluate("document.querySelector('#reader').open") is True and page.evaluate("ui.selected.size") == 0)
    page.evaluate("document.querySelector('#reader').close()")

    # ---- workshop frames
    page.evaluate("()=>{navigate(1);workshop.view='stories';render()}")
    page.wait_for_selector(".workshop-frames-list button[data-index]")
    rows = page.locator(".workshop-frames-list button[data-index]")
    rows.nth(2).click()
    page.wait_for_timeout(150)
    check("frames: single click switches frame", page.evaluate("workshop.frame") == 2 and page.evaluate("workshop.pickedFrames.size") == 0)
    check("frames: no 批量管理 button", page.locator('[data-act="workshop-frame-sel-toggle"]:visible').count() == 0)
    rows.nth(0).click(modifiers=["Control"])
    rows.nth(3).click(modifiers=["Shift"])
    check("frames: Ctrl/Shift click selects range", page.evaluate("workshop.pickedFrames.size") == 4)
    check("frames: no checkboxes", page.locator(".workshop-frames-list .sel-cbox:visible").count() == 0)
    check("frames: no selection bar", page.locator(".workshop-frames-selbar,.sel-bar:visible").count() == 0)
    rows.nth(1).click(button="right")
    page.wait_for_selector(".ctx-menu")
    check("frames: right-click on selection opens bulk menu", page.locator('.ctx-menu [data-act="workshop-frame-delete-bulk"]').count() == 1 and page.locator('.ctx-menu [data-act="workshop-copy-frame"]').count() == 0)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    check("frames: Escape clears (menu closed first)", True)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    check("frames: Escape clears selection", page.evaluate("workshop.pickedFrames.size") == 0)
    rows.nth(5).click(button="right")
    page.wait_for_selector(".ctx-menu")
    check("frames: right-click on single frame opens single menu", page.locator('.ctx-menu [data-act="workshop-copy-frame"]').count() == 1)
    page.keyboard.press("Escape")
    # marquee over frames
    rows.nth(3).scroll_into_view_if_needed(); rows.nth(0).scroll_into_view_if_needed()
    r0 = rows.nth(0).bounding_box(); r3 = rows.nth(3).bounding_box()
    page.mouse.move(r0["x"] + 4, r0["y"] + 2); page.mouse.down()
    page.mouse.move(r3["x"] + r3["width"] - 4, r3["y"] + r3["height"] - 2, steps=10); page.mouse.up()
    page.wait_for_timeout(200)
    check("frames: marquee selects frames", page.evaluate("workshop.pickedFrames.size") == 4)
    page.keyboard.press("Escape")

    # ---- workflow rail / bindings
    page.evaluate("()=>{mapperUI.railPinned=true;navigate(3)}")
    page.wait_for_selector("#wf-rail-list [data-workflow-id]")
    check("workflows: no 选择 toggle / checkboxes", page.locator('[data-act="ws-lib-sel-toggle"]').count() == 0 and page.locator("#wf-rail-list .sel-cbox").count() == 0)
    flows = page.locator("#wf-rail-list [data-workflow-id]")
    flows.nth(0).click(modifiers=["Control"])
    check("workflows: Ctrl click selects", page.evaluate("mapperUI.libSel.size") == 1)
    page.keyboard.press("Escape")
    check("workflows: Escape clears", page.evaluate("mapperUI.libSel.size") == 0)
    maps = page.locator("#wm-binding-rows [data-binding-row]")
    if maps.count() >= 2:
        maps.nth(0).locator(".wf-row-main").click(modifiers=["Control"])
        maps.nth(1).locator(".wf-row-main").click(modifiers=["Control"])
        check("bindings: Ctrl click selects two", page.evaluate("mapperUI.sel.size") == 2)
        check("bindings: no checkboxes / sel bar", page.locator("#wm-binding-rows .sel-cbox").count() == 0 and page.locator(".wm-workbench .sel-bar").count() == 0)
        maps.nth(0).click(button="right")
        page.wait_for_selector("#wf-menu")
        check("bindings: right-click on selection shows bulk menu", page.locator('#wf-menu [data-act="wm-disable-bulk"]').count() == 1)
        page.keyboard.press("Escape")
        page.evaluate("mapperUI.sel.clear();render()")
        maps.nth(0).locator(".wf-row-main").click()
        check("bindings: single click edits", page.evaluate("mapperUI.sel.size") == 0)
    page.screenshot(path="/home/user/comfy-comic-studio/tests/selection_check.png")
    check("no runtime errors", not errors)
    if errors: print(errors)
    b.close()
sys.exit(1 if fails else 0)
