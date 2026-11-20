"""Install four independent adapters through cloud_adapter contract version 1."""

from .channels import AsyncImages, CompatibleChat, CompatibleImages, NovelStyle
from .transport import Scope

COMMON = {
    "min_interval": {"type": "number", "minimum": 0, "maximum": 60},
    "max_result_bytes": {"type": "integer", "minimum": 1024, "maximum": 33554432},
}
SEED = {"type": "integer", "minimum": 0, "maximum": 4294967295}
ADAPTERS = {
    "compatible_images": (
        CompatibleImages,
        "兼容 Images 图像",
        True,
        False,
        {
            "response_format": {"type": "string"},
            "style": {"type": "string", "maxLength": 64},
        },
    ),
    "compatible_chat_images": (
        CompatibleChat,
        "兼容 Chat 图像",
        True,
        False,
        {"modalities": {"type": "array", "items": {"type": "string"}, "maxItems": 2}},
    ),
    "novel_style_images": (NovelStyle, "NovelAI 风格图像", False, True, {"seed": SEED}),
    "async_images": (
        AsyncImages,
        "通用异步图像",
        False,
        True,
        {
            "seed": SEED,
            "submit_path": {"type": "string"},
            "poll_path": {"type": "string"},
            "max_polls": {"type": "integer", "minimum": 1, "maximum": 200},
            "poll_interval": {"type": "number", "minimum": 0.01, "maximum": 30},
        },
    ),
}


def activate(mio):
    scope = mio.service(Scope())
    for identifier, (adapter, title, reference, seed, properties) in ADAPTERS.items():

        def factory(channel, transport=None, cls=adapter):
            return cls(channel, transport, scope=scope)

        mio.contribute(
            "cloud_adapter",
            identifier,
            factory,
            title=title,
            capabilities=[
                "generate",
                "negative",
                "size",
                "bounded-http",
                "no-submit-retry",
            ]
            + (["reference"] if reference else [])
            + (["seed"] if seed else []),
            schema={
                "type": "object",
                "additionalProperties": False,
                "properties": {**COMMON, **properties},
            },
            supports_reference=reference,
            supports_negative=True,
            supports_seed=seed,
        )
