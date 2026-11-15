"""UI themes: named sets of safe CSS design tokens.

A theme is inert data — colours, bounded dimensions and shadows only — so users can import theme
files and extensions can ship them without turning a theme into arbitrary CSS.  Missing colour
tokens fall back to the built-in theme of the same mode, so a theme may override just the accent.
Semantic control tokens are optional overrides; the CSS defaults remain responsible for deriving
them from the palette when they are absent.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import Field, ValidationError, field_validator

from .models import StrictModel, now_iso

COLOR_TOKENS = (
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
    "button-border",
    "button-hover",
    "button-primary",
    "button-primary-text",
    "button-danger",
    "button-active",
    "control-surface",
    "control-border",
    "control-focus",
    "surface-panel",
    "surface-raised",
)
SHADOW_TOKENS = ("shadow", "shadow-sm")
LENGTH_TOKENS = (
    "radius-control",
    "radius-card",
    "control-height",
    "button-height",
    "button-small-height",
    "button-large-height",
    "space-control",
    "space-panel",
)
TOKENS = (*COLOR_TOKENS, *SHADOW_TOKENS, *LENGTH_TOKENS)

NUMBER = r"[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)"
HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})")
COLOR_FUNCTION_RE = re.compile(r"(rgb|rgba|hsl|hsla)\(([^()]*)\)")
LENGTH_RE = re.compile(rf"({NUMBER})(px|rem)?")
# Keep dimensions useful without allowing an imported theme to create an unbounded layout.
# Heights are positive; radii and spacing intentionally permit zero.
LENGTH_LIMITS_PX = {
    "radius-control": (0.0, 128.0),
    "radius-card": (0.0, 256.0),
    "control-height": (1.0, 256.0),
    "button-height": (1.0, 256.0),
    "button-small-height": (1.0, 256.0),
    "button-large-height": (1.0, 256.0),
    "space-control": (0.0, 256.0),
    "space-panel": (0.0, 256.0),
}


def _length_px(value: str) -> float | None:
    match = LENGTH_RE.fullmatch(value)
    if not match:
        return None
    number = float(match.group(1))
    if match.group(2) is None and number != 0:
        return None
    if match.group(2) == "rem":
        number *= 16
    return number


def _channel(value: str, high: float, *, percent_only: bool = False) -> bool:
    percent = value.endswith("%")
    number = value[:-1] if percent else value
    if percent_only and not percent:
        return False
    return bool(re.fullmatch(NUMBER, number)) and 0 <= float(number) <= (100 if percent else high)


def _color(value: str) -> bool:
    if value == "transparent" or HEX_RE.fullmatch(value):
        return True
    match = COLOR_FUNCTION_RE.fullmatch(value)
    if not match:
        return False
    function, body = match.groups()
    if "," in body:
        if "/" in body:
            return False
        parts = [part.strip() for part in body.split(",")]
        if len(parts) not in (3, 4):
            return False
        channels, alpha = parts[:3], parts[3:]
    else:
        parts = body.split("/")
        if len(parts) > 2:
            return False
        channels = parts[0].split()
        alpha = [parts[1].strip()] if len(parts) == 2 else []
        if len(channels) != 3:
            return False
    if alpha and not _channel(alpha[0], 1):
        return False
    if function.startswith("rgb"):
        return all(_channel(channel, 255) for channel in channels)
    hue = channels[0].removesuffix("deg")
    return bool(re.fullmatch(NUMBER, hue)) and all(
        _channel(channel, 100, percent_only=True) for channel in channels[1:]
    )


def _shadow(value: str) -> bool:
    if value == "none":
        return True
    if len(value) > 512:
        return False
    # Commas inside colour functions are not layer separators; nested functions are not allowed.
    layers = re.split(r",(?![^()]*\))", value)
    if len(layers) > 4:
        return False
    for layer in layers:
        words = re.findall(r"(?:rgb|rgba|hsl|hsla)\([^()]*\)|\S+", layer.strip())
        if not words:
            return False
        if "inset" in words:
            words.remove("inset")
        if words and _color(words[0]):
            words.pop(0)
        elif words and _color(words[-1]):
            words.pop()
        if not 2 <= len(words) <= 4:
            return False
        for index, word in enumerate(words):
            dimension = _length_px(word)
            if dimension is None or abs(dimension) > 1024 or (index == 2 and dimension < 0):
                return False
    return True


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
                raise ValueError(f"未知的主题令牌：{key}")
            value = value.strip()
            if key in COLOR_TOKENS:
                ok = _color(value)
            elif key in SHADOW_TOKENS:
                ok = _shadow(value)
            else:
                px = _length_px(value)
                low, high = LENGTH_LIMITS_PX[key]
                ok = px is not None and low <= px <= high
            if not ok:
                raise ValueError(f"{key} 的取值不合法：{value[:40]}")
        return {k: v.strip() for k, v in tokens.items()}


INK = Theme(
    id="ink",
    name="石墨（深色）",
    mode="dark",
    tokens={
        # Graphite & Sage: the classic (3.x) palette.
        "bg": "#131517",
        "bg-deep": "#17191b",
        "panel": "#1c1f21",
        "panel-2": "#24282a",
        "hover": "#2b302e",
        "line": "#2c3031",
        "line-strong": "#3a403f",
        "text": "#e8ebe7",
        "soft": "#b1b8b0",
        "muted": "#a0aaa2",
        "accent": "#b8e9bd",
        "accent-strong": "#89b993",
        "on-accent": "#15291c",
        "tint": "#293b2e",
        "amber": "#d1b181",
        "red": "#e99292",
        "blue": "#489abe",
        "shadow": "0 10px 28px rgb(0 0 0 / 0.36)",
    },
)
PAPER = Theme(
    id="paper",
    name="鼠尾草纸（浅色）",
    mode="light",
    tokens={
        "bg": "#f3f5f0",
        "bg-deep": "#ecefe7",
        "panel": "#ffffff",
        "panel-2": "#e4e9df",
        "hover": "#dce4d7",
        "line": "#d6ddcf",
        "line-strong": "#c3ccbc",
        "text": "#29332a",
        "soft": "#566754",
        "muted": "#5b6a57",
        "accent": "#355e40",
        "accent-strong": "#5f8963",
        "on-accent": "#f4f7f1",
        "tint": "#dce9d7",
        "amber": "#9e762d",
        "red": "#b44444",
        "blue": "#2f7fa8",
        "shadow": "0 10px 28px rgb(20 30 20 / 0.16)",
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
    """Complete the base palette and retain explicitly supplied semantic overrides.

    Semantic defaults stay in CSS, where they can follow the theme's palette instead of becoming
    copies of the base theme's colours.  This keeps existing accent-only theme files effective.
    """
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
