"""Small JSON configuration with explicit credential names and bounded nesting."""

import json
import math
import re
from urllib.parse import parse_qsl, urlsplit

SECRET_OPTION_NAME = re.compile(
    r"(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|passwd|"
    r"credential|authorization|bearer|cookie|session[_-]?(?:key|id|token|secret)|"
    r"auth[_-]?(?:token|key|secret|header)|(?<![a-z0-9])auth(?![a-z0-9]))",
    re.I,
)


def secret_url(value: str) -> bool:
    value = value.lstrip("".join(chr(code) for code in range(33)))
    if value.startswith("//"):
        value = "https:" + value
    if not value.lower().startswith(("http:", "https:")):
        return False
    try:
        url = urlsplit(value)
        return bool(
            url.username
            or url.password
            or any(
                SECRET_OPTION_NAME.search(key) or key.lower() in {"key", "sig", "signature"}
                for key, _ in parse_qsl(url.query, keep_blank_values=True)
                + parse_qsl(url.fragment, keep_blank_values=True)
            )
        )
    except ValueError:
        return True


def json_value(value: object, *, reject_secret_urls: bool = False) -> bool:
    pending = [(value, 0, False)]
    seen = 0
    while pending:
        child, depth, secret = pending.pop()
        seen += 1
        if depth > 32 or seen > 8192:
            return False
        if type(child) is dict:
            if any(type(key) is not str for key in child):
                return False
            pending.extend(
                (item, depth + 1, secret or bool(SECRET_OPTION_NAME.search(key)))
                for key, item in child.items()
            )
        elif type(child) is list:
            pending.extend((item, depth + 1, secret) for item in child)
        elif type(child) is float:
            if not math.isfinite(child):
                return False
        elif type(child) is str:
            if reject_secret_urls and not secret and secret_url(child):
                return False
        elif child is not None and type(child) not in (bool, int):
            return False
    return True


def validate_options(value: object) -> dict:
    if not isinstance(value, dict) or not json_value(value, reject_secret_urls=True):
        raise ValueError(
            "options must be bounded JSON (maximum depth 32); use named credential fields "
            "instead of credentials embedded in URLs"
        )
    if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")) > 32 * 1024:
        raise ValueError("options is too large (maximum 32 KiB)")
    return value
