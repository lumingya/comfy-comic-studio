"""Atomic conversation files. A crashed execution is never replayed automatically."""

import json
import os
import re
import threading
import uuid
from pathlib import Path

from mio_server.extensions.public import MASK, NotFound, now_iso

from .models import AssistSettings


def uid(prefix=""):
    return prefix + uuid.uuid4().hex


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temp.open("w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


class ConversationStore:
    def __init__(self, root):
        self.root = Path(root)
        self.directory = self.root / "conversations"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        for path in self.directory.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if data.get("run", {}).get("status") in ("running", "waiting_approval"):
                    data["run"].update(
                        status="interrupted",
                        error="上次运行已中断，请检查操作记录后继续",
                    )
                    for call in data["run"].get("pending_calls", []):
                        if call.get("status") == "executing":
                            call["status"] = "unknown"
                    write_json(path, data)
            except (OSError, ValueError):
                continue

    def path(self, conversation_id):
        if not re.fullmatch(r"chat_[a-f0-9]{32}", conversation_id):
            raise NotFound("对话不存在")
        return self.directory / f"{conversation_id}.json"

    def get(self, conversation_id):
        with self.lock:
            try:
                return json.loads(self.path(conversation_id).read_text(encoding="utf-8"))
            except FileNotFoundError:
                raise NotFound("对话不存在") from None

    def put(self, data):
        with self.lock:
            data["updated_at"] = now_iso()
            write_json(self.path(data["id"]), data)
        return data

    def create(self, title):
        return self.put(
            {
                "id": uid("chat_"),
                "title": title,
                "created_at": now_iso(),
                "messages": [],
                "requests": {},
                "run": {"status": "idle", "pending_calls": []},
            }
        )

    def list(self):
        with self.lock:
            items = []
            for path in self.directory.glob("*.json"):
                try:
                    value = json.loads(path.read_text(encoding="utf-8"))
                    items.append(
                        {
                            key: value[key]
                            for key in (
                                "id",
                                "title",
                                "created_at",
                                "updated_at",
                                "run",
                            )
                        }
                    )
                except (OSError, ValueError, KeyError):
                    continue
            return sorted(items, key=lambda item: item["updated_at"], reverse=True)

    def settings(self):
        with self.lock:
            path = self.root / "config.json"
            if not path.exists():
                return AssistSettings()
            return AssistSettings.model_validate_json(path.read_text(encoding="utf-8"))

    def save_settings(self, settings):
        with self.lock:
            old = {c.id: c for c in self.settings().channels}
            for channel in settings.channels:
                if channel.api_key == MASK:
                    if channel.id not in old:
                        raise ValueError("新渠道需要自己的密钥")
                    if (channel.base_url, channel.provider) != (
                        old[channel.id].base_url,
                        old[channel.id].provider,
                    ):
                        raise ValueError("地址已改变，请重新填写此渠道的密钥")
                    channel.api_key = old[channel.id].api_key
            write_json(self.root / "config.json", settings.model_dump())
            return self.public_settings()

    def public_settings(self):
        data = self.settings().model_dump()
        for channel in data["channels"]:
            channel["api_key"] = MASK if channel["api_key"] else ""
        data["storage_path"] = str(self.directory.resolve())
        return data
