"""Discover OpenAPI operations and invoke the actual validated HTTP boundary exactly once."""

import asyncio
import base64
import binascii
import json
import re
from urllib.parse import quote

import httpx
from mio_server.extensions.public import required_scope
from starlette.routing import compile_path

SECRET_KEY = re.compile(
    r"api[_-]?key|password|secret|authorization|cookie|access[_-]?token", re.IGNORECASE
)
# Only operations that change credentials or reviewed executable content stay human-owned.
# System catalogs and ordinary administration still follow the user's operation grants.
HUMAN_OPERATIONS = (
    ("*", r"/tokens(?:/.*)?"),
    ("*", r"/extensions/[^/]+/settings"),
    ("PATCH", r"/settings"),
    ("POST", r"/settings/models"),
    ("POST", r"/extensions(?:/folder|/[^/]+/enable)?"),
    ("PUT", r"/extension-market/source"),
    ("POST", r"/extension-market/[^/]+/install"),
    ("POST", r"/update/(?:download|install)"),
    ("POST", r"/backups/restore-plans(?:/[^/]+/apply)?"),
    ("POST", r"/webhooks"),
    ("PATCH", r"/webhooks/[^/]+"),
)


def sanitize(value, secrets=()):
    if isinstance(value, dict):
        return {
            k: "[redacted]" if SECRET_KEY.search(k) else sanitize(v, secrets)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [sanitize(v, secrets) for v in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
        return value
    return value


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "mio_list_operations",
            "description": "查找项目操作。先搜索再读取具体参数。",
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {"type": "string"},
                    "offset": {"type": "integer", "minimum": 0},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mio_describe_operation",
            "description": "读取一个操作的完整 OpenAPI 参数、请求体与权限。",
            "parameters": {
                "type": "object",
                "properties": {"operation": {"type": "string"}},
                "required": ["operation"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mio_call_operation",
            "description": "执行项目操作。仅使用目录中的 operation ID；遵守权限，写入可能等待用户确认。",
            "parameters": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string"},
                    "path_parameters": {"type": "object"},
                    "query": {"type": "object"},
                    "body": {},
                    "attachment_id": {
                        "type": "string",
                        "description": "上传二进制文件时，使用用户已上传的图片 ID",
                    },
                    "body_text": {
                        "type": "string",
                        "description": "原始文件请求体，例如工作流 JSON 文本",
                    },
                    "body_base64": {
                        "type": "string",
                        "description": "原始二进制请求体，Base64 编码；优先使用 attachment_id",
                    },
                },
                "required": ["operation"],
                "additionalProperties": False,
            },
        },
    },
]


