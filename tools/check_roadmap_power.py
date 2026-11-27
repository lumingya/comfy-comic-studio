"""Measure actual Chrome video suspension and long-form interaction without remote services.

Uses installed Chrome through Python Playwright and an existing local ffmpeg encoder.
No browser or dependency is installed.
The selected wallpaper-idle timeout uses the native wall clock, never fake timers;
only that selected value is real-waited. CDP timeline durations describe
renderer/compositor work, NOT GPU utilization, energy, or watts.
Raw trace events stay in memory and are discarded after aggregation.

Run the power/interaction matrix after the coordinated web build, or select a phase:
    python tools/check_roadmap_power.py --report TEMP_REPORT.json
    python tools/check_roadmap_power.py --only interactions --theme dynamic
    python tools/check_roadmap_power.py --only extensions --theme dark
    python tools/check_roadmap_power.py --idle-timeout-seconds 180
"""

from __future__ import annotations

import argparse
import json
import math
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

from roadmap_power_fixture import EPISODE, ROOT, THEME, serve

TIMER_OBSERVER = """(() => {
  const nativeSet = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
  window.__powerTimers = [];
  window.setTimeout = function(fn, delay, ...args) {
    const row = {delay:Number(delay), at:performance.now(), fired:null, cleared:null, id:null};
    const observed = typeof fn === 'function' ? function(...values) {
      row.fired = performance.now(); return fn.apply(this, values);
    } : fn;
    const id = nativeSet(observed, delay, ...args);
    if ([30000,60000,180000].includes(Number(delay))) {
      row.id=id; window.__powerTimers.push(row);
    }
    return id;
  };
  window.clearTimeout = function(id) {
    const row = window.__powerTimers.findLast(row=>row.id===id);
    if(row) row.cleared=performance.now(); return nativeClear(id);
  };
})();"""

VIDEO_STATE = """() => {
  const v=document.querySelector('video'); if(!v) return null;
  const q=v.getVideoPlaybackQuality();
  return {paused:v.paused,currentTime:v.currentTime,totalFrames:q.totalVideoFrames,
    droppedFrames:q.droppedVideoFrames,width:v.videoWidth,height:v.videoHeight,
    readyState:v.readyState,src:v.currentSrc,now:performance.now(),
    documentHidden:document.hidden,documentFocused:document.hasFocus()};
}"""


def metrics(cdp):
    return {item["name"]: item["value"] for item in cdp.send("Performance.getMetrics")["metrics"]}


def summarize_trace(events):
    names = Counter()
    totals = defaultdict(
        float,
        dict.fromkeys(("paint_ms", "raster_ms", "composite_ms", "swap_ms"), 0.0),
    )
    threads = {}
    for event in events:
        if event.get("ph") == "M" and event.get("name") == "thread_name":
            threads[event.get("pid"), event.get("tid")] = event.get("args", {}).get("name", "")
    for event in events:
        if event.get("ph") != "X":
            continue
        name = event.get("name", "")
        duration = event.get("dur", 0) / 1000
        if name == "Paint":
            totals["paint_ms"] += duration
        if name == "RasterTask":
            totals["raster_ms"] += duration
        if name in {"CompositeLayers", "LayerTreeHostImpl::PrepareToDraw", "DrawFrame"}:
            totals["composite_ms"] += duration
        if "SwapBuffers" in name or "DrawAndSwap" in name:
            totals["swap_ms"] += duration
        if any(word in name for word in ("Paint", "Raster", "Swap", "DrawFrame", "Decode")):
            names[name] += 1
    return {
        "event_count": len(events),
        "summed_event_durations_ms": {key: round(value, 3) for key, value in totals.items()},
        "relevant_event_counts": dict(names.most_common(30)),
        "thread_names": sorted(set(threads.values())),
        "duration_warning": "Nested and multi-thread trace durations may overlap; not GPU percent",
    }


