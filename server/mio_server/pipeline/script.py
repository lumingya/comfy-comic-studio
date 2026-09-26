"""Structured script: one sentence -> story JSON (characters, scenes, 12-16 panels).

The LLM only writes JSON; everything here that decides validity is a pure function, so the
format is testable without a model. Characters must be adults and the content SFW.
"""

from __future__ import annotations

import copy
import re

SHOTS = ("extreme_close", "close", "medium", "cowboy", "full", "wide")
ANGLES = ("eye", "high", "low", "side", "back", "dutch")
TIMES = ("morning", "day", "evening", "night")
KINDS = ("speech", "thought", "narration", "sfx")
GENDERS = ("female", "male")
NARRATOR = "narrator"
MIN_AGE = 20
MAX_BUBBLE_CHARS = 36
BLOCKED = (
    "nsfw",
    "nude",
    "naked",
    "sex",
    "explicit",
    "nipples",
    "underwear",
    "lingerie",
    "cleavage",
    "loli",
    "shota",
    "child",
    "kid",
    "toddler",
    "underage",
    "minor",
    "schoolgirl",
    "school uniform",
    "萝莉",
    "幼女",
    "正太",
    "儿童",
    "小学生",
    "初中生",
)
ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}$")

SYSTEM_PROMPT = """你是条漫编剧兼分镜师。根据用户的一句话写一个短篇条漫剧本，只输出一个 JSON 对象，不要任何解释。

硬性要求：
- 所有角色都是成年人（age ≥ 20），内容全年龄向（无色情、无血腥）。
- 2 个角色、3 个场景、{min_panels}–{max_panels} 格；每格对白 0–2 句，每句不超过 {max_chars} 个汉字，口语、简短。
- 视觉信息用英文 Danbooru 标签（小写，空格分隔单词，如 "short hair"），不要用角色名、作品名或画师名做标签。
- 每个角色的 tags 必须写全可识别的外貌：发色、发型、瞳色、固定服装（上衣、下装或外套）、1–2 个标志性配饰；整部作品中服装不变。
- signature 从 tags 里挑 2–4 个最容易辨认的特征，用来检查角色一致性。
- description 用英文写成一句完整的外貌描述，给不懂标签的图像模型用，内容与 tags 一致。
- 分镜要有节奏：开场用 wide 交代环境，情绪处用 close，交替使用景别；同一场景里人物位置保持一致。

JSON 结构（字段名必须一致）：
{{
  "title": "中文标题",
  "logline": "一句话梗概（中文）",
  "characters": [
    {{"id": "lin", "name": "林夏", "gender": "female", "age": 27,
      "tags": ["black hair", "short hair", "bob cut", "brown eyes", "round eyewear", "beige trench coat", "white shirt", "black pants"],
      "signature": ["bob cut", "round eyewear", "beige trench coat"],
      "description": "a 27-year-old woman with a short black bob, brown eyes and round glasses, wearing a beige trench coat over a white shirt and black pants"}}
  ],
  "scenes": [
    {{"id": "s1", "location": "深夜的办公室", "time": "night",
      "tags": ["office", "indoors", "desk", "computer", "window", "city lights"],
      "description": "an empty open-plan office late at night, city lights outside the window"}}
  ],
  "panels": [
    {{"id": "p01", "scene": "s1", "shot": "wide", "angle": "high",
      "characters": [{{"id": "lin", "expression": "tired", "action": "typing on a laptop at her desk", "tags": ["sitting", "typing", "tired"]}}],
      "tags": ["monitor glow"],
      "description": "Lin is the last person in the dark office, lit by her monitor",
      "dialogue": [{{"speaker": "narrator", "kind": "narration", "text": "凌晨两点，办公室只剩我一个人。"}}]}}
  ]
}}

取值范围：gender ∈ female|male；time ∈ morning|day|evening|night；shot ∈ extreme_close|close|medium|cowboy|full|wide；
angle ∈ eye|high|low|side|back|dutch；dialogue.kind ∈ speech|thought|narration|sfx；
dialogue.speaker 是角色 id，旁白用 "narrator"。每格 characters 0–2 人（空镜可以为空）。"""


def _tags(value) -> list[str]:
    out = []
    for tag in value if isinstance(value, list) else []:
        if not isinstance(tag, str):
            continue
        tag = re.sub(r"\s+", " ", tag.replace("_", " ")).strip().lower()
        if tag and tag not in out:
            out.append(tag)
    return out


def _slug(value, fallback: str) -> str:
    text = re.sub(r"[^a-z0-9_]", "_", str(value or "").strip().lower()).strip("_")
    if not text or not text[0].isalpha():
        text = fallback
    return text[:24]


