"""LoRA tag parsing, exact formatting and text-input writes."""

import copy
import math
import re
from decimal import Decimal

from .workflow_slot_common import _MISSING, LORA_TAG, MODEL_EXT, LibraryError, _is_link
from .workflow_slot_shapes import _mirror_path_for


def number_text(value):
    value = round(float(value) * 100) / 100
    if value == int(value):
        return str(int(value))
    text = ("%.2f" % value).rstrip("0").rstrip(".")
    return text


def strip_extension(name):
    return MODEL_EXT.sub("", str(name))


def lora_stem(name):
    return strip_extension(str(name).replace("\\", "/").split("/")[-1])


def lora_display_name(name, fmt):
    if fmt == "file":
        return str(name)
    if fmt == "path":
        return strip_extension(str(name).replace("\\", "/"))
    return lora_stem(name)


def _tidy(text):
    text = re.sub(r"[ \t]+", " ", str(text))
    text = re.sub(r" ?(,) ?(?=,)", r"\1", text)
    text = re.sub(r"^[ ,]+|[ ,]+$", "", text, flags=re.M)
    text = re.sub(r" +\n", "\n", text)
    return text.strip()


def parse_lora_syntax(text):
    loras = []

    def collect(match):
        entry = {
            "name": match.group(1).strip(),
            "strength": 1 if match.group(2) is None else _num(match.group(2)),
        }
        if match.group(3) is not None:
            entry["clip"] = _num(match.group(3))
        loras.append(entry)
        return " "

    rest = LORA_TAG.sub(collect, str(text if text is not None else ""))
    return {"loras": loras, "text": _tidy(rest)}


def _num(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        raise LibraryError("LoRA 强度必须是有限数字") from None
    if isinstance(text, bool) or not math.isfinite(value):
        raise LibraryError("LoRA 强度必须是有限数字")
    return int(value) if value == int(value) else value


def format_tag(lora, name_format):
    def exact(value):
        value = float(value)
        return str(int(value)) if value == int(value) else format(Decimal(repr(value)), "f")

    clip = ""
    if "clip" in lora and lora["clip"] != lora["strength"]:
        clip = ":" + exact(lora["clip"])
    name = lora_display_name(lora["name"], name_format).replace(":", "_")
    return "<lora:" + name + ":" + exact(lora["strength"]) + clip + ">"


def _apply_syntax(workflow, lora, loras, notices):
    node = workflow.get(lora["nodeId"])
    if not isinstance(node, dict):
        raise LibraryError("LoRA 语法目标节点不存在")
    current = node["inputs"].get(lora["path"], _MISSING)
    if _is_link(current, workflow):
        raise LibraryError("LoRA 语法目标字段已连线，不能写入")
    if current is not _MISSING and not isinstance(current, str):
        raise LibraryError("LoRA 语法目标字段不是文本")
    base = parse_lora_syntax("" if current is _MISSING else current)["text"]
    tags = " ".join(format_tag(l, lora["nameFormat"]) for l in loras)
    if not tags:
        text = base
    elif not base:
        text = tags
    elif lora["placement"] == "prepend":
        text = tags + ("" if base[:1] in (",", "\n") else " ") + base
    else:
        text = base + (" " if base[-1:] in (",", "\n") else "\n" if "\n" in base else " ") + tags
    node["inputs"][lora["path"]] = text
    if lora.get("assumed") and loras:
        notices.append(
            "工作流里没有解析 <lora:> 语法的节点，LoRA 标签已写入正向提示词；需要 LoRA Manager、Prompt Control 等插件才会生效。"
        )
    mirror_path = "" if lora.get("mirror") is False else _mirror_path_for(node, workflow)
    if mirror_path:
        container = node["inputs"][mirror_path]
        wrapped = not isinstance(container, list)
        existing = container["__value__"] if wrapped else container
        template = (
            existing[0]
            if existing
            else {"name": "", "strength": 1, "active": True, "clipStrength": 1}
        )
        entries = []
        for l in loras:
            entry = copy.deepcopy(template)
            if "lora" in entry and "name" not in entry:
                entry["lora"] = lora_display_name(l["name"], lora["nameFormat"])
            else:
                entry["name"] = lora_display_name(l["name"], lora["nameFormat"])
            entry["strength"] = l["strength"]
            if "clipStrength" in entry:
                entry["clipStrength"] = l["clip"] if "clip" in l else l["strength"]
            if "active" in entry:
                entry["active"] = True
            if "on" in entry:
                entry["on"] = True
            entries.append(entry)
        node["inputs"][mirror_path] = {**container, "__value__": entries} if wrapped else entries


def describe_overrides(overrides):
    """Short human summary for task cards: model name and LoRA list."""
    clean = overrides if isinstance(overrides, dict) else {}
    parts = []
    if isinstance(clean.get("model"), str) and clean["model"]:
        parts.append(lora_stem(clean["model"]))
    if isinstance(clean.get("loras"), list):
        names = [
            lora_stem(l.get("name", "")) + " ×" + number_text(l.get("strength", 1))
            for l in clean["loras"]
            if isinstance(l, dict)
        ]
        parts.append("LoRA · " + (", ".join(names) if names else "无追加"))
    return " · ".join(parts)
