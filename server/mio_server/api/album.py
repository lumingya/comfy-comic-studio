"""Album templates (secondary output): list / import / delete, and HTML album export."""

from __future__ import annotations

from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field

from ..album import media as M
from ..album import templates as T
from ..album.build import episode_book, episode_pages
from ..album.render import AlbumOptions, render_album
from ..storage import NotFound
from .deps import Ctx

router = APIRouter(tags=["album"])


class AlbumExport(BaseModel):
    episode_ids: list[str] = Field(min_length=1, max_length=50)
    template_id: str = "export-paper"
    variant_id: str | None = None
    lettered: bool = Field(default=True, description="Crop panels from the lettered strip")
    show_captions: bool = True
    show_prompts: bool = False
    theme_color: str = ""
    border: int = Field(default=0, ge=0, le=8)
    signature: str = Field(default="", max_length=120)
    title: str = Field(default="", max_length=120)
    max_width: int = Field(
        default=1400, ge=320, le=4000, description="Only used by the ``preview`` image profile"
    )
    image_profile: M.Profile = Field(
        default="preview",
        description="图片处理: auto / clean (无损清洗) / publish (轻量发布) / archive (无损归档); "
        "preview = fast in-app preview encoding",
    )


class PortableExport(BaseModel):
    episode_ids: list[str] = Field(min_length=1, max_length=50)
    format: Literal["zip", "pdf"] = "zip"
    variant_id: str | None = None
    lettered: bool = True
    show_captions: bool = True
    title: str = Field(default="", max_length=120)
    image_profile: M.Profile = "auto"


def _find(ctx, template_id: str):
    item = next((c for c in ctx.registry.all("album_template") if c.id == template_id), None)
    if item is None:
        raise NotFound(f"画册模板不存在：{template_id}")
    return item


@router.get("/album-templates")
def list_templates(ctx: Ctx) -> list[dict]:
    return [T.summary(c.value, c.source) for c in ctx.registry.all("album_template")]


@router.get("/album-templates/{template_id}")
def get_template(ctx: Ctx, template_id: str) -> dict:
    return _find(ctx, template_id).value.model_dump(exclude={"name"})


@router.post("/album-templates", status_code=status.HTTP_201_CREATED)
def import_template(ctx: Ctx, body: dict) -> dict:
    """Import a template file (the legacy ``formatVersion: 1`` format works unchanged)."""
    tpl = T.parse_template(body)
    existing = next((c for c in ctx.registry.all("album_template") if c.id == tpl.id), None)
    if existing and existing.source != "user":
        raise ValueError(f"模板 id 已被占用：{tpl.id}")
    ctx.store.put_doc(tpl)
    ctx.registry.register(
        "album_template", tpl.id, tpl, source="user", title=tpl.title, replace=True
    )
    return T.summary(tpl, "user")


@router.delete("/album-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(ctx: Ctx, template_id: str) -> None:
    if _find(ctx, template_id).source != "user":
        raise ValueError("只能删除自己导入的模板")
    ctx.store.delete_doc("album_template", template_id)
    ctx.registry.unregister("album_template", template_id)


@router.post("/export/album")
def export_album(ctx: Ctx, body: AlbumExport) -> Response:
    """Self-contained offline HTML album; one book per episode."""
    tpl = _find(ctx, body.template_id).value
    requested = body.image_profile
    profile = "clean" if requested == "auto" else requested

    def build(profile: str) -> tuple[list, M.Stats]:
        stats = M.Stats(profile)
        books = [
            episode_book(
                ctx,
                eid,
                variant_id=body.variant_id,
                lettered=body.lettered,
                max_width=body.max_width,
                profile=profile,
                stats=stats,
            )
            for eid in body.episode_ids
        ]
        return books, stats

    books, stats = build(profile)
    if requested == "auto" and M.over_budget(stats):
        books, stats = build("publish")
        stats.auto_compressed = True
    stats.over_budget = M.over_budget(stats)
    html = render_album(
        tpl,
        books,
        AlbumOptions(
            show_captions=body.show_captions,
            show_prompts=body.show_prompts,
            border=body.border,
            signature=body.signature,
            theme_color=body.theme_color,
            collection_title=body.title,
        ),
    )
    data = html.encode("utf-8")
    base = body.title or (books[0].title if len(books) == 1 else f"画册合集_{len(books)}话")
    filename = f"{base}_{tpl.id}.html"
    for eid in body.episode_ids:
        ctx.hooks.action(
            "episode.exported",
            {"episode_id": eid, "fmt": "album", "bytes": len(data), "filename": filename},
        )
    return Response(
        data,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "X-Mio-Export": stats.header(),
        },
    )