def sample(page, cdp, seconds):
    """Capture a bounded trace without saving media, URLs, or raw trace files."""
    chunks = []
    complete = []

    def collected(params):
        chunks.extend(params["value"])

    def completed(params):
        complete.append(params)

    cdp.on("Tracing.dataCollected", collected)
    cdp.on("Tracing.tracingComplete", completed)
    cdp.send(
        "Tracing.start",
        {
            "categories": "devtools.timeline,disabled-by-default-devtools.timeline,cc,viz,gpu,media",
            "transferMode": "ReportEvents",
        },
    )
    before, video_before = metrics(cdp), page.evaluate(VIDEO_STATE)
    started = time.monotonic()
    page.wait_for_timeout(seconds * 1000)
    wall = time.monotonic() - started
    video_after, after = page.evaluate(VIDEO_STATE), metrics(cdp)
    cdp.send("Tracing.end")
    deadline = time.monotonic() + 10
    while not complete and time.monotonic() < deadline:
        page.wait_for_timeout(50)
    if not complete:
        raise RuntimeError("CDP trace completion not received")
    cdp.remove_listener("Tracing.dataCollected", collected)
    cdp.remove_listener("Tracing.tracingComplete", completed)
    result = {
        "wall_seconds": round(wall, 3),
        "renderer_task_ms": round((after["TaskDuration"] - before["TaskDuration"]) * 1000, 3),
        "script_ms": round((after["ScriptDuration"] - before["ScriptDuration"]) * 1000, 3),
        "layout_ms": round((after["LayoutDuration"] - before["LayoutDuration"]) * 1000, 3),
        "js_heap_used_mb": round(after["JSHeapUsedSize"] / 1024**2, 3),
        "trace": summarize_trace(chunks),
    }
    if video_before and video_after:
        result["video"] = {
            "before": {k: v for k, v in video_before.items() if k != "src"},
            "after": {k: v for k, v in video_after.items() if k != "src"},
            "decoded_frame_delta": video_after["totalFrames"] - video_before["totalFrames"],
            "dropped_frame_delta": video_after["droppedFrames"] - video_before["droppedFrames"],
            "current_time_delta_seconds": round(
                video_after["currentTime"] - video_before["currentTime"], 5
            ),
        }
    return result


def install_state(context, state, idle_timeout_seconds):
    context.add_init_script(TIMER_OBSERVER)
    state["wallpaperIdleTimeout"] = idle_timeout_seconds
    context.add_init_script(
        "if(window===top&&!localStorage.getItem('mio.ui')){"
        "localStorage.setItem('mio.locale','en');localStorage.setItem('mio.ui',JSON.stringify("
        + json.dumps({"version": 3, "state": state})
        + "));}"
    )


def fit(page):
    return page.evaluate(
        """() => ({viewport:innerWidth,width:document.documentElement.scrollWidth,
        horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,
        videos:document.querySelectorAll('video').length})"""
    )


def wait_video(page):
    page.wait_for_function(
        "() => {const v=document.querySelector('video');return v&&v.videoWidth>0&&!v.paused}"
    )


def timer_rows(page):
    return page.evaluate("() => window.__powerTimers.filter(row=>row.delay>=30000)")


def settings(page, origin, idle_timeout_seconds):
    page.goto(origin + "/settings?tab=appearance")
    control = page.get_by_role("combobox", name="Pause animated wallpaper when idle", exact=True)
    control.wait_for()
    results = []
    for value in (0, 30, 60, 180):
        before = len(timer_rows(page))
        control.select_option(str(value))
        page.wait_for_timeout(150)
        scheduled = timer_rows(page)[before:]
        persisted = page.evaluate(
            "JSON.parse(localStorage.getItem('mio.ui')).state.wallpaperIdleTimeout"
        )
        assert persisted == value, (persisted, value)
        page.reload()
        control = page.get_by_role(
            "combobox", name="Pause animated wallpaper when idle", exact=True
        )
        assert control.input_value() == str(value)
        results.append(
            {"seconds": value, "persisted_after_reload": True, "new_native_timers": scheduled}
        )
    control.select_option("30")
    page.wait_for_timeout(100)
    active_30 = [r for r in timer_rows(page) if r["delay"] == 30000 and r["cleared"] is None]
    control.select_option("60")
    page.wait_for_timeout(100)
    changed = timer_rows(page)
    assert active_30 and all(
        any(row["id"] == old["id"] and row["cleared"] is not None for row in changed)
        for old in active_30
    ), changed
    assert any(r["delay"] == 60000 and r["cleared"] is None for r in changed), changed
    results.append({"reschedule_30_to_60": "old timer cancelled; new native 60000ms timer active"})
    control.select_option(str(idle_timeout_seconds))
    page.wait_for_timeout(150)
    return results


