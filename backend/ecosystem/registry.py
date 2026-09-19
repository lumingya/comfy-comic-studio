"""Open registries: image providers, exporters and importers.

Every entry has an ``owner`` (``core`` or an extension id) so a disabled
extension unregisters everything it contributed in one call. Specs are plain
JSON so the front end can render forms, menus and option lists directly
from ``/api/ecosystem/manifest`` without knowing who registered them.
"""

import copy
import re
import threading

from backend.mio_library import LibraryError
from .storage import identifier

FIELD_TYPES = ("text", "password", "number", "select", "toggle", "json", "textarea", "url", "color", "range", "font", "image", "code")
# Channel keys every provider shares; provider specs add their own on top.
BASE_CHANNEL_FIELDS = ("id", "title", "provider", "baseUrl", "model", "keyMode", "keyId", "keyIds", "extraParams")
CAPABILITY_DEFAULTS = {
    "images": True,        # accepts reference images
    "negative": True,      # accepts a negative prompt
    "seed": True,
    "size": True,
    "steps": True,
    "cfg": True,
    "models": False,       # can list models (op: models)
    "check": False,        # can run a read-only connection check (op: check)
    "workflow": False,     # needs a ComfyUI-style graph
    "braceWeights": False, # prompt braces are emphasis syntax (NovelAI): unknown {tokens} stay literal
    "multimodal": False,   # chat-style multimodal model rather than a diffusion endpoint
    "credentials": "none", # "none" | "bearer": host resolves a stored key and passes it along
}
SPEC_ID = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


