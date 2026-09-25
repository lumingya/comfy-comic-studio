"""OpenAPI 3.1 document generated from the route table plus shared component schemas."""

import copy

from backend.api_v1.core import PREFIX, ROUTER

VERSION = "2.0.0"
SCHEMAS = {}


def ref(name):
    return {"$ref": "#/components/schemas/" + name}


def schema(name, definition):
    """Register a reusable component schema and return a ``$ref`` to it."""
    SCHEMAS[name] = definition
    return ref(name)


def qp(name, kind="string", description="", required=False, **extra):
    """A query parameter description for ``Route.query``."""
    spec = {"type": kind, **extra} if isinstance(kind, str) else kind
    item = {"name": name, "in": "query", "required": required, "schema": spec}
    if description:
        item["description"] = description
    return item


def obj(properties=None, required=(), extra=True, **more):
    value = {"type": "object"}
    if properties:
        value["properties"] = properties
    if required:
        value["required"] = list(required)
    if extra is False:
        value["additionalProperties"] = False
    value.update(more)
    return value


def array(items, **more):
    return {"type": "array", "items": items, **more}


def page_of(item):
    return obj({"items": array(item), "total": {"type": "integer"}, "limit": {"type": "integer"},
                "offset": {"type": "integer"}}, ["items", "total"])


STRING = {"type": "string"}
INTEGER = {"type": "integer"}
NUMBER = {"type": "number"}
BOOLEAN = {"type": "boolean"}
ANY_OBJECT = {"type": "object"}

# ---------------------------------------------------------------- shared components

schema("ErrorEnvelope", obj({
    "error": obj({"code": STRING, "message": STRING, "details": {}}, ["code", "message"]),
    "requestId": STRING}, ["error", "requestId"]))

schema("Artifact", obj({"kind": {"const": "image"}, "url": STRING, "mime": STRING,
                        "bytes": {"type": "integer", "minimum": 0}}, ["kind", "url"]))

schema("ProviderConfig", obj({
    **{key: STRING for key in ("baseUrl", "model", "size", "quality", "sampler", "id", "title", "keyId")},
    "provider": {"enum": ["novelai", "openai"]},
    "protocol": {"enum": ["images", "chat"]},
    "keyMode": {"enum": ["none", "stored", "environment"]},
    "keyIds": array({"type": "string", "minLength": 1, "maxLength": 150}, maxItems=32),
    "sendSize": BOOLEAN, "sendQuality": BOOLEAN,
    "sendAspectHint": {"type": "boolean", "description": "Chat protocol only: append the frame aspect ratio to the prompt (default true)"},
    "extraParams": {"type": "object", "maxProperties": 100,
                    "description": "Additional protocol parameters; bound fields and credentials cannot be overridden."},
}, ["provider", "baseUrl", "model"], extra=False))

schema("GenerationRequest", {
    "type": "object", "additionalProperties": False, "required": ["prompt"],
    "description": "Supply exactly one of channelId (a saved channel) or config (an ad-hoc cloud configuration).",
    "properties": {
        "channelId": {"type": "string", "description": "Saved image channel (see /channels)."},
        "providerId": {"type": "string", "deprecated": True, "description": "Alias of channelId."},
        "config": ref("ProviderConfig"),
        "apiKey": {"type": "string", "writeOnly": True, "description": "One-off key; never stored or echoed."},
        "prompt": {"type": "string", "minLength": 1, "maxLength": 100000},
        "negative": STRING,
        "images": array(STRING, maxItems=32, description="Ordered local /images/ references or PNG/JPEG/WebP base64 data URLs"),
        "source": {"type": "string", "description": "PNG, JPEG or WebP base64 data URL"},
        "frame": obj({key: NUMBER for key in ("width", "height", "steps", "cfg", "seed", "denoise")}, extra=False),
    }})