def freeze(page, cdp, seconds, idle_timeout_seconds):
    wait_video(page)
    page.evaluate(
        """() => {
          window.__powerActivity=0;window.__powerPaused=0;
          window.addEventListener('pointermove',()=>window.__powerActivity=performance.now());
          const video=document.querySelector('video');
          video.addEventListener('pause',()=>{
            window.__powerPaused=performance.now();
            window.__powerPauseFrames=video.getVideoPlaybackQuality().totalVideoFrames;
          });
        }"""
    )
    page.mouse.move(22, 22)
    started = time.monotonic()
    foreground = sample(page, cdp, seconds)
    assert foreground["video"]["decoded_frame_delta"] > seconds * 10, foreground
    elapsed = time.monotonic() - started
    pre_expiry_margin_seconds = 1
    page.wait_for_timeout(max(0, idle_timeout_seconds - pre_expiry_margin_seconds - elapsed) * 1000)
    before_threshold = page.evaluate(VIDEO_STATE)
    observed_before_elapsed = time.monotonic() - started
    assert not before_threshold["paused"], before_threshold
    assert observed_before_elapsed < idle_timeout_seconds, observed_before_elapsed
    page.wait_for_function("() => document.querySelector('video').paused", timeout=5000)
    actual = page.evaluate("() => (window.__powerPaused-window.__powerActivity)/1000")
    timing_tolerance_seconds = 1.5
    assert (
        idle_timeout_seconds - timing_tolerance_seconds
        <= actual
        <= idle_timeout_seconds + timing_tolerance_seconds
    ), actual
    pause_frames = page.evaluate("() => window.__powerPauseFrames")
    frozen = sample(page, cdp, seconds)
    decoded_frames_after_pause = frozen["video"]["after"]["totalFrames"] - pause_frames
    assert frozen["video"]["decoded_frame_delta"] == 0, frozen
    assert decoded_frames_after_pause == 0, (pause_frames, frozen)
    assert frozen["video"]["after"]["paused"], frozen
    page.evaluate(
        """() => {window.__powerResumeStart=0;window.__powerResumeFrame=0;
          window.addEventListener('pointermove',()=>{
            window.__powerResumeStart=performance.now();
            document.querySelector('video').requestVideoFrameCallback(()=>
              window.__powerResumeFrame=performance.now());
          },{once:true});} """
    )
    page.mouse.move(24, 24)
    page.wait_for_function("() => window.__powerResumeFrame>0")
    resume = page.evaluate("() => window.__powerResumeFrame-window.__powerResumeStart")
    assert not page.evaluate(VIDEO_STATE)["paused"]
    return {
        "foreground": foreground,
        "idle_timeout_seconds": idle_timeout_seconds,
        "frozen_after_real_idle_timeout": frozen,
        "threshold_elapsed_seconds": round(actual, 3),
        "still_playing_at_elapsed_seconds": round(observed_before_elapsed, 3),
        "decoded_frames_after_pause": decoded_frames_after_pause,
        "pointer_to_first_video_frame_ms": round(resume, 3),
    }


