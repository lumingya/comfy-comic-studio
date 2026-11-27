"""One extension seam for the same typed operations used by the UI and public API.

Dependencies (including authentication), request validation, response validation and HTTP
status handling stay with FastAPI. An operation wrapper can transform arguments/results or
replace the operation. Errors propagate: retrying a potentially completed mutation is unsafe.
"""

from __future__ import annotations

import inspect
from functools import wraps

from fastapi import APIRouter, Request
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.routing import compile_path

from ..auth import required_scope
from ..registry import InactiveContributionError
from .deps import Ctx


async def invoke(handler, *args, **kwargs):
    if inspect.iscoroutinefunction(handler):
        return await handler(*args, **kwargs)
    result = await run_in_threadpool(handler, *args, **kwargs)
    return await result if inspect.isawaitable(result) else result


def operation_layers(ctx, operation):
    manager = getattr(ctx, "extensions", None)
    return (
        manager.operation_layers(operation)
        if manager
        else ctx.registry.layers("operation", operation)
    )


def wrap_endpoint(endpoint, operation):
    @wraps(endpoint)
    async def dispatch(**values):
        ctx = values["ctx"]
        # A short, atomic publication check and snapshot. No lock crosses an await, and
        # activation's own HTTP calls receive a retryable conflict instead of deadlocking.
        layers = operation_layers(ctx, operation)

        async def call(index, arguments):
            if index < 0:
                return await invoke(endpoint, **arguments)
            contribution = layers[index]
            used = False

            async def next_operation(**changes):
                nonlocal used
                if used:
                    raise ValueError("an operation wrapper may call next only once")
                used = True
                if "ctx" in changes and changes["ctx"] is not ctx:
                    raise ValueError("an operation wrapper cannot replace its application context")
                return await call(index - 1, {**arguments, **changes})

            try:
                dispatched = contribution.invoke(
                    invoke, contribution.value, next_operation, **arguments
                )
            except InactiveContributionError:
                return await call(index - 1, arguments)
            return await dispatched

        return await call(len(layers) - 1, values)

    # Resolve string annotations in the endpoint's own module before wrapping it.
    dispatch.__signature__ = inspect.signature(endpoint, eval_str=True)
    dispatch.__mio_original__ = endpoint
    dispatch.__mio_operation__ = operation
    return dispatch


class OperationRoute(APIRoute):
    def __init__(self, path, endpoint, **kwargs):
        operation = getattr(endpoint, "__mio_operation__", None)
        endpoint = getattr(endpoint, "__mio_original__", endpoint)
        methods = kwargs.get("methods") or ["GET"]
        if "ctx" not in inspect.signature(endpoint).parameters or len(methods) != 1:
            raise ValueError("core operations require a context and exactly one HTTP method")
        operation = operation or f"{next(iter(methods)).upper()} {compile_path(path)[1]}"
        extra = {
            **(kwargs.pop("openapi_extra", None) or {}),
            "x-mio-operation": operation,
            "x-mio-arguments": list(inspect.signature(endpoint).parameters),
        }
        super().__init__(path, wrap_endpoint(endpoint, operation), openapi_extra=extra, **kwargs)


class Router(APIRouter):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, route_class=OperationRoute, **kwargs)


router = Router(tags=["operations"])


@router.get("/operations")
def list_operations(ctx: Ctx, request: Request) -> list[dict]:
    """Discover typed operations and their active wrappers; schemas remain in OpenAPI."""
    result = []
    for path, methods in request.app.openapi().get("paths", {}).items():
        for method, spec in methods.items():
            operation = spec.get("x-mio-operation")
            if not operation:
                continue
            result.append(
                {
                    "id": operation,
                    "method": method.upper(),
                    "path": operation.split(" ", 1)[1],
                    "operation_id": spec.get("operationId", ""),
                    "summary": spec.get("summary", ""),
                    "arguments": spec.get("x-mio-arguments", []),
                    "scope": required_scope(method.upper(), operation.split(" ", 1)[1]),
                    "wrappers": [c.source for c in operation_layers(ctx, operation)],
                }
            )
    return result
