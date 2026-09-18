import os
import time
import sys
import re
import json
import uuid
import base64
import binascii
import hashlib
import copy
import mimetypes
import threading
from backend import mio_pictures
from backend import mio_lifecycle
from backend import mio_foundation
from backend import mio_api
from backend import mio_credentials
from backend import mio_docs
from backend.ecosystem import api as ecosystem_api
from backend.production import api as production_api
from backend.mio_native_store import NativeStore
from backend.mio_library import LibraryError
import io
from pathlib import Path
from datetime import datetime
import urllib.request
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def _read_port_from_env(default=8777):
    raw = os.environ.get("MIO_PORT", os.environ.get("COMFY_COMIC_PORT", "")).strip()
    if not raw:
        return default
    try:
        port = int(raw)
    except ValueError:
        print(
            f"[Config] Ignoring invalid COMFY_COMIC_PORT={raw!r}; falling back to {default}.",
            flush=True,
        )
        return default
    if not (1 <= port <= 65535):
        print(
            f"[Config] COMFY_COMIC_PORT={port} is out of range; falling back to {default}.",
            flush=True,
        )
        return default
    return port


PORT = _read_port_from_env()
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    BASE_DIR = str(Path(__file__).resolve().parents[1])
LEGACY_DATA_FILE = os.path.join(BASE_DIR, "comfy_comic_data.json")
DATA_DIR = os.path.abspath(
    os.environ.get("MIO_DATA_DIR", os.path.join(BASE_DIR, "data"))
)
LEGACY_CONFIG_FILES = {
    key: os.path.join(DATA_DIR, key + ".json")
    for key in ("content", "comfy", "llm", "xml_template", "chat", "ui")
}
CONFIG_FILES = {
    "content": os.path.join(DATA_DIR, "storyboards", "templates.json"),
    "galleries": os.path.join(DATA_DIR, "albums", "index.json"),
    "matrix": os.path.join(DATA_DIR, "presets", "characters.json"),
    "workflows": os.path.join(DATA_DIR, "workflows", "library.json"),
    "comfy": os.path.join(DATA_DIR, "settings", "comfy.json"),
    "llm": os.path.join(DATA_DIR, "settings", "llm.json"),
    "xml_template": os.path.join(DATA_DIR, "settings", "xml_template.json"),
    "chat": os.path.join(DATA_DIR, "conversations", "sessions.json"),
    "ui": os.path.join(DATA_DIR, "workspace", "state.json"),
    "queue": os.path.join(DATA_DIR, "queue", "tasks.json"),
    "projects": os.path.join(DATA_DIR, "workspace", "collections.json"),
    "plans": os.path.join(DATA_DIR, "storyboards", "plans.json"),
    "presets": os.path.join(DATA_DIR, "presets", "scene-presets.json"),
}
# Keep /images URLs stable. New images are grouped by date under data/assets/images.
LEGACY_IMAGES_DIR = os.path.join(BASE_DIR, "images")
IMAGES_DIR = os.path.join(DATA_DIR, "runtime", "staging", "images")
MAX_JSON_BODY_BYTES = 10 * 1024 * 1024
MAX_IMAGE_BYTES = 50 * 1024 * 1024
CONFIG_LOCK = threading.RLock()
PUBLIC_FILES = {
    "/index.html",
    "/styles.css",
    "/favicon.svg",
    "/LICENSE",
    "/README.md",
    "/README.en.md",
    "/SECURITY.md",
    "/README.html",
    "/README.en.html",
    "/SECURITY.html",
    "/examples/mio_client.py",
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
ALLOWED_ORIGINS.update(
    filter(
        None,
        (
            x.strip()
            for x in os.environ.get(
                "MIO_ORIGINS", os.environ.get("COMFY_COMIC_ORIGINS", "")
            ).split(",")
        ),
    )
)
_NATIVE_STORES = {}


def reset_native_stores():
    with CONFIG_LOCK:
        for store in list(_NATIVE_STORES.values()):
            try:
                store.close()
            except Exception:
                pass
        _NATIVE_STORES.clear()


def native_store():
    key = os.path.abspath(DATA_DIR)
    with CONFIG_LOCK:
        if key not in _NATIVE_STORES:
            _NATIVE_STORES[key] = NativeStore(key, BASE_DIR)
        return _NATIVE_STORES[key]


def content_store():
    store = native_store()
    with CONFIG_LOCK:
        if not hasattr(store, "fresh_content"):
            from backend.mio_content import initialize

            store.fresh_content = initialize(store, BASE_DIR)
    return store


class PayloadTooLargeError(ValueError):
    pass


class ConfigReadError(ValueError):
    pass


def _is_file_inside(candidate_path, root_dir):
    candidate = os.path.realpath(os.path.join(BASE_DIR, candidate_path.lstrip("/\\")))
    root = os.path.realpath(root_dir)
    try:
        inside = os.path.commonpath(
            [os.path.normcase(candidate), os.path.normcase(root)]
        ) == os.path.normcase(root)
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

    if decoded_path.startswith("/docs/"):
        return decoded_path.lower().endswith(
            (".md", ".html", ".json", ".png", ".svg", ".txt")
        ) and _is_file_inside(decoded_path, os.path.join(BASE_DIR, "docs"))

    for asset_dir in PUBLIC_ASSET_DIRS:
        if decoded_path.startswith(asset_dir):
            if not decoded_path.lower().endswith(PUBLIC_ASSET_SUFFIXES):
                return False
            return _is_file_inside(
                decoded_path, os.path.join(BASE_DIR, asset_dir.strip("/"))
            )

    if decoded_path.startswith("/images/"):
        try:
            return native_store().image_path(decoded_path).is_file()
        except (LibraryError, OSError, ValueError):
            return False
    return False


def validate_config_payload(data):
    missing = [key for key in REQUIRED_CONFIG_FIELDS if key not in data]
    if missing:
        raise ValueError(
            f"Missing required config fields: {', '.join(sorted(missing))}"
        )

    invalid = [
        key
        for key, expected_type in REQUIRED_CONFIG_FIELDS.items()
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
    if leading_text.startswith(b"<svg") or (
        leading_text.startswith(b"<?xml") and b"<svg" in leading_text
    ):
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
    path = Path(path).absolute()
    root = Path(DATA_DIR).absolute()
    if not path.is_relative_to(root) or path.is_symlink() or not path.is_file():
        raise PermissionError("Local image must be an owned workspace asset")
    from backend.mio_library import image_type

    image_type(path.read_bytes())
    return str(path)


def local_path_from_url(raw_url):
    parsed = urllib.parse.urlsplit(raw_url)
    if parsed.scheme and len(parsed.scheme) == 1 and parsed.scheme.isalpha():
        raise ValueError("Arbitrary local paths are not allowed")
    if (
        not parsed.scheme
        or parsed.hostname in ("localhost", "127.0.0.1", "::1")
        and parsed.port == PORT
    ):
        return str(native_store().image_path(parsed.path))
    return None


def read_limited_response(response, limit=MAX_IMAGE_BYTES):
    declared_length = response.headers.get("Content-Length")
    if declared_length:
        try:
            declared_length = int(declared_length)
        except ValueError as exc:
            raise ValueError("Invalid upstream Content-Length header") from exc
        if declared_length > limit:
            raise PayloadTooLargeError(
                f"Upstream response exceeds the {limit // (1024 * 1024)} MB size limit"
            )

    chunks = []
    total = 0
    while True:
        chunk = response.read(min(1024 * 1024, limit - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise PayloadTooLargeError(
                f"Upstream response exceeds the {limit // (1024 * 1024)} MB size limit"
            )
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


def fetch_remote_image(raw_url, timeout=30, on_socket=None):
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Only HTTP(S) image URLs are supported")
    req = urllib.request.Request(
        raw_url, headers={"User-Agent": "ComfyComicStudio/1.0"}
    )
    from backend.providers.transport import opener as cancelable_opener

    open_request = (
        cancelable_opener({"_onSocket": on_socket}).open
        if on_socket
        else urllib.request.urlopen
    )
    with open_request(req, timeout=timeout) as response:
        # Signed image URLs may have neither an extension nor an image MIME.
        # Validate actual bytes instead of rejecting them from HTTP metadata.
        raw = read_limited_response(response)
    return raw, detect_image_mime_type(raw)


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


MARKETPLACE_FILE = os.path.join(DATA_DIR, "cache", "marketplace.json")

DEFAULT_MARKETPLACE_CATALOG = {
    "version": "1.0.0",
    "updatedAt": "2026-09-04",
    "storyboards": [
        {
            "id": "tpl_cyberpunk_noir",
            "title": "赛博朋克：霓虹雨夜追逐 (6幕)",
            "author": "ComfyComic 社区",
            "desc": "以未来赛博朋克都市为背景的动作分镜，包含天台对峙、雨夜追车与全息投影交火等高戏剧张力场景。",
            "category": "action",
            "tags": ["cyberpunk", "action", "sci-fi"],
            "stepsCount": 6,
            "data": {
                "title": "赛博朋克：霓虹雨夜追逐",
                "desc": "以未来赛博朋克都市为背景的动作分镜",
                "steps": [
                    {
                        "name": "第一幕：雨夜天台",
                        "prompt": "A cinematic wide shot of {character}, {style}, standing on the edge of a rainy cyberpunk skyscraper rooftop, neon lights reflecting on wet concrete, wearing {outfit}, fog and flying cars in background",
                        "caption": "雨水打湿了霓虹灯的倒影，{character} 站在摩天大楼的边缘，俯瞰这座不夜城。",
                    },
                    {
                        "name": "第二幕：锁定目标",
                        "prompt": "Close-up shot of {character}, {style}, eye glowing with cybernetic optical interface displaying target HUD, intense expression, dynamic dramatic lighting",
                        "caption": "义眼微光闪烁，目标数据在视网膜上迅速流转——猎物出现了。",
                    },
                    {
                        "name": "第三幕：飞跃深渊",
                        "prompt": "Dynamic mid-air action shot of {character}, {style}, leaping across the gap between two towering skyscrapers, coat billowing, sparks flying, high adrenaline",
                        "caption": "没有任何迟疑，{character} 纵身跃入数百米高空的虚空之中。",
                    },
                    {
                        "name": "第四幕：暗巷突袭",
                        "prompt": "Low angle combat scene, {character}, {style}, landing in a steam-filled narrow alleyway, drawn energy weapon reflecting glowing signs, ready to strike",
                        "caption": "轻盈落地，蒸汽在管道周围嘶嘶作响，枪口已对准了黑暗深处。",
                    },
                    {
                        "name": "第五幕：全息交火",
                        "prompt": "Intense firefight scene, {character}, {style}, sliding behind cover while laser blasts shatter holographic billboards, neon debris flying everywhere",
                        "caption": "全息广告牌在激光的扫射下崩碎成漫天光屑，交火瞬间白热化。",
                    },
                    {
                        "name": "第六幕：收枪回眸",
                        "prompt": "Medium shot of {character}, {style}, holstering the glowing weapon, turning away as distant sirens approach, calm expression, rain droplets on face",
                        "caption": "警笛声自远处呼啸而来，{character} 悄然隐入夜色，只留下雨中的一抹残影。",
                    },
                ],
            },
        },
        {
            "id": "tpl_manga_4koma_battle",
            "title": "热血决斗：四格高燃反转 (4幕)",
            "author": "MangaStudio",
            "desc": "经典日漫四格热血分镜，起承转合鲜明，适合做战斗对决、必杀技释放与反转桥段。",
            "category": "manga",
            "tags": ["manga", "4koma", "battle"],
            "stepsCount": 4,
            "data": {
                "title": "热血决斗：四格高燃反转",
                "desc": "经典日漫四格热血分镜",
                "steps": [
                    {
                        "name": "起：对峙拔刀",
                        "prompt": "Manga style dramatic face-off, {character}, {style}, hand on sword hilt, wind blowing dust across battlefield, extreme tension, high contrast ink lines",
                        "caption": "狂风卷过荒原，{character} 的手按在刀柄上，空气仿佛在这一刻凝固。",
                    },
                    {
                        "name": "承：瞬身斩击",
                        "prompt": "Extreme speed dynamic slash, {character}, {style}, rushing forward with afterimages, sword drawing lightning arc, dynamic foreshortening",
                        "caption": "脚步踏碎大地的刹那，雷霆般的残影已撕裂了十步的距离！",
                    },
                    {
                        "name": "转：意料之外的招架",
                        "prompt": "Shocked expression close-up of {character}, {style}, eyes wide, sword blocked by unexpected obstacle, dynamic manga speedlines",
                        "caption": "然而，刀刃却在距离目标一寸处骤然停滞——这不可能！",
                    },
                    {
                        "name": "合：帅气收招",
                        "prompt": "Masterful pose of {character}, {style}, smirking with sword half-sheathed, clicked into scabbard, wind settling, epic victory silhouette",
                        "caption": "“结束了。”随着刀谭归鞘的清脆声响，胜负已分。",
                    },
                ],
            },
        },
        {
            "id": "tpl_fashion_lookbook",
            "title": "高级定制：时尚穿搭 Lookbook (6幕)",
            "author": "StyleLab",
            "desc": "专为角色换装与摄影画册设计的 6 幕 Lookbook 模板，包含全身、七分身、饰品微距与情绪大片。",
            "category": "lookbook",
            "tags": ["fashion", "lookbook", "photography"],
            "stepsCount": 6,
            "data": {
                "title": "高级定制：时尚穿搭 Lookbook",
                "desc": "专为角色换装与摄影画册设计",
                "steps": [
                    {
                        "name": "Look 1：全身廓形",
                        "prompt": "Full body fashion editorial photography of {character}, {style}, wearing {outfit}, minimalist studio background, elegant silhouette, natural softbox lighting",
                        "caption": "经典廓形与面料垂坠感的极致表达，展现从容干练的现代姿态。",
                    },
                    {
                        "name": "Look 2：回眸半身",
                        "prompt": "Three-quarter portrait of {character}, {style}, looking back over shoulder, wearing {outfit}, Vogue magazine style, subtle film grain",
                        "caption": "不经意的侧颜回眸，捕捉光影与衣领线条的微妙呼应。",
                    },
                    {
                        "name": "Look 3：妆造特写",
                        "prompt": "Extreme close-up beauty shot of {character}, {style}, focus on delicate facial features and jewelry accessories, flawless skin texture, catchlight in eyes",
                        "caption": "精细至极的细节雕琢，微光流转于眉眼与配饰之间。",
                    },
                    {
                        "name": "Look 4：动态随行",
                        "prompt": "Walking street style shot of {character}, {style}, in motion, hair and fabric swaying gracefully, city architecture background, candid natural lighting",
                        "caption": "步履间的灵动生机，行走在城市光影交织的街道。",
                    },
                    {
                        "name": "Look 5：坐姿情绪",
                        "prompt": "Moody seated pose of {character}, {style}, resting chin in hand on modern designer chair, thoughtful gaze, high fashion editorial composition",
                        "caption": "静谧的片刻凝视，在克制中流淌出高级的艺术氛围。",
                    },
                    {
                        "name": "Look 6：光影谢幕",
                        "prompt": "Golden hour cinematic shot of {character}, {style}, backlit by warm sunset rays, rim lighting on hair and outfit, poetic farewell",
                        "caption": "余晖倾洒的谢幕瞬间，定格关于风格与美的永恒印象。",
                    },
                ],
            },
        },
    ],
    "exportPresets": [
        {
            "id": "webtoon",
            "name": "沉浸条漫 (Webtoon)",
            "author": "ComfyComic Official",
            "badge": "移动端优先",
            "desc": "垂直无限流长条漫，自适应手机与桌面端，带有阅读进度、平滑间距与悬浮半透明旁白对白层。",
        },
        {
            "id": "manga_grid",
            "name": "经典日漫分镜 (Manga Grid)",
            "author": "ComfyComic Official",
            "badge": "分镜版式",
            "desc": "经典漫画多格交错布局，模拟黑白/彩色实体漫画书的分格张力，配合复古网点框与漫画对白标签。",
        },
        {
            "id": "artbook_lookbook",
            "name": "典雅画集 (Artbook Lookbook)",
            "author": "ComfyComic Official",
            "badge": "艺术画册",
            "desc": "高端时尚画册与摄影集风格，大比例留白、极简排版、色块底纹，并附带提示词参数水印。",
        },
        {
            "id": "flipbook_3d",
            "name": "拟真 3D 翻页书 (3D Flipbook)",
            "author": "ComfyComic Official",
            "badge": "沉浸拟物",
            "desc": "纯前端 CSS3 3D 拟真翻页书，支持键盘左右键及点击翻页，带书脊阴影、翻页转动弧度与封面封底。",
        },
    ],
}


def get_marketplace_catalog():
    if os.path.exists(MARKETPLACE_FILE):
        try:
            cached = read_json_file(MARKETPLACE_FILE, {})
            if isinstance(cached, dict) and cached.get("storyboards"):
                return cached
        except Exception:
            pass
    return DEFAULT_MARKETPLACE_CATALOG


def fetch_remote_json(url, max_bytes=5 * 1024 * 1024):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("仅支持 HTTP/HTTPS 协议的网络链接")
    req = urllib.request.Request(url, headers={"User-Agent": "ComfyComicStudio/2.3"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        content = resp.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise PayloadTooLargeError("远程模板大小超出 5MB 限制")
        return json.loads(content.decode("utf-8-sig"))


# Provider transport: same-origin browser requests, no SDK dependency.
def list_provider_models(payload):
    config = payload.get("config") or {}
    provider, base = mio_credentials.endpoint(config)
    if provider != "openai":
        raise ValueError(
            "Model discovery is available for OpenAI-compatible channels only"
        )
    key = mio_credentials.resolve(DATA_DIR, payload)
    headers = {"Accept": "application/json", "User-Agent": "Mio/1.0"}
    if key:
        headers["Authorization"] = "Bearer " + key

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    try:
        with urllib.request.build_opener(NoRedirect).open(
            urllib.request.Request(base + "/models", headers=headers), timeout=25
        ) as response:
            raw = read_limited_response(response, 5 * 1024 * 1024)
        data = json.loads(raw)
        items = (
            data.get("data", data.get("models", [])) if isinstance(data, dict) else []
        )
        if not isinstance(items, list):
            raise ValueError()
        ids = sorted(
            set(
                item.get("id") if isinstance(item, dict) else item
                for item in items
                if isinstance(item.get("id") if isinstance(item, dict) else item, str)
                and 0 < len(item.get("id") if isinstance(item, dict) else item) <= 500
            )
        )[:2000]
        if not ids:
            raise ValueError()
        return {"models": ids}
    except urllib.error.HTTPError as exc:
        raise ValueError(
            "Models API HTTP "
            + str(exc.code)
            + "; check endpoint/authentication or enter the model ID manually"
        ) from None
    except Exception:
        raise ValueError(
            "Could not read a supported model list; manual model IDs remain available"
        ) from None


class ProviderHTTPError(Exception):
    """Keep the upstream status and response; redact only the request credential."""

    def __init__(self, status, body, key="", headers=None):
        self.headers = dict(headers or {})
        from backend.providers.reliability import retry_delay

        self.retry_after = retry_delay(self.headers)
        self.status = status
        self.body = body
        if key:
            for secret in (
                key.encode(),
                json.dumps(key)[1:-1].encode(),
                urllib.parse.quote(key, safe="").encode(),
            ):
                self.body = self.body.replace(secret, b"[REDACTED]")
        super().__init__(
            "HTTP " + str(status) + ": " + self.body.decode("utf-8", errors="replace")
        )


def provider_image_input(value):
    if not isinstance(value, str):
        raise ValueError(
            "Each image input must be a local /images/ reference or image data URL"
        )
    if value.startswith("/images/"):
        value = image_url_to_data_url(value)
    if not re.fullmatch(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+", value):
        raise ValueError("Image inputs require PNG, JPEG or WebP")
    normalized = data_url_to_base64_data_url(value)
    raw = base64.b64decode(normalized.split(",", 1)[1], validate=True)
    if detect_image_mime_type(raw) not in ("image/png", "image/jpeg", "image/webp"):
        raise ValueError("Reference bytes must be PNG, JPEG or WebP")
    return normalized, raw


def generate_provider_image(payload):
    from backend.providers import generate

    return generate(payload, application_services())


def handle_vision_audit(payload):
    from backend import mio_proxy

    return mio_proxy.handle_vision_audit(payload, application_services())


def read_json_file(path, default=None):
    if default is None:
        default = {}
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
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
        with open(path, "r", encoding="utf-8") as existing:
            if existing.read() == serialized:
                return False
    except (OSError, ValueError):
        pass

    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(serialized)
    os.replace(tmp_path, path)
    return True


def normalize_merged_config(data):
    if not isinstance(data, dict):
        return {}

    comfy_config = (
        data.get("comfyConfig") if isinstance(data.get("comfyConfig"), dict) else {}
    )
    if comfy_config:
        data.setdefault("nodePositive", comfy_config.get("nodePositive", "6"))
        data.setdefault("nodeNegative", comfy_config.get("nodeNegative", ""))
        data.setdefault("nodeOutput", comfy_config.get("nodeOutput", "9"))

    xml_config = (
        data.get("xmlConfig") if isinstance(data.get("xmlConfig"), dict) else {}
    )
    if xml_config:
        data.setdefault("xmlSystemPrompt", xml_config.get("systemPrompt", ""))

    return data


def manage_native_credentials(payload):
    with native_store().library.writer():
        return mio_credentials.manage(DATA_DIR, payload)


def chat_proxy(payload):
    from backend import mio_proxy

    return mio_proxy.chat_proxy(payload, application_services())


def read_merged_config_raw():
    with CONFIG_LOCK:
        value = native_store().read()
        return mio_pictures.project(
            mio_lifecycle.filter_deleted(value, DATA_DIR), DATA_DIR
        )


def read_merged_config():
    return mio_foundation.project_execution(
        application_services(), read_merged_config_raw()
    )


def split_config_payload(data):
    ui_config = copy.deepcopy(data.get("uiConfig", {}))
    meta = ui_config.get("comfyStudio", {})
    projects = meta.pop("projects", [])
    creation = meta.pop("creation", {})
    plans = creation.pop("plans", [])
    presets = creation.pop("variableSets", [])
    comfy_config = (
        data.get("comfyConfig") if isinstance(data.get("comfyConfig"), dict) else {}
    )
    comfy_config = {
        **comfy_config,
        "baseUrl": data.get(
            "comfyUrl", comfy_config.get("baseUrl", "http://127.0.0.1:8188")
        ),
        "isMockMode": data.get("isMockMode", comfy_config.get("isMockMode", False)),
        "nodePositive": data.get("nodePositive", comfy_config.get("nodePositive", "6")),
        "nodeNegative": data.get("nodeNegative", comfy_config.get("nodeNegative", "")),
        "nodeOutput": data.get("nodeOutput", comfy_config.get("nodeOutput", "9")),
    }

    xml_config = (
        data.get("xmlConfig") if isinstance(data.get("xmlConfig"), dict) else {}
    )
    if "xmlSystemPrompt" in data:
        xml_config = {**xml_config, "systemPrompt": data.get("xmlSystemPrompt", "")}

    return {
        "content": {
            "templates": data.get("templates", []),
            "activeTemplateId": data.get("activeTemplateId"),
        },
        "matrix": {"batchMatrix": data.get("batchMatrix", {})},
        "galleries": {"savedGalleries": data.get("savedGalleries", [])},
        "workflows": {
            "comfyWorkflows": data.get("comfyWorkflows", []),
            "activeWorkflowId": data.get("activeWorkflowId"),
        },
        "queue": {"batchRunState": data.get("batchRunState", {})},
        "projects": {
            "_studioProjects": projects,
            "_hasStudioMetadata": "comfyStudio" in ui_config,
        },
        "plans": {"_studioPlans": plans, "_studioCreation": creation},
        "presets": {"_studioPresets": presets},
        "comfy": {
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
            "uiConfig": ui_config,
            "updatedAt": data.get("updatedAt"),
        },
    }


def transaction_path():
    root = os.path.commonpath([os.path.dirname(path) for path in CONFIG_FILES.values()])
    return os.path.join(root, ".config-transaction.json")


def recover_config_transaction():
    journal = transaction_path()
    if not os.path.exists(journal):
        return
    payloads = read_json_file(journal, {})
    if set(payloads) != set(CONFIG_FILES):
        raise ConfigReadError(
            "Invalid config transaction; keep files and restore a backup."
        )
    for key, payload in payloads.items():
        write_json_file(CONFIG_FILES[key], payload)
    os.remove(journal)


def write_split_config(data):
    with CONFIG_LOCK:
        return native_store().write(
            mio_pictures.project(
                mio_lifecycle.filter_deleted(copy.deepcopy(data), DATA_DIR), DATA_DIR
            )
        )


def store_image_bytes(raw, album_id="unassigned"):
    from backend.mio_media import MediaStore

    return MediaStore(DATA_DIR).put(raw)["url"]


def store_image_stream(stream):
    from backend.mio_media import MediaStore

    return MediaStore(DATA_DIR).ingest(stream)


def store_image_data(data_url, album_id="unassigned"):
    return native_store().upload(data_url)


from backend.mio_services import ApplicationServices, HTTPServices
from backend.mio_http import HTTPRoutes


def application_services():
    return ApplicationServices(
        image_url_to_data_url=image_url_to_data_url,
        PayloadTooLargeError=PayloadTooLargeError,
        BASE_DIR=BASE_DIR,
        CONFIG_LOCK=CONFIG_LOCK,
        DATA_DIR=DATA_DIR,
        IMAGES_DIR=IMAGES_DIR,
        MAX_IMAGE_BYTES=MAX_IMAGE_BYTES,
        ProviderHTTPError=ProviderHTTPError,
        chat_proxy=chat_proxy,
        detect_image_mime_type=detect_image_mime_type,
        fetch_remote_image=fetch_remote_image,
        generate_provider_image=generate_provider_image,
        local_path_from_url=local_path_from_url,
        mio_foundation=mio_foundation,
        native_store=native_store,
        provider_image_input=provider_image_input,
        read_limited_response=read_limited_response,
        read_merged_config=read_merged_config,
        read_merged_config_raw=read_merged_config_raw,
        store_image_bytes=store_image_bytes,
        store_image_data=store_image_data,
        store_image_stream=store_image_stream,
        validate_config_payload=validate_config_payload,
        write_json_file=write_json_file,
        write_split_config=write_split_config,
    )


def http_services():
    return HTTPServices(
        ALLOWED_ORIGINS=ALLOWED_ORIGINS,
        BASE_DIR=BASE_DIR,
        CONFIG_LOCK=CONFIG_LOCK,
        DATA_DIR=DATA_DIR,
        LibraryError=LibraryError,
        MAX_IMAGE_BYTES=MAX_IMAGE_BYTES,
        MAX_JSON_BODY_BYTES=MAX_JSON_BODY_BYTES,
        PayloadTooLargeError=PayloadTooLargeError,
        ProviderHTTPError=ProviderHTTPError,
        application=application_services(),
        bytes_to_data_url=bytes_to_data_url,
        chat_proxy=chat_proxy,
        content_store=content_store,
        fetch_remote_image=fetch_remote_image,
        fetch_remote_json=fetch_remote_json,
        generate_provider_image=generate_provider_image,
        get_marketplace_catalog=get_marketplace_catalog,
        handle_vision_audit=handle_vision_audit,
        image_url_to_data_url=image_url_to_data_url,
        is_public_static_path=is_public_static_path,
        list_provider_models=list_provider_models,
        manage_native_credentials=manage_native_credentials,
        native_store=native_store,
        read_merged_config=read_merged_config,
        store_image_bytes=store_image_bytes,
        store_image_data=store_image_data,
    )


class ComicRequestHandler(HTTPRoutes):
    make_services = staticmethod(http_services)


def main():
    try:
        from PIL import Image

        major, minor = map(int, Image.__version__.split(".")[:2])
        if (major, minor) < (11, 3) or major >= 13:
            raise ImportError("Pillow version")
    except ImportError:
        print(
            "缩略图与 PDF 需要 Pillow 11.3–12.x。请运行 python -m pip install -r packaging/requirements.txt 后重新启动。",
            flush=True,
        )
        raise SystemExit(1)
    # Change working dir to server.py directory
    os.chdir(BASE_DIR)
    try:
        native_store().wait_index()
        ecosystem_api.service(application_services())
        mio_foundation.jobs(application_services())
        server = ThreadingHTTPServer(
            (
                os.environ.get(
                    "MIO_HOST", os.environ.get("COMFY_COMIC_HOST", "127.0.0.1")
                ),
                PORT,
            ),
            ComicRequestHandler,
        )
    except (LibraryError, OSError) as error:
        print("启动已停止，未使用默认数据覆盖现有文件：" + str(error), flush=True)
        print(
            "旧格式请先离线转换到新目录；用 MIO_DATA_DIR 指向转换结果。参阅 docs/guide/FILE_LIBRARY.html。",
            flush=True,
        )
        raise SystemExit(2)
    print("=========================================================")
    print(" Mio 独立文件服务已成功启动！")
    print(f" 网页访问地址: http://127.0.0.1:{PORT}/index.html")
    print(" 物理落盘配置目录: " + DATA_DIR)
    print("=========================================================", flush=True)
    try:
        import webbrowser
        import time

        def _open_browser():
            time.sleep(0.3)
            webbrowser.open(f"http://127.0.0.1:{PORT}/index.html")

        threading.Thread(target=_open_browser, daemon=True).start()
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        ecosystem_api.service(application_services()).close()
        server.server_close()


if __name__ == "__main__":
    main()