class OperationBridge:
    def __init__(self, service):
        self.service = service

    @property
    def app(self):
        return self.service.mio.host_app

    def catalog(self):
        if self.app is None:
            return {}
        schema = self.app.openapi()
        result = {}
        for path, methods in schema.get("paths", {}).items():
            if not path.startswith("/api/") or path.startswith("/api/v2/"):
                continue
            local = path[4:]
            for method, spec in methods.items():
                if method.upper() not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                    continue
                key = spec.get("x-mio-operation") or f"{method.upper()} {local}"
                result[key] = {
                    "id": key,
                    "method": method.upper(),
                    "path": local,
                    "summary": spec.get("summary", ""),
                    "scope": spec.get("x-mio-scope") or required_scope(method.upper(), local),
                    "spec": spec,
                }
        return result

    def allowed(self, operation, scopes=None):
        settings = self.service.store.settings()
        policy = settings.permissions
        key, path = operation["id"], operation["path"]
        if self.restriction(operation):
            return False
        # Extension code owns arbitrary capabilities; grant its exact operation explicitly.
        if path.startswith("/ext/") and key not in policy.allow_operations:
            return False
        return (
            (operation["scope"] in policy.scopes or key in policy.allow_operations)
            and (scopes is None or operation["scope"] in scopes)
            and key not in policy.deny_operations
        )

    def restriction(self, operation):
        path = operation["path"]
        method = operation.get("method") or operation["id"].split(" ", 1)[0]
        own = f"/ext/{self.service.mio.id}"
        if (
            any(
                (verb == "*" or verb == method) and re.fullmatch(pattern, path)
                for verb, pattern in HUMAN_OPERATIONS
            )
            or path in {f"{own}/settings", f"{own}/models"}
            or path.startswith(own + "/conversations/")
            and path.endswith("/approval")
            or path == f"/extensions/{self.service.mio.id}/disable"
            or method == "DELETE"
            and path == f"/extensions/{self.service.mio.id}"
        ):
            return "此操作涉及凭据、权限或运行代码，需由用户直接执行"
        return ""

    def listing(self, search="", scopes=None):
        query = search.casefold()
        return [
            {
                **{k: v for k, v in item.items() if k != "spec"},
                "allowed": self.allowed(item, scopes),
                "reason": self.restriction(item),
                "configurable": not bool(self.restriction(item)),
            }
            for item in self.catalog().values()
            if not query or query in (item["id"] + " " + item["summary"]).casefold()
        ]

    def operation(self, key):
        result = self.catalog().get(key)
        if result is None:
            raise ValueError("操作不存在；请先搜索操作目录")
        return result

    def describe(self, key):
        item = self.operation(key)
        # Include transitive component references, without flattening recursive models.
        available = self.app.openapi().get("components", {}).get("schemas", {})
        components = {}
        pending = [item["spec"]]
        while pending:
            current = pending.pop()
            if isinstance(current, dict):
                ref = current.get("$ref", "").removeprefix("#/components/schemas/")
                if ref in available and ref not in components:
                    components[ref] = available[ref]
                    pending.append(available[ref])
                pending.extend(v for k, v in current.items() if k != "$ref")
            elif isinstance(current, list):
                pending.extend(current)
        return {**item, "schemas": components, "allowed": self.allowed(item)}

    async def execute(self, args, scopes):
        self.service.require_enabled()
        item = self.operation(args.get("operation", ""))
        if not self.allowed(item, scopes):
            raise ValueError("此操作未获授权；请用户在权限设置中调整")
        path = item["path"]
        values = args.get("path_parameters") or {}
        for name in re.findall(r"\{([^{}]+)\}", path):
            value = str(values.get(name, ""))
            if not value or value in {".", ".."} or any(c in value for c in "/\\%?#\x00"):
                raise ValueError(f"路径参数不合法：{name}")
            path = path.replace("{" + name + "}", quote(value, safe=""))
        if self.restriction({**item, "path": path}):
            raise ValueError("此操作需由用户直接执行")
        for other in self.catalog().values():
            if other["id"] != item["id"] and other["method"] == item["method"]:
                pattern, _, _ = compile_path(other["path"])
                if pattern.fullmatch(path):
                    raise ValueError("路径与另一个操作重叠，请使用实际操作 ID")
        query = args.get("query") or {}
        if not isinstance(query, dict) or any(
            isinstance(v, dict)
            or (isinstance(v, list) and any(isinstance(x, (dict, list)) for x in v))
            for v in query.values()
        ):
            raise ValueError("query 需要简单键值对象")
        binary_fields = [
            key for key in ("attachment_id", "body_text", "body_base64") if key in args
        ]
        if len(binary_fields) > 1 or (binary_fields and "body" in args):
            raise ValueError("请求体只能选择一种来源")
        body_args = {"json": args.get("body")} if "body" in args else {}
        headers = {"origin": "http://127.0.0.1"}
        if binary_fields:
            content = item["spec"].get("requestBody", {}).get("content", {})
            if "application/octet-stream" not in content:
                raise ValueError("此操作不接收原始文件，请使用声明的 JSON 请求体")
            field = binary_fields[0]
            if field == "attachment_id":
                _, attachment = self.service.attachment(args[field])
                raw = attachment.read_bytes()
            elif field == "body_text":
                raw = str(args[field]).encode("utf-8")
            else:
                try:
                    raw = base64.b64decode(args[field], validate=True)
                except (ValueError, TypeError, binascii.Error):
                    raise ValueError("body_base64 不是合法的 Base64") from None
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError("助手单次文件操作不能超过 8 MB")
            body_args = {"content": raw}
            headers["content-type"] = "application/octet-stream"

        async def bounded_app(scope, receive, send):
            total = 0
            binary = False

            async def bounded_send(message):
                nonlocal total, binary
                if message["type"] == "http.response.start":
                    response_headers = dict(message.get("headers", []))
                    binary = b"json" not in response_headers.get(b"content-type", b"")
                elif message["type"] == "http.response.body":
                    total += len(message.get("body", b""))
                    if binary:
                        message = {**message, "body": b""}
                    elif total > 256 * 1024:
                        raise ValueError("结果超过 256 KB，请缩小查询范围")
                await send(message)

            await self.app(scope, receive, bounded_send)

        transport = httpx.ASGITransport(app=bounded_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            async with (
                asyncio.timeout(180),
                client.stream(
                    item["method"],
                    "/api" + path,
                    params=query,
                    **body_args,
                    headers=headers,
                    timeout=180,
                ) as response,
            ):
                content_type = response.headers.get("content-type", "")
                if "json" not in content_type:
                    return {
                        "status": response.status_code,
                        "content_type": content_type,
                        "download_path": "/api" + path,
                        "bytes": response.headers.get("content-length"),
                    }
                chunks, size = [], 0
                async for part in response.aiter_bytes():
                    size += len(part)
                    if size > 256 * 1024:
                        return {
                            "status": response.status_code,
                            "truncated": True,
                            "message": "结果较大，请缩小查询范围",
                        }
                    chunks.append(part)
                body = b"".join(chunks)
                result = json.loads(body) if body else None
                return {
                    "status": response.status_code,
                    "result": self.service.sanitize(result),
                }
