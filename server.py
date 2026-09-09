import os
import sys
import re
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
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
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

MARKETPLACE_FILE = os.path.join(DATA_DIR, "marketplace_cache.json")

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

                self.send_json(200, {"ok": True, "status": "success", "files": written})
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
    print(f" ComfyComic Studio 本地服务已成功启动！")
    print(f" 网页访问地址: http://127.0.0.1:{PORT}/index.html")
    print(f" 物理落盘配置目录: data/")
    print(f"=========================================================")
    server = ThreadingHTTPServer(('127.0.0.1', PORT), ComicRequestHandler)
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
