import os
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
import mio_api
import mio_credentials
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
        print(f"[Config] Ignoring invalid COMFY_COMIC_PORT={raw!r}; falling back to {default}.", flush=True)
        return default
    if not (1 <= port <= 65535):
        print(f"[Config] COMFY_COMIC_PORT={port} is out of range; falling back to {default}.", flush=True)
        return default
    return port


PORT = _read_port_from_env()
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LEGACY_DATA_FILE = os.path.join(BASE_DIR, "comfy_comic_data.json")
DATA_DIR = os.path.join(BASE_DIR, "data")
LEGACY_CONFIG_FILES = {key: os.path.join(DATA_DIR, key + ".json") for key in
                       ("content", "comfy", "llm", "xml_template", "chat", "ui")}
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
IMAGES_DIR = os.path.join(DATA_DIR, "assets", "images")
MAX_JSON_BODY_BYTES = 10 * 1024 * 1024
MAX_IMAGE_BYTES = 50 * 1024 * 1024
CONFIG_LOCK = threading.RLock()
PUBLIC_FILES = {
    "/index.html",
    "/styles.css",
    "/favicon.svg",
    "/README.md", "/README.en.md", "/SECURITY.md", "/examples/mio_client.py",
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
ALLOWED_ORIGINS.update(filter(None, (x.strip() for x in os.environ.get("MIO_ORIGINS", os.environ.get("COMFY_COMIC_ORIGINS", "")).split(","))))
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(IMAGES_DIR, exist_ok=True)


class PayloadTooLargeError(ValueError):
    pass


class ConfigReadError(ValueError):
    pass


def _is_file_inside(candidate_path, root_dir):
    candidate = os.path.realpath(os.path.join(BASE_DIR, candidate_path.lstrip("/\\")))
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

    if decoded_path.startswith('/docs/'):
        return decoded_path.lower().endswith(('.md', '.html', '.json', '.png')) and _is_file_inside(decoded_path, os.path.join(BASE_DIR, 'docs'))

    for asset_dir in PUBLIC_ASSET_DIRS:
        if decoded_path.startswith(asset_dir):
            if not decoded_path.lower().endswith(PUBLIC_ASSET_SUFFIXES):
                return False
            return _is_file_inside(decoded_path, os.path.join(BASE_DIR, asset_dir.strip("/")))

    if not decoded_path.startswith("/images/"):
        return False
    relative = decoded_path[len("/images/"):]
    for root in (IMAGES_DIR, LEGACY_IMAGES_DIR):
        candidate = os.path.realpath(os.path.join(root, relative))
        if os.path.commonpath([candidate, os.path.realpath(root)]) == os.path.realpath(root) and os.path.isfile(candidate):
            return True
    return False


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
    roots = [os.path.realpath(os.path.abspath(root)) for root in (IMAGES_DIR, LEGACY_IMAGES_DIR)]
    try:
        is_allowed = any(os.path.commonpath([os.path.normcase(candidate), os.path.normcase(root)]) == os.path.normcase(root) for root in roots)
    except ValueError:
        is_allowed = False
    if not is_allowed:
        raise PermissionError("Local image paths must stay inside the images directory")
    if not os.path.isfile(candidate):
        raise FileNotFoundError("Local image file does not exist")
    return candidate

def local_path_from_url(raw_url):
    parsed = urllib.parse.urlparse(raw_url)
    if (not parsed.scheme or (parsed.hostname in ("localhost", "127.0.0.1") and parsed.port == PORT)) and parsed.path.startswith("/images/"):
        relative = urllib.parse.unquote(parsed.path)[len("/images/"):]
        for root in (IMAGES_DIR, LEGACY_IMAGES_DIR):
            try:
                return ensure_path_within_images(os.path.join(root, relative))
            except FileNotFoundError:
                continue
        raise FileNotFoundError("Local image file does not exist")
    if parsed.scheme == "file":
        path = urllib.parse.unquote(parsed.path)
        if os.name == "nt" and path.startswith("/") and len(path) > 3 and path[2] == ":":
            path = path[1:]
        return ensure_path_within_images(path)
    if parsed.scheme in ("http", "https"):
        host = (parsed.hostname or "").lower()
        if host in ("127.0.0.1", "localhost") and parsed.port == PORT:
            local_rel_path = urllib.parse.unquote(parsed.path).lstrip("/\\")
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
                        "caption": "雨水打湿了霓虹灯的倒影，{character} 站在摩天大楼的边缘，俯瞰这座不夜城。"
                    },
                    {
                        "name": "第二幕：锁定目标",
                        "prompt": "Close-up shot of {character}, {style}, eye glowing with cybernetic optical interface displaying target HUD, intense expression, dynamic dramatic lighting",
                        "caption": "义眼微光闪烁，目标数据在视网膜上迅速流转——猎物出现了。"
                    },
                    {
                        "name": "第三幕：飞跃深渊",
                        "prompt": "Dynamic mid-air action shot of {character}, {style}, leaping across the gap between two towering skyscrapers, coat billowing, sparks flying, high adrenaline",
                        "caption": "没有任何迟疑，{character} 纵身跃入数百米高空的虚空之中。"
                    },
                    {
                        "name": "第四幕：暗巷突袭",
                        "prompt": "Low angle combat scene, {character}, {style}, landing in a steam-filled narrow alleyway, drawn energy weapon reflecting glowing signs, ready to strike",
                        "caption": "轻盈落地，蒸汽在管道周围嘶嘶作响，枪口已对准了黑暗深处。"
                    },
                    {
                        "name": "第五幕：全息交火",
                        "prompt": "Intense firefight scene, {character}, {style}, sliding behind cover while laser blasts shatter holographic billboards, neon debris flying everywhere",
                        "caption": "全息广告牌在激光的扫射下崩碎成漫天光屑，交火瞬间白热化。"
                    },
                    {
                        "name": "第六幕：收枪回眸",
                        "prompt": "Medium shot of {character}, {style}, holstering the glowing weapon, turning away as distant sirens approach, calm expression, rain droplets on face",
                        "caption": "警笛声自远处呼啸而来，{character} 悄然隐入夜色，只留下雨中的一抹残影。"
                    }
                ]
            }
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
                        "caption": "狂风卷过荒原，{character} 的手按在刀柄上，空气仿佛在这一刻凝固。"
                    },
                    {
                        "name": "承：瞬身斩击",
                        "prompt": "Extreme speed dynamic slash, {character}, {style}, rushing forward with afterimages, sword drawing lightning arc, dynamic foreshortening",
                        "caption": "脚步踏碎大地的刹那，雷霆般的残影已撕裂了十步的距离！"
                    },
                    {
                        "name": "转：意料之外的招架",
                        "prompt": "Shocked expression close-up of {character}, {style}, eyes wide, sword blocked by unexpected obstacle, dynamic manga speedlines",
                        "caption": "然而，刀刃却在距离目标一寸处骤然停滞——这不可能！"
                    },
                    {
                        "name": "合：帅气收招",
                        "prompt": "Masterful pose of {character}, {style}, smirking with sword half-sheathed, clicked into scabbard, wind settling, epic victory silhouette",
                        "caption": "“结束了。”随着刀谭归鞘的清脆声响，胜负已分。"
                    }
                ]
            }
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
                        "caption": "经典廓形与面料垂坠感的极致表达，展现从容干练的现代姿态。"
                    },
                    {
                        "name": "Look 2：回眸半身",
                        "prompt": "Three-quarter portrait of {character}, {style}, looking back over shoulder, wearing {outfit}, Vogue magazine style, subtle film grain",
                        "caption": "不经意的侧颜回眸，捕捉光影与衣领线条的微妙呼应。"
                    },
                    {
                        "name": "Look 3：妆造特写",
                        "prompt": "Extreme close-up beauty shot of {character}, {style}, focus on delicate facial features and jewelry accessories, flawless skin texture, catchlight in eyes",
                        "caption": "精细至极的细节雕琢，微光流转于眉眼与配饰之间。"
                    },
                    {
                        "name": "Look 4：动态随行",
                        "prompt": "Walking street style shot of {character}, {style}, in motion, hair and fabric swaying gracefully, city architecture background, candid natural lighting",
                        "caption": "步履间的灵动生机，行走在城市光影交织的街道。"
                    },
                    {
                        "name": "Look 5：坐姿情绪",
                        "prompt": "Moody seated pose of {character}, {style}, resting chin in hand on modern designer chair, thoughtful gaze, high fashion editorial composition",
                        "caption": "静谧的片刻凝视，在克制中流淌出高级的艺术氛围。"
                    },
                    {
                        "name": "Look 6：光影谢幕",
                        "prompt": "Golden hour cinematic shot of {character}, {style}, backlit by warm sunset rays, rim lighting on hair and outfit, poetic farewell",
                        "caption": "余晖倾洒的谢幕瞬间，定格关于风格与美的永恒印象。"
                    }
                ]
            }
        }
    ],
    "exportPresets": [
        {
            "id": "webtoon",
            "name": "沉浸条漫 (Webtoon)",
            "author": "ComfyComic Official",
            "badge": "移动端优先",
            "desc": "垂直无限流长条漫，自适应手机与桌面端，带有阅读进度、平滑间距与悬浮半透明旁白对白层。"
        },
        {
            "id": "manga_grid",
            "name": "经典日漫分镜 (Manga Grid)",
            "author": "ComfyComic Official",
            "badge": "分镜版式",
            "desc": "经典漫画多格交错布局，模拟黑白/彩色实体漫画书的分格张力，配合复古网点框与漫画对白标签。"
        },
        {
            "id": "artbook_lookbook",
            "name": "典雅画集 (Artbook Lookbook)",
            "author": "ComfyComic Official",
            "badge": "艺术画册",
            "desc": "高端时尚画册与摄影集风格，大比例留白、极简排版、色块底纹，并附带提示词参数水印。"
        },
        {
            "id": "flipbook_3d",
            "name": "拟真 3D 翻页书 (3D Flipbook)",
            "author": "ComfyComic Official",
            "badge": "沉浸拟物",
            "desc": "纯前端 CSS3 3D 拟真翻页书，支持键盘左右键及点击翻页，带书脊阴影、翻页转动弧度与封面封底。"
        }
    ]
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
    config = payload.get('config') or {}
    provider, base = mio_credentials.endpoint(config)
    if provider != 'openai':
        raise ValueError('Model discovery is available for OpenAI-compatible channels only')
    key = mio_credentials.resolve(DATA_DIR, payload)
    headers = {'Accept': 'application/json', 'User-Agent': 'Mio/1.0'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(base + '/models', headers=headers), timeout=25) as response:
            raw = read_limited_response(response, 5 * 1024 * 1024)
        data = json.loads(raw)
        items = data.get('data', data.get('models', [])) if isinstance(data, dict) else []
        if not isinstance(items, list):
            raise ValueError()
        ids = sorted(set(item.get('id') if isinstance(item, dict) else item for item in items
                         if isinstance(item.get('id') if isinstance(item, dict) else item, str)
                         and 0 < len(item.get('id') if isinstance(item, dict) else item) <= 500))[:2000]
        if not ids:
            raise ValueError()
        return {'models': ids}
    except urllib.error.HTTPError as exc:
        raise ValueError('Models API HTTP ' + str(exc.code) + '; check endpoint/authentication or enter the model ID manually') from None
    except Exception:
        raise ValueError('Could not read a supported model list; manual model IDs remain available') from None


