"""The legacy handbook (使用教程) under ``/manual/``: ``legacy/docs`` rendered offline.

The legacy app served its Markdown guides as self-contained HTML pages (``backend/mio_docs.py``:
the Markdown is embedded in ``docs/reader-template.html`` together with the vendored marked and
DOMPurify, so no network is needed). The same pages are rendered here on request, so the help
drawer, Home and 设置 → 工具与资源 can link to them from the new app.

``/manual/docs/index.html`` is the 教程中心; ``/manual/docs/guide/QUICKSTART.html`` renders
``legacy/docs/guide/QUICKSTART.md``. Only files under ``legacy/docs`` (plus the README) are
reachable; nothing is written to disk.
"""

from __future__ import annotations

import json
import urllib.parse
from pathlib import Path, PurePosixPath

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse

LEGACY = Path(__file__).resolve().parents[3] / "legacy"
STATIC = {".svg", ".png", ".webp", ".jpg", ".jpeg", ".gif", ".json", ".css"}

router = APIRouter(include_in_schema=False)


def available() -> bool:
    return (LEGACY / "docs" / "reader-template.html").is_file()


def render_markdown(relative: PurePosixPath) -> str:
    """legacy ``mio_docs.render_document``: the Markdown inside the offline reader template."""
    text = (LEGACY / relative).read_text(encoding="utf-8-sig")
    template = (LEGACY / "docs" / "reader-template.html").read_text(encoding="utf-8")
    payload = json.dumps(
        {
            "markdown": text,
            "path": relative.as_posix(),
            "english": "/en/" in "/" + relative.as_posix() or relative.name.endswith(".en.md"),
        },
        ensure_ascii=False,
    )
    # JSON data must never be able to terminate its script element.
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    prefix = "../" * (len(relative.parts) - 1)
    vendor = LEGACY / "vendor"
    return (
        template.replace("__HOME__", prefix + "docs/index.html")
        .replace("__APP__", prefix + "index.html")
        .replace("__SOURCE__", urllib.parse.quote(relative.name))
        .replace("__DOC_DATA__", payload)
        .replace("__MARKED__", (vendor / "marked.min.js").read_text(encoding="utf-8"))
        .replace("__PURIFY__", (vendor / "purify.min.js").read_text(encoding="utf-8"))
    )


def _inside(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _missing() -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Not Found", "kind": "not_found"})


@router.get("/manual")
@router.get("/manual/")
def manual_home() -> RedirectResponse:
    return RedirectResponse("/manual/docs/index.html")


@router.get("/manual/{path:path}")
def manual(path: str):
    rel = PurePosixPath(path)
    if rel.as_posix() == "index.html":  # the handbook's 「打开 Mio」 link
        return RedirectResponse("/")
    if not available() or ".." in rel.parts or rel.is_absolute():
        return _missing()
    docs = (LEGACY / "docs").resolve()
    target = (LEGACY / rel).resolve()
    readme = rel.as_posix() in ("README.html", "README.en.html")
    if not (readme or _inside(target, docs)):
        return _missing()
    if rel.suffix == ".html":
        source = rel.with_suffix(".md")
        # Prefer the Markdown (the committed source); hand-written pages such as docs/index.html
        # have no Markdown sibling and are served as they are.
        if (LEGACY / source).is_file():
            return HTMLResponse(render_markdown(source), headers={"Cache-Control": "no-cache"})
        if target.is_file() and not readme:
            return FileResponse(target, headers={"Cache-Control": "no-cache"})
        return _missing()
    if rel.suffix.lower() in STATIC and target.is_file():
        return FileResponse(target)
    return _missing()
