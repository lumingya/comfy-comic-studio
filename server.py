import os
import json
import uuid
import base64
import binascii
import mimetypes
import threading
import urllib.request
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

def _read_port_from_env(default=8777):
    raw = os.environ.get("COMFY_COMIC_PORT", "").strip()
    if not raw:
        return default
    try:
        port = int(raw)
    except ValueError:
        print(f"[Config] Ignoring invalid COMFY_COMIC_PORT={raw!r}; falling back to {default}.", flush=True)
        return default
    if not (1 <= port <= 65535):
        print(f"[Config] COMFY_COMIC_PORT={port} is out of range; falling back to {default}.", flush=True)
        return default
    return port


PORT = _read_port_from_env()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LEGACY_DATA_FILE = os.path.join(BASE_DIR, "comfy_comic_data.json")
DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_FILES = {
    "content": os.path.join(DATA_DIR, "content.json"),
    "comfy": os.path.join(DATA_DIR, "comfy.json"),
    "llm": os.path.join(DATA_DIR, "llm.json"),
    "xml_template": os.path.join(DATA_DIR, "xml_template.json"),
    "chat": os.path.join(DATA_DIR, "chat.json"),
    "ui": os.path.join(DATA_DIR, "ui.json"),
}
IMAGES_DIR = os.path.join(BASE_DIR, "images")
MAX_JSON_BODY_BYTES = 10 * 1024 * 1024
MAX_IMAGE_BYTES = 50 * 1024 * 1024
CONFIG_LOCK = threading.RLock()
PUBLIC_FILES = {
    "/index.html",
    "/styles.css",
    "/favicon.svg",
}
# Whole directories of front-end assets. Serving these by prefix (instead of
# listing every file) keeps server.py from needing an edit each time a module
# or a vendored library is added.
PUBLIC_ASSET_DIRS = ("/js/", "/vendor/")
PUBLIC_ASSET_SUFFIXES = (".js", ".css", ".svg", ".woff2", ".woff", ".map")
REQUIRED_CONFIG_FIELDS = {
    "templates": list,
    "batchMatrix": dict,
    "savedGalleries": list,
    "comfyWorkflows": list,
    "comfyConfig": dict,
    "llmConfig": dict,
    "xmlConfig": dict,
    "chatConfig": dict,
    "uiConfig": dict,
    "batchRunState": dict,
}
PROTECTED_COLLECTION_FIELDS = ("templates", "savedGalleries", "comfyWorkflows")
ALLOWED_ORIGINS = {
    "null",  # Support opening index.html directly from file:// as a fallback.
    f"http://127.0.0.1:{PORT}",
    f"http://localhost:{PORT}",
}
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(IMAGES_DIR, exist_ok=True)


class PayloadTooLargeError(ValueError):
    pass


class ConfigReadError(ValueError):
    pass


def _is_file_inside(candidate_path, root_dir):
    candidate = os.path.realpath(os.path.join(BASE_DIR, candidate_path.lstrip("/")))
    root = os.path.realpath(root_dir)
    try:
        inside = (
            os.path.commonpath([os.path.normcase(candidate), os.path.normcase(root)])
            == os.path.normcase(root)
        )
    except ValueError:
        return False
    return inside and os.path.isfile(candidate)


def is_public_static_path(request_path):
    """Only expose the application shell, front-end assets and generated images."""
    decoded_path = urllib.parse.unquote(request_path or "/")
    if decoded_path == "/":
        return True
    if decoded_path in PUBLIC_FILES:
        return True

    for asset_dir in PUBLIC_ASSET_DIRS:
        if decoded_path.startswith(asset_dir):
            if not decoded_path.lower().endswith(PUBLIC_ASSET_SUFFIXES):
                return False
            return _is_file_inside(decoded_path, os.path.join(BASE_DIR, asset_dir.strip("/")))

    if not decoded_path.startswith("/images/"):
        return False
    return _is_file_inside(decoded_path, IMAGES_DIR)