def generate_provider_image(payload):
    import io
    import zipfile
    import secrets
    config = payload.get('config') or {}
    provider = config.get('provider')
    if provider not in ('novelai', 'openai'):
        raise ValueError('Unsupported image provider')
    _, base = mio_credentials.endpoint(config)
    key = mio_credentials.resolve(DATA_DIR, payload)
    model = str(config.get('model', '')).strip()
    prompt = str(payload.get('prompt', '')).strip()
    if not model or not prompt:
        raise ValueError('Model and prompt are required')
    source = payload.get('source')
    source_raw = None
    if source:
        if not isinstance(source, str) or not re.match(r'^data:image/(png|jpeg|webp);base64,', source):
            raise ValueError('Reference must be a PNG/JPEG/WebP data URL')
        source_raw = base64.b64decode(source.split(',', 1)[1], validate=True)
        if detect_image_mime_type(source_raw, '') not in ('image/png', 'image/jpeg', 'image/webp'):
            raise ValueError('Reference bytes must be PNG, JPEG or WebP')
    frame = payload.get('frame') or {}
    def number(name, default, low, high):
        value = float(frame.get(name, default))
        if not low <= value <= high:
            raise ValueError('Invalid parameter: ' + name)
        return value
    negative = str(payload.get('negative', ''))
    headers = {'Content-Type': 'application/json', 'User-Agent': 'Mio/1.0'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    if provider == 'novelai':
        width, height = int(number('width', 768, 64, 2048)), int(number('height', 1024, 64, 2048))
        if width % 64 or height % 64:
            raise ValueError('NovelAI width and height must be multiples of 64')
        seed = int(number('seed', -1, -1, 4294967295))
        params = {'params_version': 3, 'width': width, 'height': height, 'scale': number('cfg', 5, 0, 10),
                  'steps': int(number('steps', 28, 1, 50)), 'seed': seed if seed >= 0 else secrets.randbelow(4294967296),
                  'n_samples': 1, 'sampler': config.get('sampler', 'k_euler_ancestral'), 'noise_schedule': 'karras',
                  'negative_prompt': negative, 'ucPreset': 0, 'qualityToggle': False, 'sm': False, 'sm_dyn': False,
                  'dynamic_thresholding': False, 'controlnet_strength': 1, 'legacy': False, 'add_original_image': True}
        if 'diffusion-4' in model or 'diffusion-5' in model:
            params.update({'v4_prompt': {'caption': {'base_caption': prompt, 'char_captions': []}, 'use_coords': False, 'use_order': True},
                           'v4_negative_prompt': {'caption': {'base_caption': negative, 'char_captions': []}}, 'characterPrompts': []})
        if source_raw:
            params.update(image=base64.b64encode(source_raw).decode(), strength=number('denoise', .45, 0, 1), noise=0)
        body = {'input': prompt, 'model': model, 'action': 'img2img' if source_raw else 'generate', 'parameters': params}
        path = '/ai/generate-image'
    elif config.get('protocol') == 'chat':
        content = [{'type': 'text', 'text': prompt + ('\nAvoid: ' + negative if negative else '')}]
        if source:
            content.append({'type': 'image_url', 'image_url': {'url': source}})
        body = {'model': model, 'messages': [{'role': 'user', 'content': content}], 'stream': False}
        path = '/chat/completions'
    else:
        body = {'model': model, 'prompt': prompt + ('\nAvoid: ' + negative if negative else ''), 'n': 1}
        if config.get('sendSize', True) and config.get('size'):
            body['size'] = config['size']
        if config.get('sendQuality', True) and config.get('quality'):
            body['quality'] = config['quality']
        path = '/images/edits' if source_raw else '/images/generations'
    if provider == 'openai' and source_raw and config.get('protocol') != 'chat':
        boundary = 'ComicStudio' + uuid.uuid4().hex
        parts = []
        for name, value in body.items():
            parts.append(('----' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + str(value) + '\r\n').encode())
        mime = detect_image_mime_type(source_raw, '')
        ext = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[mime]
        parts.append(('----' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="reference.' + ext + '"\r\nContent-Type: ' + mime + '\r\n\r\n').encode() + source_raw + b'\r\n')
        parts.append(('----' + boundary + '--\r\n').encode())
        data = b''.join(parts)
        headers['Content-Type'] = 'multipart/form-data; boundary=--' + boundary
    else:
        data = json.dumps(body).encode()
    # Never forward Authorization to a redirect target or retry a paid generation.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(urllib.request.Request(base + path, data=data, headers=headers), timeout=300) as response:
            raw = read_limited_response(response)
    except urllib.error.HTTPError as exc:
        raise ValueError('Image provider HTTP ' + str(exc.code) + ' (check key, balance, model and parameters)') from None
    if provider == 'novelai':
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = [entry for entry in archive.infolist() if entry.filename.lower().endswith(('.png', '.jpg', '.webp'))]
            if not entries or entries[0].file_size > MAX_IMAGE_BYTES:
                raise ValueError('NovelAI returned no usable image or an oversized image')
            raw = archive.read(entries[0])
    else:
        result = json.loads(raw)
        item = (result.get('data') or [{}])[0]
        if config.get('protocol') == 'chat':
            message = ((result.get('choices') or [{}])[0].get('message') or {})
            images = message.get('images') or []
            content = message.get('content') or []
            if images:
                item = {'url': images[0].get('image_url', {}).get('url')}
            elif isinstance(content, list):
                item = next(({'url': c.get('image_url', {}).get('url')} for c in content if c.get('type') == 'image_url'), {})
            elif isinstance(content, str):
                match = re.search(r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+', content)
                item = {'url': match.group(0)} if match else {}
        if item.get('b64_json'):
            raw = base64.b64decode(item['b64_json'], validate=True)
        elif str(item.get('url', '')).startswith('data:image/'):
            raw = base64.b64decode(item['url'].split(',', 1)[1], validate=True)
        elif item.get('url'):
            raw, _ = fetch_remote_image(item['url'])
        else:
            raise ValueError('Provider returned no image; text-only responses are not successful generations')
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError('Generated image too large')
    mime = detect_image_mime_type(raw, '')
    if mime not in ('image/png', 'image/jpeg', 'image/webp'):
        raise ValueError('Provider must return PNG, JPEG or WebP, not active SVG or other content')
    data_url = 'data:' + mime + ';base64,' + base64.b64encode(raw).decode()
    return {'image': store_image_data(data_url, payload.get('albumId', 'unassigned')), 'offlineFallback': False, 'provider': provider}


def handle_vision_audit(payload):
    base_url = (payload.get("baseUrl") or "").strip().rstrip("/")
    if not base_url:
        raise ValueError("未配置视觉模型 API 地址")
    
    api_key = (payload.get("apiKey") or "").strip()
    model = (payload.get("model") or "").strip() or "gpt-4o"
    prompt_text = payload.get("promptText") or "请审查该漫画分镜的画质、一致性与肢体结构"
    image_data_url = payload.get("imageDataUrl") or ""

    if not image_data_url:
        raise ValueError("缺少待审查的图像数据")

    if not base_url.endswith("/chat/completions"):
        endpoint = f"{base_url}/chat/completions"
    else:
        endpoint = base_url

    system_instruction = (
        "你是一个专业的 AI 漫画分镜视觉审校专家（Visual Critic）。"
        "请对画面进行专业且严苛的视觉评估，重点检查：角色一致性（发色、服饰特征）、解剖与肢体结构（尤其手指、五官是否畸变崩坏）、分镜镜头与剧本匹配度。"
        "必须以纯 JSON 格式输出，不要包含任何 markdown 代码块或包裹文字，JSON 字段包括："
        "{"
        "  \"score\": 8.5,"
        "  \"passed\": true,"
        "  \"summary\": \"一句话综合评审意见\","
        "  \"consistency\": \"角色特征一致性评价\","
        "  \"anatomy\": \"手部、面部与肢体解剖结构检查\","
        "  \"scene\": \"镜头景别与故事氛围符合度\","
        "  \"suggestions\": \"针对该画面的重绘或局部修补建议\""
        "}"
    )

    request_body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": system_instruction
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt_text
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_data_url
                        }
                    }
                ]
            }
        ],
        "temperature": 0.2,
        "max_tokens": 1200
    }

    req_data = json.dumps(request_body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "ComfyComicStudio/2.3"
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(endpoint, data=req_data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        res_text = resp.read().decode("utf-8")
        data = json.loads(res_text)
        try:
            choices = data.get("choices") or []
            first_choice = choices[0] if choices else {}
            message = first_choice.get("message") or {}
            content = message.get("content") or ""
            if not isinstance(content, str):
                content = ""
            # 优先提取 ```json ... ``` 代码块，若无则尝试匹配最外层完整 JSON 对象，规避尾部花括号引发贪婪跨越
            code_match = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', content)
            if code_match:
                json_str = code_match.group(1)
            else:
                match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content)
                if not match:
                    match = re.search(r'\{[\s\S]*\}', content)
                json_str = match.group(0) if match else content.strip()
            critique = json.loads(json_str)
            if not isinstance(critique, dict):
                raise ValueError("Parsed JSON is not an object")
        except Exception:
            critique = {
                "score": 5.0,
                "passed": False,
                "summary": "模型未返回规范 JSON 审校结构，请人工复核",
                "consistency": "待人工复核",
                "anatomy": "待人工复核",
                "scene": "待人工复核",
                "suggestions": "请检查大模型返回内容及提示词设置"
            }
        return critique

def read_json_file(path, default=None):
    if default is None:
        default = {}
    if not os.path.exists(path):
        return default
    with open(path, 'r', encoding='utf-8-sig') as f:
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
        recover_config_transaction()
        if not any(os.path.exists(path) for path in CONFIG_FILES.values()) and any(os.path.exists(path) for path in LEGACY_CONFIG_FILES.values()):
            if not all(os.path.exists(path) for path in LEGACY_CONFIG_FILES.values()):
                raise ConfigReadError("Legacy configuration is incomplete; restore the missing files before migration.")
            legacy = {}
            for path in LEGACY_CONFIG_FILES.values():
                chunk = read_json_file(path, {})
                if not isinstance(chunk, dict):
                    raise ConfigReadError("Invalid legacy configuration: " + path)
                legacy.update(chunk)
            write_split_config(legacy)
            print("[Migration] Structured data layout created; legacy JSON files retained as backup.", flush=True)
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

    if not merged:
        return {**{key: kind() for key, kind in REQUIRED_CONFIG_FIELDS.items()}, "_emptyWorkspace": True}
    has_studio_metadata = merged.pop("_hasStudioMetadata", False)
    if "_studioProjects" in merged:
        meta = merged.setdefault("uiConfig", {}).setdefault("comfyStudio", {})
        meta["projects"] = merged.pop("_studioProjects")
        creation = merged.pop("_studioCreation", {})
        creation["plans"] = merged.pop("_studioPlans", [])
        creation["variableSets"] = merged.pop("_studioPresets", [])
        meta["creation"] = creation
        if not has_studio_metadata:
            merged["uiConfig"].pop("comfyStudio", None)
    return normalize_merged_config(merged)

def split_config_payload(data):
    ui_config = copy.deepcopy(data.get("uiConfig", {}))
    meta = ui_config.get("comfyStudio", {})
    projects = meta.pop("projects", [])
    creation = meta.pop("creation", {})
    plans = creation.pop("plans", [])
    presets = creation.pop("variableSets", [])
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
        },
        "matrix": {"batchMatrix": data.get("batchMatrix", {})},
        "galleries": {"savedGalleries": data.get("savedGalleries", [])},
        "workflows": {"comfyWorkflows": data.get("comfyWorkflows", []), "activeWorkflowId": data.get("activeWorkflowId")},
        "queue": {"batchRunState": data.get("batchRunState", {})},
        "projects": {"_studioProjects": projects, "_hasStudioMetadata": "comfyStudio" in ui_config},
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
        raise ConfigReadError("Invalid config transaction; keep files and restore a backup.")
    for key, payload in payloads.items():
        write_json_file(CONFIG_FILES[key], payload)
    os.remove(journal)


