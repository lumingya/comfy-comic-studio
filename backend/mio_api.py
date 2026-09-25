"""Public API facade. The implementation lives in :mod:`backend.api_v1`.

Kept as a stable import point for the HTTP layer, tests and tools::

    from backend import mio_api
    mio_api.openapi()          # generated OpenAPI 3.1 document
    mio_api.handle(handler, services)
"""

from backend.api_v1 import (  # noqa: F401
    GENERATION_SLOT,
    VERSION,
    ApiError,
    capabilities,
    generation_payload,
    handle,
    openapi,
    route_table,
)
