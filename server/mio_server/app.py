"""ASGI entry point.

``uvicorn mio_server.app:app`` works (the app is built lazily on first attribute access, so merely
importing this module never opens a database); tests call :func:`create_app` with their own
:class:`~mio_server.context.AppContext`.
"""

from __future__ import annotations

from .api import create_app

__all__ = ["create_app"]


def __getattr__(name: str):
    if name == "app":
        app = create_app()
        globals()["app"] = app
        return app
    raise AttributeError(name)
