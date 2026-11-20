"""Shared slot constants, graph primitives and application errors."""

import hashlib
import json
import re


class LibraryError(ValueError):
    """Raised when a workflow slot plan cannot be applied."""

    def __init__(self, message, code="MIO-SLOT-001", status=400):
        super().__init__(message)
        self.code = code
        self.status = status


MODEL_EXT = re.compile(r"\.(safetensors|ckpt|pt|pth|bin|gguf|sft|pkl)$", re.I)


STRONG_MODEL_KEYS = re.compile(r"^(ckpt_name|unet_name)$", re.I)


WEAK_MODEL_KEYS = re.compile(
    r"^(checkpoint|ckpt|model_name|model|model_path|diffusion_model|base_model|unet|transformer)$",
    re.I,
)


NOT_MODEL = re.compile(
    r"lora|vae|clip|control|upscale|ipadapter|adapter|embedding|face|detect|bbox|segm|sam\b|"
    r"encoder|tokenizer|scheduler|style|instantid|photomaker|pulid|insight|onnx|preprocessor|"
    r"depth|pose|animatediff|motion|gligen|hypernet|audio|llm|florence|vision|refiner_|"
    r"interpolation|vfi|rife|ifrnet|film|esrgan|realesrgan|gfpgan|codeformer|rembg|segmentation|"
    r"matting|depthanything|midas|zoe|openpose|dwpose|lama|inpaint_model|facerestore",
    re.I,
)


NOT_MODEL_FILE = re.compile(
    r"\bamt[-_.]|[-_]amt[-_.]|\bamt.*?gopro|ifrnet|ifunet|rife|vimeo|film_net|_vfi\b|"
    r"flavr|gmflow|\bm2m\b|cain|sepconv|stmfnet|flownet|raft_|spynet|"
    r"esrgan|realesrgan|gfpgan|codeformer|depth_anything|openpose|dwpose|insightface",
    re.I,
)


MODEL_CLASS = re.compile(r"checkpoint|unet|diffusion|model.?loader|dit.?loader", re.I)


STACK_KEY = re.compile(r"^(lora|lora_name)_?(\d+)(?:_name)?$", re.I)


CHAIN_NAME_KEYS = ["lora_name", "lora"]


CHAIN_STRENGTH_KEYS = [
    "strength_model",
    "strength",
    "lora_strength",
    "model_strength",
    "lora_model_strength",
    "model_weight",
    "lora_wt",
    "weight",
]


CHAIN_CLIP_KEYS = ["strength_clip", "clip_strength", "lora_clip_strength", "clip_weight"]


STACK_STRENGTH_PREFIXES = [
    "strength",
    "model_strength",
    "wt",
    "lora_wt",
    "model_weight",
    "model_str",
    "strength_model",
    "lora_strength",
    "weight",
]


STACK_CLIP_PREFIXES = ["clip_weight", "clip_str", "strength_clip", "clip_strength"]


STACK_SWITCH_PREFIXES = ["switch", "enabled", "on"]


PASSTHROUGH_KEYS = ["model", "clip", "prev_lora", "lora_stack"]


SYNTAX_TEXT_KEYS = re.compile(r"text|prompt", re.I)


LORA_TAG = re.compile(r"<lora:([^<>:]+?)(?::(-?\d*\.?\d+))?(?::(-?\d*\.?\d+))?\s*>")


MAX_LORAS = 16


_MISSING = object()


MODEL_INPUT = re.compile(r"^(model\d*|unet)$", re.I)


def _is_number(value):
    return type(value) in (int, float)


def _is_link(value, workflow):
    return (
        isinstance(value, list)
        and len(value) == 2
        and (isinstance(value[0], str) or (_is_number(value[0]) and str(value[0]) in workflow))
        and type(value[1]) is int
    )


def _sort_key(node_id):
    try:
        return (0, float(node_id), "")
    except (TypeError, ValueError):
        return (1, 0.0, str(node_id))


def _node_ids(workflow):
    ids = [
        i
        for i, n in (workflow or {}).items()
        if isinstance(n, dict) and isinstance(n.get("inputs"), dict)
    ]
    return sorted(ids, key=_sort_key)


def _title(node):
    meta = node.get("_meta") if isinstance(node, dict) else None
    return str((meta or {}).get("title") or node.get("class_type") or "")


def _consumer_index(workflow):
    index = {}
    for node_id in _node_ids(workflow):
        for key, value in workflow[node_id]["inputs"].items():
            if _is_link(value, workflow):
                index.setdefault(str(value[0]), []).append(
                    {"consumer": node_id, "key": key, "index": value[1]}
                )
    return index


def _write_field(workflow, node_id, key, value):
    node = workflow.get(node_id)
    if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
        raise LibraryError("工作流里没有节点 " + str(node_id))
    if _is_link(node["inputs"].get(key), workflow):
        raise LibraryError("节点 %s 的 %s 已连线，不能写入" % (node_id, key))
    node["inputs"][key] = value


def info_hash(info):
    return hashlib.sha256(
        json.dumps(info or {}, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
