"""Bounded assistant private data inside its isolated SDK data directory."""

from __future__ import annotations

import json
import re
import shutil
from contextlib import nullcontext
from pathlib import Path

from mio_server.backups.extension_data import ATOMIC_TEMP as SDK_TEMP
from mio_server.backups.extension_data import extension_data_dir, regular_path
from mio_server.backups.privacy import clean_url, has_embedded_secret
from mio_server.storage import Conflict

MAX_AI_SETTINGS = 1024 * 1024
MAX_AI_CONVERSATION = 32 * 1024 * 1024
MAX_AI_METADATA = 64 * 1024
MAX_AI_ATTACHMENT = 8 * 1024 * 1024
CONVERSATION = re.compile(r"extensions_data/ai-assist/conversations/chat_[a-f0-9]{32}\.json")
ATTACHMENT = re.compile(r"extensions_data/ai-assist/attachments/img_[a-f0-9]{32}\.(json|bin)")
ATOMIC_TEMP = re.compile(r"(?:config|chat_[a-f0-9]{32}|img_[a-f0-9]{32})\.json\.[a-f0-9]{32}\.tmp")


def allowed_ai_path(name: str) -> bool:
    return bool(
        name == "extensions_data/ai-assist/config.json"
        or CONVERSATION.fullmatch(name)
        or ATTACHMENT.fullmatch(name)
    )


def ai_size_limit(name: str) -> int:
    if name == "extensions_data/ai-assist/config.json":
        return MAX_AI_SETTINGS
    if CONVERSATION.fullmatch(name):
        return MAX_AI_CONVERSATION
    return MAX_AI_ATTACHMENT if name.endswith(".bin") else MAX_AI_METADATA


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("AI assistant data contains duplicate JSON keys")
        result[key] = value
    return result


def _object(path: Path, limit: int) -> dict:
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("AI assistant data exceeds its size limit")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs)
        if not isinstance(value, dict):
            raise TypeError("AI assistant data requires JSON objects")
        json.dumps(value, allow_nan=False)
        return value
    except (UnicodeDecodeError, ValueError, TypeError, RecursionError) as exc:
        raise ValueError("AI assistant data must be valid UTF-8 JSON") from exc


def _private(value, include_credentials):
    try:
        if not include_credentials and has_embedded_secret(value):
            raise ValueError(
                "AI assistant data contains embedded credentials; remove them or explicitly include credentials"
            )
    except RecursionError as exc:
        raise ValueError("AI assistant data nesting is too deep") from exc


def _settings(path: Path, *, redact: bool) -> dict:
    value = _object(path, MAX_AI_SETTINGS)
    channels = value.get("channels", [])
    if not isinstance(channels, list) or not all(isinstance(channel, dict) for channel in channels):
        raise ValueError("AI assistant channels must be a list")
    if redact:
        for channel in channels:
            channel.pop("api_key", None)
            if "base_url" in channel:
                if not isinstance(channel["base_url"], str):
                    raise ValueError("AI assistant channel URL must be text")
                channel["base_url"] = clean_url(channel["base_url"])
    return value


