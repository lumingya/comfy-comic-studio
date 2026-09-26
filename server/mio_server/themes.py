"""UI themes: named sets of colour tokens (the CSS variables in ``web/src/styles/base.css``).

A theme is inert data — only colour values, validated here — so users can import theme files and
extensions can ship them without any trust prompt beyond enabling the extension.  Missing tokens
fall back to the built-in theme of the same mode, so a theme may override just the accent.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import Field, ValidationError, field_validator

from .models import StrictModel, now_iso

TOKENS = (
    "bg",
    "bg-deep",
    "panel",
    "panel-2",
    "hover",
    "line",
    "line-strong",
    "text",
    "soft",
    "muted",
    "accent",
    "accent-strong",
    "on-accent",
    "tint",
    "amber",
    "red",
    "blue",
    "shadow",
)
COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[0-9.,%/\sdeg]+\))$")
SHADOW_RE = re.compile(r"^[0-9a-zA-Z#(),./%\s-]{1,160}$")


class ThemeError(ValueError):
    pass


class Theme(StrictModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,47}$")
    name: str = Field(min_length=1, max_length=60)
    mode: Literal["light", "dark"]
    tokens: dict[str, str] = Field(default_factory=dict)
    author: str = ""
    created_at: str = Field(default_factory=now_iso)

    @field_validator("tokens")
    @classmethod
    def check_tokens(cls, tokens: dict[str, str]) -> dict[str, str]:
        for key, value in tokens.items():
            if key not in TOKENS:
                raise ValueError(f"未知的配色令牌：{key}")
            value = value.strip()
            ok = SHADOW_RE.match(value) if key == "shadow" else COLOR_RE.match(value)
            if not ok or "url" in value.lower():
                raise ValueError(f"{key} 的取值不合法：{value[:40]}")
        return {k: v.strip() for k, v in tokens.items()}


INK = Theme(
    id="ink",
    name="墨（深色）",
    mode="dark",
    tokens={
        "bg": "#101312",
        "bg-deep": "#0b0d0c",
        "panel": "#171b1a",
        "panel-2": "#1e2321",
        "hover": "#252b28",
        "line": "#29302d",
        "line-strong": "#3a4340",
        "text": "#e8ece7",
        "soft": "#b6beb5",
        "muted": "#7d887f",
        "accent": "#a9dcb1",
        "accent-strong": "#6f9f77",
        "on-accent": "#0f2215",
        "tint": "rgb(169 220 177 / 0.09)",
        "amber": "#e0bb7c",
        "red": "#ec9a94",
        "blue": "#9cc3e6",
        "shadow": "0 18px 48px rgb(0 0 0 / 0.45)",
    },
)
PAPER = Theme(
    id="paper",
    name="纸（浅色）",
    mode="light",
    tokens={
        "bg": "#f3f4ef",
        "bg-deep": "#e9ebe4",
        "panel": "#ffffff",
        "panel-2": "#eef0ea",
        "hover": "#e5e9e1",
        "line": "#dadfd4",
        "line-strong": "#c3cabd",
        "text": "#1f2721",
        "soft": "#4b5a4e",
        "muted": "#7a847b",
        "accent": "#2f5b3c",
        "accent-strong": "#3f7550",
        "on-accent": "#f5f8f3",
        "tint": "rgb(47 91 60 / 0.08)",
        "amber": "#9a6e22",
        "red": "#b0473f",
        "blue": "#2f6c9e",
        "shadow": "0 18px 48px rgb(30 40 30 / 0.16)",
    },
)
MIDNIGHT = Theme(
    id="midnight",
    name="午夜（深蓝）",
    mode="dark",
    tokens={
        "bg": "#0f1320",
        "bg-deep": "#0a0d17",
        "panel": "#161b2c",
        "panel-2": "#1c2236",
        "hover": "#232a42",
        "line": "#2a3150",
        "line-strong": "#3a4368",
        "text": "#e6e9f5",
        "soft": "#b3b9d3",
        "muted": "#7c84a6",
        "accent": "#9db8ff",
        "accent-strong": "#6c86d9",
        "on-accent": "#0c1433",
        "tint": "rgb(157 184 255 / 0.1)",
    },
)
SAKURA = Theme(
    id="sakura",
    name="樱（浅粉）",
    mode="light",
    tokens={
        "bg": "#faf3f3",
        "bg-deep": "#f3e7e8",
        "panel": "#ffffff",
        "panel-2": "#f7eced",
        "hover": "#f1e1e3",
        "line": "#ead5d8",
        "line-strong": "#d9b9be",
        "text": "#2d2224",
        "soft": "#5e4a4e",
        "muted": "#8f7b7f",
        "accent": "#b24a64",
        "accent-strong": "#c9667e",
        "on-accent": "#fff6f8",
        "tint": "rgb(178 74 100 / 0.08)",
    },
)
BUILTIN = (INK, PAPER, MIDNIGHT, SAKURA)
BASE = {"dark": INK, "light": PAPER}


def parse_theme(data: dict) -> Theme:
    try:
        return Theme.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise ThemeError(f"主题不合法（{where}）：{first['msg']}") from None


def resolved(theme: Theme) -> dict[str, str]:
    """Every token, falling back to the built-in theme of the same mode."""
    return {**BASE[theme.mode].tokens, **theme.tokens}


def to_json(theme: Theme, source: str) -> dict:
    return {
        "id": theme.id,
        "name": theme.name,
        "mode": theme.mode,
        "author": theme.author,
        "source": source,
        "tokens": resolved(theme),
    }