schema("GenerationResult", obj({
    "image": STRING, "provider": {"enum": ["novelai", "openai"]}, "offlineFallback": {"const": False},
    "assetEndpoint": STRING, "artifacts": array(ref("Artifact")), "contractVersion": {"const": 1},
    "appliedExtraParams": array(STRING)}, ["image", "assetEndpoint"]))

schema("FailurePolicy", obj({
    "mode": {"enum": ["pause", "retry", "continue"], "default": "retry",
             "description": "Failure behavior within one task; never pauses other manually started tasks."},
    "maxRetries": {"type": "integer", "minimum": 1, "maximum": 100, "default": 5},
    "delaySeconds": {"type": "integer", "minimum": 5, "maximum": 300, "default": 15},
    "onExhausted": {"enum": ["pause", "continue"], "default": "continue"},
    "maxConsecutiveFailures": {"type": "integer", "minimum": 0, "maximum": 100, "default": 5,
                               "description": "Per-task consecutive failed attempts before dispatch stops; 0 disables."},
}, extra=False))

schema("Runtime", obj({
    "concurrency": {"type": "integer", "minimum": 1, "maximum": 16, "default": 1,
                    "description": "Independent in-flight frame limit PER TASK."},
    "requestTimeoutSeconds": {"type": "integer", "minimum": 30, "maximum": 7200, "default": 600}}, extra=False))

schema("Recovery", obj({
    "expectedCursor": {"type": "integer", "minimum": 0}, "expectedUpdated": NUMBER,
    "acknowledgeUnconfirmed": {"type": "boolean", "description": "Must be true for unknown results; caller accepts possible duplicate billing."},
}, ["expectedCursor", "expectedUpdated"]))

schema("JobFrame", obj({
    "channelId": {"type": "string", "minLength": 1, "maxLength": 150,
                  "description": "Saved channel reference; the latest saved configuration is resolved before each request."},
    "config": {"type": "object", "description": "Cloud ProviderConfig or {provider:comfyui,baseUrl,outputNodeId}. Stored/environment credentials only."},
    "prompt": STRING, "negative": STRING,
    "images": array({"type": "string", "pattern": "^/images/"}, maxItems=32),
    "frameIndex": {"type": "integer", "minimum": 0, "maximum": 9999},
    "source": {"type": ["string", "null"]}, "albumId": STRING, "frame": ANY_OBJECT,
    "workflow": {"type": "object", "description": "ComfyUI API graph; mio-image://N strings are replaced with uploaded image filenames."},
}, ["config"], extra=False))

schema("JobInput", obj({
    "frames": array(ref("JobFrame"), minItems=1, maxItems=1000), "hold": BOOLEAN, "label": STRING,
    "albumId": STRING, "owner": {"type": "string", "description": "Opaque integration correlation ID."}},
    ["frames"], extra=False))

schema("SubmitJob", obj({"idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 160},
                         "input": ref("JobInput")}, ["idempotencyKey", "input"]))

schema("Job", obj({
    "id": STRING,
    "state": {"enum": ["pending", "paused", "running", "complete", "failed", "unknown", "canceled", "archived"]},
    "cursor": {"type": "integer", "description": "Confirmed result count, NOT a contiguous prefix or next frame index."},
    "total": INTEGER, "results": array(ANY_OBJECT), "error": {"type": ["object", "null"]},
    "upstream": {"type": ["string", "null"]}, "provider": STRING, "updated": NUMBER,
    "frameStates": array(ANY_OBJECT), "allowedActions": array(STRING), "requiresRecoveryConsent": BOOLEAN,
    "currentChannels": array(ANY_OBJECT), "channelRefs": array(ANY_OBJECT), "requestHistory": array(ANY_OBJECT),
    "retry_count": INTEGER, "attempts": INTEGER, "errors": array(ANY_OBJECT),
    "consecutive_failures": INTEGER, "failure_limit_reached": INTEGER,
}, ["id", "state", "cursor", "total", "results"]))


