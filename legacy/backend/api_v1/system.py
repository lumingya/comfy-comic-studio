"""Discovery: health, capabilities, the OpenAPI document and the route index."""

import json

from backend.api_v1.core import PREFIX, ROUTER, Raw
from backend.api_v1.spec import VERSION, STRING, BOOLEAN, INTEGER, array, obj, openapi, schema



def app_version(host):
    try:
        from backend.mio_update import current_version

        return current_version(host.BASE_DIR) or ""
    except Exception:
        return ""


def capabilities(host=None):
    import backend.api_v1  # noqa: F401
    from backend.providers.registry import PROVIDERS

    tags = {}
    for route in ROUTER.routes:
        for tag in route.tags:
            tags[tag] = tags.get(tag, 0) + 1
    return {
        "name": "Mio",
        "apiVersion": VERSION,
        "appVersion": app_version(host) if host is not None else "",
        "prefix": PREFIX,
        "operations": len(ROUTER.routes),
        "areas": [{"name": name, "operations": tags.get(name, 0)} for name, _ in ROUTER.tags],
        "providers": [spec["id"] for spec in PROVIDERS.manifest()],
        "generationProviders": ["comfyui", "novelai", "openai"],
        "synchronousGenerationProviders": ["novelai", "openai"],
        "browserQueueIntegration": True,
        "productionQueue": True,
        "durableJobs": True,
        "optimisticConcurrency": "ETag / If-Match",
        "patchFormat": "application/merge-patch+json (RFC 7396)",
        "albumExportFormats": ["html", "zip", "pdf"],
        "credentialPolicy": "write-only; secrets are never returned",
        "webhooks": False,
        "events": "GET /jobs/events (SSE replay), GET /ecosystem/activity (polling)",
    }


@ROUTER.get("/health", summary="服务健康与版本", tags=["system"],
            response=obj({"status": STRING, "name": STRING, "version": STRING, "appVersion": STRING}))
def health(ctx):
    return {"status": "ok", "name": "Mio", "version": VERSION, "appVersion": app_version(ctx.host)}


@ROUTER.get("/capabilities", summary="能力发现：功能区、操作数、支持的图像服务", tags=["system"],
            response=schema("Capabilities", obj({
                "name": STRING, "apiVersion": STRING, "appVersion": STRING, "operations": INTEGER,
                "areas": array(obj({"name": STRING, "operations": INTEGER})),
                "providers": array(STRING), "generationProviders": array(STRING),
                "browserQueueIntegration": BOOLEAN, "webhooks": BOOLEAN})))
def get_capabilities(ctx):
    return capabilities(ctx.host)


@ROUTER.get("/openapi.json", summary="本 API 的 OpenAPI 3.1 文档（不套信封）", tags=["system"],
            produces={"application/json": {"schema": {"type": "object"}}})
def get_openapi(ctx):
    return Raw(json.dumps(openapi(), ensure_ascii=False).encode("utf-8"), mime="application/json; charset=utf-8")


@ROUTER.get("/routes", summary="全部路由的精简索引（方法、路径、说明、标签）", tags=["system"],
            response=array(obj({"method": STRING, "path": STRING, "summary": STRING,
                                "tags": array(STRING), "operationId": STRING, "deprecated": BOOLEAN})))
def get_routes(ctx):
    return [{"method": r.method, "path": PREFIX + r.path.replace(":path}", "}"), "summary": r.summary,
             "tags": r.tags, "operationId": r.operation_id, "deprecated": r.deprecated} for r in ROUTER.routes]
