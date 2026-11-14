"""The explicit, inspectable scope of variable refactoring.

Only author-editable text is traversed. IDs, asset references, profile/workflow documents,
arbitrary variant extension keys, generated takes, history and credentials are excluded.
"""

from dataclasses import dataclass
from typing import Iterator

FIELDS = [
    "series.title, subtitle, variables values",
    "presets.entries key/value, bindings literal value or variable key",
    "bible and variant characters: name, description, trigger, tags, appearance, signature, outfits",
    "bible locations/props/styles: name, description, tags, negative",
    "episode.title, synopsis, base_prompt",
    "panel.description, lighting, tags, character action/expression/tags, dialogue text",
    "panel.overrides raw/append/negative prompts, string leaves of values and node_overrides",
    "strip.lettering text",
]
_IDENTIFIERS = {"id", "asset_id", "$asset", "take_id", "profile_id", "workflow_id"}
_CHARACTER_TEXT = ("name", "description", "trigger", "tag_description", "appearance", "signature")


def pointer(parts) -> str:
    return "/" + "/".join(str(p).replace("~", "~0").replace("/", "~1") for p in parts)


@dataclass
class TextField:
    owner_id: str
    parts: tuple
    container: dict | list
    key: str | int
    locked: bool = False

    @property
    def value(self):
        return self.container[self.key]

    @property
    def path(self):
        return pointer(self.parts)

    def set(self, value):
        self.container[self.key] = value


def _strings(owner, value, path, *, locked=False, protect_references=False) -> Iterator[TextField]:
    items = value.items() if isinstance(value, dict) else enumerate(value)
    for key, child in items:
        if protect_references and key in _IDENTIFIERS:
            continue
        parts = (*path, key)
        if isinstance(child, str):
            yield TextField(owner, parts, value, key, locked)
        elif isinstance(child, (list, dict)):
            yield from _strings(
                owner, child, parts, locked=locked, protect_references=protect_references
            )


def _selected(owner, value, path, keys, *, locked=False):
    for key in keys:
        child = value.get(key)
        if isinstance(child, str):
            yield TextField(owner, (*path, key), value, key, locked)
        elif isinstance(child, (dict, list)):
            yield from _strings(
                owner,
                child,
                (*path, key),
                locked=locked,
                protect_references=key in {"values", "node_overrides"},
            )


def text_fields(series: dict, episodes: list[dict]) -> Iterator[TextField]:
    sid = series["id"]
    yield from _selected(sid, series, (), ("title", "subtitle", "variables"))
    for index, preset in enumerate(series["presets"]):
        for j, entry in enumerate(preset["entries"]):
            yield from _selected(sid, entry, ("presets", index, "entries", j), ("value",))
        for j, binding in enumerate(preset["bindings"]):
            if binding["source"] == "literal":
                yield from _selected(sid, binding, ("presets", index, "bindings", j), ("value",))
    for group, items in series["bible"].items():
        for index, item in enumerate(items):
            keys = (*_CHARACTER_TEXT, "outfits", "tags", "negative")
            yield from _selected(sid, item, ("bible", group, index), keys)
    for index, variant in enumerate(series["variants"]):
        for cid, patch in variant["characters"].items():
            yield from _selected(
                sid,
                patch,
                ("variants", index, "characters", cid),
                (*_CHARACTER_TEXT, "outfits"),
            )
    for ep in episodes:
        eid = ep["id"]
        yield from _selected(eid, ep, (), ("title", "synopsis", "base_prompt"))
        locked_panels = {p["id"] for p in ep["panels"] if p["locked"]}
        for index, panel in enumerate(ep["panels"]):
            path = ("panels", index)
            locked = panel["locked"]
            yield from _selected(
                eid, panel, path, ("description", "lighting", "tags"), locked=locked
            )
            for j, char in enumerate(panel["characters"]):
                yield from _selected(
                    eid,
                    char,
                    (*path, "characters", j),
                    ("action", "expression", "tags"),
                    locked=locked,
                )
            for j, dialogue in enumerate(panel["dialogues"]):
                yield from _selected(
                    eid, dialogue, (*path, "dialogues", j), ("text",), locked=locked
                )
            yield from _selected(
                eid,
                panel["overrides"],
                (*path, "overrides"),
                (
                    "raw_prompt",
                    "raw_negative",
                    "append_prompt",
                    "negative_prompt",
                    "values",
                    "node_overrides",
                ),
                locked=locked,
            )
        for index, layer in enumerate(ep["strip"]["lettering"]):
            yield from _selected(
                eid,
                layer,
                ("strip", "lettering", index),
                ("text",),
                locked=layer["locked"] or layer["panel_id"] in locked_panels,
            )


def definitions(series: dict, episodes: list[dict]):
    """Yield (key, owner, pointer, container, actual_key, dictionary_key, locked)."""
    for key in series["variables"]:
        yield key, series["id"], pointer(("variables", key)), series["variables"], key, True, False
    for index, preset in enumerate(series["presets"]):
        for j, entry in enumerate(preset["entries"]):
            yield (
                entry["key"],
                series["id"],
                pointer(("presets", index, "entries", j, "key")),
                entry,
                "key",
                False,
                False,
            )
    for ep in episodes:
        for index, panel in enumerate(ep["panels"]):
            for key in panel["overrides"]["values"]:
                if key.startswith("$") and key != "$asset":
                    yield (
                        key[1:],
                        ep["id"],
                        pointer(("panels", index, "overrides", "values", key)),
                        panel["overrides"]["values"],
                        key,
                        True,
                        panel["locked"],
                    )


def variable_bindings(series: dict):
    for index, preset in enumerate(series["presets"]):
        for j, binding in enumerate(preset["bindings"]):
            if binding["source"] == "variable":
                yield binding, pointer(("presets", index, "bindings", j, "value"))