def frame_statistics(values):
    values = sorted(values)
    if not values:
        return {"count": 0}
    return {
        "count": len(values),
        "median_ms": round(values[len(values) // 2], 3),
        "p95_ms": round(values[min(len(values) - 1, math.ceil(len(values) * 0.95) - 1)], 3),
        "max_ms": round(values[-1], 3),
        "over_50ms": sum(v > 50 for v in values),
    }


def gesture(page, cdp, callback):
    before = metrics(cdp)
    page.evaluate(
        """() => {
          window.__powerFrames=[];window.__powerRunning=true;let last=performance.now();
          const tick=now=>{window.__powerFrames.push(now-last);last=now;
            if(window.__powerRunning)requestAnimationFrame(tick)};requestAnimationFrame(tick);
        }"""
    )
    started = time.monotonic()
    callback()
    values = page.evaluate(
        "() => {window.__powerRunning=false;return window.__powerFrames.slice(1)}"
    )
    after = metrics(cdp)
    return {
        "wall_seconds": round(time.monotonic() - started, 3),
        "frame_intervals": frame_statistics(values),
        "renderer_task_ms": round((after["TaskDuration"] - before["TaskDuration"]) * 1000, 3),
        "js_heap_before_mb": round(before["JSHeapUsedSize"] / 1024**2, 3),
        "js_heap_after_mb": round(after["JSHeapUsedSize"] / 1024**2, 3),
    }


def long_form(page, cdp, origin):
    page.goto(origin + f"/workshop/assembly/{EPISODE}/board")
    page.locator(".board-row[data-board-panel]").last.wait_for(state="attached")
    assert page.locator(".board-row[data-board-panel]").count() == 120
    page.locator(".take .take-image").first.wait_for()
    page.wait_for_timeout(500)
    result = {
        "panels": 120,
        "candidate_records": 1440,
        "independent_asset_count": 12,
        "asset_boundary": "12 generated 480x640 images reused by 1440 records; not 1440 independent textures",
        "fit": fit(page),
    }
    assert not result["fit"]["horizontalOverflow"], result["fit"]

    def scroll():
        page.mouse.move(350 if page.viewport_size["width"] == 1440 else 330, 650)
        for _ in range(40):
            page.mouse.wheel(0, 130)
            page.wait_for_timeout(20)

    scroll_position = """() => {
      let node=document.querySelector('.board');
      while(node&&!(node.scrollHeight>node.clientHeight+1&&
        /auto|scroll/.test(getComputedStyle(node).overflowY)))node=node.parentElement;
      node=node||document.scrollingElement;
      return {top:node.scrollTop,height:node.scrollHeight,viewport:node.clientHeight};
    }"""
    before_scroll = page.evaluate(scroll_position)
    result["board_vertical_scroll"] = gesture(page, cdp, scroll)
    after_scroll = page.evaluate(scroll_position)
    assert after_scroll["top"] > before_scroll["top"] + 100, (before_scroll, after_scroll)
    result["board_vertical_scroll"]["position_before"] = before_scroll
    result["board_vertical_scroll"]["position_after"] = after_scroll
    jump = page.locator("select.board-jump")
    jump.select_option("power-panel-000")
    image = page.locator('.take[data-selection-id="power-panel-000-take-00"] .take-image')
    image.scroll_into_view_if_needed()
    start = time.monotonic()
    image.click()
    page.locator("dialog#board-zoom[open]").wait_for()
    result["open_large_image_ms"] = round((time.monotonic() - start) * 1000, 3)
    page.keyboard.press("c")
    viewport = page.locator(".board-split-viewport")
    viewport.wait_for()
    # The range label is localized; its stable min/max distinguish it from the divider.
    zoom = page.locator('input[type="range"][min="1"][max="4"]')
    zoom.focus()
    zoom.press("Home")
    for _ in range(10):
        zoom.press("ArrowRight")
    assert float(zoom.input_value()) > 1
    box = viewport.bounding_box()
    assert box

    def pan():
        x, y = box["x"] + box["width"] * 0.7, box["y"] + box["height"] * 0.6
        page.mouse.move(x, y)
        page.mouse.down()
        for i in range(60):
            page.mouse.move(x - i * 2, y - i)
            page.wait_for_timeout(15)
        page.mouse.up()

    result["split_compare_pan"] = gesture(page, cdp, pan)
    transforms = page.locator(".board-split-frame").evaluate_all(
        "els=>els.map(el=>el.style.transform)"
    )
    assert len(transforms) == 2 and transforms[0] == transforms[1], transforms
    assert "translate(0px, 0px)" not in transforms[0], transforms
    result["synchronized_transform"] = transforms[0]
    result["compare_fit"] = fit(page)
    page.keyboard.press("Escape")
    page.locator("dialog#board-zoom[open]").wait_for(state="hidden")
    result["focus_restored"] = image.evaluate("el=>el===document.activeElement")
    assert result["focus_restored"]
    return result


def extension_memory(page, cdp, origin, folder):
    """Observe load and renderer JS memory; never invoke a model/work action."""
    from professional_browser_fixture import PACKAGES, packages
    from professional_browser_steps import install

    def screen():
        start = time.monotonic()
        page.goto(origin + "/settings?tab=appearance")
        page.get_by_role(
            "combobox", name="Pause animated wallpaper when idle", exact=True
        ).wait_for()
        ready = (time.monotonic() - start) * 1000
        page.wait_for_timeout(500)
        cdp.send("HeapProfiler.collectGarbage")
        state = metrics(cdp)
        paints = page.evaluate(
            "() => Object.fromEntries(performance.getEntriesByType('paint').map(e=>[e.name,e.startTime]))"
        )
        return {
            "observed_screen_ready_ms": round(ready, 3),
            "paint_timing_ms": {key: round(value, 3) for key, value in paints.items()},
            "host_renderer_retained_js_heap_mb": round(state["JSHeapUsedSize"] / 1024**2, 3),
            "host_renderer_nodes": state["Nodes"],
            "iframe_count": page.locator("iframe").count(),
        }

    for identifier in PACKAGES:
        page.request.post(f"{origin}/api/extensions/{identifier}/disable")
        page.request.delete(f"{origin}/api/extensions/{identifier}")
    jobs_before = page.request.get(origin + "/api/jobs").json()
    result = {
        "boundary": "Retained renderer JS heaps after explicit GC, BFCache disabled; not total browser RAM, GPU memory, or leak proof",
        "all_disabled": screen(),
    }
    installed = install(page, origin, packages(folder))
    result["all_enabled_same_screen"] = screen()
    panels = {}
    try:
        for identifier in PACKAGES:
            if installed.get(identifier, {}).get("workspace"):
                panels[identifier] = {
                    "status": "skipped",
                    "reason": "Workspace entry is outside sandbox panel memory measurements",
                }
                continue
            started = time.monotonic()
            page.goto(origin + f"/workshop/assembly/{EPISODE}/board")
            menu = page.locator("[data-episode-extension-menu]").get_by_role(
                "button", name="Extensions", exact=True
            )
            menu.wait_for()
            board_ready = (time.monotonic() - started) * 1000
            panel_started = time.monotonic()
            menu.click()
            title = PACKAGES[identifier][1]
            page.get_by_role("menuitem", name=title, exact=True).click()
            iframe = page.locator(f'iframe[title="{title}"]')
            iframe.wait_for()
            frame = iframe.element_handle().content_frame()
            assert frame
            frame.locator(
                "#suggest-pacing" if identifier == "script-assistant" else "#load"
            ).wait_for()
            ready = (time.monotonic() - panel_started) * 1000
            page.wait_for_timeout(300)
            cdp.send("HeapProfiler.collectGarbage")
            state = metrics(cdp)
            panels[identifier] = {
                "status": "observed",
                "board_ready_ms": round(board_ready, 3),
                "observed_panel_ready_ms": round(ready, 3),
                "host_renderer_retained_js_heap_mb": round(state["JSHeapUsedSize"] / 1024**2, 3),
                "host_renderer_nodes": state["Nodes"],
                "iframe_count": page.locator("iframe").count(),
            }
            try:
                panel_cdp = page.context.new_cdp_session(frame)
                try:
                    panel_cdp.send("Performance.enable")
                    panel_cdp.send("HeapProfiler.collectGarbage")
                    nested = metrics(panel_cdp)
                    panels[identifier]["isolated_panel_renderer_retained_js_heap_mb"] = round(
                        nested["JSHeapUsedSize"] / 1024**2, 3
                    )
                    panels[identifier]["isolated_panel_renderer_nodes"] = nested["Nodes"]
                finally:
                    panel_cdp.detach()
            except Exception as exc:
                panels[identifier]["panel_renderer_heap_boundary"] = (
                    "No separate iframe CDP target: " + type(exc).__name__
                )
        result["opened_panels"] = panels
    finally:
        for identifier in installed:
            response = page.request.post(f"{origin}/api/extensions/{identifier}/disable")
            assert response.ok, response.text()
    result["disabled_again_same_screen"] = screen()
    assert page.request.get(origin + "/api/jobs").json() == jobs_before
    result["no_jobs_submitted"] = True
    return result


def run_case(browser, origin, width, theme, seconds, only, folder, idle_timeout_seconds):
    context = browser.new_context(
        viewport={"width": width, "height": 900 if width == 1440 else 844},
        color_scheme="light" if theme == "light" else "dark",
        reduced_motion="no-preference",
    )
    install_state(
        context,
        {
            "theme": THEME if theme == "dynamic" else "system",
            "reduceMotion": False,
            "pauseWallpaperWhenUnfocused": False,
            "homeGuideHidden": True,
        },
        idle_timeout_seconds,
    )
    page = context.new_page()
    page.set_default_timeout(10000)
    errors, external = [], []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    def guard(route):
        if route.request.url.startswith((origin + "/", "data:", "blob:")):
            route.continue_()
        else:
            external.append(route.request.resource_type)
            route.abort()

    page.route("**/*", guard)
    case = {"width": width, "height": 900 if width == 1440 else 844, "theme": theme}
    try:
        page.goto(origin + "/settings?tab=appearance")
        page.get_by_role(
            "combobox", name="Pause animated wallpaper when idle", exact=True
        ).wait_for()
        cdp = context.new_cdp_session(page)
        cdp.send("Performance.enable")
        case["fit"] = fit(page)
        assert not case["fit"]["horizontalOverflow"], case["fit"]
        if only == "interactions":
            case["long_form"] = long_form(page, cdp, origin)
        elif only == "extensions":
            case["extensions"] = extension_memory(page, cdp, origin, folder)
        elif theme == "dynamic":
            case["settings"] = settings(page, origin, idle_timeout_seconds)
            case["app_idle"] = freeze(page, cdp, seconds, idle_timeout_seconds)
            page.goto(origin + "/__power_fixture/clean")
            wait_video(page)
            page.wait_for_timeout(500)
            case["clean_video_playing"] = sample(page, cdp, seconds)
            page.locator("video").evaluate("v=>v.pause()")
            case["clean_video_paused"] = sample(page, cdp, seconds)
            assert case["clean_video_paused"]["video"]["decoded_frame_delta"] <= 1
            case["clean_video_boundary"] = "Plain video reference; explicit pause, no app idle hook"
        else:
            page.wait_for_timeout(2000)
            case["app_without_video"] = sample(page, cdp, seconds)
        if theme == "dynamic" and only is None:
            case["long_form"] = long_form(page, cdp, origin)
        assert not errors, errors
        assert not external, external
        case["status"] = "passed"
    except Exception as exc:
        case.update(
            status="failed",
            error=str(exc),
            traceback=traceback.format_exc(),
            fixture_page_text=page.locator("body").inner_text()[:1500],
        )
    finally:
        case["page_errors"], case["external_request_types"] = errors, external
        context.close()
    print(json.dumps({k: case.get(k) for k in ("width", "theme", "status", "error")}), flush=True)
    return case


def run(args):
    from playwright.sync_api import sync_playwright

    executable = args.browser or "C:/Program Files/Google/Chrome/Application/chrome.exe"
    if not Path(executable).is_file():
        raise RuntimeError("Pass --browser pointing to installed Chromium; nothing is installed")
    if not (ROOT / "web/dist/index.html").is_file():
        raise RuntimeError("Build web/dist before running this actual-browser measurement")
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    started = time.monotonic()
    with (
        tempfile.TemporaryDirectory(prefix="mio-power-acceptance-") as tmp,
        tempfile.TemporaryFile() as log,
    ):
        process = subprocess.Popen(
            [
                sys.executable,
                "-X",
                "utf8",
                str(Path(__file__).resolve()),
                "--serve",
                str(port),
                "--data",
                str(Path(tmp) / "workspace"),
            ],
            cwd=ROOT,
            stdout=log,
            stderr=log,
        )
        try:
            for _ in range(200):
                if process.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read().decode("utf-8", errors="replace")[-5000:])
                try:
                    with urllib.request.urlopen(origin + "/healthz", timeout=1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Disposable measurement server did not become ready")
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    executable_path=executable,
                    headless=not args.headed,
                    args=["--autoplay-policy=no-user-gesture-required"]
                    + (
                        ["--disable-features=BackForwardCache"] if args.only == "extensions" else []
                    ),
                )
                version = browser.version
                try:
                    cases = [
                        run_case(
                            browser,
                            origin,
                            width,
                            theme,
                            args.sample_seconds,
                            args.only,
                            Path(tmp),
                            args.idle_timeout_seconds,
                        )
                        for width in args.width or (1440, 390)
                        for theme in args.theme or ("light", "dark", "dynamic")
                    ]
                finally:
                    browser.close()
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    return {
        "browser": executable,
        "browser_version": version,
        "headless": not args.headed,
        "only": args.only,
        "sample_count_per_state": 1,
        "selected_idle_timeout_seconds": args.idle_timeout_seconds,
        "real_wall_clock_idle_timeout_seconds_tested": (
            args.idle_timeout_seconds
            if args.only is None and (args.theme is None or "dynamic" in args.theme)
            else None
        ),
        "real_wall_clock": True,
        "measurement": "Renderer CDP/trace/video decode counters; not watts or GPU utilization",
        "video_fixture": "Local ffmpeg H.264 1280x720 30fps 8-second loop",
        "data_boundary": "Temporary neutral generated assets only; no user data or remote services",
        "idle_timeout_boundary": (
            "Only selected timeout real-waited; other values persisted and native timer schedule observed, not real-waited"
            if args.only is None and (args.theme is None or "dynamic" in args.theme)
            else "Wallpaper timeout assertions are outside this selected phase"
        ),
        "raw_traces_saved": False,
        "temporary_workspace_removed": True,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "cases": cases,
        "passed": sum(c["status"] == "passed" for c in cases),
        "failed": sum(c["status"] == "failed" for c in cases),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--width", type=int, choices=(1440, 390), action="append")
    parser.add_argument("--theme", choices=("light", "dark", "dynamic"), action="append")
    parser.add_argument("--sample-seconds", type=float, default=5)
    parser.add_argument("--idle-timeout-seconds", type=int, choices=(30, 60, 180), default=30)
    parser.add_argument("--only", choices=("interactions", "extensions"))
    parser.add_argument("--report", type=Path)
    parser.add_argument("--serve", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--data", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.serve:
        if not args.data:
            parser.error("--serve requires parent-owned disposable --data")
        serve(args.serve, args.data)
        return 0
    if args.sample_seconds < 2 or args.sample_seconds > 10:
        parser.error("--sample-seconds must be between 2 and 10")
    report = run(args)
    content = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(content + "\n", encoding="utf-8")
    print(content)
    return int(report["failed"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
