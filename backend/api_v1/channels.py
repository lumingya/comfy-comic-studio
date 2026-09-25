"""Image channels (saved generation endpoints) and the provider-type registry.

A *provider* is a type of image service (comfyui, novelai, openai, or one added by an
extension). A *channel* is a saved configuration of one provider: endpoint, model,
parameters and a pool of API keys. Keys are write-only: listings return metadata only.
"""

import copy
import uuid

from backend import mio_credentials
from backend.api_v1.common import channel_state, image_generation, mutate_settings, settings_doc
from backend.api_v1.core import ROUTER, ApiError, emit, merge_patch
from backend.api_v1.spec import BOOLEAN, INTEGER, STRING, array, obj, schema
from backend.mio_library import ID
from backend.mio_library_settings import secret_name
from backend.providers.registry import PROVIDERS

CHANNEL_ID = {"channelId": {"description": "Channel ID (see GET /channels)"}}
PROVIDER = schema("ProviderType", obj({
    "id": STRING, "label": STRING, "description": STRING, "builtin": BOOLEAN, "owner": STRING,
    "fields": array({"type": "object"}), "defaults": {"type": "object"}, "capabilities": {"type": "object"},
    "configFields": array(STRING)}))
CHANNEL = schema("Channel", obj({
    "id": STRING, "title": STRING, "provider": STRING, "baseUrl": STRING, "model": STRING, "active": BOOLEAN,
    "usesWorkflow": BOOLEAN, "keyMode": {"enum": ["none", "stored", "environment"]}, "keyCount": INTEGER,
    "extraParams": {"type": "object"}}, description="Provider-specific fields (protocol, size, sampler …) are included as saved"))
CHANNEL_INPUT = schema("ChannelInput", obj({
    "id": STRING, "title": STRING, "provider": STRING, "baseUrl": STRING, "model": STRING,
    "keyMode": {"enum": ["none", "environment"], "description": "`stored` is set automatically when keys are added"},
    "apiKey": {"type": "string", "writeOnly": True}, "apiKeys": array(STRING, maxItems=32, writeOnly=True),
    "activate": {"type": "boolean", "description": "Make this the active channel"},
    "extraParams": {"type": "object"}}, description="Plus the provider's own fields (see GET /providers/{id})"))
KEY_META = obj({"id": STRING, "label": STRING, "createdAt": INTEGER, "inUse": BOOLEAN})
WRITE_ONLY = ("apiKey", "apiKeys", "activate")


def public_channel(profile, active, comfy_base=""):
    item = {k: copy.deepcopy(v) for k, v in profile.items() if not secret_name(k) and k not in ("keyId", "keyIds", "keyLabel")}
    item["active"] = profile.get("id") == active
    item["usesWorkflow"] = bool(PROVIDERS.has(profile.get("provider")) and PROVIDERS.spec(profile["provider"])["capabilities"].get("workflow"))
    if item["usesWorkflow"]:
        item["baseUrl"] = comfy_base
    ids = profile.get("keyIds") or ([profile["keyId"]] if profile.get("keyId") else [])
    item["keyCount"] = len(ids) if profile.get("keyMode") == "stored" else 0
    item.setdefault("keyMode", "none")
    return item


def comfy_base(host):
    document, _ = settings_doc(host, "comfy")
    return str(document.get("baseUrl") or "")


def find(profiles, channel_id):
    profile = next((p for p in profiles if p.get("id") == channel_id), None)
    if profile is None:
        raise ApiError(404, "channel_not_found", "No saved channel with this ID")
    return profile


def provider_spec(provider):
    if not isinstance(provider, str) or not PROVIDERS.has(provider):
        raise ApiError(400, "unknown_provider", "Unknown provider; see GET /providers")
    return PROVIDERS.spec(provider)


