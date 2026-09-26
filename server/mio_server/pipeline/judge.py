"""VLM checks: character consistency per panel, and face boxes for bubble placement.

Scoring is a pure function over the model's JSON so the pass rule is testable:
an appearance passes when the character is present, identity >= 4 (1-5 against the reference
image) and no signature feature is judged wrong (features out of frame count as unknown).
"""

from __future__ import annotations

import json

from . import prompts as P

PASS_IDENTITY = 4


def consistency_prompt(story: dict, panel: dict) -> tuple[str, list[str]]:
    chars, scenes = P.index(story)
    cast = [chars[c["id"]] for c in panel.get("characters") or [] if c.get("id") in chars]
    scene = scenes.get(panel.get("scene"), {})
    lines = []
    for i, ch in enumerate(cast, 1):
        lines.append(
            f'{i}. "{P.display_name(ch)}" — reference image {i}. Key features: {"; ".join(ch["signature"])}. '
            f"Full description: {ch['description']}."
        )
    expected = "\n".join(lines) if lines else "(none — this panel should show no people)"
    example = json.dumps(
        {
            "characters": [
                {
                    "name": P.display_name(ch),
                    "present": True,
                    "identity": 4,
                    "features": {f: True for f in ch["signature"]},
                    "note": "",
                }
                for ch in cast
            ],
            "extra_people": 0,
            "scene": 4,
            "quality": 4,
        },
        ensure_ascii=False,
    )
    text = f"""You are a strict continuity checker for an anime comic.
Images 1..{len(cast)} are character reference images, in the order listed below. The LAST image is the comic panel to check.
Characters that should appear in the panel:
{expected}
Intended panel: {P.SHOT_TEXT.get(panel.get("shot"), "")}; setting: {scene.get("description", "")}; moment: {panel.get("description", "")}

For each expected character:
- present: is this character visible in the panel?
- identity: 1-5, is it the SAME person as the reference (face, hairstyle, hair color, eye color, outfit colors)? 5 = unmistakably the same, 4 = same with minor drift, 3 = similar but noticeably different, 2 = mostly different, 1 = a different person.
- features: for each key feature, true if visible and correct, false if visible but wrong or clearly missing, null if not visible in this framing.
Also report: extra_people (count of people who are not listed), scene (1-5 match with the intended panel), quality (1-5 anatomy and rendering, 5 = clean).
Answer with JSON only, exactly this shape:
{example}"""
    return text, [c["id"] for c in cast]


def score(story: dict, panel: dict, result: dict) -> list[dict]:
    """Per-appearance verdicts from the judge JSON (missing entries count as failures)."""
    chars, _ = P.index(story)
    verdicts = []
    reported = result.get("characters") if isinstance(result, dict) else None
    reported = reported if isinstance(reported, list) else []
    for i, c in enumerate(panel.get("characters") or []):
        ch = chars.get(c.get("id"))
        if not ch:
            continue
        name = P.display_name(ch).lower()
        entry = next(
            (r for r in reported if isinstance(r, dict) and str(r.get("name", "")).lower() == name),
            None,
        )
        if entry is None and i < len(reported) and isinstance(reported[i], dict):
            entry = reported[i]
        entry = entry or {}
        try:
            identity = int(entry.get("identity") or 0)
        except (TypeError, ValueError):
            identity = 0
        features = entry.get("features") if isinstance(entry.get("features"), dict) else {}
        wrong = [f for f, ok in features.items() if ok is False]
        right = [f for f, ok in features.items() if ok is True]
        present = bool(entry.get("present"))
        verdicts.append(
            {
                "panel": panel["id"],
                "character": ch["id"],
                "present": present,
                "identity": identity,
                "features_ok": len(right),
                "features_wrong": wrong,
                "pass": present and identity >= PASS_IDENTITY and not wrong,
                "note": entry.get("note", ""),
            }
        )
    return verdicts


