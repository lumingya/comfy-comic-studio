"""Provider failure classification and bounded, Retry-After-aware backoff."""

from email.utils import parsedate_to_datetime
import random
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


def failure_summary(text):
    lower = str(text).lower()
    if any(x in lower for x in ("out of memory", "outofmemory", "cuda error: memory")):
        return "GPU 显存不足：请减小分辨率或批量数，或释放显存后重试。"
    if any(
        x in lower for x in ("does not exist", "not found", "value_not_in_list")
    ) and any(x in lower for x in ("model", "checkpoint", "ckpt", "lora")):
        return "缺少模型文件：请检查工作流中的模型、Checkpoint 或 LoRA 是否已安装。"
    if any(
        x in lower
        for x in ("invalid_prompt", "class_type", "node_missing", "node type")
    ):
        return "工作流节点缺失或不兼容：请安装所需节点，并重新检查工作流。"
    if "stopped locally" in lower:
        return "已停止本地处理；请查看上游取消回执，已有结果不会被迟到响应覆盖。"
    if "http 401" in lower or "invalid_api_key" in lower:
        return "服务拒绝了密钥：请检查 API 密钥是否有效、过期或绑定了错误的服务。"
    if "http 403" in lower:
        return "服务拒绝访问：请检查模型权限、账户授权及服务地区限制。"
    if "429" in lower:
        return "服务暂时限流：正在按服务端要求等待，未计入连续故障熔断。"
    return str(text)[:500]


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
