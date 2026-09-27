"""Versioned, offline handbook bundled with the new server at ``/manual/``.

The restored UI still links to the former ``docs/guide/*.html`` names. Resolve those names to
current handbook sections instead of silently serving 3.2 instructions. Only explicitly listed
files are reachable; neither the legacy checkout nor a Markdown/CDN runtime is required.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

from fastapi import APIRouter
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse

MANUAL = Path(__file__).resolve().parents[1] / "manual"
ZH = "/manual/docs/index.html"
EN = "/manual/docs/en/GUIDE.html"
FILES = {
    "docs/index.html": "index.html",
    "docs/en/GUIDE.html": "en.html",
    "docs/guide/img/flow.svg": "flow.svg",
}
GUIDES = {
    "QUICKSTART": "start",
    "CONFIGURATION": "connect-a-provider",
    "CHANNELS_AND_KEYS": "connect-a-provider",
    "WORKFLOW": "workflow",
    "IMAGE_VARIABLES": "variables",
    "FOUNDATION": "tasks",
    "PRESENTATION": "read-and-share",
    "CONTENT_AND_SHARING": "sharing",
    "BACKUP": "backup",
    "FILE_LIBRARY": "files",
    "FILE_LIBRARY_CONVERSION": "files",
    "MOBILE": "mobile",
    "TROUBLESHOOTING": "troubleshooting",
    "GLOSSARY": "glossary",
    "API": "sharing",
}
HEADERS = {
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; "
        "base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
    ),
}
router = APIRouter(include_in_schema=False)


def available() -> bool:
    return all((MANUAL / name).is_file() for name in FILES.values())


def _missing() -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Not Found", "kind": "not_found"})


@router.get("/manual")
@router.get("/manual/")
def manual_home() -> RedirectResponse:
    return RedirectResponse(ZH)


@router.get("/manual/{path:path}")
def manual(path: str):
    rel = PurePosixPath(path)
    if rel.is_absolute() or ".." in rel.parts or "\\" in path:
        return _missing()
    name = rel.as_posix()
    if name == "index.html":  # old handbook's "Open Mio" link
        return RedirectResponse("/")
    if name in ("README.html", "README.en.html"):
        return RedirectResponse((EN if name == "README.en.html" else ZH) + "#start")
    if len(rel.parts) == 3 and rel.parts[:2] in (("docs", "guide"), ("docs", "en")):
        section = GUIDES.get(rel.stem) if rel.suffix == ".html" else None
        if section:
            return RedirectResponse((EN if rel.parts[1] == "en" else ZH) + "#" + section)
    resource = FILES.get(name)
    if resource:
        root = MANUAL.resolve()
        target = (root / resource).resolve()
        if root in target.parents and target.is_file():
            return FileResponse(target, headers=HEADERS)
    return _missing()
