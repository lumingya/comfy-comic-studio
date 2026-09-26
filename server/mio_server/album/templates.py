"""Album templates (画册导出模板, a secondary output next to the strip).

The format is the legacy one (``formatVersion: 1``) so old template files import unchanged:
an HTML document with ``{{variables}}``, exactly one ``{{#books}}…{{/books}}`` loop containing
exactly one ``{{#frames}}…{{/frames}}`` loop, and ``{{image}}`` inside the frame loop.
Templates are inert: ``<script>`` is refused (the exported file only runs Mio's own reader under
a nonce CSP), and custom runtime scripts from old templates are ignored.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
LAYOUTS = {
    "webtoon": "Webtoon 长卷",
    "manga": "Manga 双页",
    "artbook": "Artbook 艺术册",
    "flip": "交互画册",
}
BUILTIN_DIR = Path(__file__).resolve().parent / "builtin"


class TemplateError(ValueError):
    pass


class TemplateOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")

    accent: str = "#b66b48"
    background: str = "#f1eee6"
    paper: str = "#faf8f2"
    text: str = "#273b34"
    width: int = Field(default=900, ge=320, le=2400)
    gap: int = Field(default=24, ge=0, le=200)
    radius: int = Field(default=8, ge=0, le=64)
    font: Literal["serif", "sans"] = "sans"

    @field_validator("accent", "background", "paper", "text")
    @classmethod
    def hex_color(cls, value: str) -> str:
        if not HEX.match(value):
            raise ValueError("颜色必须是六位十六进制色值")
        return value


class AlbumTemplate(BaseModel):
    """Stored as a document (kind ``album_template``) when imported by the user."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
    name: str = "album_template"
    formatVersion: Literal[1] = 1
    title: str = Field(min_length=1, max_length=80)
    description: str = ""
    author: str = ""
    version: str = ""
    layout: Literal["webtoon", "manga", "artbook", "flip"] = "webtoon"
    options: TemplateOptions = Field(default_factory=TemplateOptions)
    html: str = Field(max_length=400_000)
    assets: dict[str, str] = Field(default_factory=dict, description="{{asset:key}} data URLs")

    @field_validator("html")
    @classmethod
    def check_html(cls, raw: str) -> str:
        for loop in ("books", "frames"):
            if raw.count("{{#" + loop + "}}") != 1 or raw.count("{{/" + loop + "}}") != 1:
                raise ValueError("模板需要且只能有一组 {{#" + loop + "}} 循环")
        bs, be = raw.find("{{#books}}"), raw.find("{{/books}}")
        fs, fe = raw.find("{{#frames}}"), raw.find("{{/frames}}")
        if not (bs < fs < fe < be):
            raise ValueError("frames 循环必须嵌套在 books 循环内")
        if not re.search(r"\{\{\s*image\s*\}\}", raw[fs:fe]):
            raise ValueError("分镜循环中缺少 {{image}}")
        if re.search(r"<\s*script\b", raw, re.IGNORECASE):
            raise ValueError("模板里不能包含 <script>（导出文件只运行 Mio 自带的阅读脚本）")
        return raw

    @field_validator("assets")
    @classmethod
    def check_assets(cls, assets: dict[str, str]) -> dict[str, str]:
        for key, value in assets.items():
            if not re.match(r"^[a-zA-Z][a-zA-Z0-9_-]{0,47}$", key):
                raise ValueError(f"素材键不合法：{key}")
            if not value.startswith("data:image/"):
                raise ValueError(f"素材 {key} 必须是图片 data URL")
        return assets


def parse_template(data: dict) -> AlbumTemplate:
    try:
        return AlbumTemplate.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise TemplateError(f"不是合法的画册模板（{where}）：{first['msg']}") from None


@lru_cache(maxsize=1)
def builtin_templates() -> tuple[AlbumTemplate, ...]:
    out = []
    for path in sorted(BUILTIN_DIR.glob("*.json")):
        out.append(parse_template(json.loads(path.read_text(encoding="utf-8"))))
    return tuple(out)


def summary(tpl: AlbumTemplate, source: str) -> dict:
    return {
        "id": tpl.id,
        "title": tpl.title,
        "description": tpl.description,
        "author": tpl.author,
        "layout": tpl.layout,
        "layout_name": LAYOUTS[tpl.layout],
        "options": tpl.options.model_dump(),
        "source": source,
    }