def assistant_files(workspace: Path, *, include_credentials: bool = True):
    """Validate committed files and attachment pairs without reading images into memory."""
    workspace = workspace.resolve()
    root = extension_data_dir(workspace, "ai-assist")
    regular_path(root)
    if not root.exists():
        return
    if not root.is_dir() or root.resolve() != root:
        raise ValueError("AI assistant data must use a regular local directory")
    files = {}
    pending = [root]
    while pending:
        for path in sorted(pending.pop().iterdir()):
            regular_path(path)
            if (
                ATOMIC_TEMP.fullmatch(path.name) or SDK_TEMP.fullmatch(path.name)
            ) and path.is_file():
                continue
            name = path.relative_to(workspace).as_posix()
            if name == "extensions_data/ai-assist/settings.json":
                # The SDK's generic settings contract validates and snapshots this file.
                continue
            if path.is_dir() and name in {
                "extensions_data/ai-assist/conversations",
                "extensions_data/ai-assist/attachments",
            }:
                pending.append(path)
                continue
            if not path.is_file() or not allowed_ai_path(name):
                raise ValueError("AI assistant data contains a forbidden path")
            if path.stat().st_size > ai_size_limit(name):
                raise ValueError("AI assistant data exceeds its size limit")
            files[name] = path
            if len(files) > 100_000:
                raise ValueError("AI assistant data contains too many files")
    attachment_ids = set()
    for name, path in files.items():
        if not ATTACHMENT.fullmatch(name):
            continue
        sibling = str(Path(name).with_suffix(".json" if name.endswith(".bin") else ".bin")).replace(
            "\\", "/"
        )
        if sibling not in files:
            raise ValueError("AI assistant attachment is missing metadata or image data")
        if name.endswith(".json"):
            metadata = _object(path, MAX_AI_METADATA)
            if (
                metadata.get("id") != path.stem
                or metadata.get("size") != files[sibling].stat().st_size
                or metadata.get("mime_type")
                not in {"image/png", "image/jpeg", "image/webp", "image/gif"}
                or metadata.get("url") != f"/api/ai-assist/attachments/{path.stem}"
            ):
                raise ValueError("AI assistant attachment metadata does not match its image")
            _private(metadata, include_credentials)
            attachment_ids.add(path.stem)
    for name in sorted(files):
        path = files[name]
        if name == "extensions_data/ai-assist/config.json":
            _private(_settings(path, redact=False), include_credentials)
        elif CONVERSATION.fullmatch(name):
            conversation = _object(path, MAX_AI_CONVERSATION)
            run = conversation.get("run")
            if (
                conversation.get("id") != path.stem
                or not all(
                    isinstance(conversation.get(field), str)
                    for field in ("title", "created_at", "updated_at")
                )
                or not isinstance(conversation.get("messages"), list)
                or not isinstance(conversation.get("requests"), dict)
                or not isinstance(run, dict)
                or not isinstance(run.get("status"), str)
                or not isinstance(run.get("pending_calls"), list)
                or not all(isinstance(call, dict) for call in run["pending_calls"])
            ):
                raise ValueError("AI assistant conversation identity or messages are invalid")
            for message in conversation["messages"]:
                references = (
                    message.get("attachment_ids", []) if isinstance(message, dict) else None
                )
                if not isinstance(references, list) or not all(
                    isinstance(identifier, str) and identifier in attachment_ids
                    for identifier in references
                ):
                    raise ValueError("AI assistant conversation references a missing attachment")
            _private(conversation, include_credentials)
        yield name, path


def copy_assistant_data(
    source: Path, target: Path, *, include_credentials: bool, byte_budget: int
) -> int:
    total = 0
    for name, path in assistant_files(source):
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if name == "extensions_data/ai-assist/config.json":
            settings = _settings(path, redact=not include_credentials)
            _private(settings, include_credentials)
            raw = json.dumps(settings, ensure_ascii=False, allow_nan=False).encode("utf-8")
            total += len(raw)
            if total > byte_budget:
                raise ValueError("workspace exceeds the archive size limit")
            destination.write_bytes(raw)
        else:
            total += path.stat().st_size
            if total > byte_budget:
                raise ValueError("workspace exceeds the archive size limit")
            shutil.copyfile(path, destination)
    # Also reject credentials embedded in messages or attachment metadata, matching workspace
    # JSON privacy rules. User text is preserved rather than silently rewritten.
    for _ in assistant_files(target, include_credentials=include_credentials):
        pass
    return total


def require_assistant_idle(ctx):
    assistant = getattr(ctx, "extension_services", {}).get("ai-assist")
    if assistant is None:
        return
    with assistant.lock:
        if assistant.workers or any(
            item.get("run", {}).get("status") in {"running", "waiting_approval"}
            for item in assistant.store.list()
        ):
            raise Conflict("请先停止 AI 对话并等待请求结束，再恢复工作区")


class AssistantBackup:
    root = "extensions_data/ai-assist"
    allowed = staticmethod(allowed_ai_path)
    size_limit = staticmethod(ai_size_limit)
    files = staticmethod(assistant_files)
    snapshot = staticmethod(copy_assistant_data)
    restore_guard = staticmethod(require_assistant_idle)

    @staticmethod
    def lock(ctx):
        service = getattr(ctx, "extension_services", {}).get("ai-assist")
        return service.lock if service is not None else nullcontext()


PARTICIPANT = AssistantBackup()
