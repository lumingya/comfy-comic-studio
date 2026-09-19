"""HTTP routing and static/media responses. Services are constructor-injected."""

import os, time, sys, re, json, uuid, base64, binascii, hashlib, copy, mimetypes, threading, io
import secrets
import hmac
from pathlib import Path
from datetime import datetime
import urllib.request, urllib.parse
from http.server import SimpleHTTPRequestHandler
from backend import (
    mio_pictures,
    mio_lifecycle,
    mio_foundation,
    mio_api,
    mio_credentials,
    mio_docs,
)
from backend.ecosystem import api as ecosystem_api
from backend.production import api as production_api


class HTTPRoutes(SimpleHTTPRequestHandler):
    # Process-scoped browser capability; never persisted in config or exposed by APIs.
    csrf_token = secrets.token_urlsafe(32)

    def parse_request(self):
        if not super().parse_request():
            return False
        # Origin/CSRF alone do not stop DNS rebinding: an attacker-selected
        # Host can otherwise read the shell capability as its own origin.
        values = self.headers.get_all("Host", [])
        allowed = {"localhost", "127.0.0.1", "::1"}
        bound = str(self.server.server_address[0]).lower().rstrip(".")
        if bound not in ("0.0.0.0", "::", ""):
            allowed.add(bound)
        for origin in self.services.ALLOWED_ORIGINS:
            try:
                parsed = urllib.parse.urlsplit(origin)
                if parsed.scheme in ("http", "https") and parsed.hostname:
                    allowed.add(parsed.hostname.lower().rstrip("."))
            except ValueError:
                pass
        valid = False
        if len(values) == 1:
            value = values[0]
            try:
                parsed = urllib.parse.urlsplit("//" + value)
                valid = (value == value.strip() and not any(c in value for c in "/\\?#")
                         and not parsed.username and not parsed.password
                         and (parsed.port is None or 0 < parsed.port <= 65535)
                         and (parsed.hostname or "").lower().rstrip(".") in allowed)
            except ValueError:
                pass
        if not valid:
            self.close_connection = True
            self.send_json(403, {"error": "MIO-HOST-001: 不可信的 Host；请使用回环地址，或通过 MIO_ORIGINS 明确配置可信入口"})
            return False
        return True

    def authorize_private(self):
        if not self.is_origin_allowed():
            self.send_json(403, {"error": "MIO-ORIGIN-001: Origin is not allowed"})
            return False
        path = urllib.parse.urlparse(self.path).path
        browser = self.headers.get("Origin") is not None or self.headers.get("Sec-Fetch-Site") is not None
        supplied = self.headers.get("X-Mio-CSRF", "")
        # Native streamed downloads use a form, which cannot set custom headers.
        # Validate its hidden capability before any export work, then rewind for the parser.
        if browser and path == "/api/export/portable" and self.command == "POST" and self.headers.get("Content-Type", "").split(";")[0] == "application/x-www-form-urlencoded":
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 16384:
                    raise ValueError("invalid form size")
                raw = self.rfile.read(size)
                fields = urllib.parse.parse_qs(raw.decode("utf-8"), max_num_fields=4)
                supplied = fields.get("_csrf", [""])[0]
                self.rfile = io.BytesIO(raw)
            except (ValueError, UnicodeError):
                supplied = ""
        if path.startswith("/api/") and browser and not (supplied.isascii() and hmac.compare_digest(supplied, self.csrf_token)):
            self.send_json(403, {"error": "MIO-CSRF-001: 请从本服务首页重新打开工作室"})
            return False
        return True

    def send_response(self, code, message=None):
        self.response_status = code
        return super().send_response(code, message)

    def __init__(self, *args, **kwargs):
        self.services = self.make_services()
        super().__init__(*args, **kwargs)

    server_version = "Mio/1.0"

    def external_api(self):
        return mio_api.handle(self, self.services.application)

    def guess_type(self, path):
        if Path(urllib.parse.urlparse(path).path).name == "LICENSE":
            return "text/plain; charset=utf-8"
        mime = super().guess_type(path)
        suffix = Path(urllib.parse.urlparse(path).path).suffix.lower()
        text_types = {
            ".md": "text/plain",
            ".html": "text/html",
            ".txt": "text/plain",
            ".css": "text/css",
            ".js": "text/javascript",
            ".json": "application/json",
            ".py": "text/plain",
        }
        if suffix in text_types:
            return text_types[suffix] + "; charset=utf-8"
        return mime

    def send_head(self):
        parsed = urllib.parse.urlparse(self.path)
        decoded = urllib.parse.unquote(parsed.path)
        if decoded in ("/", "/index.html"):
            body = (Path(self.services.BASE_DIR) / "index.html").read_text(encoding="utf-8")
            body = body.replace("<head>", '<head><meta name="mio-csrf" content="' + self.csrf_token + '">', 1).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        thumb = urllib.parse.parse_qs(parsed.query).get("thumb", [None])[0]
        if decoded.startswith("/images/") and thumb:
            try:
                from backend.mio_media import MediaStore

                path = MediaStore(self.services.DATA_DIR).thumbnail(
                    self.services.native_store().image_path(decoded), thumb
                )
                handle = path.open("rb")
                try:
                    size = os.fstat(handle.fileno()).st_size
                    self.send_response(200)
                    self.send_header(
                        "Content-Type",
                        "image/svg+xml" if path.suffix == ".svg" else "image/webp",
                    )
                    self.send_header("Content-Length", str(size))
                    self.end_headers()
                    return handle
                except Exception:
                    handle.close()
                    raise
            except (self.services.LibraryError, OSError) as exc:
                self.send_error(getattr(exc, "status", 404), str(exc))
                return None
        document_path = decoded
        if decoded.endswith(".html") and (decoded.startswith("/docs/") or decoded == "/README.html"):
            candidate = Path(self.services.BASE_DIR) / decoded.lstrip("/")
            if candidate.with_suffix(".md").is_file():
                document_path = str(Path(decoded).with_suffix(".md"))
        if (
            document_path.endswith(".md")
            and self.services.is_public_static_path(parsed.path)
            and urllib.parse.parse_qs(parsed.query).get("raw") != ["1"]
        ):
            try:
                relative = Path(document_path.lstrip("/"))
                body = mio_docs.render_document(
                    self.services.BASE_DIR, relative
                ).encode("utf-8")
            except FileNotFoundError:
                self.send_error(404, "Document not found")
                return None
            except UnicodeError:
                self.send_error(422, "Document must be UTF-8")
                return None
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            return io.BytesIO(body)
        return super().send_head()

    def translate_path(self, path):
        request_path = urllib.parse.unquote(urllib.parse.urlparse(path).path)
        if request_path.startswith("/images/"):
            try:
                return str(self.services.native_store().image_path(request_path))
            except (self.services.LibraryError, OSError, ValueError):
                return os.path.join(self.services.DATA_DIR, "__not_found__")
        return super().translate_path(path)

    def is_origin_allowed(self):
        origin = self.headers.get("Origin")
        return origin != "null" and (not origin or origin in self.services.ALLOWED_ORIGINS)

    def send_json(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def read_json_body(self, max_bytes=None):
        if max_bytes is None:
            max_bytes = self.services.MAX_JSON_BODY_BYTES
        content_type = (
            self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        )
        if content_type != "application/json":
            raise ValueError("Content-Type must be application/json")
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ValueError("Missing Content-Length header")
        content_length = int(raw_length)
        if content_length < 0:
            raise ValueError("Invalid Content-Length header")
        if content_length > max_bytes:
            limit_mb = max_bytes // (1024 * 1024)
            raise self.services.PayloadTooLargeError(
                f"JSON request exceeds the {limit_mb} MB size limit"
            )
        raw = self.rfile.read(content_length)
        if len(raw) != content_length:
            raise ValueError("Incomplete request body")
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("JSON request body must be an object")
        return data

    def end_headers(self):
        # Opaque/file origins are never a trusted private API boundary.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        origin = self.headers.get("Origin")
        if origin and origin != "null" and origin in self.services.ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers", "Content-Type, Authorization, X-Mio-CSRF, If-None-Match"
            )

        request_path = urllib.parse.urlparse(self.path).path
        if (
            request_path.startswith("/images/")
            and re.fullmatch(
                r"[a-f0-9]{64}\.(?:png|jpg|jpeg|webp|svg)",
                request_path.rsplit("/", 1)[-1],
            )
        ) and getattr(self, "response_status", 200) in (200, 304):
            self.send_header("Cache-Control", "private, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def do_PUT(self):
        if not self.external_api():
            self.send_error(405)

    do_DELETE = do_PUT
    do_PATCH = do_PUT

    def do_OPTIONS(self):
        if not self.is_origin_allowed():
            self.send_json(403, {"error": "Origin is not allowed"})
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.external_api():
            return
        if not self.authorize_private():
            return
        request_path = urllib.parse.urlparse(self.path).path
        if production_api.dispatch(self, self.services.application, request_path):
            return
        if ecosystem_api.dispatch(self, self.services.application, request_path):
            return
        if request_path.startswith("/api/foundation/") and mio_foundation.dispatch(
            self,
            self.services.application,
            request_path[len("/api/foundation/") :],
            urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query),
        ):
            return

        if request_path == "/api/content":
            try:
                from backend.mio_content import bootstrap

                value = bootstrap(self.services.content_store())
                value["config"] = mio_lifecycle.filter_deleted(
                    value["config"], self.services.DATA_DIR
                )
                self.send_json(200, value)
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if request_path == "/api/config":
            try:
                self.services.content_store().library.scan()
                self.send_json(
                    200,
                    (
                        mio_lifecycle.filter_deleted(
                            self.services.native_store().read(
                                album_summaries="summaries=1" in self.path,
                                include_baseline=False,
                            ),
                            self.services.DATA_DIR,
                        )
                        if "summaries=1" in self.path
                        else self.services.read_merged_config()
                    ),
                )
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if request_path.startswith("/api/library/export/"):
            try:
                kind, id = request_path[len("/api/library/export/") :].split("/", 1)
                if kind == "albums":
                    mio_foundation.materialize_album(self.services.application, id)
                raw = self.services.native_store().library.export_bundle(kind, id)
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header(
                    "Content-Disposition", 'attachment; filename="' + id + '.mio.zip"'
                )
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except self.services.LibraryError as e:
                self.send_json(e.status, {"error": str(e)})
            return

        if request_path.startswith("/api/library/entity/"):
            try:
                kind, id = request_path[len("/api/library/entity/") :].split("/", 1)
                if kind == "albums":
                    mio_foundation.materialize_album(self.services.application, id)
                value = self.services.native_store().entity(kind, id)
                self.send_json(200, value)
            except self.services.LibraryError as e:
                self.send_json(e.status, {"error": str(e)})
            return
        if request_path == "/api/library/rescan":
            self.services.native_store().library.scan()
            self.send_json(
                200,
                {
                    "ok": True,
                    "problems": self.services.native_store().library.problems(),
                },
            )
            return

        if request_path == "/api/marketplace/index":
            try:
                self.send_json(200, self.services.get_marketplace_catalog())
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if not self.services.is_public_static_path(request_path):
            self.send_json(404, {"error": "Not found"})
            return

        if request_path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/v1"):
            self.send_error(405, "Use GET")
            return
        request_path = urllib.parse.urlparse(self.path).path
        if request_path.startswith("/api/") or not self.services.is_public_static_path(
            request_path
        ):
            self.send_error(404, "Not found")
            return
        if request_path == "/":
            self.path = "/index.html"
        super().do_HEAD()

    def do_POST(self):
        if self.external_api():
            return
        request_path = urllib.parse.urlparse(self.path).path
        if not self.authorize_private():
            return

        if production_api.dispatch(self, self.services.application, request_path):
            return
        if ecosystem_api.dispatch(self, self.services.application, request_path):
            return

        if request_path == "/api/image/comfy-check":
            try:
                from backend.mio_connection_check import check_comfy
                self.send_json(200, check_comfy(self.read_json_body(max_bytes=4096)))
            except self.services.PayloadTooLargeError:
                self.send_json(413, {"error": "Connection-check request exceeds 4 KiB"})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
            return

        if request_path in ("/api/image/credentials", "/api/image/models"):
            if self.headers.get("Origin") == "null":
                self.send_json(
                    403, {"error": "Open the local server URL to manage credentials"}
                )
                return
            try:
                payload = self.read_json_body(max_bytes=65536)
                result = (
                    self.services.manage_native_credentials(payload)
                    if request_path.endswith("/credentials")
                    else self.services.list_provider_models(payload)
                )
                self.send_json(200, result)
            except self.services.PayloadTooLargeError:
                self.send_json(413, {"error": "Request too large"})
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)[:240]})
            except Exception:
                self.send_json(
                    500, {"error": "Local credential/model operation failed"}
                )
            return

        if request_path == "/api/export/portable":
            from backend.mio_export import stream_export, read_export_body

            try:
                stream_export(
                    self, self.services.native_store(), read_export_body(self)
                )
            except (self.services.LibraryError, ValueError, OSError) as exc:
                # C7: keep the library's own status (409 while another export
                # is streaming) so clients can back off and retry instead of
                # treating a busy slot as a malformed request.
                status = getattr(exc, "status", 400)
                self.send_json(
                    status if isinstance(status, int) and 400 <= status < 600 else 400,
                    {"error": str(exc), **({"code": exc.code} if hasattr(exc, "code") else {})},
                )
            return

        if request_path == "/api/image/generate":
            try:
                self.send_json(
                    200,
                    self.services.generate_provider_image(
                        self.read_json_body(
                            max_bytes=self.services.MAX_IMAGE_BYTES * 4 // 3 + 65536
                        )
                    ),
                )
            except self.services.ProviderHTTPError as exc:
                self.send_response(exc.status)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(exc.body)))
                self.end_headers()
                self.wfile.write(exc.body)
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
            return

        if request_path.startswith("/api/foundation/") and mio_foundation.dispatch(
            self,
            self.services.application,
            request_path[len("/api/foundation/") :],
            urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query),
        ):
            return

        if request_path in (
            "/api/library/import",
            "/api/library/inspect",
            "/api/library/export-document",
        ):
            try:
                from backend import mio_resource_sharing as sharing

                body = self.read_json_body(max_bytes=260 * 1024 * 1024)
                store = self.services.native_store()
                if "html" in body:
                    from backend import mio_album_html

                    if body.get("expectedKind") != "albums":
                        raise self.services.LibraryError("请在画册页面导入 HTML 画册。")
                    self.send_json(
                        200,
                        (
                            mio_album_html.inspect(store, body)
                            if request_path.endswith("/inspect")
                            else mio_album_html.import_html(store, body)
                        ),
                    )
                elif request_path.endswith("/export-document"):
                    raw = sharing.export_document(
                        store, body.get("kind"), body.get("document")
                    )
                    self.send_response(200)
                    self.send_header("Content-Type", "application/zip")
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                elif request_path.endswith("/inspect"):
                    kind, doc, assets = sharing.inspect_resource(store, body)
                    self.send_json(
                        200,
                        {
                            "ok": True,
                            "kind": kind,
                            "title": doc["title"],
                            "count": len(
                                doc.get(
                                    "steps", doc.get("frames", doc.get("entries", []))
                                )
                            ),
                            "images": len(assets),
                            "storyboards": int(
                                bool(doc.get("sharedSources", {}).get("storyboard"))
                            ),
                            "variables": int(
                                bool(doc.get("sharedSources", {}).get("variables"))
                            ),
                        },
                    )
                else:
                    self.send_json(200, sharing.import_resource(store, body))
            except self.services.LibraryError as e:
                self.send_json(e.status, {"error": str(e)})
            except Exception as e:
                self.send_json(400, {"error": str(e)})
            return
        if request_path == "/api/library/forget-key":
            try:
                scope = self.read_json_body().get("scope")
                if scope not in ("llm", "xml", "critic"):
                    raise ValueError("Unknown key scope")
                name = "workspace" if scope == "critic" else scope
                pointer = (
                    "/ui/comfyStudio/settings/critic/key"
                    if scope == "critic"
                    else "/key"
                )
                store = self.services.native_store()
                current = store.settings.get(name)
                self.send_json(
                    200,
                    store.apply(
                        [],
                        settings_changes=[
                            {
                                "name": name,
                                "document": current["document"],
                                "expected": current["etag"],
                                "clearSecrets": [pointer],
                            }
                        ],
                    ),
                )
            except Exception as e:
                self.send_json(400, {"error": str(e)})
            return

        if request_path == "/api/chat":
            try:
                self.send_json(
                    200,
                    self.services.chat_proxy(
                        self.read_json_body(max_bytes=20 * 1024 * 1024)
                    ),
                )
            except Exception:
                self.send_json(
                    502,
                    {
                        "error": "模型请求未完成；未自动重试。请检查连接、模型和保存的密钥。"
                    },
                )
            return

        if request_path == "/api/config":
            try:
                payload = self.read_json_body(max_bytes=20 * 1024 * 1024)
                if payload.get("format") != "mio.delta.v2":
                    raise self.services.LibraryError(
                        "Only per-entity v2 delta saves are accepted. Reload the application.",
                        409,
                    )
                service = mio_foundation.jobs(self.services.application)
                with service.lock, self.services.CONFIG_LOCK:
                    removed = payload.get("removals", [])
                    deleted = mio_lifecycle.deleted_album_ids(self.services.DATA_DIR)
                    changes = [
                        op
                        for op in payload.get("changes", [])
                        if not (op.get("kind") == "albums" and op.get("id") in deleted)
                    ]
                    for op in changes:
                        if op.get("kind") == "albums":
                            op["document"] = mio_pictures.project(
                                {"savedGalleries": [op["document"]]},
                                self.services.DATA_DIR,
                            )["savedGalleries"][0]
                    album_ids = [
                        op["id"] for op in removed if op.get("kind") == "albums"
                    ]
                    self.send_json(
                        200,
                        self.services.native_store().apply(
                            changes,
                            removed,
                            payload.get("settings", []),
                            before_commit=(
                                (lambda: service.delete_albums(album_ids))
                                if album_ids
                                else None
                            ),
                        ),
                    )
            except self.services.LibraryError as e:
                self.send_json(e.status, {"error": str(e), "code": e.code})
            except Exception as e:
                self.send_json(400, {"error": str(e)})

        elif request_path == "/api/store-image":
            try:
                payload = self.read_json_body(
                    max_bytes=self.services.MAX_IMAGE_BYTES * 4 // 3 + 4096
                )
                local_url = self.services.store_image_data(
                    payload.get("dataUrl", ""), payload.get("albumId", "unassigned")
                )
                if payload.get("name"):
                    mio_foundation.record_asset_origin(
                        self.services.application,
                        local_url,
                        {"kind": "upload", "name": str(payload["name"])[:250]},
                    )
                self.send_json(200, {"ok": True, "localUrl": local_url})
            except self.services.PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except (ValueError, TypeError) as e:
                self.send_json(400, {"error": str(e)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

        elif request_path == "/api/save-image":
            # Download a ComfyUI image URL and persist it locally under /images/
            try:
                payload = self.read_json_body()
                img_url = payload.get("url", "")
                if not img_url:
                    raise ValueError("Missing url field")

                raw, mime_type = self.services.fetch_remote_image(img_url)
                local_url = self.services.store_image_bytes(
                    raw,
                    payload.get("albumId", "unassigned"),
                )
                self.send_json(200, {"status": "ok", "localUrl": local_url})
            except self.services.PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                self.send_json(502, {"error": str(e)})
        elif request_path == "/api/inline-image":
            # Convert an image URL/path/data URL into a base64 data URL for self-contained exports.
            try:
                payload = self.read_json_body()
                img_url = payload.get("url", "")
                data_url = self.services.image_url_to_data_url(img_url)

                self.send_json(200, {"status": "ok", "dataUrl": data_url})
            except self.services.PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                self.send_json(422, {"error": str(e)})
        elif request_path == "/api/marketplace/fetch-remote":
            try:
                payload = self.read_json_body()
                url = (payload.get("url") or "").strip()
                data = self.services.fetch_remote_json(url)
                self.send_json(200, {"status": "ok", "data": data})
            except self.services.PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                self.send_json(400, {"error": str(e)})
        elif request_path == "/api/vision/audit":
            try:
                # 视觉图片 Base64 审校放宽上限至 68MB（支持 50MB 原始图片膨胀）
                payload = self.read_json_body(
                    max_bytes=self.services.MAX_IMAGE_BYTES * 4 // 3 + 2 * 1024 * 1024
                )
                critique = self.services.handle_vision_audit(payload)
                self.send_json(200, {"status": "ok", "critique": critique})
            except self.services.PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
        else:
            self.send_json(404, {"error": "Not found"})