def write_split_config(data):
    payloads = split_config_payload(data)
    written = []
    with CONFIG_LOCK:
        recover_config_transaction()
        # Durable roll-forward journal: readers never observe half an API save,
        # including after an interrupted process or a disk write failure.
        write_json_file(transaction_path(), payloads)
        for key, payload in payloads.items():
            if write_json_file(CONFIG_FILES[key], payload):
                written.append(key)
        os.remove(transaction_path())
    return written

def store_image_data(data_url, album_id="unassigned"):
    if not isinstance(album_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,150}", album_id):
        raise ValueError("Invalid album ID")
    normalized = data_url_to_base64_data_url(data_url)
    raw = base64.b64decode(normalized.split(",", 1)[1], validate=True)
    mime = detect_image_mime_type(raw)
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}.get(mime)
    if not ext:
        raise ValueError("Only PNG, JPEG, WebP and GIF assets are accepted")
    relative = "albums/" + album_id + "/" + hashlib.sha256(raw).hexdigest() + ext
    destination = os.path.join(IMAGES_DIR, relative)
    with CONFIG_LOCK:
        if not os.path.exists(destination):
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            temporary = destination + ".tmp"
            try:
                with open(temporary, "wb") as handle:
                    handle.write(raw)
                os.replace(temporary, destination)
            finally:
                if os.path.exists(temporary):
                    os.remove(temporary)
    return "/images/" + relative


