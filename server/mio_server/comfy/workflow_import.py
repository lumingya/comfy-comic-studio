"""Bounded, content-based workflow decoding; never executes nodes or decodes image pixels."""

from __future__ import annotations

import json
import struct
import warnings
import zlib
from typing import Any

from PIL import Image

MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_METADATA_BYTES = 8 * 1024 * 1024
MAX_IMAGE_PIXELS = 100_000_000
MAX_NODES = 20_000
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
UI_EXPORT_GUIDE = (
    "这是 ComfyUI 界面工作流，尚不含可执行的 API 节点。"
    "请先在 ComfyUI 打开它，选择「文件 → 导出工作流 (API)」后重新导入；"
    "旧版可先在设置中开启开发者模式，再选择「保存 (API Format)」。"
    "Mio 不会猜测自定义控件顺序或浏览器脚本生成的连线。"
)


class WorkflowDecodeError(ValueError):
    code = "invalid_format"


class WorkflowFormatError(WorkflowDecodeError):
    code = "ui_format"


def _json(value: str | bytes) -> Any:
    def invalid_constant(_value: str):
        raise ValueError("non-finite JSON number")

    try:
        return json.loads(value, parse_constant=invalid_constant)
    except (UnicodeError, ValueError, RecursionError):
        raise WorkflowDecodeError("工作流 JSON 无法读取；请重新导出完整的 API 格式文件。") from None


def normalize_workflow(payload: dict) -> dict[str, Any]:
    """Keep Mio configuration; prefer an embedded API prompt over a frontend workflow."""
    if not isinstance(payload, dict):
        raise WorkflowDecodeError("工作流必须是 JSON 对象，请导出 ComfyUI API 格式。")
    is_api = bool(payload) and all(
        isinstance(node, dict) and "class_type" in node and "inputs" in node
        for node in payload.values()
    )
    if is_api:
        graph = payload
    elif "graph" in payload:
        graph = payload["graph"]
    elif isinstance(payload.get("prompt"), dict):
        graph = payload["prompt"]
    elif isinstance(payload.get("workflow"), dict):
        graph = payload["workflow"]
    else:
        graph = payload
    if not isinstance(graph, dict) or not graph:
        raise WorkflowDecodeError("工作流节点为空或格式不完整；请重新导出 API 格式。")
    nodes = graph.get("nodes")
    if len(nodes if isinstance(nodes, list) else graph) > MAX_NODES:
        raise WorkflowDecodeError("工作流超过 20000 个节点的分析上限。")
    out = {"graph": graph}
    if "graph" in payload and not is_api:
        for key in ("config", "name", "notes"):
            if key in payload:
                out[key] = payload[key]
    return out


def ui_issues(graph: dict) -> list[dict[str, str]]:
    """A structural overview is useful even when frontend execution cannot be reproduced."""
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])
    nodes = [node for node in nodes if isinstance(node, dict)]
    disabled = sum(node.get("mode") in (2, 4) for node in nodes)
    definitions = graph.get("definitions")
    subgraphs = definitions.get("subgraphs", []) if isinstance(definitions, dict) else []
    implicit = (
        any(
            "everywhere" in str(node.get("type", "")).lower()
            or "ue_graphs" in (node.get("properties") or {})
            for node in nodes
            if isinstance(node.get("properties", {}), dict)
        )
        or "ue_graphs" in graph
    )
    result = [
        {"code": "ui_format", "severity": "error", "message": UI_EXPORT_GUIDE},
        {
            "code": "ui_overview",
            "severity": "info",
            "message": (
                f"结构概览：{len(nodes)} 个节点、{len(links) if isinstance(links, list) else 0} 条连线，"
                f"其中 {disabled} 个节点被静音或旁路。这里只检查结构，尚未转换为 API 工作流。"
            ),
        },
    ]
    if subgraphs or implicit or disabled:
        result.append(
            {
                "code": "frontend_graph",
                "severity": "warning",
                "message": (
                    "图中含子图、隐式连线或失活节点；请在 ComfyUI 确认当前分支与节点状态后导出 API。"
                    "依赖浏览器状态的插件还需要适配器，手工映射不能替代其执行协议。"
                ),
            }
        )
    return result


def decode_workflow_bytes(content: bytes) -> dict[str, Any]:
    """Decode JSON or PNG/WebP metadata into a normalized ``{graph, config?}`` envelope."""
    if not content or len(content) > MAX_FILE_BYTES:
        raise WorkflowDecodeError("工作流文件为空或超过 64 MB。")
    if content.startswith(PNG_SIGNATURE):
        payload = _from_metadata(_png_metadata(content))
    elif content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        payload = _from_metadata(_webp_metadata(content))
    else:
        payload = _json(content)
    return normalize_workflow(payload)


def _from_metadata(metadata: dict) -> dict:
    for key in ("prompt", "workflow"):
        if key in metadata:
            value = metadata[key]
            payload = _json(value) if isinstance(value, (str, bytes)) else value
            if not isinstance(payload, dict):
                raise WorkflowDecodeError("图片内的工作流元数据不是 JSON 对象。")
            return {key: payload}
    raise WorkflowDecodeError(
        "图片中没有 ComfyUI 的 prompt 或 workflow 元数据；"
        "请使用未经转存的原始 PNG/WebP，或从 ComfyUI 导出 API 格式 JSON。"
    )