def validate_fields(spec, values):
    """Check value types against the provider spec; key references are managed via /keys."""
    allowed = set(spec["configFields"]) | {"title"}
    unknown = sorted(set(values) - allowed - set(WRITE_ONLY))
    if unknown:
        raise ApiError(400, "unknown_field", "Unknown channel field(s): " + ", ".join(unknown))
    if "keyId" in values or "keyIds" in values:
        raise ApiError(400, "invalid_field", "Manage keys through /channels/{id}/keys")
    if values.get("keyMode", "none") not in ("none", "environment", "stored"):
        raise ApiError(400, "invalid_field", "keyMode must be none or environment")
    types = {f["key"]: f["type"] for f in spec["fields"]}
    for key, value in values.items():
        if key in WRITE_ONLY or value is None:
            continue
        kind = types.get(key, "json" if key == "extraParams" else "text")
        if kind == "toggle" and not isinstance(value, bool):
            raise ApiError(400, "invalid_field", key + " must be true or false")
        if kind in ("number", "range") and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ApiError(400, "invalid_field", key + " must be a number")
        if kind == "json" and not isinstance(value, dict):
            raise ApiError(400, "invalid_field", key + " must be an object")
        if kind in ("text", "select", "url", "textarea", "password", "color", "font", "code") and not isinstance(value, str):
            raise ApiError(400, "invalid_field", key + " must be a string")
        if kind == "select" and value not in [o["value"] for o in spec["fields"][[f["key"] for f in spec["fields"]].index(key)].get("options", [])]:
            raise ApiError(400, "invalid_field", key + " must be one of the provider's options")


def new_keys(values):
    keys = []
    if values.get("apiKey"):
        keys.append(values["apiKey"])
    if values.get("apiKeys"):
        if not isinstance(values["apiKeys"], list) or len(values["apiKeys"]) > 32:
            raise ApiError(400, "invalid_field", "apiKeys must be an array of at most 32 keys")
        keys.extend(values["apiKeys"])
    if any(not isinstance(k, str) or not k.strip() for k in keys):
        raise ApiError(400, "invalid_field", "API keys must be non-empty strings")
    return keys


def store_keys(host, profile, keys):
    """Save keys for the channel's current endpoint; returns their IDs."""
    if not keys:
        return []
    spec = provider_spec(profile.get("provider"))
    if spec["capabilities"].get("credentials") != "bearer":
        raise ApiError(400, "keys_not_supported", "This provider does not use API keys")
    with host.native_store().library.writer():
        result = mio_credentials.manage(host.DATA_DIR, {"action": "apply", "config": profile, "entries": [{"key": k} for k in keys]})
    return [item["id"] for item in result["keys"]]


def save_channels(host, change):
    """Atomic edit of ``imageGeneration`` in the workspace settings."""
    def edit(document):
        return change(image_generation(document))

    result, _ = mutate_settings(host, "workspace", edit)
    emit(host, "channels.saved", {})
    return result


# ------------------------------------------------------------------ provider types

@ROUTER.get("/providers", summary="图像服务类型注册表（内置 + 扩展注册），含字段定义与能力", tags=["channels"],
            response=array(PROVIDER))
def list_providers(ctx):
    return PROVIDERS.manifest()


@ROUTER.get("/providers/{providerId}", summary="一个图像服务类型的字段、默认值与能力", tags=["channels"],
            params={"providerId": {"description": "comfyui, novelai, openai or an extension provider"}}, response=PROVIDER)
def get_provider(ctx):
    if not PROVIDERS.has(ctx.params["providerId"]):
        raise ApiError(404, "unknown_provider", "Unknown provider")
    return PROVIDERS.spec(ctx.params["providerId"])


# ------------------------------------------------------------------ channels

@ROUTER.get("/channels", summary="已保存的图像渠道与当前渠道（不含密钥）", tags=["channels"],
            response=obj({"active": STRING, "items": array(CHANNEL)}))
def list_channels(ctx):
    profiles, active = channel_state(ctx.host)
    base = comfy_base(ctx.host)
    return {"active": active, "items": [public_channel(p, active, base) for p in profiles]}


@ROUTER.post("/channels", summary="新建渠道（可同时保存 API Key，并设为当前渠道）", tags=["channels"],
             body=CHANNEL_INPUT, response=CHANNEL, status=201)
