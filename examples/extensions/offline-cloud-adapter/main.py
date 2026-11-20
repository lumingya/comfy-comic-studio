"""A small cloud channel adapter whose HTTP transport can be replaced in tests."""

from __future__ import annotations

import base64

from mio_server.pipeline.providers import HttpChannel


class OfflineDemoChannel(HttpChannel):
    what = "Offline demo image service"

    def _once(self, http, prompt, refs):
        if refs:
            raise ValueError("offline_demo does not accept reference images")
        channel = self.channel
        options = channel.extra_options
        response = http.post(
            (channel.base_url or "http://offline.invalid").rstrip("/") + "/generate",
            json={
                "prompt": prompt,
                "model": channel.model,
                "style": options.get("style", "ink"),
                "quality": options.get("quality", "draft"),
            },
        )
        response.raise_for_status()
        return base64.b64decode(response.json()["image"])


def activate(mio):
    mio.contribute(
        "cloud_adapter",
        "offline_demo",
        OfflineDemoChannel,
        title="离线演示渠道",
        capabilities=["generate", "custom-options"],
        schema={
            "type": "object",
            "properties": {
                "style": {"type": "string", "enum": ["ink", "watercolor"]},
                "quality": {"type": "string", "enum": ["draft", "final"]},
                "api_key": {"type": "string", "default": "never publish a credential"},
            },
        },
        supports_reference=False,
        supports_negative=False,
        supports_seed=False,
    )