def validate_config_payload(data):
    missing = [key for key in REQUIRED_CONFIG_FIELDS if key not in data]
    if missing:
        raise ValueError(f"Missing required config fields: {', '.join(sorted(missing))}")

    invalid = [
        key for key, expected_type in REQUIRED_CONFIG_FIELDS.items()
        if not isinstance(data.get(key), expected_type)
    ]
    if invalid:
        raise ValueError(f"Invalid config field types: {', '.join(sorted(invalid))}")

    force_write = data.get("forceWrite", False)
    if not isinstance(force_write, bool):
        raise ValueError("forceWrite must be a boolean")
    return data

def bytes_to_data_url(raw, mime_type=None):
    mime = mime_type or "application/octet-stream"
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def detect_image_mime_type(raw, fallback=None):
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(raw) >= 12 and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw.startswith(b"BM"):
        return "image/bmp"
    if raw.startswith((b"II*\x00", b"MM\x00*")):
        return "image/tiff"
    if raw.startswith(b"\x00\x00\x01\x00"):
        return "image/x-icon"
    if len(raw) >= 12 and raw[4:8] == b"ftyp" and raw[8:12] in (b"avif", b"avis"):
        return "image/avif"

    leading_text = raw[:1024].lstrip().lower()
    if leading_text.startswith(b"<svg") or (leading_text.startswith(b"<?xml") and b"<svg" in leading_text):
        return "image/svg+xml"
    raise ValueError("Unsupported or invalid image content")

def data_url_to_base64_data_url(data_url):
    header, _, payload = data_url.partition(",")
    if not header.startswith("data:") or not payload:
        raise ValueError("Invalid data URL")
    mime = header[5:].split(";")[0].lower()
    if not mime.startswith("image/"):
        raise ValueError("Only image data URLs are supported")
    if ";base64" in header:
        try:
            raw = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Invalid base64 image data URL") from exc
    else:
        raw = urllib.parse.unquote_to_bytes(payload)
    if len(raw) > MAX_IMAGE_BYTES:
        raise PayloadTooLargeError("Image exceeds the 50 MB size limit")
    return bytes_to_data_url(raw, detect_image_mime_type(raw, mime))


def ensure_path_within_images(path):
    candidate = os.path.realpath(os.path.abspath(path))
    images_root = os.path.realpath(os.path.abspath(IMAGES_DIR))
    try:
        is_allowed = os.path.commonpath([os.path.normcase(candidate), os.path.normcase(images_root)]) == os.path.normcase(images_root)
    except ValueError:
        is_allowed = False
    if not is_allowed:
        raise PermissionError("Local image paths must stay inside the images directory")
    if not os.path.isfile(candidate):
        raise FileNotFoundError("Local image file does not exist")
    return candidate

def local_path_from_url(raw_url):
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme == "file":
        path = urllib.parse.unquote(parsed.path)
        if os.name == "nt" and path.startswith("/") and len(path) > 3 and path[2] == ":":
            path = path[1:]
        return ensure_path_within_images(path)
    if parsed.scheme in ("http", "https"):
        host = (parsed.hostname or "").lower()
        if host in ("127.0.0.1", "localhost") and parsed.port == PORT:
            local_rel_path = urllib.parse.unquote(parsed.path).lstrip("/")
            return ensure_path_within_images(os.path.join(BASE_DIR, local_rel_path))
        return None
    if raw_url and (os.path.isabs(raw_url) or (os.name == "nt" and len(raw_url) > 2 and raw_url[1] == ":")):
        return ensure_path_within_images(raw_url)
    if not parsed.scheme and not parsed.netloc:
        local_rel_path = urllib.parse.unquote(parsed.path).lstrip("/\\")
        return ensure_path_within_images(os.path.join(BASE_DIR, local_rel_path))
    return None