def create_channel(ctx):
    body = ctx.json()
    spec = provider_spec(body.get("provider"))
    if spec["capabilities"].get("workflow"):
        raise ApiError(409, "builtin_channel", "Workflow providers use the built-in ComfyUI channel; add workflows instead")
    validate_fields(spec, body)
    profile = {**copy.deepcopy(spec["defaults"]), **{k: copy.deepcopy(v) for k, v in body.items() if k not in WRITE_ONLY}}
    profile["id"] = body.get("id") or "provider_" + uuid.uuid4().hex[:12]
    if not isinstance(profile["id"], str) or not ID.fullmatch(profile["id"]):
        raise ApiError(400, "invalid_id", "Channel IDs must match [A-Za-z0-9_-]{1,150}")
    profile["title"] = str(body.get("title") or spec["label"])[:120]
    profile.setdefault("keyMode", "none")
    keys = new_keys(body)
    if keys:
        profile["keyIds"] = store_keys(ctx.host, profile, keys)
        profile["keyMode"] = "stored"

    def change(generation):
        if any(p.get("id") == profile["id"] for p in generation["profiles"] if isinstance(p, dict)):
            raise ApiError(409, "already_exists", "A channel with this ID already exists")
        generation["profiles"].append(profile)
        if body.get("activate") or not generation.get("active"):
            generation["active"] = profile["id"]
        return generation.get("active")

    active = save_channels(ctx.host, change)
    return public_channel(profile, active, comfy_base(ctx.host))


@ROUTER.get("/channels/{channelId}", summary="读取一个渠道", tags=["channels"], params=CHANNEL_ID, response=CHANNEL)
def get_channel(ctx):
    profiles, active = channel_state(ctx.host)
    return public_channel(find(profiles, ctx.params["channelId"]), active, comfy_base(ctx.host))


@ROUTER.patch("/channels/{channelId}", summary="修改渠道（合并补丁）；更换地址或服务类型且未给新 Key 时会解除旧 Key",
              tags=["channels"], params=CHANNEL_ID, body=CHANNEL_INPUT,
              response=obj({"channel": CHANNEL, "keysReset": BOOLEAN}))
def patch_channel(ctx):
    patch = ctx.json()
    channel_id = ctx.params["channelId"]
    if patch.get("id", channel_id) != channel_id:
        raise ApiError(400, "id_mismatch", "The channel id cannot be changed")
    profiles, _ = channel_state(ctx.host)
    current = find(profiles, channel_id)
    spec = provider_spec(patch.get("provider", current.get("provider")))
    validate_fields(spec, patch)
    if PROVIDERS.spec(current["provider"])["capabilities"].get("workflow"):
        # The ComfyUI address is part of the comfy settings document.
        if "baseUrl" in patch:
            def set_base(document):
                document["baseUrl"] = str(patch["baseUrl"] or "")

            mutate_settings(ctx.host, "comfy", set_base)
        if patch.get("provider", current["provider"]) != current["provider"]:
            raise ApiError(409, "builtin_channel", "The built-in ComfyUI channel cannot change its provider")
    updated = merge_patch(current, {k: v for k, v in patch.items() if k not in WRITE_ONLY})
    if PROVIDERS.spec(current["provider"])["capabilities"].get("workflow"):
        updated.pop("baseUrl", None)
    rebinding = updated.get("baseUrl") != current.get("baseUrl") or updated.get("provider") != current.get("provider")
    keys = new_keys(patch)
    reset = False
    if keys:
        updated["keyIds"] = store_keys(ctx.host, updated, keys) if rebinding else list(dict.fromkeys(
            (current.get("keyIds") or []) + store_keys(ctx.host, updated, keys)))
        updated.pop("keyId", None)
        updated["keyMode"] = "stored"
    elif rebinding and current.get("keyMode") == "stored":
        # Keys are bound to the endpoint they were saved for; never send them elsewhere.
        updated.pop("keyIds", None)
        updated.pop("keyId", None)
        updated["keyMode"] = "none"
        reset = True

    def change(generation):
        for index, profile in enumerate(generation["profiles"]):
            if isinstance(profile, dict) and profile.get("id") == channel_id:
                generation["profiles"][index] = updated
                break
        else:
            raise ApiError(404, "channel_not_found", "No saved channel with this ID")
        if patch.get("activate"):
            generation["active"] = channel_id
        return generation.get("active")

    active = save_channels(ctx.host, change)
    return {"channel": public_channel(updated, active, comfy_base(ctx.host)), "keysReset": reset}


