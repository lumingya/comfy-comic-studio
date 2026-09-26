"""Cloud image generation through the local OpenAI-compatible proxy (model ``max``).

Ported from the Phase 0.5 spike (``next/mio_next/render.py``).  Used for the "cloud shapes the
composition, local unifies the style" (hybrid) consistency route and for instruction edits.
"""

from __future__ import annotations

import time

from .. import imaging
from .. import llm as L
from . import prompts as P


class CloudRenderer:
    def __init__(self, llm):
        self.llm = llm

    def sheet(self, character: dict) -> tuple[bytes, dict]:
        started = time.monotonic()
        data, reply = self.llm.generate_image(P.sheet_natural(character))
        return data, {
            "seconds": round(time.monotonic() - started, 2),
            "model": reply.model,
            "fallbacks": reply.attempts,
        }

    def panel(self, story: dict, panel: dict, sheets: dict[str, bytes]) -> tuple[bytes, dict]:
        """Multi-reference models get one sheet per character; if they all fail, single-reference
        models get a lineup composite so no character loses its reference."""
        text, refs = P.natural(story, panel, with_refs=True)
        images = [sheets[cid] for cid in refs if cid in sheets]
        started, failures = time.monotonic(), []
        if len(images) > 1:
            try:
                data, reply = self.llm.generate_image(
                    text, refs=images, models=L.IMAGE_MULTI, retries=1
                )
                return data, self._meta(started, reply, refs, "multi", text)
            except L.LLMError as exc:
                failures.append(str(exc))
            text, _ = P.natural(story, panel, with_refs=True, lineup=True)
            images, mode = [imaging.lineup(images)], "lineup"
        else:
            mode = "single" if images else "text"
        data, reply = self.llm.generate_image(text, refs=images, models=L.IMAGE_SINGLE)
        reply.attempts = failures + reply.attempts
        return data, self._meta(started, reply, refs, mode, text)

    def edit(self, image: bytes, instruction: str, refs: list[bytes] = ()) -> tuple[bytes, dict]:
        """Instruction edit: the current panel image is always reference 1."""
        started = time.monotonic()
        text = (
            "Edit reference image 1 and return the full edited image. Keep composition, characters, "
            f"line art and colors unchanged except for this instruction: {instruction}"
        )
        data, reply = self.llm.generate_image(text, refs=[image, *refs], models=L.IMAGE_MULTI)
        return data, self._meta(started, reply, [], "edit", text)

    @staticmethod
    def _meta(started, reply, refs, mode, text) -> dict:
        return {
            "seconds": round(time.monotonic() - started, 2),
            "model": reply.model,
            "mode": mode,
            "refs": refs,
            "fallbacks": reply.attempts,
            "prompt": text,
        }
