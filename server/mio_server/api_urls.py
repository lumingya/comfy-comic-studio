"""Service base URL normalization shared by configuration and read-only discovery."""

from urllib.parse import urlsplit, urlunsplit


def normalize_base(value: str, *, openai: bool = True) -> str:
    """Normalize a pasted endpoint, retaining its gateway prefix and version path."""
    try:
        value = value.strip()
        if any(ord(char) < 32 for char in value):
            raise ValueError
        url = urlsplit(value)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.query
            or url.fragment
        ):
            raise ValueError
        host = url.hostname.lower()
        if ":" in host:
            host = f"[{host}]"
        port = url.port
        if port is not None and (url.scheme, port) not in {("http", 80), ("https", 443)}:
            host += f":{port}"
        path = url.path.rstrip("/")
        suffixes = ("/chat/completions", "/images/generations", "/images/edits", "/models")
        if openai:
            for suffix in suffixes:
                if path.endswith(suffix):
                    path = path[: -len(suffix)]
                    break
        return urlunsplit((url.scheme, host, path, "", ""))
    except ValueError:
        raise ValueError("请填写有效的 HTTP 或 HTTPS API 地址，不含密钥、查询参数或片段") from None
