"""Reviewed, frozen Comfy adapter identities; shared by compile, execution and recovery."""

from __future__ import annotations

import copy
import hashlib
import io
import json

from PIL import Image

from ..registry import InactiveContributionError
from .client import ComfyError, OutputImage

POINTS = ("comfy_output_adapter", "comfy_state_adapter")


class HistoryImages:
    def freeze(self, node, options):
        return options

    def collect(self, output, plan, transport):
        return [
            OutputImage("", item["filename"], item.get("subfolder", ""), item.get("type", "output"))
            for item in output.get("images", [])
        ]


def builtin(point, id):
    from .adapters import ParameterControlPanel

    if (point, id) == (POINTS[0], "history-images"):
        return HistoryImages()
    if (point, id) == (POINTS[1], "parameter-control-panel"):
        return ParameterControlPanel()
    return None


def builtin_ref(point, id):
    return dict(
        point=point,
        id=id,
        source="builtin",
        contract=1,
        digest=hashlib.sha256(f"mio-comfy-adapter-v1:{point}:{id}".encode()).hexdigest(),
    )


def register_builtins(registry):
    for point, id in zip(POINTS, ("history-images", "parameter-control-panel"), strict=True):
        ref = builtin_ref(point, id)
        registry.register(point, id, builtin(point, id), digest=ref["digest"], contract=1)


def select(registry, point, id):
    layers = registry.layers(point, id) if registry else []
    if layers:
        item = layers[-1]
        return dict(
            point=point,
            id=id,
            source=item.source,
            digest=item.meta.get("digest", ""),
            contract=item.meta.get("contract", 1),
        )
    if builtin(point, id):
        return builtin_ref(point, id)
    raise ComfyError(f"ComfyUI 适配器未安装：{point}/{id}")


def resolve(registry, ref):
    if ref.get("contract") != 1 or ref.get("point") not in POINTS:
        raise ComfyError("不支持的 ComfyUI 适配器契约")
    if ref == builtin_ref(ref["point"], ref["id"]) and builtin(ref["point"], ref["id"]):
        return builtin(ref["point"], ref["id"])
    for item in registry.layers(ref["point"], ref["id"]) if registry else []:
        if (item.source, item.meta.get("digest"), item.meta.get("contract")) == (
            ref["source"],
            ref["digest"],
            ref["contract"],
        ):
            return item.value
    raise ComfyError(f"任务依赖的 ComfyUI 适配器不可用：{ref['id']}，请恢复原扩展版本")


def invoke(registry, ref, method, *args, **kwargs):
    """Call a frozen adapter method after rechecking its exact reviewed contribution."""
    if ref.get("contract") != 1 or ref.get("point") not in POINTS:
        raise ComfyError("不支持的 ComfyUI 适配器契约")
    if ref == builtin_ref(ref["point"], ref["id"]) and builtin(ref["point"], ref["id"]):
        return getattr(builtin(ref["point"], ref["id"]), method)(*args, **kwargs)
    for item in registry.layers(ref["point"], ref["id"]) if registry else []:
        if (item.source, item.meta.get("digest"), item.meta.get("contract")) == (
            ref["source"],
            ref["digest"],
            ref["contract"],
        ):
            try:
                return item.invoke_method(item.value, method, *args, **kwargs)
            except InactiveContributionError as exc:
                raise ComfyError(str(exc.args[0])) from exc
    raise ComfyError(f"任务依赖的 ComfyUI 适配器不可用：{ref['id']}，请恢复原扩展版本")


def json_copy(value):
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


class OutputTransport:
    """Read-only image retrieval on the current Comfy endpoint."""

    def __init__(self, client):
        self._client = client

    def view(self, filename, subfolder="", type="output"):
        return self._client.view(filename, subfolder, type)


def collect(client, node_id, output, frozen, registry):
    try:
        images = invoke(
            registry,
            frozen["adapter"],
            "collect",
            copy.deepcopy(output),
            json_copy(frozen["plan"]),
            OutputTransport(client),
        )
        result = []
        for index, image in enumerate(images):
            if not isinstance(image, OutputImage):
                raise ValueError("collect must return OutputImage values")
            image.node, image.index = node_id, index
            if not image.data:
                image.data = client.view(image.filename, image.subfolder, image.type)
            if not isinstance(image.data, bytes) or not image.data:
                raise ValueError("empty image output")
            with Image.open(io.BytesIO(image.data)) as decoded:
                decoded.verify()
            result.append(image)
        return result
    except ComfyError:
        raise
    except Exception as exc:
        raise ComfyError(f"节点 {node_id} 的输出解析失败：{exc}", kind="output_adapter") from exc