def _parameters(route):
    params = []
    for name in route.param_names:
        info = route.params.get(name, {})
        entry = {"name": name, "in": "path", "required": True,
                 "schema": copy.deepcopy(info.get("schema", STRING))}
        if info.get("description"):
            entry["description"] = info["description"]
        params.append(entry)
    params.extend(copy.deepcopy(route.query))
    return params


def _responses(route):
    responses = {}
    status = str(route.status)
    if route.produces:
        responses[status] = {"description": "Success", "content": copy.deepcopy(route.produces)}
    else:
        responses[status] = {"description": "Success", "content": {"application/json": {"schema": obj(
            {"data": copy.deepcopy(route.response) if route.response is not None else {}, "requestId": STRING},
            ["data", "requestId"])}}}
    codes = {400, 401, 403, 404, 500, 503} | set(route.errors)
    if route.method in ("POST", "PUT", "PATCH", "DELETE"):
        codes |= {409, 413}
    for code in sorted(codes):
        responses[str(code)] = {"$ref": "#/components/responses/Error"}
    return responses


def openapi():
    import backend.api_v1  # noqa: F401  (make sure every route module is registered)

    paths = {}
    for route in ROUTER.routes:
        operation = {"operationId": route.operation_id, "summary": route.summary, "tags": route.tags}
        if route.description:
            operation["description"] = route.description
        parameters = _parameters(route)
        if parameters:
            operation["parameters"] = parameters
        if route.body is not None or route.binary_body:
            content = {}
            if route.body is not None:
                content["application/json"] = {"schema": copy.deepcopy(route.body)}
            for media in route.binary_body or ():
                content[media] = {"schema": {"type": "string", "format": "binary"}}
            operation["requestBody"] = {"required": bool(route.body_required), "content": content}
        operation["responses"] = _responses(route)
        if route.deprecated:
            operation["deprecated"] = True
        key = PREFIX + route.path.replace(":path}", "}")
        paths.setdefault(key, {})[route.method.lower()] = operation
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Mio API",
            "version": VERSION,
            "description": (
                "Public automation API of Mio. Every route requires `Authorization: Bearer $MIO_API_TOKEN` "
                "(at least 32 characters). JSON responses use the envelope {data, requestId}; errors use "
                "{error: {code, message, details?}, requestId}. Writes accept `If-Match: \"<etag>\"` for "
                "optimistic concurrency. Credentials are write-only and never returned."),
        },
        "security": [{"bearerAuth": []}],
        "tags": [{"name": name, "description": description} for name, description in ROUTER.tags],
        "paths": paths,
        "components": {
            "securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}},
            "responses": {"Error": {"description": "Error envelope",
                                    "content": {"application/json": {"schema": ref("ErrorEnvelope")}}}},
            "schemas": copy.deepcopy(dict(sorted(SCHEMAS.items()))),
        },
    }


def route_table():
    """Markdown reference of every route, grouped by tag (docs/api/ROUTES.md)."""
    import backend.api_v1  # noqa: F401

    lines = ["# Mio API v%s · 路由总表" % VERSION, "",
             "> 由 `python tools/build_api_docs.py` 从路由表生成，请勿手工编辑。"
             "完整请求/响应结构见 [openapi.json](openapi.json)，使用说明见 [README](README.md)。", ""]
    for name, description in ROUTER.tags:
        routes = [r for r in ROUTER.routes if name in r.tags]
        if not routes:
            continue
        lines += ["## " + name, "", description, "", "| 方法 | 路径 | 说明 |", "|---|---|---|"]
        for route in routes:
            summary = route.summary.replace("|", "\\|") + (" *(deprecated)*" if route.deprecated else "")
            lines.append("| `%s` | `%s%s` | %s |" % (route.method, PREFIX, route.path.replace(":path}", "}"), summary))
        lines.append("")
    lines.append("共 %d 个操作。" % len(ROUTER.routes))
    return "\n".join(lines) + "\n"