@ROUTER.delete("/channels/{channelId}", summary="删除渠道及其保存的 Key（内置 ComfyUI 渠道不可删除）", tags=["channels"],
               params=CHANNEL_ID, response=obj({"deleted": STRING, "active": STRING}))
def delete_channel(ctx):
    channel_id = ctx.params["channelId"]
    profiles, _ = channel_state(ctx.host)
    current = find(profiles, channel_id)
    if PROVIDERS.has(current.get("provider")) and PROVIDERS.spec(current["provider"])["capabilities"].get("workflow"):
        raise ApiError(409, "builtin_channel", "The built-in ComfyUI channel cannot be deleted; switch to another channel instead")

    def change(generation):
        generation["profiles"] = [p for p in generation["profiles"] if not (isinstance(p, dict) and p.get("id") == channel_id)]
        if generation.get("active") == channel_id:
            generation["active"] = next((p.get("id") for p in generation["profiles"] if isinstance(p, dict)), "")
        return generation.get("active")

    active = save_channels(ctx.host, change)
    with ctx.store.library.writer():
        mio_credentials.manage(ctx.host.DATA_DIR, {"action": "purge", "config": {"id": channel_id}})
    return {"deleted": channel_id, "active": active}


@ROUTER.post("/channels/{channelId}/activate", summary="设为当前渠道", tags=["channels"], params=CHANNEL_ID,
             response=obj({"active": STRING}))
def activate_channel(ctx):
    channel_id = ctx.params["channelId"]

    def change(generation):
        find([p for p in generation["profiles"] if isinstance(p, dict)], channel_id)
        generation["active"] = channel_id
        return channel_id

    return {"active": save_channels(ctx.host, change)}


def operation_config(host, profile):
    config = copy.deepcopy(profile)
    if PROVIDERS.spec(profile["provider"])["capabilities"].get("workflow"):
        config["baseUrl"] = comfy_base(host)
    return config


def run_provider(ctx, op, config):
    try:
        return ctx.service("provider_operation")(op, {"config": config})
    except (ApiError, ValueError):
        raise
    except Exception as exc:  # upstream transport failures
        raise ApiError(502, "upstream_error", str(exc)[:300] or "The provider did not answer") from None


@ROUTER.post("/channels/{channelId}/check", summary="测试连接（ComfyUI：系统状态；云端渠道：读取模型列表）",
             tags=["channels"], params=CHANNEL_ID, errors=(502,))
def check_channel(ctx):
    profiles, _ = channel_state(ctx.host)
    profile = find(profiles, ctx.params["channelId"])
    entry = PROVIDERS.get(provider_spec(profile.get("provider"))["id"])
    config = operation_config(ctx.host, profile)
    if entry.check is not None:
        return {"ok": True, "via": "check", "result": run_provider(ctx, "check", config)}
    if entry.models is not None:
        models = run_provider(ctx, "models", config)
        count = len(models.get("models", models.get("data", []))) if isinstance(models, dict) else len(models or [])
        return {"ok": True, "via": "models", "models": count}
    raise ApiError(400, "unsupported_operation", "This provider offers neither a connection check nor a model list")


@ROUTER.get("/channels/{channelId}/models", summary="渠道可用的模型列表（ComfyUI：节点信息与模型目录）", tags=["channels"],
            params=CHANNEL_ID, errors=(502,))
def channel_models(ctx):
    profiles, _ = channel_state(ctx.host)
    profile = find(profiles, ctx.params["channelId"])
    provider_spec(profile.get("provider"))
    return run_provider(ctx, "models", operation_config(ctx.host, profile))


# ------------------------------------------------------------------ key pool

def key_scope(profile):
    try:
        mio_credentials.scope(profile)
    except ValueError as exc:
        raise ApiError(400, "keys_not_supported", str(exc)) from None
    return profile