def read_limited_response(response, limit=MAX_IMAGE_BYTES):
    declared_length = response.headers.get("Content-Length")
    if declared_length:
        try:
            declared_length = int(declared_length)
        except ValueError as exc:
            raise ValueError("Invalid upstream Content-Length header") from exc
        if declared_length > limit:
            raise PayloadTooLargeError("Image exceeds the 50 MB size limit")

    chunks = []
    total = 0
    while True:
        chunk = response.read(min(1024 * 1024, limit - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise PayloadTooLargeError("Image exceeds the 50 MB size limit")
        chunks.append(chunk)
    return b"".join(chunks)


def get_image_mime_type(response, raw_url):
    content_type = (response.headers.get_content_type() or "").lower()
    if content_type.startswith("image/"):
        return content_type

    parsed = urllib.parse.urlparse(response.geturl() or raw_url)
    query_filename = urllib.parse.parse_qs(parsed.query).get("filename", [""])[0]
    guessed_type = mimetypes.guess_type(query_filename or parsed.path)[0]
    if guessed_type and guessed_type.startswith("image/"):
        return guessed_type
    raise ValueError("The requested resource is not an image")


def fetch_remote_image(raw_url):
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Only HTTP(S) image URLs are supported")
    req = urllib.request.Request(raw_url, headers={"User-Agent": "ComfyComicStudio/1.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        mime_type = get_image_mime_type(response, raw_url)
        raw = read_limited_response(response)
    return raw, detect_image_mime_type(raw, mime_type)

def image_url_to_data_url(raw_url):
    if not raw_url:
        raise ValueError("Missing url field")

    if raw_url.startswith("data:"):
        return data_url_to_base64_data_url(raw_url)

    local_path = local_path_from_url(raw_url)
    if local_path:
        with open(local_path, "rb") as f:
            raw = f.read(MAX_IMAGE_BYTES + 1)
        if len(raw) > MAX_IMAGE_BYTES:
            raise PayloadTooLargeError("Image exceeds the 50 MB size limit")
        guessed_type = mimetypes.guess_type(local_path)[0]
        mime_type = detect_image_mime_type(raw, guessed_type)
        return bytes_to_data_url(raw, mime_type)

    raw, mime_type = fetch_remote_image(raw_url)
    return bytes_to_data_url(raw, mime_type)

def read_json_file(path, default=None):
    if default is None:
        default = {}
    if not os.path.exists(path):
        return default
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def write_json_file(path, data):
    """Write atomically, and skip the write entirely when nothing changed.

    The client POSTs its whole state on every save, so all six config files
    were rewritten each time -- including content.json and comfy.json, which
    are ~170 KB each and barely ever change together. During a batch run that
    meant hundreds of KB of pointless disk churn every few hundred ms.
    """
    serialized = json.dumps(data, indent=2, ensure_ascii=False)
    try:
        with open(path, 'r', encoding='utf-8') as existing:
            if existing.read() == serialized:
                return False
    except (OSError, ValueError):
        pass

    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, 'w', encoding='utf-8') as f:
        f.write(serialized)
    os.replace(tmp_path, path)
    return True

def normalize_merged_config(data):
    if not isinstance(data, dict):
        return {}

    comfy_config = data.get("comfyConfig") if isinstance(data.get("comfyConfig"), dict) else {}
    if comfy_config:
        data.setdefault("nodePositive", comfy_config.get("nodePositive", "6"))
        data.setdefault("nodeNegative", comfy_config.get("nodeNegative", ""))
        data.setdefault("nodeOutput", comfy_config.get("nodeOutput", "9"))

    xml_config = data.get("xmlConfig") if isinstance(data.get("xmlConfig"), dict) else {}
    if xml_config:
        data.setdefault("xmlSystemPrompt", xml_config.get("systemPrompt", ""))

    return data

def read_merged_config():
    with CONFIG_LOCK:
        split_exists = any(os.path.exists(path) for path in CONFIG_FILES.values())
        merged = {}

        if split_exists:
            missing_files = [path for path in CONFIG_FILES.values() if not os.path.exists(path)]
            if missing_files:
                missing_names = ", ".join(os.path.basename(path) for path in missing_files)
                raise ConfigReadError(f"Configuration set is incomplete; missing: {missing_names}")

            read_errors = []
            for path in CONFIG_FILES.values():
                try:
                    chunk = read_json_file(path, {})
                    if isinstance(chunk, dict):
                        merged.update(chunk)
                    else:
                        read_errors.append(f"{os.path.basename(path)} is not a JSON object")
                except Exception as e:
                    read_errors.append(f"{os.path.basename(path)}: {e}")
            if read_errors:
                details = "; ".join(read_errors)
                raise ConfigReadError(f"Unable to read configuration safely: {details}")
        elif os.path.exists(LEGACY_DATA_FILE):
            merged = read_json_file(LEGACY_DATA_FILE, {})
            try:
                write_split_config(merged)
                print("[Config Migration] Legacy comfy_comic_data.json has been split into data/*.json.", flush=True)
            except Exception as e:
                print(f"[Config Migration Warning] {e}", flush=True)

    return normalize_merged_config(merged)

def split_config_payload(data):
    comfy_config = data.get("comfyConfig") if isinstance(data.get("comfyConfig"), dict) else {}
    comfy_config = {
        **comfy_config,
        "baseUrl": data.get("comfyUrl", comfy_config.get("baseUrl", "http://127.0.0.1:8188")),
        "isMockMode": data.get("isMockMode", comfy_config.get("isMockMode", False)),
        "nodePositive": data.get("nodePositive", comfy_config.get("nodePositive", "6")),
        "nodeNegative": data.get("nodeNegative", comfy_config.get("nodeNegative", "")),
        "nodeOutput": data.get("nodeOutput", comfy_config.get("nodeOutput", "9")),
    }

    xml_config = data.get("xmlConfig") if isinstance(data.get("xmlConfig"), dict) else {}
    if "xmlSystemPrompt" in data:
        xml_config = {**xml_config, "systemPrompt": data.get("xmlSystemPrompt", "")}

    return {
        "content": {
            "templates": data.get("templates", []),
            "activeTemplateId": data.get("activeTemplateId"),
            "batchMatrix": data.get("batchMatrix", {}),
            "savedGalleries": data.get("savedGalleries", []),
        },
        "comfy": {
            "comfyWorkflows": data.get("comfyWorkflows", []),
            "activeWorkflowId": data.get("activeWorkflowId"),
            "comfyConfig": comfy_config,
            "nodePositive": comfy_config.get("nodePositive", "6"),
            "nodeNegative": comfy_config.get("nodeNegative", ""),
            "nodeOutput": comfy_config.get("nodeOutput", "9"),
        },
        "llm": {
            "llmConfig": data.get("llmConfig", {}),
        },
        "xml_template": {
            "xmlConfig": xml_config,
            "xmlSystemPrompt": xml_config.get("systemPrompt", ""),
        },
        "chat": {
            "chatConfig": data.get("chatConfig", {}),
        },
        "ui": {
            "uiConfig": data.get("uiConfig", {}),
            "batchRunState": data.get("batchRunState", {}),
            "updatedAt": data.get("updatedAt"),
        },
    }

def write_split_config(data):
    payloads = split_config_payload(data)
    written = []
    with CONFIG_LOCK:
        for key, payload in payloads.items():
            if write_json_file(CONFIG_FILES[key], payload):
                written.append(key)
    return written

class ComicRequestHandler(SimpleHTTPRequestHandler):
    def is_origin_allowed(self):
        origin = self.headers.get('Origin')
        return not origin or origin in ALLOWED_ORIGINS

    def send_json(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def read_json_body(self):
        content_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
        if content_type != 'application/json':
            raise ValueError('Content-Type must be application/json')
        raw_length = self.headers.get('Content-Length')
        if raw_length is None:
            raise ValueError('Missing Content-Length header')
        content_length = int(raw_length)
        if content_length < 0:
            raise ValueError('Invalid Content-Length header')
        if content_length > MAX_JSON_BODY_BYTES:
            raise PayloadTooLargeError('JSON request exceeds the 10 MB size limit')
        raw = self.rfile.read(content_length)
        if len(raw) != content_length:
            raise ValueError('Incomplete request body')
        data = json.loads(raw.decode('utf-8'))
        if not isinstance(data, dict):
            raise ValueError('JSON request body must be an object')
        return data

    def end_headers(self):
        # Keep file:// fallback support without granting arbitrary websites access
        # to the local configuration and image APIs.
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')

        request_path = urllib.parse.urlparse(self.path).path
        if request_path.startswith('/images/') or request_path.startswith('/vendor/'):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        if not self.is_origin_allowed():
            self.send_json(403, {"error": "Origin is not allowed"})
            return
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        request_path = urllib.parse.urlparse(self.path).path
        if request_path == '/api/config':
            try:
                self.send_json(200, read_merged_config())
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if not is_public_static_path(request_path):
            self.send_json(404, {"error": "Not found"})
            return

        if request_path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_HEAD(self):
        request_path = urllib.parse.urlparse(self.path).path
        if request_path.startswith('/api/') or not is_public_static_path(request_path):
            self.send_error(404, "Not found")
            return
        if request_path == "/":
            self.path = "/index.html"
        super().do_HEAD()

    def do_POST(self):
        request_path = urllib.parse.urlparse(self.path).path
        if not self.is_origin_allowed():
            self.send_json(403, {"error": "Origin is not allowed"})
            return

        if request_path == '/api/config':
            try:
                data = validate_config_payload(self.read_json_body())
                
                # 安全红线拦截校验：防止客户端空缓存反向冲刷抹除已有配置与画册
                current_data = read_merged_config()
                force_write = data.get("forceWrite", False)
                shrunken_fields = [
                    field for field in PROTECTED_COLLECTION_FIELDS
                    if len(data.get(field, [])) < len(current_data.get(field, []))
                ]
                if not force_write and shrunken_fields:
                    field_list = ", ".join(shrunken_fields)
                    print(f"[Sync Blocked] Prevented shrinking protected fields: {field_list}.", flush=True)
                    self.send_json(409, {
                        "error": f"Sync blocked: protected collections would shrink ({field_list})."
                    })
                    return

                written = write_split_config(data)

                self.send_json(200, {"status": "success", "files": written})
            except PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                print(f"[POST Error] {e}", flush=True)
                self.send_json(400, {"error": str(e)})

        elif request_path == '/api/save-image':
            # Download a ComfyUI image URL and persist it locally under /images/
            try:
                payload = self.read_json_body()
                img_url = payload.get('url', '')
                if not img_url:
                    raise ValueError('Missing url field')

                raw, mime_type = fetch_remote_image(img_url)
                ext = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/webp': '.webp',
                    'image/gif': '.gif',
                }.get(mime_type, mimetypes.guess_extension(mime_type) or '.img')

                filename = f"comfy_{uuid.uuid4().hex[:12]}{ext}"
                dest_path = os.path.join(IMAGES_DIR, filename)
                tmp_path = f"{dest_path}.tmp"

                try:
                    with open(tmp_path, 'wb') as out:
                        out.write(raw)
                    os.replace(tmp_path, dest_path)
                finally:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)

                local_url = f"http://127.0.0.1:{PORT}/images/{filename}"
                self.send_json(200, {"status": "ok", "localUrl": local_url})
            except PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                self.send_json(502, {"error": str(e)})
        elif request_path == '/api/inline-image':
            # Convert an image URL/path/data URL into a base64 data URL for self-contained exports.
            try:
                payload = self.read_json_body()
                img_url = payload.get('url', '')
                data_url = image_url_to_data_url(img_url)

                self.send_json(200, {"status": "ok", "dataUrl": data_url})
            except PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                self.send_json(422, {"error": str(e)})
        else:
            self.send_json(404, {"error": "Not found"})

if __name__ == '__main__':
    # Change working dir to server.py directory
    os.chdir(BASE_DIR)
    print(f"=========================================================")
    print(f" ComfyComic Studio 本地服务已成功启动！")
    print(f" 网页访问地址: http://127.0.0.1:{PORT}/index.html")
    print(f" 物理落盘配置目录: data/")
    print(f"=========================================================")
    server = ThreadingHTTPServer(('127.0.0.1', PORT), ComicRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()