def normalize_story(data) -> dict:
    """Clean types and spelling (tags lower-case, ids slugged, defaults filled). Never raises."""
    if not isinstance(data, dict):
        return {}
    story = copy.deepcopy(data)
    story["title"] = str(story.get("title") or "").strip()
    story["logline"] = str(story.get("logline") or "").strip()
    for i, ch in enumerate(
        story.get("characters") if isinstance(story.get("characters"), list) else []
    ):
        if not isinstance(ch, dict):
            continue
        ch["id"] = _slug(ch.get("id"), f"c{i + 1}")
        ch["name"] = str(ch.get("name") or ch["id"]).strip()
        ch["gender"] = str(ch.get("gender") or "").strip().lower()
        try:
            ch["age"] = int(ch.get("age"))
        except (TypeError, ValueError):
            ch["age"] = None
        ch["tags"] = _tags(ch.get("tags"))
        ch["signature"] = _tags(ch.get("signature"))
        ch["description"] = str(ch.get("description") or "").strip()
    for i, sc in enumerate(story.get("scenes") if isinstance(story.get("scenes"), list) else []):
        if not isinstance(sc, dict):
            continue
        sc["id"] = _slug(sc.get("id"), f"s{i + 1}")
        sc["location"] = str(sc.get("location") or "").strip()
        sc["time"] = str(sc.get("time") or "day").strip().lower()
        sc["tags"] = _tags(sc.get("tags"))
        sc["description"] = str(sc.get("description") or "").strip()
    for i, pn in enumerate(story.get("panels") if isinstance(story.get("panels"), list) else []):
        if not isinstance(pn, dict):
            continue
        pn["id"] = _slug(pn.get("id"), f"p{i + 1:02d}")
        pn["scene"] = _slug(pn.get("scene"), "")
        pn["shot"] = (
            str(pn.get("shot") or "medium").strip().lower().replace("-", "_").replace(" ", "_")
        )
        pn["angle"] = str(pn.get("angle") or "eye").strip().lower()
        pn["tags"] = _tags(pn.get("tags"))
        pn["description"] = str(pn.get("description") or "").strip()
        cast = []
        for c in pn.get("characters") if isinstance(pn.get("characters"), list) else []:
            if isinstance(c, dict):
                cast.append(
                    {
                        "id": _slug(c.get("id"), ""),
                        "expression": str(c.get("expression") or "").strip(),
                        "action": str(c.get("action") or "").strip(),
                        "tags": _tags(c.get("tags")),
                    }
                )
        pn["characters"] = cast
        lines = []
        for d in pn.get("dialogue") if isinstance(pn.get("dialogue"), list) else []:
            if isinstance(d, dict) and str(d.get("text") or "").strip():
                kind = str(d.get("kind") or "speech").strip().lower()
                speaker = str(d.get("speaker") or NARRATOR).strip().lower()
                if kind == "narration":
                    speaker = NARRATOR
                lines.append(
                    {
                        "speaker": _slug(speaker, NARRATOR),
                        "kind": kind,
                        "text": str(d["text"]).strip(),
                    }
                )
        pn["dialogue"] = lines
    return story


def _blocked_in(text: str) -> list[str]:
    low = text.lower()
    found = []
    for term in BLOCKED:
        if term.isascii():
            if re.search(r"(?<![a-z])" + re.escape(term) + r"(?![a-z])", low):
                found.append(term)
        elif term in text:
            found.append(term)
    return found


