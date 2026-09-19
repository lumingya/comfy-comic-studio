"""Provider failure classification and bounded, Retry-After-aware backoff."""

from email.utils import parsedate_to_datetime
import random
import re
import time


def retry_delay(headers=None, attempt=1, base=2):
    value = (headers or {}).get("Retry-After")
    if value is not None:
        try:
            return max(0, min(3600, float(value)))
        except (TypeError, ValueError):
            try:
                return max(
                    0, min(3600, parsedate_to_datetime(value).timestamp() - time.time())
                )
            except (TypeError, ValueError, OverflowError):
                pass
    return min(300, base * 2 ** min(max(attempt - 1, 0), 8)) + random.uniform(0, 0.5)


def _has_status(lower, code):
    """Match an HTTP status without tripping on seeds, prompt ids or byte counts."""
    code = str(code)
    stripped = lower.strip()
    return bool(
        re.search(r"(?:http|status|code|error)\W{0,4}" + code + r"(?!\d)", lower)
    ) or stripped.startswith(code + " ") or stripped.startswith(code + ":")


def failure_summary(text, terminal=False):
    """Map raw provider errors to actionable Chinese guidance.

    ``terminal`` means retries are exhausted and the page has stopped, so the
    summary must not claim that the system is still waiting.
    """
    raw = str(text)
    lower = raw.lower()
    if any(x in lower for x in ("out of memory", "outofmemory", "cuda error: memory")):
        return "GPU 显存不足：请减小分辨率或批量数，或释放显存后重试。"
    if any(
        x in lower
        for x in ("invalid_prompt", "class_type", "node_missing", "node type")
    ):
        return "工作流节点缺失或不兼容：请安装所需节点，并重新检查工作流。"
    if _has_status(lower, 404):
        return "模型或接口地址不存在（HTTP 404）：请核对模型 ID 是否可用、基础地址是否正确（通常到 /v1）。"
    if any(
        x in lower for x in ("does not exist", "not found", "value_not_in_list")
    ) and any(x in lower for x in ("model", "checkpoint", "ckpt", "lora")):
        return "缺少模型文件：请检查工作流中的模型、Checkpoint 或 LoRA 是否已安装。"
    if "stopped locally" in lower:
        return "已停止本地处理；请查看上游取消回执，已有结果不会被迟到响应覆盖。"
    if any(
        x in lower
        for x in (
            "moderation_blocked",
            "content_policy_violation",
            "content_policy",
            "safety_violations",
            "safety system",
            "rejected by the safety",
            "prohibited_content",
            "blocked by content",
            "responsible ai",
            "image_generation_user_error",
        )
    ) or ("moderation" in lower and "block" in lower):
        return "触发内容安全审核：服务拒绝生成这一幕。请修改提示词后仅重跑本幕，其余分幕不受影响。"
    if _has_status(lower, 401) or "invalid_api_key" in lower or "incorrect api key" in lower:
        return "服务拒绝了密钥：请检查 API 密钥是否有效、过期或绑定了错误的服务。"
    if _has_status(lower, 402) or any(
        x in lower
        for x in ("insufficient_quota", "insufficient quota", "insufficient anlas", "not enough anlas", "payment required", "billing_hard_limit", "exceeded your current quota")
    ):
        return "余额或额度不足：请检查账户余额（NovelAI Anlas / API 额度）或计费设置后再继续。"
    if _has_status(lower, 403):
        return "服务拒绝访问：请检查模型权限、账户授权及服务地区限制。"
    if _has_status(lower, 429) or "rate limit" in lower or "too many requests" in lower or "rate_limit" in lower:
        if terminal:
            return "服务限流（HTTP 429）：已按服务端要求多次等待重试仍被拒绝，本幕已停止。请稍后重跑本幕，或降低并发。"
        return "服务暂时限流：正在按服务端要求等待，未计入连续故障熔断。"
    if _has_status(lower, 400) or _has_status(lower, 422):
        detail = _detail(raw)
        return "服务拒绝了请求参数（HTTP 400/422）：" + (detail or "请检查模型、尺寸、步数等参数是否符合该服务要求。")
    if any(_has_status(lower, code) for code in (500, 502, 503, 504)) or "bad gateway" in lower or "service unavailable" in lower:
        return "服务端暂时故障（HTTP 5xx）：上游服务或中转不可用，请稍后重跑本幕。"
    if "text-only responses are not successful generations" in lower or "returned no image" in lower:
        return "服务只返回了文字，没有图片：请确认所选模型支持图像生成；Chat 协议的图像模型需要 modalities 包含 image。"
    if "timed out" in lower or "timeout" in lower:
        return "等待结果超时：上游可能仍在处理或已完成。请先在服务端核对，再决定是否重跑；可在队列运行设置中调大超时。"
    return raw[:500]


def _detail(raw):
    """Pull the human-readable message out of a JSON error body when present."""
    import json

    body = raw.split(": ", 1)[1] if re.match(r"^HTTP \d{3}: ", raw) else raw
    try:
        value = json.loads(body)
    except (ValueError, TypeError):
        return body.strip()[:160]
    if isinstance(value, dict):
        error = value.get("error", value)
        if isinstance(error, dict):
            message = error.get("message") or error.get("msg") or error.get("detail")
        else:
            message = error if isinstance(error, str) else value.get("message") or value.get("detail")
        if isinstance(message, str):
            return message.strip()[:160]
    return ""


class ExecutionError(RuntimeError):
    """Known execution failure, rather than input validation or unknown submission."""


def result_unconfirmed(error, upstream=None):
    """Conservative transport classification; known execution rejection is final.

    A timeout/disconnect/truncated response cannot establish whether a paid
    submission was accepted. A saved upstream id is evidence of acceptance.
    HTTP rejections are handled separately, not treated as transport breaks.
    """
    from http.client import HTTPException
    from urllib.error import URLError, HTTPError
    if isinstance(error, InterruptedError):
        return True
    if isinstance(error, ExecutionError):
        return False
    if upstream:
        return True
    return (isinstance(error, (TimeoutError, ConnectionError, HTTPException))
            or isinstance(error, URLError) and not isinstance(error, HTTPError))


def fatal_page_failure(error):
    """True when the remaining pages of a book cannot succeed with the same setup.

    Credentials, billing, permissions, unreachable hosts and broken channel
    configuration affect every page; moderation, bad parameters, exhausted rate
    limits and transient 5xx are page-local, so the queue moves on to the next page.
    """
    from urllib.error import URLError, HTTPError
    try:
        from backend.mio_channels import ChannelConfigurationError
    except Exception:  # pragma: no cover - import cycle guard
        ChannelConfigurationError = ()
    if isinstance(error, ChannelConfigurationError):
        return True
    status = getattr(error, "status", None)
    if status in (401, 402, 403):
        return True
    if isinstance(error, ConnectionError) or (
        isinstance(error, URLError) and not isinstance(error, HTTPError)
    ):
        return True
    if isinstance(error, OSError) and not isinstance(error, (URLError, TimeoutError)):
        # Disk or filesystem trouble while staging assets affects every page.
        return True
    lower = str(error).lower()
    if any(_has_status(lower, code) for code in (401, 402, 403)) or "invalid_api_key" in lower:
        return True
    return "画册已被删除" in lower
