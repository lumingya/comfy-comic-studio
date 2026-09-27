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

    def _models(self, multi: bool = False) -> tuple[str, ...]:
        configured = getattr(self.llm, "image_models", ())
        choices = (
            configured
            if isinstance(configured, (tuple, list)) and configured
            else (L.IMAGE_MULTI if multi else L.IMAGE_SINGLE)
        )
        # One model per paid attempt. A user-selected image model must not be shadowed by
        # the built-in "max" fallback; uncertain requests are resolved by the job engine.
        return tuple(choices[:1])

    def sheet(self, character: dict) -> tuple[bytes, dict]:
        started = time.monotonic()
        data, reply = self.llm.generate_image(
            P.sheet_natural(character), models=self._models(), retries=0
        )
        return data, {
            "seconds": round(time.monotonic() - started, 2),
            "model": reply.model,
            "fallbacks": reply.attempts,
        }

    def panel(
        self, story: dict, panel: dict, sheets: dict[str, bytes], *, prompt: str | None = None
    ) -> tuple[bytes, dict]:
        """Use the frozen compiled prompt, with one reference per character.

        Only a definitive unsupported-reference rejection may fall back to a lineup. An
        ambiguous paid request (timeout / 5xx / malformed answer) must never be sent again.
        """
        text, refs = P.natural(story, panel, with_refs=True)
        if prompt is not None:
            text = prompt
        images = [sheets[cid] for cid in refs if cid in sheets]
        started, failures = time.monotonic(), []
        if len(images) > 1:
            try:
                data, reply = self.llm.generate_image(
                    text, refs=images, models=self._models(multi=True), retries=0
                )
                return data, self._meta(started, reply, refs, "multi", text)
            except L.LLMError as exc:
                if exc.sent is True or exc.status not in (400, 413, 415, 422):
                    raise
                failures.append(str(exc))
            if prompt is None:
                text, _ = P.natural(story, panel, with_refs=True, lineup=True)
            else:
                text = prompt + "\nThe reference is a lineup of the characters, from left to right."
            images, mode = [imaging.lineup(images)], "lineup"
        else:
            mode = "single" if images else "text"
        data, reply = self.llm.generate_image(text, refs=images, models=self._models(), retries=0)
        reply.attempts = failures + reply.attempts
        return data, self._meta(started, reply, refs, mode, text)

    def edit(self, image: bytes, instruction: str, refs: list[bytes] = ()) -> tuple[bytes, dict]:
        """Instruction edit: the current panel image is always reference 1."""
        started = time.monotonic()
        text = (
            "Edit reference image 1 and return the full edited image. Keep composition, characters, "
            f"line art and colors unchanged except for this instruction: {instruction}"
        )
        data, reply = self.llm.generate_image(
            text, refs=[image, *refs], models=self._models(multi=True), retries=0
        )
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
