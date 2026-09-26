"""Third-party extensions (ROADMAP §2.4, opened in P5): manifest, trust-by-digest, loader, SDK."""

from .manager import ExtensionError, ExtensionManager, Info
from .manifest import MANIFEST, Manifest, ManifestError
from .sdk import ExtensionAPI

__all__ = [
    "MANIFEST",
    "ExtensionAPI",
    "ExtensionError",
    "ExtensionManager",
    "Info",
    "Manifest",
    "ManifestError",
]