def validate_story(story: dict, min_panels: int = 12, max_panels: int = 16) -> list[str]:
    """Problems in a normalized story (empty list = valid). Messages are for the LLM repair loop."""
    problems = []
    if not isinstance(story, dict) or not story:
        return ["顶层必须是 JSON 对象"]
    if not story.get("title"):
        problems.append("缺少 title")
    chars = [c for c in story.get("characters") or [] if isinstance(c, dict)]
    scenes = [s for s in story.get("scenes") or [] if isinstance(s, dict)]
    panels = [p for p in story.get("panels") or [] if isinstance(p, dict)]
    if not 1 <= len(chars) <= 4:
        problems.append(f"characters 需要 1–4 个，现在 {len(chars)} 个")
    if not scenes:
        problems.append("至少需要 1 个场景")
    if not min_panels <= len(panels) <= max_panels:
        problems.append(f"panels 需要 {min_panels}–{max_panels} 格，现在 {len(panels)} 格")
    char_ids, scene_ids, panel_ids = set(), set(), set()
    for c in chars:
        where = f"角色 {c.get('id')}"
        if c["id"] in char_ids or c["id"] == NARRATOR:
            problems.append(f"{where}：id 重复或保留")
        char_ids.add(c["id"])
        if c.get("gender") not in GENDERS:
            problems.append(f"{where}：gender 只能是 female 或 male")
        if not isinstance(c.get("age"), int) or c["age"] < MIN_AGE:
            problems.append(f"{where}：age 必须是 ≥ {MIN_AGE} 的整数（角色必须是成年人）")
        if len(c.get("tags") or []) < 5:
            problems.append(f"{where}：tags 至少 5 个（发色、发型、瞳色、服装、配饰）")
        if not 2 <= len(c.get("signature") or []) <= 4:
            problems.append(f"{where}：signature 需要 2–4 个")
        elif any(t not in c["tags"] for t in c["signature"]):
            problems.append(f"{where}：signature 必须取自 tags")
        if len(c.get("description") or "") < 20:
            problems.append(f"{where}：description 太短")
    for s in scenes:
        if s["id"] in scene_ids:
            problems.append(f"场景 {s['id']}：id 重复")
        scene_ids.add(s["id"])
        if s.get("time") not in TIMES:
            problems.append(f"场景 {s['id']}：time 只能是 {'|'.join(TIMES)}")
        if not s.get("tags"):
            problems.append(f"场景 {s['id']}：缺少 tags")
    for p in panels:
        where = f"分格 {p.get('id')}"
        if p["id"] in panel_ids:
            problems.append(f"{where}：id 重复")
        panel_ids.add(p["id"])
        if p.get("scene") not in scene_ids:
            problems.append(f"{where}：scene 不存在")
        if p.get("shot") not in SHOTS:
            problems.append(f"{where}：shot 只能是 {'|'.join(SHOTS)}")
        if p.get("angle") not in ANGLES:
            problems.append(f"{where}：angle 只能是 {'|'.join(ANGLES)}")
        cast = p.get("characters") or []
        if len(cast) > 2:
            problems.append(f"{where}：每格最多 2 个角色")
        if len({c["id"] for c in cast}) != len(cast):
            problems.append(f"{where}：同一角色出现两次")
        for c in cast:
            if c["id"] not in char_ids:
                problems.append(f"{where}：角色 {c['id'] or '(空)'} 不存在")
        if len(p.get("dialogue") or []) > 2:
            problems.append(f"{where}：对白最多 2 句")
        for d in p.get("dialogue") or []:
            if d["kind"] not in KINDS:
                problems.append(f"{where}：dialogue.kind 只能是 {'|'.join(KINDS)}")
            if d["speaker"] != NARRATOR and d["speaker"] not in char_ids:
                problems.append(f"{where}：说话人 {d['speaker']} 不存在")
            if len(d["text"]) > MAX_BUBBLE_CHARS:
                problems.append(f"{where}：对白超过 {MAX_BUBBLE_CHARS} 字：{d['text'][:12]}…")
    visual = [t for c in chars for t in c.get("tags", [])] + [
        c.get("description", "") for c in chars
    ]
    visual += [t for s in scenes for t in s.get("tags", [])] + [
        s.get("description", "") for s in scenes
    ]
    for p in panels:
        visual += p.get("tags", []) + [p.get("description", "")]
        for c in p.get("characters") or []:
            visual += c.get("tags", []) + [c.get("action", ""), c.get("expression", "")]
    blocked = sorted({term for text in visual for term in _blocked_in(text)})
    if blocked:
        problems.append("含有不允许的内容词：" + "、".join(blocked))
    return problems


def generate_script(sentence: str, client, min_panels: int = 12, max_panels: int = 16, models=None):
    """One sentence -> validated story dict (plus the LLM reply for timing/model info)."""
    from .llm import TEXT_MODELS

    system = SYSTEM_PROMPT.format(
        min_panels=min_panels, max_panels=max_panels, max_chars=MAX_BUBBLE_CHARS
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": sentence.strip()},
    ]
    data, reply = client.chat_json(
        messages,
        models or TEXT_MODELS,
        validate=lambda d: validate_story(normalize_story(d), min_panels, max_panels),
        repairs=2,
    )
    return normalize_story(data), reply


def stats(story: dict) -> dict:
    panels = story.get("panels") or []
    return {
        "panels": len(panels),
        "scenes": len(story.get("scenes") or []),
        "characters": len(story.get("characters") or []),
        "lines": sum(len(p.get("dialogue") or []) for p in panels),
        "shots": {
            s: sum(1 for p in panels if p.get("shot") == s)
            for s in SHOTS
            if any(p.get("shot") == s for p in panels)
        },
        "two_shots": sum(1 for p in panels if len(p.get("characters") or []) == 2),
        "empty_shots": sum(1 for p in panels if not p.get("characters")),
    }