@ROUTER.get("/channels/{channelId}/keys", summary="渠道的 Key 池（只返回 ID、标签、创建时间）", tags=["channels"],
            params=CHANNEL_ID, response=obj({"keys": array(KEY_META), "keyMode": STRING}))
def list_keys(ctx):
    profiles, _ = channel_state(ctx.host)
    profile = key_scope(find(profiles, ctx.params["channelId"]))
    with ctx.store.library.writer():
        keys = mio_credentials.manage(ctx.host.DATA_DIR, {"action": "list", "config": profile})["keys"]
    in_use = set(profile.get("keyIds") or ([profile["keyId"]] if profile.get("keyId") else []))
    return {"keyMode": profile.get("keyMode", "none"), "keys": [{**k, "inUse": k["id"] in in_use} for k in keys]}


@ROUTER.post("/channels/{channelId}/keys", summary="向 Key 池添加一个 Key（多个 Key 轮流使用）", tags=["channels"],
             params=CHANNEL_ID, status=201,
             body=obj({"key": {"type": "string", "writeOnly": True}, "label": STRING}, ["key"]), response=KEY_META)
def add_key(ctx):
    body = ctx.json()
    profiles, _ = channel_state(ctx.host)
    profile = key_scope(find(profiles, ctx.params["channelId"]))
    with ctx.store.library.writer():
        added = mio_credentials.manage(ctx.host.DATA_DIR, {"action": "add", "config": profile, "key": body.get("key", ""),
                                                            "label": body.get("label")})["key"]

    def change(generation):
        target = find([p for p in generation["profiles"] if isinstance(p, dict)], profile["id"])
        ids = target.get("keyIds") or ([target["keyId"]] if target.get("keyId") else [])
        target["keyIds"] = list(dict.fromkeys(ids + [added["id"]]))[:32]
        target.pop("keyId", None)
        target["keyMode"] = "stored"

    save_channels(ctx.host, change)
    return {**added, "inUse": True}


@ROUTER.delete("/channels/{channelId}/keys/{keyId}", summary="从 Key 池删除一个 Key", tags=["channels"],
               params={**CHANNEL_ID, "keyId": {"description": "Key ID from GET /channels/{channelId}/keys"}},
               response=obj({"deleted": STRING, "keyMode": STRING}))
def delete_key(ctx):
    profiles, _ = channel_state(ctx.host)
    profile = key_scope(find(profiles, ctx.params["channelId"]))
    key_id = ctx.params["keyId"]
    with ctx.store.library.writer():
        try:
            mio_credentials.manage(ctx.host.DATA_DIR, {"action": "delete", "config": profile, "keyId": key_id})
        except ValueError:
            raise ApiError(404, "key_not_found", "No key with this ID for this channel and endpoint") from None

    def change(generation):
        target = find([p for p in generation["profiles"] if isinstance(p, dict)], profile["id"])
        ids = [i for i in (target.get("keyIds") or ([target["keyId"]] if target.get("keyId") else [])) if i != key_id]
        target.pop("keyId", None)
        if ids:
            target["keyIds"] = ids
        else:
            target.pop("keyIds", None)
            if target.get("keyMode") == "stored":
                target["keyMode"] = "none"
        return target["keyMode"]

    return {"deleted": key_id, "keyMode": save_channels(ctx.host, change)}


# ------------------------------------------------------------------ ComfyUI helpers

@ROUTER.post("/comfy/check", summary="检查 ComfyUI 是否可用（默认使用已保存的地址）", tags=["workflows"],
             body=obj({"baseUrl": STRING}), body_required=False, errors=(502,))
def comfy_check(ctx):
    base = ctx.json(required=False).get("baseUrl") or comfy_base(ctx.host)
    return run_provider(ctx, "check", {"provider": "comfyui", "baseUrl": base})


@ROUTER.get("/comfy/object-info", summary="ComfyUI 节点信息（/object_info）与已安装模型目录", tags=["workflows"], errors=(502,))
def comfy_object_info(ctx):
    return run_provider(ctx, "models", {"provider": "comfyui", "baseUrl": comfy_base(ctx.host)})
