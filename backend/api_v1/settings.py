"""Settings documents (comfy / llm / xml / workspace). Credentials are write-only.

Secret-named leaves (``key``, ``apiKey``, ``token`` …) are moved into the local vault by
the settings writer. Reads never contain secret values: they list the JSON pointers
that currently hold a stored credential instead.
"""

import copy

from backend.api_v1.common import settings_doc
from backend.api_v1.core import ROUTER, ApiError, Reply, emit, merge_patch, quoted_etag
from backend.api_v1.spec import BOOLEAN, STRING, array, obj, qp, schema
from backend.mio_library_settings import leaves, secret_name

NAMES = ("workspace", "comfy", "llm", "xml")
NAME = {"name": {"schema": {"enum": list(NAMES)},
                 "description": "workspace (UI, channels, ordering…), comfy (ComfyUI address, active workflow), "
                                "llm (text model), xml (storyboard XML model)"}}
SETTINGS = schema("SettingsDocument", obj({
    "name": STRING, "etag": {"type": ["string", "null"]}, "document": {"type": "object"},
    "secrets": array(STRING, description="JSON pointers that hold a stored credential (values are never returned)")},
    ["name", "document", "secrets"]))


def check_name(name):
    if name not in NAMES:
        raise ApiError(404, "unknown_settings", "Settings documents: " + ", ".join(NAMES))
    return name


def public_view(name, document, etag):
    document = copy.deepcopy(document)
    refs = document.pop("_secretRefs", {}) or {}
    return {"name": name, "etag": etag, "document": document, "secrets": sorted(refs)}


def write(host, name, document, expected, clear=()):
    from backend.api_v1.common import save_settings

    if not isinstance(document, dict):
        raise ApiError(400, "invalid_body", "Settings must be a JSON object")
    document = copy.deepcopy(document)
    document.pop("_secretRefs", None)  # re-attached by the writer from the stored document
    with host.CONFIG_LOCK:
        _, current = settings_doc(host, name)
        if expected is not None and expected != current:
            raise ApiError(409, "revision_conflict", "Settings changed since they were read")
        save_settings(host, name, document, current, clear)
        stored, etag = settings_doc(host, name)
    emit(host, "settings.saved", {"name": name})
    return public_view(name, stored, etag)


def parse_pointer(pointer):
    if not isinstance(pointer, str) or not pointer.startswith("/") or len(pointer) > 500:
        raise ApiError(400, "invalid_pointer", "pointer must be a JSON pointer such as /key")
    return [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]


def secret_pointers(document):
    return sorted(pointer for _, _, pointer in leaves(document))


@ROUTER.get("/settings", summary="设置文档列表：名称、ETag、已保存密钥的位置", tags=["settings"],
            response=array(obj({"name": STRING, "etag": {"type": ["string", "null"]}, "secrets": array(STRING)})))
def list_settings(ctx):
    items = []
    for name in NAMES:
        document, etag = settings_doc(ctx.host, name)
        items.append({"name": name, "etag": etag, "secrets": sorted((document.get("_secretRefs") or {}))})
    return items


@ROUTER.get("/settings/{name}", summary="读取设置文档（不含密钥值；?view=true 返回界面使用的展开视图）",
            tags=["settings"], params=NAME, response=SETTINGS,
            query=[qp("view", "boolean", "comfy: hydrate the active workflow fields (read-only view)")])
def get_settings(ctx):
    name = check_name(ctx.params["name"])
    document, etag = settings_doc(ctx.host, name)
    view = public_view(name, document, etag)
    if ctx.q_bool("view"):
        hydrated = copy.deepcopy(ctx.store.settings_view(name))
        hydrated.pop("_secretRefs", None)
        view["document"] = hydrated
    return Reply(view, headers={"ETag": quoted_etag(etag)} if etag else {})


@ROUTER.put("/settings/{name}", summary="替换设置文档（密钥字段填明文即保存到本地密钥库；留空则保持原密钥）",
            tags=["settings"], params=NAME, body={"type": "object"}, response=SETTINGS,
            query=[qp("expectedEtag", description="Alternative to If-Match")], body_limit=20 * 1024 * 1024,
            description="Changing an endpoint (baseUrl) next to a stored key without supplying a new key fails with "
                        "409 credential_binding_changed: keys are bound to the endpoint they were saved for.")
