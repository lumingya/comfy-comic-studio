"""External vision and chat proxies with explicit application dependencies."""

import json
import re
import urllib.request
import urllib.parse


def handle_vision_audit(payload, services):
    base_url = (payload.get("baseUrl") or "").strip().rstrip("/")
    if not base_url:
        raise ValueError("未配置视觉模型 API 地址")

    api_key = (payload.get("apiKey") or "").strip()
    model = (payload.get("model") or "").strip() or "gpt-4o"
    prompt_text = (
        payload.get("promptText") or "请审查该漫画分镜的画质、一致性与肢体结构"
    )
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
        '  "score": 8.5,'
        '  "passed": true,'
        '  "summary": "一句话综合评审意见",'
        '  "consistency": "角色特征一致性评价",'
        '  "anatomy": "手部、面部与肢体解剖结构检查",'
        '  "scene": "镜头景别与故事氛围符合度",'
        '  "suggestions": "针对该画面的重绘或局部修补建议"'
        "}"
    )

    request_body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_instruction},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        "temperature": 0.2,
        "max_tokens": 1200,
    }

    req_data = json.dumps(request_body).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": "ComfyComicStudio/2.3"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(
        endpoint, data=req_data, headers=headers, method="POST"
    )
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
            code_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", content)
            if code_match:
                json_str = code_match.group(1)
            else:
                match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", content)
                if not match:
                    match = re.search(r"\{[\s\S]*\}", content)
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
                "suggestions": "请检查大模型返回内容及提示词设置",
            }
        return critique


def chat_proxy(payload, services):
    scope = payload.get("scope", "llm")
    store = services.native_store()
    if scope in ("llm", "xml"):
        cfg = store.settings.resolve(scope)
    elif scope == "critic":
        cfg = (
            store.settings.resolve("workspace")
            .get("ui", {})
            .get("comfyStudio", {})
            .get("settings", {})
            .get("critic", {})
        )
    else:
        raise ValueError("Unknown saved connection scope")
    base = str(payload.get("baseUrl", "")).rstrip("/")
    if base != str(cfg.get("baseUrl", "")).rstrip("/"):
        raise ValueError(
            "The endpoint differs from the saved connection. Save or reload it before sending."
        )
    parsed = urllib.parse.urlsplit(base)
    if (
        parsed.scheme not in ("https", "http")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid model endpoint")
    if parsed.scheme == "http" and parsed.hostname not in (
        "localhost",
        "127.0.0.1",
        "::1",
    ):
        raise ValueError("Remote model endpoints require HTTPS")
    key = payload.get("key") or cfg.get("key", "")
    if "\r" in key or "\n" in key:
        raise ValueError("Invalid credential")
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    body = payload.get("body")
    if not isinstance(body, dict) or not isinstance(body.get("messages"), list):
        raise ValueError("Messages must be a list")
    endpoint = (
        base if base.endswith("/chat/completions") else base + "/chat/completions"
    )

    # No redirects with Authorization, no automatic retry after uncertain billing.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    request = urllib.request.Request(
        endpoint, data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    with urllib.request.build_opener(NoRedirect).open(request, timeout=180) as response:
        raw = response.read(12 * 1024 * 1024 + 1)
        if len(raw) > 12 * 1024 * 1024:
            raise ValueError("Model response exceeds size limit")
        return json.loads(raw)
