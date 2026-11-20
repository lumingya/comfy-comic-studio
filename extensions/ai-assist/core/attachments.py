"""Canonical attachment routes and the one historical metadata-only alias."""


def attachment_url(attachment_id: str) -> str:
    return f"/api/ext/ai-assist/attachments/{attachment_id}"


def valid_attachment_url(url: object, attachment_id: str) -> bool:
    # Older backups stored this exact local route. Keep their bytes/checksums intact;
    # consumers address images by ID through the current route, not this old URL.
    # Never accept an origin, query, fragment, alternate ID or arbitrary local URL.
    return url in (
        attachment_url(attachment_id),
        f"/api/ai-assist/attachments/{attachment_id}",
    )
