"""Public release metadata. Browsing never requires a release signing key."""

from __future__ import annotations

from urllib.parse import quote, urlparse

import httpx

from .manifest import UpdateError, parse_version

REPOSITORY = "lumingya/comfy-comic-studio"
API = f"https://api.github.com/repos/{REPOSITORY}/releases"
RELEASES_PAGE = f"https://github.com/{REPOSITORY}/releases"
MAX_METADATA = 4 * 1024 * 1024


def read_json(http: httpx.Client, url: str, limit: int = MAX_METADATA) -> tuple[object, bool]:
    with http.stream("GET", url) as response:
        if response.status_code >= 400:
            if response.status_code in {403, 429}:
                raise UpdateError("版本检查暂时受限，请稍后重试")
            raise UpdateError(f"获取版本信息失败：HTTP {response.status_code}")
        body = bytearray()
        for chunk in response.iter_bytes():
            body.extend(chunk)
            if len(body) > limit:
                raise UpdateError("版本信息过大")
        try:
            import json

            return json.loads(body), 'rel="next"' in response.headers.get("link", "")
        except ValueError:
            raise UpdateError("版本信息格式不正确") from None


def release_info(release: dict) -> dict:
    tag = str(release.get("tag_name", ""))
    version = tag.removeprefix("v")
    try:
        parse_version(version)
    except UpdateError:
        version = ""
    assets = release.get("assets") or []
    manifest_url = ""
    for asset in assets:
        if not isinstance(asset, dict) or asset.get("name") != "mio-release.json":
            continue
        url = str(asset.get("browser_download_url", ""))
        parsed = urlparse(url)
        if (
            parsed.scheme == "https"
            and parsed.netloc == "github.com"
            and parsed.path.startswith(f"/{REPOSITORY}/releases/download/")
        ):
            manifest_url = url
    return {
        "tag": tag,
        "version": version,
        "name": str(release.get("name") or tag),
        "published_at": str(release.get("published_at") or ""),
        "prerelease": bool(release.get("prerelease")),
        "notes": str(release.get("body") or ""),
        "manifest_url": manifest_url,
        "has_manifest": bool(manifest_url),
    }


def page(http: httpx.Client, number: int, per_page: int) -> dict:
    data, has_more = read_json(http, f"{API}?page={number}&per_page={per_page}")
    if not isinstance(data, list):
        raise UpdateError("版本目录格式不正确")
    return {
        "items": [
            release_info(item) for item in data if isinstance(item, dict) and not item.get("draft")
        ],
        "page": number,
        "per_page": per_page,
        "has_more": has_more,
    }


def by_tag(http: httpx.Client, tag: str) -> dict:
    data, _ = read_json(http, f"{API}/tags/{quote(tag, safe='')}")
    if not isinstance(data, dict) or data.get("draft") or data.get("tag_name") != tag:
        raise UpdateError("没有找到这个公开版本")
    return release_info(data)
