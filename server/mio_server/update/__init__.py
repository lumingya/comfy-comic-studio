"""Signed self-update for release installs (see :mod:`.updater`)."""

from .manifest import UpdateError, parse_version, sign_manifest, verify_manifest
from .updater import DEFAULT_FEED, Updater

__all__ = [
    "DEFAULT_FEED",
    "UpdateError",
    "Updater",
    "parse_version",
    "sign_manifest",
    "verify_manifest",
]
