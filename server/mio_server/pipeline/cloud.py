"""Cloud image generation through the local OpenAI-compatible proxy (model ``max``).

Ported from the Phase 0.5 spike (``next/mio_next/render.py``).  Used for the "cloud shapes the
composition, local unifies the style" (hybrid) consistency route and for instruction edits.
"""

from __future__ import annotations

import copy
import time

from .. import imaging
from .. import llm as L
from . import cloud_request as CR
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
        self,
        story: dict,
        panel: dict,
        sheets: dict[str, bytes],
        *,
        prompt: str | None = None,
        request: dict | None = None,
        references: list[bytes] | None = None,
    ) -> tuple[bytes, dict]:
        """Use the frozen compiled prompt, with one reference per character.

        Only a definitive unsupported-reference rejection may fall back to a lineup. An
        ambiguous paid request (timeout / 5xx / malformed answer) must never be sent again.
        """
        text, refs = P.natural(story, panel, with_refs=True)
        if prompt is not None:
            text = prompt
        images = [sheets[cid] for cid in refs if cid in sheets]
        if references is not None:
            images = references
        if request is not None:
            refs = [r["asset_id"] for r in request["requested"]["refs"]]
            text = request["requested"]["prompt"]
        frozen = request or CR.freeze_request(
            self.llm, {"prompt": text}, models=self._models(len(images) > 1)
        )

        def generate(current, images):
            return CR.call(self.llm, current, images, retries=0)

        started, failures = time.monotonic(), []
        if len(images) > 1:
            try:
                data, reply = generate(frozen, images)
                return data, self._meta(started, reply, refs, "multi", text)
            except L.LLMError as exc:
                if (
                    exc.sent is True
                    or exc.status not in (400, 413, 415, 422)
                    or not exc.reference_unsupported
                ):
                    raise
                failures.append(str(exc))
            if request is None and prompt is None:
                text, _ = P.natural(story, panel, with_refs=True, lineup=True)
            else:
                text += "\nThe attached reference combines the original reference images from left to right."
            images, mode = [imaging.lineup(images)], "lineup"
            fallback = copy.deepcopy(frozen)
            fallback["requested"]["prompt"] = text
        else:
            mode = "single" if images else "text"
            fallback = frozen
        data, reply = generate(fallback, images)
        if mode == "lineup" and reply.image_request:
            reply.image_request["requested"] = copy.deepcopy(frozen["requested"])
            reply.image_request["effective"]["reference_mode"] = "lineup"
            reply.image_request["adjustments"].append("multi_reference_lineup")
        reply.attempts = failures + reply.attempts
        return data, self._meta(started, reply, refs, mode, text)

    def edit(
        self, image: bytes, instruction: str, refs: list[bytes] = (), *, request=None
    ) -> tuple[bytes, dict]:
        """Instruction edit: the current panel image is always reference 1."""
        started = time.monotonic()
        text = self.edit_prompt(instruction)
        frozen = request or CR.freeze_request(
            self.llm, {"prompt": text}, models=self._models(multi=True)
        )
        data, reply = CR.call(self.llm, frozen, [image, *refs], retries=0)
        return data, self._meta(started, reply, [], "edit", text)

    @staticmethod
    def edit_prompt(instruction: str) -> str:
        return (
            "Edit reference image 1 and return the full edited image. Keep composition, characters, "
            f"line art and colors unchanged except for this instruction: {instruction}"
        )

    @staticmethod
    def _meta(started, reply, refs, mode, text) -> dict:
        return {
            "seconds": round(time.monotonic() - started, 2),
            "model": reply.model,
            "mode": mode,
            "refs": refs,
            "fallbacks": reply.attempts,
            "prompt": text,
            "request": reply.image_request,
        }
