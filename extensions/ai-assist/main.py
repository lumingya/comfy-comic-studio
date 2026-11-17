"""Standalone AI assistant package. All business code and UI live in this folder."""

from .core.api import router
from .core.service import AIAssist


def activate(mio):
    service = mio.service(AIAssist(mio))
    mio.router.include_router(router)
    mio.contribute("text_provider", "ai-assist", service.llm_client, title="AI 辅助")
    mio.contribute(
        "workspace_surface",
        "ai-assist",
        lambda: {
            "title": "AI 辅助",
            "mode": service.store.settings().mode,
            "entry": "page/dist/index.html",
        },
        title="AI 辅助",
    )
