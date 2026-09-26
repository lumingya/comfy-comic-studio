"""A small valid story used by several tests (synthetic, adults, SFW)."""
import copy

CHARACTERS = [
    {"id": "lin", "name": "林夏", "gender": "female", "age": 27,
     "tags": ["black hair", "short hair", "bob cut", "brown eyes", "round eyewear", "beige trench coat", "white shirt"],
     "signature": ["bob cut", "round eyewear", "beige trench coat"],
     "description": "a 27-year-old woman with a short black bob, brown eyes and round glasses, in a beige trench coat"},
    {"id": "zhou", "name": "周然", "gender": "male", "age": 28,
     "tags": ["brown hair", "messy hair", "green eyes", "stubble", "green hoodie", "black jacket", "headphones around neck"],
     "signature": ["messy hair", "green hoodie", "headphones around neck"],
     "description": "a 28-year-old man with messy brown hair, green eyes and light stubble, in a green hoodie under a black jacket"},
]
SCENES = [
    {"id": "s1", "location": "深夜的办公室", "time": "night", "tags": ["office", "indoors", "desk", "computer"],
     "description": "an empty open-plan office late at night"},
    {"id": "s2", "location": "便利店", "time": "night", "tags": ["convenience store", "indoors", "shelves"],
     "description": "a bright 24-hour convenience store"},
    {"id": "s3", "location": "雨夜街头", "time": "night", "tags": ["street", "rain", "outdoors", "umbrella"],
     "description": "a rainy street with neon reflections"},
]


def make_story(panels: int = 12) -> dict:
    shots = ["wide", "medium", "close", "cowboy", "full", "extreme_close"]
    items = []
    for i in range(panels):
        scene = SCENES[min(i * 3 // panels, 2)]["id"]
        cast = [] if i == 0 else [{"id": "lin", "expression": "tired", "action": "looking at her phone", "tags": ["holding phone"]}]
        if i % 4 == 3:
            cast.append({"id": "zhou", "expression": "smile", "action": "waving", "tags": ["waving"]})
        dialogue = [{"speaker": "narrator", "kind": "narration", "text": "凌晨两点。"}] if i == 0 else \
            [{"speaker": "lin", "kind": "speech", "text": "又是你啊。"}] if i % 2 else []
        items.append({"id": f"p{i + 1:02d}", "scene": scene, "shot": shots[i % len(shots)], "angle": "eye",
                      "characters": cast, "tags": [], "description": f"panel {i + 1}", "dialogue": dialogue})
    return {"title": "雨夜便利店", "logline": "加班的林夏在便利店重逢老同学。",
            "characters": copy.deepcopy(CHARACTERS), "scenes": copy.deepcopy(SCENES), "panels": items}
