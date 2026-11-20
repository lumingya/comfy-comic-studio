"""Remove configured credentials; reject unexpected embedded secrets by default."""

import json
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..pipeline.cloud_request import SECRET_OPTION_NAME
from ..settings import AppSettings

SECRET_KEYS = {
    "api_key",
    "apikey",
    "access_token",
    "authorization",
    "cookie",
    "password",
    "secret",
    "secret_hash",
    "token",
    "refresh_token",
    "client_secret",
    "x-api-key",
}


def clean_url(value: str) -> str:
    url = urlsplit(value)
    if url.scheme.lower() not in {"http", "https"}:
        return value
    host = url.netloc.rsplit("@", 1)[-1]
    query = [
        (key, val)
        for key, val in parse_qsl(url.query, keep_blank_values=True)
        if key.lower() not in SECRET_KEYS
    ]
    return urlunsplit((url.scheme, host, url.path, urlencode(query), ""))


def clean_options(value):
    if isinstance(value, dict):
        return {
            key: clean_options(child)
            for key, child in value.items()
            if key.lower() not in SECRET_KEYS and not SECRET_OPTION_NAME.search(key)
        }
    if isinstance(value, list):
        return [clean_options(child) for child in value]
    return clean_url(value) if isinstance(value, str) else value


def has_embedded_secret(value) -> bool:
    if isinstance(value, dict):
        return any(
            (key.lower() in SECRET_KEYS and bool(child)) or has_embedded_secret(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(has_embedded_secret(child) for child in value)
    if isinstance(value, str):
        try:
            url = urlsplit(value)
        except ValueError:
            return value.lstrip().lower().startswith(("http:", "https:"))
        if url.scheme.lower() in {"http", "https"}:
            return bool(
                url.username
                or url.password
                or any(
                    key.lower() in SECRET_KEYS
                    for key, _ in parse_qsl(url.query, keep_blank_values=True)
                )
            )
    return False


def sanitize(store_db, jobs_db, include_credentials: bool) -> list[str]:
    exclusions = ["extension packages", "update packages", "caches", "temporary files"]
    if not include_credentials:
        exclusions += ["API tokens", "configured credentials", "webhook secrets", "URL credentials"]
        store_db.execute("DELETE FROM documents WHERE kind = 'api_token'")
    settings_found = False
    for row in store_db.execute("SELECT kind, id, payload_json FROM documents").fetchall():
        kind, identifier, raw = row
        value = json.loads(raw)
        if kind == "settings":
            settings_found = True
            value["extensions"] = {}
            value["legacy_seeded"] = True
            if not include_credentials:
                value["llm"]["api_key"] = ""
                value["llm"]["base_url"] = clean_url(value["llm"]["base_url"])
                value["update_feed"] = clean_url(value.get("update_feed", ""))
                for channel in value.get("image_channels", []):
                    channel["api_key"] = ""
                    channel["base_url"] = clean_url(channel["base_url"])
                    channel["extra_options"] = clean_options(channel.get("extra_options", {}))
        elif kind == "instance":
            value["enabled"] = False
            if not include_credentials:
                value["base_url"] = clean_url(value["base_url"])
        elif kind == "webhook":
            value["enabled"] = False
            if not include_credentials:
                value["secret"] = ""
                value["url"] = clean_url(value["url"])
        elif kind == "workshop_queue":
            value["paused"] = True
            value["active"] = value["active_job"] = None
        store_db.execute(
            "UPDATE documents SET payload_json = ? WHERE kind = ? AND id = ?",
            (json.dumps(value, ensure_ascii=False), kind, identifier),
        )
    if not settings_found:
        settings = AppSettings(legacy_seeded=True)
        store_db.execute(
            "INSERT INTO documents VALUES ('settings', ?, ?, ?, ?)",
            (settings.id, settings.name, settings.updated_at, settings.model_dump_json()),
        )
    # Unknown plug-in nodes can embed credentials in graph inputs or historical requests.
    # Do not silently alter immutable request/receipt hashes to redact those fields.
    if not include_credentials:
        for db in (store_db, jobs_db):
            for table in db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall():
                name = table[0]
                if name.startswith("sqlite_"):
                    continue
                columns = [col[1] for col in db.execute(f'PRAGMA table_info("{name}")')]
                for column in columns:
                    if column.endswith("_json"):
                        for (raw,) in db.execute(
                            f'SELECT "{column}" FROM "{name}" WHERE "{column}" IS NOT NULL'
                        ):
                            if has_embedded_secret(json.loads(raw)):
                                raise ValueError(
                                    "workspace contains embedded credentials; remove them or explicitly include credentials"
                                )
    store_db.commit()
    jobs_db.commit()
    for db in (store_db, jobs_db):
        db.execute("PRAGMA secure_delete = ON")
        db.execute("VACUUM")
    return exclusions