def _dimensions(width: int, height: int) -> None:
    if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
        raise WorkflowDecodeError("图片尺寸无效或超过一亿像素，请改用 API 格式 JSON。")


def _inflate(data: bytes, limit: int) -> bytes:
    try:
        decoder = zlib.decompressobj()
        out = decoder.decompress(data, limit + 1)
        if len(out) > limit or not decoder.eof:
            raise WorkflowDecodeError("图片工作流元数据过大或压缩数据不完整，请改用 API JSON。")
        return out
    except zlib.error:
        raise WorkflowDecodeError("图片工作流元数据压缩内容损坏，请重新获取原始文件。") from None


def _png_metadata(data: bytes) -> dict[str, str]:
    offset, total = len(PNG_SIGNATURE), 0
    found: dict[str, str] = {}
    header = False
    while offset + 12 <= len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4 : offset + 8]
        end = offset + 12 + size
        if end > len(data):
            break
        chunk = data[offset + 8 : offset + 8 + size]
        offset = end
        if kind == b"IHDR" and size == 13 and not header:
            _dimensions(*struct.unpack_from(">II", chunk))
            header = True
        elif kind in (b"tEXt", b"zTXt", b"iTXt", b"comf"):
            key, separator, text = chunk.partition(b"\0")
            if key not in (b"prompt", b"workflow") or not separator:
                continue
            if zlib.crc32(kind + chunk) != struct.unpack_from(">I", data, end - 4)[0]:
                raise WorkflowDecodeError("图片工作流元数据校验失败，请重新获取原始文件。")
            if kind == b"zTXt":
                if not text.startswith(b"\0"):
                    raise WorkflowDecodeError("图片工作流元数据压缩格式无效。")
                text = _inflate(text[1:], MAX_METADATA_BYTES - total)
            elif kind == b"iTXt":
                if len(text) < 2 or text[0] not in (0, 1) or text[1] != 0:
                    raise WorkflowDecodeError("图片工作流元数据文本格式无效。")
                compressed = text[0]
                parts = text[2:].split(b"\0", 2)
                if len(parts) != 3:
                    raise WorkflowDecodeError("图片工作流元数据文本不完整。")
                text = _inflate(parts[2], MAX_METADATA_BYTES - total) if compressed else parts[2]
            total += len(text)
            if total > MAX_METADATA_BYTES:
                raise WorkflowDecodeError("图片工作流元数据超过 8 MB，请改用 API 格式 JSON。")
            name = key.decode("ascii")
            if name in found:
                raise WorkflowDecodeError("图片包含重复的工作流元数据，请改用 API 格式 JSON。")
            try:
                found[name] = text.decode("utf-8")
            except UnicodeError:
                if kind == b"iTXt":
                    raise WorkflowDecodeError("图片工作流元数据不是有效 UTF-8。") from None
                found[name] = text.decode("latin-1")
        elif kind == b"IEND" and header:
            return found
    raise WorkflowDecodeError("PNG 文件不完整或格式无效，请重新获取原始文件。")


def _webp_metadata(data: bytes) -> dict[str, str]:
    if len(data) < 12 or struct.unpack_from("<I", data, 4)[0] + 8 != len(data):
        raise WorkflowDecodeError("WebP 文件不完整或格式无效。")
    found: dict[str, str] = {}
    offset, total = 12, 0
    while offset + 8 <= len(data):
        kind = data[offset : offset + 4]
        size = struct.unpack_from("<I", data, offset + 4)[0]
        end = offset + 8 + size
        if end > len(data):
            raise WorkflowDecodeError("WebP 文件不完整。")
        chunk = data[offset + 8 : end]
        offset = end + (size % 2)
        if kind == b"VP8X" and size >= 10:
            _dimensions(
                int.from_bytes(chunk[4:7], "little") + 1,
                int.from_bytes(chunk[7:10], "little") + 1,
            )
        if kind != b"EXIF":
            continue
        total += size
        if total > MAX_METADATA_BYTES:
            raise WorkflowDecodeError("图片工作流元数据超过 8 MB，请改用 API 格式 JSON。")
        try:
            exif = Image.Exif()
            with warnings.catch_warnings():
                warnings.simplefilter("error")
                exif.load(chunk)
                for tag in (0x0110, 0x010F, 0x010E):
                    value = exif.get(tag)
                    if not isinstance(value, str):
                        continue
                    key, separator, text = value.partition(":")
                    if separator and key in ("prompt", "workflow"):
                        if key in found:
                            raise WorkflowDecodeError("图片包含重复的工作流元数据。")
                        found[key] = text
        except WorkflowDecodeError:
            raise
        except (
            ValueError,
            TypeError,
            LookupError,
            OSError,
            EOFError,
            SyntaxError,
            Warning,
            struct.error,
            OverflowError,
        ):
            raise WorkflowDecodeError("WebP 工作流元数据损坏，请重新获取原始文件。") from None
    if offset != len(data):
        raise WorkflowDecodeError("WebP 文件不完整。")
    return found
