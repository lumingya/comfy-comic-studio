"""Mount the same reviewed extension activation locally and behind v2 authentication."""

from __future__ import annotations

import hashlib

from fastapi import Depends, WebSocketException
from fastapi.requests import HTTPConnection

from ..extensions.manifest import digest
from ..storage import NotFound


def mount_extensions(app, *, prefix="/api/ext", authenticate=None):
    manager = app.state.ctx.extensions
    if manager is None:
        return
    manager.apps.append((app, prefix, authenticate))
    refresh_extensions(app, prefix=prefix, authenticate=authenticate)


def refresh_extensions(app, *, prefix="/api/ext", authenticate=None):
    manager = app.state.ctx.extensions
    previous = getattr(app.state, "extension_routes", [])
    app.router.routes[:] = [r for r in app.router.routes if not any(r is old for old in previous)]
    app.state.extension_routes = []
    for ext_id, router in manager.routers():
        loaded = manager.loaded[ext_id]
        pinned = manager.ctx.settings().extensions[ext_id].digest
        guards = [Depends(extension_guard(manager, ext_id, loaded, pinned))]
        if authenticate:
            guards.insert(0, Depends(authenticate))

        def operation_id(route, ext=ext_id):
            key = f"{route.path}:{','.join(sorted(route.methods or []))}"
            suffix = hashlib.sha256(key.encode()).hexdigest()[:12]
            return f"ext_{ext}_{route.name}_{suffix}"

        before = list(app.router.routes)
        app.include_router(
            router,
            prefix=f"{prefix}/{ext_id}",
            dependencies=guards,
            generate_unique_id_function=operation_id,
        )
        added = [r for r in app.router.routes if not any(r is old for old in before)]
        app.state.extension_routes.extend(added)
        manager.mounted.add(ext_id)
    # Re-added extension routes precede the SPA catch-all. Router inclusion is atomic.
    additions = app.state.extension_routes
    app.router.routes[:] = [
        r for r in app.router.routes if not any(r is added for added in additions)
    ]
    position = next(
        (i for i, r in enumerate(app.router.routes) if getattr(r, "path", None) == "/{path:path}"),
        len(app.router.routes),
    )
    app.router.routes[position:position] = additions
    app.openapi_schema = None


def extension_guard(manager, ext_id, loaded, pinned):
    """A route belongs to one activation, never to a later load of the same extension id."""

    def require_active(conn: HTTPConnection) -> None:
        state = manager.ctx.settings().extensions.get(ext_id)
        active = (
            manager.loaded.get(ext_id) is loaded
            and state is not None
            and state.enabled
            and state.digest == pinned
        )
        if active:
            try:
                active = digest(loaded.api.folder) == pinned
            except OSError:
                active = False
        if not active:
            if conn.scope["type"] == "websocket":
                raise WebSocketException(code=1008, reason="extension is not active")
            raise NotFound(f"扩展未启用、内容已变动或需要重启：{ext_id}")

    return require_active
