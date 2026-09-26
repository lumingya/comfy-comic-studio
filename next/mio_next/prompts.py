"""Dual-dialect prompt compiler (pure functions).

* ``danbooru``: tag prompts for local Illustrious / NoobAI SDXL checkpoints.
* ``natural``: English prose for cloud image models, with numbered reference images.

Both read the same structured panel, so a story is written once and rendered by either path.
"""
from __future__ import annotations

import re

QUALITY = ("masterpiece", "best quality", "amazing quality", "very aesthetic", "absurdres", "newest")
RATING = ("general",)
STYLE_TAGS = ("anime coloring", "clean lineart")
NEGATIVE = ("nsfw", "explicit", "questionable", "lowres", "bad anatomy", "bad hands", "extra fingers",
            "missing fingers", "extra arms", "deformed", "text", "english text", "speech bubble", "watermark",
            "signature", "username", "worst quality", "low quality", "normal quality", "jpeg artifacts", "blurry")
SHOT_TAGS = {
    "extreme_close": ("portrait", "close-up", "face focus"),
    "close": ("portrait", "close-up"),
    "medium": ("upper body",),
    "cowboy": ("cowboy shot",),
    "full": ("full body",),
    "wide": ("wide shot", "scenery"),
}
ANGLE_TAGS = {"eye": (), "high": ("from above",), "low": ("from below",), "side": ("from side",),
              "back": ("from behind",), "dutch": ("dutch angle",)}
TIME_TAGS = {"morning": ("morning", "sunlight"), "day": ("day",), "evening": ("evening", "sunset", "orange sky"),
             "night": ("night",)}
SHOT_TEXT = {
    "extreme_close": "an extreme close-up on the face",
    "close": "a close-up shot (head and shoulders)",
    "medium": "a medium shot (waist up)",
    "cowboy": "a cowboy shot (mid-thigh up)",
    "full": "a full-body shot",
    "wide": "a wide establishing shot where the environment dominates",
}
ANGLE_TEXT = {"eye": "at eye level", "high": "seen from a high angle", "low": "seen from a low angle",
              "side": "seen from the side", "back": "seen from behind", "dutch": "with a tilted dutch angle"}
# SDXL-friendly sizes (multiples of 64, about one megapixel) per shot
PANEL_SIZES = {"extreme_close": (1216, 832), "close": (1152, 896), "medium": (1024, 1024),
               "cowboy": (896, 1152), "full": (832, 1216), "wide": (1216, 832)}
NATURAL_STYLE = ("Japanese anime style webtoon panel, clean lineart, cel shading, soft consistent colors. "
                 "Absolutely no text, letters, speech bubbles, captions, panel borders or watermarks.")


def escape_tag(tag: str) -> str:
    """Parentheses are weighting syntax in ComfyUI prompts; literal ones must be escaped."""
    return re.sub(r"(?<!\\)([()])", r"\\\1", tag)


def dedupe(tags) -> list[str]:
    out = []
    for tag in tags:
        tag = tag.strip()
        if tag and tag not in out:
            out.append(tag)
    return out


def index(story: dict) -> tuple[dict, dict]:
    return ({c["id"]: c for c in story.get("characters") or []}, {s["id"]: s for s in story.get("scenes") or []})


def count_tags(genders: list[str]) -> list[str]:
    girls, boys = genders.count("female"), genders.count("male")
    if not genders:
        return ["no humans"]
    tags = []
    if girls:
        tags.append("1girl" if girls == 1 else f"{girls}girls")
    if boys:
        tags.append("1boy" if boys == 1 else f"{boys}boys")
    if len(genders) == 1:
        tags.append("solo")
    return tags


def display_name(character: dict) -> str:
    """Romanized label (``su_wan`` -> ``Su Wan``) so prose like "Su Wan opens the door" binds to
    the right reference image; falls back to the name field."""
    ident = character.get("id") or ""
    return ident.replace("_", " ").title() if ident.isascii() and ident else character.get("name", "")


def panel_size(panel: dict) -> tuple[int, int]:
    return PANEL_SIZES.get(panel.get("shot"), (1024, 1024))


