"""Compose extension transport, runtime surfaces, private data and theme catalog."""

from . import extension_private, extension_surfaces, extension_transport, theme_catalog
from .operations import Router

router = Router(tags=["extensions"])
for module in (extension_transport, extension_surfaces, extension_private, theme_catalog):
    router.include_router(module.router)