def judge_panel(llm, story: dict, panel: dict, anchors: dict[str, bytes], image: bytes) -> dict:
    text, order = consistency_prompt(story, panel)
    data, reply = llm.vision_json(text, [anchors[cid] for cid in order] + [image])
    return {
        "panel": panel["id"],
        "raw": data,
        "verdicts": score(story, panel, data),
        "model": reply.model,
        "seconds": round(reply.seconds, 2),
        "extra_people": _int(data.get("extra_people")) if isinstance(data, dict) else None,
        "scene": _int(data.get("scene")) if isinstance(data, dict) else None,
        "quality": _int(data.get("quality")) if isinstance(data, dict) else None,
    }


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def faces_prompt(story: dict, panel: dict) -> str:
    chars, _ = P.index(story)
    cast = [chars[c["id"]] for c in panel.get("characters") or [] if c.get("id") in chars]
    known = (
        "; ".join(f"{P.display_name(ch)} ({ch['description']})" for ch in cast) or "none expected"
    )
    return (
        f"Locate the face of every person in this image. Known characters: {known}.\n"
        'Answer with JSON only: {"faces": [{"name": "Su Wan", "box": [x1, y1, x2, y2]}]} where the box '
        "coordinates are integers normalized to 0-1000 relative to the image width and height. "
        'Use the known names when you can tell who it is, otherwise "unknown". Use {"faces": []} if there are none.'
    )


def normalize_faces(result, size: tuple[int, int]) -> list[dict]:
    """Faces as ``{"name", "box": [x1, y1, x2, y2]}`` in 0-1 image fractions (bad boxes dropped)."""
    faces = result.get("faces") if isinstance(result, dict) else result
    out = []
    for face in faces if isinstance(faces, list) else []:
        box = face.get("box") or face.get("bbox") if isinstance(face, dict) else None
        if not (
            isinstance(box, list)
            and len(box) == 4
            and all(isinstance(v, (int, float)) for v in box)
        ):
            continue
        x1, y1, x2, y2 = box
        top = max(box)
        scale_x, scale_y = (1, 1) if top <= 1.0 else (1000, 1000) if top <= 1000 else size
        x1, x2 = sorted((x1 / scale_x, x2 / scale_x))
        y1, y2 = sorted((y1 / scale_y, y2 / scale_y))
        x1, y1, x2, y2 = (max(0.0, min(1.0, v)) for v in (x1, y1, x2, y2))
        if x2 - x1 < 0.01 or y2 - y1 < 0.01:
            continue
        out.append(
            {
                "name": str(face.get("name") or "unknown"),
                "box": [round(v, 4) for v in (x1, y1, x2, y2)],
            }
        )
    return out


def locate_faces(llm, story: dict, panel: dict, image: bytes, size: tuple[int, int]) -> list[dict]:
    data, _ = llm.vision_json(faces_prompt(story, panel), [image])
    faces = normalize_faces(data, size)
    chars, _ = P.index(story)
    names = {
        P.display_name(chars[c["id"]]).lower(): c["id"]
        for c in panel.get("characters") or []
        if c.get("id") in chars
    }
    for face in faces:
        face["character"] = names.get(face["name"].lower())
    return faces


def summarize(judgements: list[dict]) -> dict:
    verdicts = [v for j in judgements for v in j.get("verdicts", [])]
    n = len(verdicts)
    by_char = {}
    for v in verdicts:
        slot = by_char.setdefault(v["character"], {"appearances": 0, "passed": 0})
        slot["appearances"] += 1
        slot["passed"] += v["pass"]
    feature_total = sum(v["features_ok"] + len(v["features_wrong"]) for v in verdicts)

    def mean(key):
        vals = [j[key] for j in judgements if isinstance(j.get(key), int)]
        return round(sum(vals) / len(vals), 2) if vals else None

    return {
        "appearances": n,
        "passed": sum(v["pass"] for v in verdicts),
        "pass_rate": round(sum(v["pass"] for v in verdicts) / n, 3) if n else None,
        "identity_mean": round(sum(v["identity"] for v in verdicts) / n, 2) if n else None,
        "feature_accuracy": round(sum(v["features_ok"] for v in verdicts) / feature_total, 3)
        if feature_total
        else None,
        "missing": sum(not v["present"] for v in verdicts),
        "extra_people": sum(j.get("extra_people") or 0 for j in judgements),
        "scene_mean": mean("scene"),
        "quality_mean": mean("quality"),
        "by_character": by_char,
    }