def danbooru(story: dict, panel: dict, extra_style=STYLE_TAGS) -> tuple[str, str]:
    """``(positive, negative)`` tag prompts for one panel."""
    chars, scenes = index(story)
    scene = scenes.get(panel.get("scene"), {})
    cast = [c for c in panel.get("characters") or [] if c.get("id") in chars]
    tags = list(QUALITY) + list(RATING) + list(extra_style)
    tags += count_tags([chars[c["id"]]["gender"] for c in cast])
    for c in cast:
        tags += chars[c["id"]]["tags"]
        tags += c.get("tags") or []
    tags += SHOT_TAGS.get(panel.get("shot"), ())
    tags += ANGLE_TAGS.get(panel.get("angle"), ())
    tags += scene.get("tags") or []
    tags += TIME_TAGS.get(scene.get("time"), ())
    tags += panel.get("tags") or []
    negative = list(NEGATIVE)
    if not cast:
        negative += ["1girl", "1boy", "people"]
    elif len(cast) == 1:
        negative += ["multiple girls", "multiple boys", "2girls", "2boys"]
    return ", ".join(escape_tag(t) for t in dedupe(tags)), ", ".join(dedupe(negative))


ORDINALS = ("first", "second", "third", "fourth")


def natural(story: dict, panel: dict, with_refs: bool = True, lineup: bool = False) -> tuple[str, list[str]]:
    """``(prompt, ref_character_ids)``: prose prompt plus the characters whose sheets go along,
    in reference-image order. ``lineup`` describes one composite reference image with the
    characters standing side by side (for models that accept a single reference)."""
    chars, scenes = index(story)
    scene = scenes.get(panel.get("scene"), {})
    cast = [c for c in panel.get("characters") or [] if c.get("id") in chars]
    width, height = panel_size(panel)
    frame = "a wide horizontal frame" if width > height else "a tall vertical frame" if height > width else "a square frame"
    parts = [f"{NATURAL_STYLE} Composition: {SHOT_TEXT.get(panel.get('shot'), 'a medium shot')}, "
             f"{ANGLE_TEXT.get(panel.get('angle'), 'at eye level')}, {frame}."]
    refs = []
    if cast:
        people = []
        for i, c in enumerate(cast, 1):
            ch = chars[c["id"]]
            if lineup:
                ref = (f" (exactly the {ORDINALS[i - 1]} figure from the left in the reference image: "
                       f"same face, hairstyle, hair color and outfit)")
            elif with_refs:
                ref = f" (exactly the person in reference image {i}: same face, hairstyle, hair color and outfit)"
            else:
                ref = ""
            if with_refs:
                refs.append(ch["id"])
            action = f"; {c['action']}" if c.get("action") else ""
            mood = f"; expression: {c['expression']}" if c.get("expression") else ""
            people.append(f"{display_name(ch)}: {ch['description']}{ref}{action}{mood}")
        count = "one person" if len(cast) == 1 else f"{len(cast)} people"
        lead = ("The reference image is a character lineup, not a scene; redraw these characters inside the scene. "
                if lineup else "")
        parts.append(f"{lead}Characters ({count}, nobody else): " + " | ".join(people) + ".")
    else:
        parts.append("No people in this panel.")
    setting = scene.get("description") or ", ".join(scene.get("tags") or [])
    time = scene.get("time")
    parts.append(f"Setting: {setting}" + (f", {time}" if time else "") + ".")
    if panel.get("description"):
        parts.append(f"Moment: {panel['description']}.")
    return " ".join(parts), refs


def sheet_danbooru(character: dict) -> tuple[str, str]:
    tags = list(QUALITY) + list(RATING) + list(STYLE_TAGS) + count_tags([character["gender"]])
    tags += character["tags"] + ["full body", "standing", "looking at viewer", "simple background", "white background"]
    negative = list(NEGATIVE) + ["multiple views", "multiple girls", "multiple boys", "2girls", "2boys"]
    return ", ".join(escape_tag(t) for t in dedupe(tags)), ", ".join(dedupe(negative))


def sheet_natural(character: dict) -> str:
    return (f"{NATURAL_STYLE} Character reference: a single full-body front view of {character['description']}, "
            f"standing straight, neutral friendly expression, arms relaxed, plain white background, "
            f"a tall vertical frame, the whole figure visible from head to shoes.")