def put_settings(ctx):
    name = check_name(ctx.params["name"])
    view = write(ctx.host, name, ctx.json(), ctx.if_match())
    return Reply(view, headers={"ETag": quoted_etag(view["etag"])} if view["etag"] else {})


@ROUTER.patch("/settings/{name}", summary="合并补丁修改设置（例：切换当前画册集、修改 LLM 模型）", tags=["settings"],
              params=NAME, body={"type": "object"}, response=SETTINGS,
              query=[qp("expectedEtag", description="Alternative to If-Match")], body_limit=20 * 1024 * 1024)
def patch_settings(ctx):
    name = check_name(ctx.params["name"])
    patch = ctx.json()
    patch.pop("_secretRefs", None)
    with ctx.host.CONFIG_LOCK:
        document, etag = settings_doc(ctx.host, name)
        expected = ctx.if_match()
        if expected and expected != etag:
            raise ApiError(409, "revision_conflict", "Settings changed since they were read")
        document.pop("_secretRefs", None)
        view = write(ctx.host, name, merge_patch(document, patch), etag)
    return Reply(view, headers={"ETag": quoted_etag(view["etag"])} if view["etag"] else {})


@ROUTER.get("/settings/{name}/secrets", summary="哪些位置保存了密钥、哪些位置可以保存密钥（不返回值）",
            tags=["settings"], params=NAME,
            response=obj({"stored": array(STRING), "slots": array(STRING)}))
def list_secrets(ctx):
    name = check_name(ctx.params["name"])
    document, _ = settings_doc(ctx.host, name)
    return {"stored": sorted((document.get("_secretRefs") or {})), "slots": secret_pointers(document)}


@ROUTER.put("/settings/{name}/secrets", summary="保存一个密钥（例：{pointer: \"/key\", value: \"sk-…\"}）",
            tags=["settings"], params=NAME,
            body=obj({"pointer": STRING, "value": {"type": "string", "writeOnly": True, "minLength": 1}}, ["pointer", "value"]),
            response=obj({"stored": array(STRING)}))
def put_secret(ctx):
    name = check_name(ctx.params["name"])
    body = ctx.json()
    parts = parse_pointer(body.get("pointer"))
    value = body.get("value")
    if not isinstance(value, str) or not value.strip() or len(value) > 32768 or "\n" in value:
        raise ApiError(400, "invalid_field", "value must be a single-line, non-empty string")
    if not secret_name(parts[-1]):
        raise ApiError(400, "invalid_pointer", "The pointer must end in a credential field (key, apiKey, token, password …)")
    pointer = body["pointer"]
    with ctx.host.CONFIG_LOCK:
        document, etag = settings_doc(ctx.host, name)
        # Replacing a key also removes the superseded value from the vault.
        replaced = [pointer] if pointer in (document.get("_secretRefs") or {}) else []
        document.pop("_secretRefs", None)
        parent = document
        for part in parts[:-1]:
            if isinstance(parent, list) and part.isdigit() and int(part) < len(parent):
                parent = parent[int(part)]
            elif isinstance(parent, dict):
                parent = parent.setdefault(part, {})
            else:
                raise ApiError(400, "invalid_pointer", "The pointer does not address an object field")
            if not isinstance(parent, (dict, list)):
                raise ApiError(400, "invalid_pointer", "The pointer does not address an object field")
        if not isinstance(parent, dict):
            raise ApiError(400, "invalid_pointer", "The pointer does not address an object field")
        parent[parts[-1]] = value.strip()
        view = write(ctx.host, name, document, etag, clear=replaced)
    return {"stored": view["secrets"]}


@ROUTER.delete("/settings/{name}/secrets", summary="删除一个已保存的密钥（?pointer=/key）", tags=["settings"],
               params=NAME, query=[qp("pointer", description="JSON pointer, e.g. /key", required=True)],
               response=obj({"stored": array(STRING), "removed": BOOLEAN}))
def delete_secret(ctx):
    name = check_name(ctx.params["name"])
    pointer = ctx.q("pointer", "")
    parse_pointer(pointer)
    with ctx.host.CONFIG_LOCK:
        document, etag = settings_doc(ctx.host, name)
        present = pointer in (document.get("_secretRefs") or {})
        document.pop("_secretRefs", None)
        view = write(ctx.host, name, document, etag, clear=[pointer] if present else [])
    return {"stored": view["secrets"], "removed": present}