def _field(item):
    if not isinstance(item, dict) or not isinstance(item.get("key"), str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", item["key"]):
        raise LibraryError("Provider field requires an identifier key")
    if item["key"] in ("id", "provider", "keyMode", "keyId", "keyIds"):
        raise LibraryError("Provider field key is reserved: " + item["key"])
    kind = item.get("type", "text")
    if kind not in FIELD_TYPES:
        raise LibraryError("Unsupported field type: " + str(kind))
    field = {
        "key": item["key"],
        "label": str(item.get("label") or item["key"])[:80],
        "type": kind,
        "required": item.get("required") is True,
        "secret": kind == "password",
    }
    for key in ("default", "placeholder", "help", "min", "max", "step", "language"):
        if key in item:
            field[key] = item[key]
    if kind == "select":
        options = item.get("options") or []
        if not isinstance(options, list) or not options or len(options) > 200:
            raise LibraryError("Select field requires 1–200 options")
        field["options"] = [
            {"value": str(o["value"] if isinstance(o, dict) else o), "label": str(o.get("label", o["value"]) if isinstance(o, dict) else o)[:80]}
            for o in options
        ]
    return field


def normalize_provider_spec(spec, owner):
    if not isinstance(spec, dict):
        raise LibraryError("Provider spec must be an object")
    id = spec.get("id")
    if not isinstance(id, str) or not SPEC_ID.fullmatch(id):
        raise LibraryError("Provider id must match [a-z][a-z0-9_-]{0,63}")
    fields = [_field(f) for f in spec.get("fields", [])]
    if len(fields) > 64:
        raise LibraryError("At most 64 provider fields")
    keys = [f["key"] for f in fields]
    if len(set(keys)) != len(keys):
        raise LibraryError("Duplicate provider field key")
    capabilities = dict(CAPABILITY_DEFAULTS)
    for key, value in (spec.get("capabilities") or {}).items():
        if key not in capabilities:
            raise LibraryError("Unknown provider capability: " + str(key))
        if key == "credentials":
            if value not in ("none", "bearer"):
                raise LibraryError("credentials must be none or bearer")
            capabilities[key] = value
        else:
            capabilities[key] = bool(value)
    defaults = spec.get("defaults") or {}
    if not isinstance(defaults, dict):
        raise LibraryError("Provider defaults must be an object")
    for field in fields:
        if "default" in field and field["key"] not in defaults:
            defaults[field["key"]] = field["default"]
    return {
        "id": id,
        "label": str(spec.get("label") or id)[:80],
        "description": str(spec.get("description") or "")[:400],
        "kind": "image",
        "owner": owner,
        "builtin": owner == "core",
        "fields": fields,
        "defaults": defaults,
        "capabilities": capabilities,
        "configFields": list(dict.fromkeys(BASE_CHANNEL_FIELDS + tuple(keys) + tuple(spec.get("configFields", ())))),
        "panel": spec.get("panel", "generic" if owner != "core" else id),
        "docs": str(spec.get("docs") or "")[:300],
    }


class Provider:
    __slots__ = ("spec", "generate", "models", "check")

    def __init__(self, spec, generate, models=None, check=None):
        self.spec = spec
        self.generate = generate
        self.models = models
        self.check = check

    @property
    def id(self):
        return self.spec["id"]

    @property
    def owner(self):
        return self.spec["owner"]


class ProviderRegistry:
    def __init__(self):
        self.lock = threading.RLock()
        self.items = {}

    def register(self, spec, generate, *, owner="core", models=None, check=None):
        if owner != "core":
            identifier(owner)
        normalized = normalize_provider_spec(spec, owner)
        if not callable(generate):
            raise LibraryError("Provider requires a generate callable")
        with self.lock:
            existing = self.items.get(normalized["id"])
            if existing and existing.owner != owner:
                raise LibraryError("Provider id already registered by " + existing.owner + ": " + normalized["id"], 409)
            self.items[normalized["id"]] = Provider(normalized, generate, models, check)
            return normalized

    def unregister(self, *, owner):
        with self.lock:
            for id in [k for k, v in self.items.items() if v.owner == owner]:
                del self.items[id]

    def get(self, id):
        with self.lock:
            item = self.items.get(id)
        if not item:
            raise LibraryError("Unknown image provider: " + str(id) + "。请启用提供该渠道的扩展，或改选其他渠道。", 404)
        return item

    def has(self, id):
        with self.lock:
            return id in self.items

    def spec(self, id):
        return copy.deepcopy(self.get(id).spec)

    def config_fields(self, id):
        with self.lock:
            item = self.items.get(id)
        return tuple(item.spec["configFields"]) if item else BASE_CHANNEL_FIELDS

    def manifest(self):
        with self.lock:
            return [copy.deepcopy(v.spec) for v in sorted(self.items.values(), key=lambda p: (not p.spec["builtin"], p.id))]


class SimpleRegistry:
    """Exporters / importers: spec + callable, owner-scoped."""

    def __init__(self, kind):
        self.kind = kind
        self.lock = threading.RLock()
        self.items = {}

    def register(self, spec, run, *, owner):
        if owner != "core":
            identifier(owner)
        if not isinstance(spec, dict) or not isinstance(spec.get("id"), str) or not SPEC_ID.fullmatch(spec["id"]):
            raise LibraryError(self.kind + " id must match [a-z][a-z0-9_-]{0,63}")
        if not callable(run):
            raise LibraryError(self.kind + " requires a callable")
        key = spec["id"] if owner == "core" else owner + ":" + spec["id"]
        normalized = {
            "id": key,
            "localId": spec["id"],
            "owner": owner,
            "label": str(spec.get("label") or spec["id"])[:80],
            "description": str(spec.get("description") or "")[:300],
            "extension": str(spec.get("extension") or "")[:16].lstrip("."),
            "mime": str(spec.get("mime") or "application/octet-stream")[:100],
            "accepts": [str(x)[:16] for x in (spec.get("accepts") or [])][:16],
            "scope": spec.get("scope", "album"),
            "runtime": spec.get("runtime", "backend"),
            "timeout": max(5, min(600, int(spec.get("timeout", 120) or 120))),
        }
        with self.lock:
            self.items[key] = (normalized, run)
            return normalized

    def unregister(self, *, owner):
        with self.lock:
            for key in [k for k, (spec, _) in self.items.items() if spec["owner"] == owner]:
                del self.items[key]

    def get(self, id):
        with self.lock:
            item = self.items.get(id)
        if not item:
            raise LibraryError("Unknown " + self.kind + ": " + str(id), 404)
        return {"spec": item[0], "run": item[1]}

    def manifest(self):
        with self.lock:
            return [copy.deepcopy(spec) for spec, _ in self.items.values()]
