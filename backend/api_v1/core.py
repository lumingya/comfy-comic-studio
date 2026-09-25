"""Declarative router, request context and response envelope for the public ``/api/v1`` API.

Every route is registered once (method, path template, documentation, handler). The
same table drives request dispatch *and* the generated OpenAPI document, so the
published contract cannot drift from the implementation.

Handlers receive a :class:`Context` and return one of:

* any JSON-serialisable value -> ``{"data": value, "requestId": ...}`` with the
  route's success status (200 unless declared otherwise);
* :class:`Reply` -> the same envelope with a custom status and/or headers;
* :class:`Raw` -> bytes or a file streamed as-is (images, ZIP, PDF, HTML ...);
* :data:`SENT` -> the handler wrote the HTTP response itself (legacy streamers).
"""

import copy
import hmac
import json
import math
import os
import re
import sys
import traceback
import urllib.parse
import uuid

PREFIX = "/api/v1"
MiB = 1024 * 1024
DEFAULT_BODY_LIMIT = 2 * MiB
SENT = object()
_MISSING = object()


class ApiError(Exception):
    """An error with a stable machine-readable code, rendered in the error envelope."""

    def __init__(self, status, code, message, details=None, headers=None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.details = details
        self.headers = headers or {}


class Reply:
    """Enveloped JSON with an explicit status code and/or extra headers."""

    def __init__(self, data=None, status=200, headers=None):
        self.data, self.status, self.headers = data, status, headers or {}


class Raw:
    """Un-enveloped bytes (``body``) or a file on disk (``path``)."""

    def __init__(self, body=None, *, path=None, mime="application/octet-stream", filename=None,
                 inline=False, status=200, headers=None):
        self.body, self.path, self.mime, self.filename = body, path, mime, filename
        self.inline, self.status, self.headers = inline, status, headers or {}


# --------------------------------------------------------------------------- routing

class Route:
    def __init__(self, method, path, handler, *, summary, tags, description="", body=None,
                 body_required=None, body_limit=DEFAULT_BODY_LIMIT, binary_body=None, query=(),
                 params=None, response=None, status=200, produces=None, deprecated=False,
                 operation_id=None, errors=()):
        self.method = method.upper()
        self.path = path
        self.handler = handler
        self.summary = summary
        self.tags = list(tags)
        self.description = description
        self.body = body
        self.body_required = (body is not None) if body_required is None else body_required
        self.body_limit = body_limit
        self.binary_body = binary_body  # list of accepted binary media types, or None
        self.query = list(query)
        self.params = params or {}
        self.response = response
        self.status = status
        self.produces = produces  # {'image/*': schema} for raw responses; None -> JSON envelope
        self.deprecated = deprecated
        self.errors = tuple(errors)
        self.operation_id = operation_id or _operation_id(self.method, path)
        segments = [s for s in path.strip("/").split("/") if s]
        self.param_names = re.findall(r"{(\w+)(?::path)?}", path)
        pattern = ""
        for segment in segments:
            pattern += "/" + re.sub(
                r"{(\w+)(:path)?}",
                lambda m: "(?P<%s>%s)" % (m.group(1), ".+" if m.group(2) else "[^/]+"),
                re.escape(segment).replace(r"\{", "{").replace(r"\}", "}"),
            )
        self.regex = re.compile("^" + (pattern or "/") + "$")
        literal = sum(1 for s in segments if "{" not in s)
        greedy = any(":path}" in s for s in segments)
        self.specificity = (not greedy, literal, len(segments))


def _operation_id(method, path):
    words = [method.lower()]
    for segment in path.strip("/").split("/"):
        segment = re.sub(r"{(\w+)(?::path)?}", r"by_\1", segment)
        words.extend(w for w in re.split(r"[^A-Za-z0-9]+", segment) if w)
    return words[0] + "".join(w[:1].upper() + w[1:] for w in words[1:])


class Router:
    def __init__(self):
        self.routes = []
        self.tags = []  # [(name, description)] in documentation order

    def tag(self, name, description):
        if all(existing != name for existing, _ in self.tags):
            self.tags.append((name, description))

    def add(self, method, path, **options):
        def register(handler):
            route = Route(method, path, handler, **options)
            if any(r.method == route.method and r.path == route.path for r in self.routes):
                raise RuntimeError("Duplicate API route: %s %s" % (route.method, route.path))
            if any(r.operation_id == route.operation_id for r in self.routes):
                raise RuntimeError("Duplicate operationId: " + route.operation_id)
            self.routes.append(route)
            return handler

        return register

    def get(self, path, **options):
        return self.add("GET", path, **options)

    def post(self, path, **options):
        return self.add("POST", path, **options)

    def put(self, path, **options):
        return self.add("PUT", path, **options)

    def patch(self, path, **options):
        return self.add("PATCH", path, **options)

    def delete(self, path, **options):
        return self.add("DELETE", path, **options)

    def match(self, method, path):
        candidates = []
        for route in self.routes:
            found = route.regex.match(path)
            if found:
                candidates.append((route, found))
        if not candidates:
            raise ApiError(404, "not_found", "Unknown API endpoint")
        candidates.sort(key=lambda item: item[0].specificity, reverse=True)
        for route, found in candidates:
            if route.method == method:
                params = {k: urllib.parse.unquote(v) for k, v in found.groupdict().items()}
                return route, params
        allowed = sorted({route.method for route, _ in candidates})
        raise ApiError(405, "method_not_allowed", "Supported methods: " + ", ".join(allowed),
                       headers={"Allow": ", ".join(allowed)})


ROUTER = Router()


# --------------------------------------------------------------------------- context

class Context:
    """Per-request state handed to every route handler."""

    def __init__(self, http, services, route, params, query, request_id):
        self.http = http
        self.services = services
        self.host = getattr(services, "application", services)
        self.route = route
        self.params = params
        self.query = query
        self.request_id = request_id
        self._body = _MISSING

    # ---- services
    @property
    def store(self):
        return self.host.native_store()

    def service(self, name, default=None):
        """A service from the HTTP layer first, then the application layer."""
        value = getattr(self.services, name, None)
        return value if value is not None else getattr(self.host, name, default)

    # ---- headers
    def header(self, name, default=""):
        return self.http.headers.get(name, default)

    def if_match(self):
        """Expected ETag from ``If-Match`` or ``?expectedEtag=``; ``None`` when absent."""
        value = self.header("If-Match", "").strip() or self.q("expectedEtag", "")
        if not value or value == "*":
            return None
        if value.startswith("W/"):
            value = value[2:]
        return value.strip().strip('"') or None

    # ---- query parameters
    def q(self, name, default=None):
        values = self.query.get(name)
        return values[-1] if values else default

    def q_list(self, name):
        out = []
        for value in self.query.get(name, []):
            out.extend(part for part in value.split(",") if part)
        return out

    def q_int(self, name, default, minimum=None, maximum=None):
        raw = self.q(name)
        if raw in (None, ""):
            return default
        try:
            value = int(raw)
        except (TypeError, ValueError):
            raise ApiError(400, "invalid_query", name + " must be an integer") from None
        if (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
            raise ApiError(400, "invalid_query", "%s must be between %s and %s" % (name, minimum, maximum))
        return value

    def q_float(self, name, default, minimum=None, maximum=None):
        raw = self.q(name)
        if raw in (None, ""):
            return default
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ApiError(400, "invalid_query", name + " must be a number") from None
        if not math.isfinite(value) or (minimum is not None and value < minimum) or (maximum is not None and value > maximum):
            raise ApiError(400, "invalid_query", "%s must be between %s and %s" % (name, minimum, maximum))
        return value

    def q_bool(self, name, default=False):
        raw = self.q(name)
        if raw is None:
            return default
        lowered = raw.strip().lower()
        if lowered in ("1", "true", "yes", "on"):
            return True
        if lowered in ("0", "false", "no", "off", ""):
            return False
        raise ApiError(400, "invalid_query", name + " must be true or false")

    def page(self, default_limit=50, max_limit=200):
        return (self.q_int("limit", default_limit, 1, max_limit), self.q_int("offset", 0, 0))

    # ---- body
    def _length(self):
        raw = self.header("Content-Length", "")
        if raw in ("", None):
            return 0
        try:
            length = int(raw)
        except ValueError:
            raise ApiError(400, "invalid_request", "Invalid Content-Length header") from None
        if length < 0:
            raise ApiError(400, "invalid_request", "Invalid Content-Length header")
        return length

    def media_type(self):
        return self.header("Content-Type", "").split(";", 1)[0].strip().lower()

    def raw_body(self, limit=None):
        limit = self.route.body_limit if limit is None else limit
        length = self._length()
        if length > limit:
            raise ApiError(413, "payload_too_large", "Request body exceeds %d MiB" % max(1, limit // MiB))
        raw = self.http.rfile.read(length) if length else b""
        if len(raw) != length:
            raise ApiError(400, "invalid_request", "Incomplete request body")
        return raw

    def json(self, required=None, limit=None):
        """The JSON object body (cached). Missing body -> ``{}`` unless required."""
        if self._body is not _MISSING:
            return self._body
        required = self.route.body_required if required is None else required
        if not self._length():
            if required:
                raise ApiError(400, "body_required", "A JSON object request body is required")
            self._body = {}
            return self._body
        if self.media_type() not in ("application/json", "application/merge-patch+json"):
            raise ApiError(415, "unsupported_media_type", "Content-Type must be application/json")
        raw = self.raw_body(limit)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ApiError(400, "invalid_json", "Request body is not valid UTF-8 JSON") from None
        if not isinstance(data, dict):
            raise ApiError(400, "invalid_body", "The JSON request body must be an object")
        self._body = data
        return data

    def is_binary(self):
        return bool(self.route.binary_body) and self._length() > 0 and self.media_type() not in (
            "application/json", "application/merge-patch+json", "")


# --------------------------------------------------------------------------- helpers

def merge_patch(target, patch):
    """RFC 7396 JSON Merge Patch."""
    if not isinstance(patch, dict):
        return copy.deepcopy(patch)
    result = copy.deepcopy(target) if isinstance(target, dict) else {}
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = merge_patch(result.get(key), value)
    return result


def paginate(items, limit, offset):
    items = list(items)
    return {"items": items[offset:offset + limit], "total": len(items), "limit": limit, "offset": offset}


def require(body, name, kind=str, message=None):
    """A required body field of the given type (non-blank for strings, non-bool for numbers)."""
    value = body.get(name)
    if kind is str:
        ok = isinstance(value, str) and bool(value.strip())
    elif kind in (int, float):
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    else:
        ok = isinstance(value, kind)
    if not ok:
        raise ApiError(400, "invalid_field", message or "%s is required" % name)
    return value


def quoted_etag(etag):
    return '"' + str(etag) + '"' if etag else None


def asset_endpoint(url):
    if isinstance(url, str) and url.startswith("/images/"):
        return PREFIX + "/assets?" + urllib.parse.urlencode({"path": url})
    return ""


def emit(host, name, payload):
    """Best-effort ecosystem event; never instantiates the ecosystem just to emit."""
    try:
        from backend.ecosystem import api as ecosystem_api

        svc = ecosystem_api.SERVICES.get((str(host.BASE_DIR), str(host.DATA_DIR)))
        if svc is not None:
            svc.events.emit(name, payload, source="api")
    except Exception:
        pass


# --------------------------------------------------------------------------- errors

_DEFAULT_CODES = {400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
                  405: "method_not_allowed", 409: "conflict", 410: "gone", 413: "payload_too_large",
                  415: "unsupported_media_type", 422: "unprocessable", 423: "locked",
                  429: "too_many_requests", 500: "internal_error", 502: "upstream_error",
                  503: "unavailable", 504: "upstream_timeout"}


def to_api_error(exc, host):
    """Map any exception raised by a handler or domain module to an :class:`ApiError`."""
    from backend.mio_library import LibraryError
    from backend.mio_job_store import Conflict
    from backend.mio_connection_check import ServiceUnreachable

    if isinstance(exc, ApiError):
        return exc
    too_large = getattr(host, "PayloadTooLargeError", None)
    if too_large and isinstance(exc, too_large):
        return ApiError(413, "payload_too_large", str(exc)[:300] or "Request exceeds the body size limit")
    provider_error = getattr(host, "ProviderHTTPError", None)
    if provider_error and isinstance(exc, provider_error):
        status = exc.status if isinstance(exc.status, int) and 400 <= exc.status < 600 else 502
        return ApiError(status, "upstream_error", str(exc)[:1000])
    if isinstance(exc, LibraryError):
        status = exc.status if isinstance(exc.status, int) and 400 <= exc.status < 600 else 400
        code = exc.code if exc.code and exc.code != "invalid_resource" else _DEFAULT_CODES.get(status, "invalid_request")
        if exc.code == "invalid_resource" and status == 400:
            code = "invalid_resource"
        return ApiError(status, code, str(exc)[:1000], getattr(exc, "details", None))
    if isinstance(exc, Conflict):
        return ApiError(409, "conflict", str(exc)[:500])
    if isinstance(exc, ServiceUnreachable):
        return ApiError(502, "upstream_unreachable", str(exc)[:400])
    try:
        from backend.mio_update import UpdateError
    except Exception:  # pragma: no cover - optional module
        UpdateError = ()
    if UpdateError and isinstance(exc, UpdateError):
        status = exc.status if isinstance(exc.status, int) and 400 <= exc.status < 600 else 400
        return ApiError(status, _DEFAULT_CODES.get(status, "update_error"), str(exc)[:500])
    if isinstance(exc, KeyError):
        return ApiError(404, "not_found", "Not found")
    if isinstance(exc, FileNotFoundError):
        return ApiError(404, "not_found", "File not found")
    if isinstance(exc, (ValueError, TypeError)):
        return ApiError(400, "invalid_request", str(exc)[:500] or "Invalid request")
    if isinstance(exc, TimeoutError):
        return ApiError(504, "upstream_timeout", "The operation timed out")
    return None


# --------------------------------------------------------------------------- transport

def authenticate(http):
    token = os.environ.get("MIO_API_TOKEN", "")
    if len(token) < 32:
        raise ApiError(503, "api_disabled", "Set MIO_API_TOKEN to at least 32 characters to enable the external API")
    supplied = http.headers.get("Authorization", "")
    if not hmac.compare_digest(supplied.encode("utf-8", "replace"), ("Bearer " + token).encode()):
        raise ApiError(401, "unauthorized", "A valid Mio Bearer token is required",
                       headers={"WWW-Authenticate": 'Bearer realm="mio"'})
    if not http.is_origin_allowed():
        raise ApiError(403, "origin_denied", "Origin is not allowed")


def _write(http, status, raw, mime, headers):
    http.send_response(status)
    http.send_header("Content-Type", mime)
    http.send_header("Content-Length", str(len(raw)))
    for key, value in headers.items():
        if value is not None:
            http.send_header(key, value)
    http.end_headers()
    http.wfile.write(raw)


def send_envelope(http, status, payload, headers):
    raw = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
    _write(http, status, raw, "application/json; charset=utf-8", headers)


def _disposition(filename, inline):
    ascii_name = re.sub(r'[^A-Za-z0-9._-]+', "_", filename).strip("_") or "download"
    return '%s; filename="%s"; filename*=UTF-8\'\'%s' % (
        "inline" if inline else "attachment", ascii_name, urllib.parse.quote(filename))


def send_raw(http, reply, request_id):
    headers = {"X-Request-Id": request_id, **reply.headers}
    if reply.filename:
        headers["Content-Disposition"] = _disposition(reply.filename, reply.inline)
    if reply.path is None:
        body = reply.body if isinstance(reply.body, (bytes, bytearray)) else str(reply.body or "").encode("utf-8")
        _write(http, reply.status, bytes(body), reply.mime, headers)
        return
    size = os.path.getsize(reply.path)
    with open(reply.path, "rb") as source:
        http.send_response(reply.status)
        http.send_header("Content-Type", reply.mime)
        http.send_header("Content-Length", str(size))
        for key, value in headers.items():
            http.send_header(key, value)
        http.end_headers()
        while True:
            chunk = source.read(MiB)
            if not chunk:
                break
            http.wfile.write(chunk)


def handle(http, services):
    """Serve ``/api/v1/*``. Returns False for every other path."""
    parsed = urllib.parse.urlsplit(http.path)
    if not (parsed.path == PREFIX or parsed.path.startswith(PREFIX + "/")):
        return False
    import backend.api_v1  # noqa: F401  (registers every route module)

    request_id = "req_" + uuid.uuid4().hex
    http.response_status = None
    host = getattr(services, "application", services)
    try:
        authenticate(http)
        route, params = ROUTER.match(http.command, parsed.path[len(PREFIX):] or "/")
        ctx = Context(http, services, route, params,
                      urllib.parse.parse_qs(parsed.query, keep_blank_values=True), request_id)
        result = route.handler(ctx)
        if result is SENT:
            return True
        if isinstance(result, Raw):
            send_raw(http, result, request_id)
            return True
        if isinstance(result, Reply):
            send_envelope(http, result.status, {"data": result.data, "requestId": request_id},
                          {"X-Request-Id": request_id, **result.headers})
            return True
        send_envelope(http, route.status, {"data": result, "requestId": request_id}, {"X-Request-Id": request_id})
    except Exception as exc:  # every failure becomes an error envelope
        error = to_api_error(exc, host)
        if error is None:
            sys.stderr.write("[mio-api] %s %s %s failed: %s\n%s" % (
                request_id, http.command, parsed.path, type(exc).__name__, traceback.format_exc(limit=12)))
            error = ApiError(500, "internal_error", "The request could not be completed")
        if http.response_status is not None:
            # Headers already sent by a streaming handler: the connection is closed instead.
            http.close_connection = True
            return True
        payload = {"error": {"code": error.code, "message": error.message}, "requestId": request_id}
        if error.details is not None:
            payload["error"]["details"] = error.details
        try:
            send_envelope(http, error.status, payload, {"X-Request-Id": request_id, **error.headers})
        except (BrokenPipeError, ConnectionResetError):
            pass
    return True