class ComicRequestHandler(SimpleHTTPRequestHandler):
    server_version = "Mio/1.0"

    def external_api(self):
        return mio_api.handle(self, sys.modules[__name__])

    def translate_path(self, path):
        request_path = urllib.parse.unquote(urllib.parse.urlparse(path).path)
        if request_path.startswith('/images/'):
            relative = request_path[len('/images/'):]
            for root in (IMAGES_DIR, LEGACY_IMAGES_DIR):
                candidate = os.path.realpath(os.path.join(root, relative))
                if os.path.commonpath([candidate, os.path.realpath(root)]) == os.path.realpath(root) and os.path.isfile(candidate):
                    return candidate
            return os.path.join(IMAGES_DIR, '__not_found__')
        return super().translate_path(path)

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

    def read_json_body(self, max_bytes=MAX_JSON_BODY_BYTES):
        content_type = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
        if content_type != 'application/json':
            raise ValueError('Content-Type must be application/json')
        raw_length = self.headers.get('Content-Length')
        if raw_length is None:
            raise ValueError('Missing Content-Length header')
        content_length = int(raw_length)
        if content_length < 0:
            raise ValueError('Invalid Content-Length header')
        if content_length > max_bytes:
            limit_mb = max_bytes // (1024 * 1024)
            raise PayloadTooLargeError(f'JSON request exceeds the {limit_mb} MB size limit')
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
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        request_path = urllib.parse.urlparse(self.path).path
        if request_path.startswith('/images/') or request_path.startswith('/vendor/'):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
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
        if not self.is_origin_allowed():
            self.send_json(403, {'error': 'Origin is not allowed'})
            return
        request_path = urllib.parse.urlparse(self.path).path
        if request_path == '/api/config':
            try:
                self.send_json(200, read_merged_config())
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if request_path == '/api/marketplace/index':
            try:
                self.send_json(200, get_marketplace_catalog())
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
        if self.path.startswith("/api/v1"):
            self.send_error(405, "Use GET")
            return
        request_path = urllib.parse.urlparse(self.path).path
        if request_path.startswith('/api/') or not is_public_static_path(request_path):
            self.send_error(404, "Not found")
            return
        if request_path == "/":
            self.path = "/index.html"
        super().do_HEAD()

    def do_POST(self):
        if self.external_api():
            return
        request_path = urllib.parse.urlparse(self.path).path
        if not self.is_origin_allowed():
            self.send_json(403, {"error": "Origin is not allowed"})
            return

        if request_path in ('/api/image/credentials', '/api/image/models'):
            if self.headers.get('Origin') == 'null':
                self.send_json(403, {'error': 'Open the local server URL to manage credentials'})
                return
            try:
                payload = self.read_json_body(max_bytes=65536)
                result = mio_credentials.manage(DATA_DIR, payload) if request_path.endswith('/credentials') else list_provider_models(payload)
                self.send_json(200, result)
            except PayloadTooLargeError:
                self.send_json(413, {'error': 'Request too large'})
            except ValueError as exc:
                self.send_json(400, {'error': str(exc)[:240]})
            except Exception:
                self.send_json(500, {'error': 'Local credential/model operation failed'})
            return

        if request_path == '/api/image/generate':
            try:
                self.send_json(200, generate_provider_image(self.read_json_body(max_bytes=MAX_IMAGE_BYTES * 4 // 3 + 65536)))
            except Exception as exc:
                self.send_json(400, {"error": str(exc)[:300]})
            return

        if request_path == '/api/config':
            try:
                data = validate_config_payload(self.read_json_body())
                
                # 安全红线拦截校验：防止客户端空缓存反向冲刷抹除已有配置与画册
                with CONFIG_LOCK:
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
                self.send_json(200, {"ok": True, "status": "success", "files": written})
            except PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                print(f"[POST Error] {e}", flush=True)
                self.send_json(400, {"error": str(e)})

        elif request_path == '/api/store-image':
            try:
                payload = self.read_json_body(max_bytes=MAX_IMAGE_BYTES * 4 // 3 + 4096)
                local_url = store_image_data(payload.get('dataUrl', ''), payload.get('albumId', 'unassigned'))
                self.send_json(200, {"ok": True, "localUrl": local_url})
            except PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except (ValueError, TypeError) as e:
                self.send_json(400, {"error": str(e)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})

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

                folder = datetime.now().strftime("%Y/%m/%d")
                filename = f"{folder}/comfy_{uuid.uuid4().hex}{ext}"
                dest_path = os.path.join(IMAGES_DIR, filename)
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                tmp_path = f"{dest_path}.tmp"

                try:
                    with open(tmp_path, 'wb') as out:
                        out.write(raw)
                    os.replace(tmp_path, dest_path)
                finally:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)

                local_url = f"/images/{filename}"
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
        elif request_path == '/api/marketplace/fetch-remote':
            try:
                payload = self.read_json_body()
                url = (payload.get('url') or '').strip()
                data = fetch_remote_json(url)
                self.send_json(200, {"status": "ok", "data": data})
            except PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                self.send_json(400, {"error": str(e)})
        elif request_path == '/api/vision/audit':
            try:
                # 视觉图片 Base64 审校放宽上限至 68MB（支持 50MB 原始图片膨胀）
                payload = self.read_json_body(max_bytes=MAX_IMAGE_BYTES * 4 // 3 + 2 * 1024 * 1024)
                critique = handle_vision_audit(payload)
                self.send_json(200, {"status": "ok", "critique": critique})
            except PayloadTooLargeError as e:
                self.send_json(413, {"error": str(e)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
        else:
            self.send_json(404, {"error": "Not found"})


if __name__ == '__main__':
    # Change working dir to server.py directory
    os.chdir(BASE_DIR)
    print(f"=========================================================")
    print(f" Mio 本地服务已成功启动！")
    print(f" 网页访问地址: http://127.0.0.1:{PORT}/index.html")
    print(f" 物理落盘配置目录: data/")
    print(f"=========================================================")
    server = ThreadingHTTPServer((os.environ.get('MIO_HOST', os.environ.get('COMFY_COMIC_HOST', '127.0.0.1')), PORT), ComicRequestHandler)
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
        server.server_close()
