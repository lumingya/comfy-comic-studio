"""Shared, bounded evidence collection for the local creative browser checks."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit

EPISODE_ID = "creative-episode"
SERIES_ID = "creative-series"
CANVAS_ID = "creative-canvas"
CANVAS_SERIES = "creative-canvas-series"
WORKSHOP_ID = "creative-workshop"
WORKFLOW_ID = "creative-neutral-workflow"


def assert_fit(page, selector: str) -> dict:
    bounds = page.locator(selector).bounding_box()
    assert bounds, f"Missing visible region: {selector}"
    viewport = page.viewport_size
    assert -1 <= bounds["x"] and bounds["x"] + bounds["width"] <= viewport["width"] + 1, bounds
    assert -1 <= bounds["y"] and bounds["y"] + bounds["height"] <= viewport["height"] + 1, bounds
    return {key: round(value, 1) for key, value in bounds.items()}


def screenshot(page, directory: Path | None, name: str) -> None:
    if directory:
        directory.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(directory / f"{name}.png"), animations="disabled")


def get_json(page, origin: str, path: str):
    response = page.request.get(origin + path)
    assert response.ok, (path, response.status)
    return response.json()


def fixture(page, origin: str, action: str, data=None):
    response = page.request.post(origin + "/__creative_fixture/" + action, data=data)
    assert response.ok, (action, response.status)
    return response.json()


class Evidence:
    """Capture only synthetic fixture traffic, never headers, tokens or external response text."""

    def __init__(self, page, origin: str):
        self.requests, self.errors, self.external = [], [], []
        self.expected_conflicts: set[str] = set()
        self.conflicts = []
        page.on("request", self.request)
        page.on("response", self.response)
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("console", self.console)

        def route(request):
            if request.request.url.startswith((origin + "/", "data:", "blob:")):
                request.continue_()
            else:
                self.external.append(request.request.resource_type)
                request.abort()

        page.route("**/*", route)

    def request(self, request):
        path = urlsplit(request.url).path
        if path.startswith("/api/"):
            body = None
            if request.post_data:
                try:
                    body = request.post_data_json
                except ValueError:
                    body = "non-JSON body"
            self.requests.append({"method": request.method, "path": path, "body": body})

    def response(self, response):
        path = urlsplit(response.url).path
        if response.status < 400:
            return
        if response.status == 409 and path in self.expected_conflicts:
            self.conflicts.append(path)
        else:
            self.errors.append(f"HTTP {response.status}: {path}")

    def console(self, message):
        if message.type != "error":
            return
        path = urlsplit(message.location.get("url", "")).path
        if path in self.expected_conflicts and "409" in message.text:
            return
        self.errors.append(message.text)

    def matching(self, method: str, path: str):
        return [item for item in self.requests if item["method"] == method and item["path"] == path]