_READER = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>body{{margin:0;background:#141716;color:#e7ece8;font:15px/1.8 system-ui,sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:32px 16px 80px}}h1{{font-weight:400;margin:0 0 4px}}
h2{{font-weight:400;font-size:18px;margin:48px 0 16px;color:#a9b8ad}}figure{{margin:0 0 28px}}
img{{display:block;width:100%;height:auto;border-radius:4px}}
figcaption{{color:#a9b8ad;font-size:14px;margin-top:8px}}</style>
<main><h1>{title}</h1>{books}</main></html>
"""


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:60] or "album"


@router.post("/export/portable")
def export_portable(ctx: Ctx, body: PortableExport) -> Response:
    """ZIP 图片资源包 (simple reader + image files) or PDF 图片画册 (one page per panel).

    Neither is bound by the single-file inline budget, so ``auto`` means 无损清洗 here.
    """
    import html as H
    import io
    import json
    import zipfile

    from PIL import Image

    profile = "clean" if body.image_profile in ("auto", "preview") else body.image_profile
    stats = M.Stats(profile)
    episodes = [
        episode_pages(
            ctx,
            eid,
            variant_id=body.variant_id,
            lettered=body.lettered,
            profile=profile,
            stats=stats,
        )
        for eid in body.episode_ids
    ]
    if not any(p for _, _, pages in episodes for p in pages):
        raise ValueError("没有可导出的格，请先采用图片")
    series = episodes[0][1]
    title = body.title or (
        episodes[0][0].title if len(episodes) == 1 else f"{series.title}_{len(episodes)}话"
    )
    base = _safe(title)
    if body.format == "pdf":
        sheets = []
        for _, _, pages in episodes:
            for page in pages:
                if page is not None:
                    with Image.open(io.BytesIO(page.data)) as im:
                        sheets.append(im.convert("RGB"))
        buf = io.BytesIO()
        quality = 85 if profile == "publish" else 95
        sheets[0].save(
            buf, "PDF", save_all=True, append_images=sheets[1:], resolution=96, quality=quality
        )
        data, mime, filename = buf.getvalue(), "application/pdf", f"{base}.pdf"
    else:
        buf = io.BytesIO()
        manifest: dict = {"title": title, "image_profile": profile, "books": []}
        sections = []
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            for n, (ep, _, pages) in enumerate(episodes, start=1):
                folder = f"images/{n:02d}" if len(episodes) > 1 else "images"
                files, figures = [], []
                for i, page in enumerate(pages, start=1):
                    if page is None:
                        continue
                    name = f"{folder}/{i:03d}.{M.ext_of(page.mime)}"
                    z.writestr(name, page.data)
                    files.append({"name": name, "caption": page.caption})
                    cap = (
                        f"<figcaption>{H.escape(page.caption)}</figcaption>"
                        if body.show_captions and page.caption
                        else ""
                    )
                    figures.append(
                        f'<figure><img loading="lazy" src="{name}" alt="{H.escape(page.name)}">'
                        f"{cap}</figure>"
                    )
                head = f"<h2>{H.escape(ep.title)}</h2>" if len(episodes) > 1 else ""
                sections.append(head + "".join(figures))
                manifest["books"].append({"title": ep.title, "files": files})
            z.writestr("index.html", _READER.format(title=H.escape(title), books="".join(sections)))
            z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        data, mime, filename = buf.getvalue(), "application/zip", f"{base}.zip"
    for eid in body.episode_ids:
        ctx.hooks.action(
            "episode.exported",
            {"episode_id": eid, "fmt": body.format, "bytes": len(data), "filename": filename},
        )
    return Response(
        data,
        media_type=mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "X-Mio-Export": stats.header(),
        },
    )
