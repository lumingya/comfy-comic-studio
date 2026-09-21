"""Explicit, read-only ComfyUI probes: reachability check and /object_info catalog. Never generation."""
import json
import time
import urllib.parse
import urllib.request
import urllib.error

OBJECT_INFO_LIMIT = 64 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def comfy_base_url(payload):
    base = str(payload.get('baseUrl', '')).strip().rstrip('/')
    try:
        parsed = urllib.parse.urlsplit(base)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise ValueError()
        _ = parsed.port
    except ValueError:
        raise ValueError('填写有效的 ComfyUI HTTP(S) 基础地址；不要包含密钥或查询参数') from None
    return base


def comfy_object_info(payload, fetch=None):
    """Read ``GET /object_info`` through the backend and derive the installed model catalog.

    The browser never talks to ComfyUI directly (no CORS flags needed). The response carries the
    raw node definitions, which the workbench uses for field lists, plus a compact catalog of the
    checkpoints / diffusion models / LoRAs found in any node's enum inputs.
    """
    from backend.ecosystem.workflow_slots import catalog_from_object_info

    base = comfy_base_url(payload)
    try:
        if fetch is None:
            with urllib.request.build_opener(NoRedirect).open(
                    urllib.request.Request(base + '/object_info', headers={'Accept': 'application/json'}), timeout=20) as response:
                raw = response.read(OBJECT_INFO_LIMIT + 1)
        else:
            raw = fetch(base + '/object_info')
        if len(raw) > OBJECT_INFO_LIMIT:
            raise ValueError('节点定义响应超过 64 MiB 限制')
        data = json.loads(raw)
    except (urllib.error.URLError, OSError, TimeoutError):
        raise ValueError('无法读取 ComfyUI 节点定义；检查服务启动、端口与 Mio 后端到该地址的网络。不跟随重定向。') from None
    except (json.JSONDecodeError, UnicodeError):
        raise ValueError('地址未返回 ComfyUI 节点定义 JSON，请检查是否误填了其他网页地址') from None
    if not isinstance(data, dict) or not data or not all(isinstance(v, dict) for v in data.values()):
        raise ValueError('返回内容不是 ComfyUI 节点定义，请检查地址')
    catalog = catalog_from_object_info(data)
    return {'ok': True, 'objectInfo': data, 'catalog': catalog, 'nodeClasses': len(data), 'fetchedAt': int(time.time() * 1000),
            'models': catalog['checkpoints'] + catalog['unets'],
            'message': '已读取 %d 个节点定义：%d 个 Checkpoint、%d 个扩散模型、%d 个 LoRA。' % (
                len(data), len(catalog['checkpoints']), len(catalog['unets']), len(catalog['loras']))}


def check_comfy(payload):
    base = comfy_base_url(payload)
    try:
        import time
        started = time.monotonic()
        with urllib.request.build_opener(NoRedirect).open(
                urllib.request.Request(base + '/system_stats', headers={'Accept': 'application/json'}), timeout=5) as response:
            raw = response.read(256 * 1024 + 1)
        latency = round((time.monotonic() - started) * 1000)
        if len(raw) > 256 * 1024:
            raise ValueError('状态响应超过大小限制')
        data = json.loads(raw)
        if not isinstance(data, dict) or not (isinstance(data.get('system'), dict) or isinstance(data.get('devices'), list)):
            raise ValueError('返回内容不是 ComfyUI 状态，请检查地址')
        # The browser never talks to ComfyUI directly (no CORS flags needed);
        # surface the same latency / VRAM figures the shell used to compute.
        vram = None
        devices = data.get('devices') if isinstance(data.get('devices'), list) else []
        gpu = devices[0] if devices and isinstance(devices[0], dict) else None
        try:
            if gpu and gpu.get('vram_total'):
                vram = max(0, min(100, round((1 - float(gpu.get('vram_free', 0)) / float(gpu['vram_total'])) * 100)))
        except (TypeError, ValueError, ZeroDivisionError):
            vram = None
        return {'ok': True, 'message': '服务可读 · 只检查了连接，未生成图片；请继续核对工作流、节点和本机模型。',
                'latencyMs': latency, 'vramPercent': vram}
    except (urllib.error.URLError, OSError, TimeoutError):
        raise ValueError('无法读取 ComfyUI 状态；检查服务启动、端口与 Mio 后端到该地址的网络。不跟随重定向。') from None
    except (json.JSONDecodeError, UnicodeError):
        raise ValueError('地址未返回 ComfyUI JSON 状态，请检查是否误填了其他网页地址') from None
