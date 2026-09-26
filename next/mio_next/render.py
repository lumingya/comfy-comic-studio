"""Panel renderers.

* ``LocalRenderer``: the user's ComfyUI through the tagged workflows in ``next/workflows/``
  (text-to-image, and image-to-image with the tile ControlNet for style unification).
* ``CloudRenderer``: image models behind the local proxy, with character sheets as references.

Strategies compared by the benchmark (ROADMAP §6.4):
  baseline  local text-to-image from Danbooru tags only (stands for the legacy pipeline)
  hybrid    cloud model shapes the panel from references, local img2img + tile unifies style
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from . import imaging
from . import prompts as P
from .comfy import bindings as B
from .comfy.client import ComfyClient, ComfyError

WORKFLOWS = Path(__file__).resolve().parent.parent / "workflows"


class LocalRenderer:
    def __init__(self, client: ComfyClient, checkpoint: str = "anikawaxl_v4.safetensors", steps: int = 24,
                 cfg: float = 5.0, sampler: str = "euler_ancestral", scheduler: str = "normal",
                 workflows: Path = WORKFLOWS):
        self.client = client
        self.defaults = {"checkpoint": checkpoint, "steps": steps, "cfg": cfg, "sampler": sampler, "scheduler": scheduler}
        self.t2i_graph = json.loads((workflows / "t2i_sdxl.json").read_text(encoding="utf-8"))
        self.i2i_graph = json.loads((workflows / "i2i_tile.json").read_text(encoding="utf-8"))

    def _run(self, graph: dict, values: dict) -> tuple[bytes, dict]:
        bindings, problems = B.resolve(graph)
        if problems:
            raise ComfyError("工作流标签有问题：" + "；".join(problems))
        pruned, outputs = B.select_variant(graph, bindings, None)
        final = B.apply_values(pruned, bindings, {**self.defaults, **values})
        result = self.client.run(final, output_nodes=outputs, timeout=900)
        if not result.images:
            raise ComfyError("ComfyUI 没有返回图片")
        sampling = sum(v for k, v in result.node_seconds.items() if final.get(k, {}).get("class_type", "").startswith("KSampler"))
        return result.images[0].data, {"seconds": round(result.elapsed, 2), "sampling": round(sampling, 2),
                                       "cached": len(result.cached), "prompt_id": result.prompt_id}

    def t2i(self, prompt: str, negative: str, seed: int, size: tuple[int, int]) -> tuple[bytes, dict]:
        return self._run(self.t2i_graph, {"prompt": prompt, "negative": negative, "seed": seed,
                                          "width": size[0], "height": size[1], "batch": 1})

    def i2i(self, image: bytes, prompt: str, negative: str, seed: int, size: tuple[int, int],
            denoise: float = 0.5, strength: float = 0.75, steps: int | None = None) -> tuple[bytes, dict]:
        png = imaging.fit(image, size)
        name = self.client.upload_image(png, f"mio_{hashlib.sha1(png).hexdigest()[:16]}.png")
        values = {"prompt": prompt, "negative": negative, "seed": seed, "init": name, "denoise": denoise, "strength": strength}
        if steps:
            values["steps"] = steps
        return self._run(self.i2i_graph, values)


class CloudRenderer:
    def __init__(self, llm):
        self.llm = llm

    def sheet(self, character: dict) -> tuple[bytes, dict]:
        started = time.monotonic()
        data, reply = self.llm.generate_image(P.sheet_natural(character))
        return data, {"seconds": round(time.monotonic() - started, 2), "model": reply.model, "fallbacks": reply.attempts}

    def panel(self, story: dict, panel: dict, sheets: dict[str, bytes]) -> tuple[bytes, dict]:
        """Multi-reference models get one sheet per character; if they all fail, single-reference
        models get a lineup composite so no character loses its reference."""
        from .llm import IMAGE_MULTI, IMAGE_SINGLE, LLMError

        text, refs = P.natural(story, panel, with_refs=True)
        images = [sheets[cid] for cid in refs]
        started, failures = time.monotonic(), []
        if len(images) > 1:
            try:
                data, reply = self.llm.generate_image(text, refs=images, models=IMAGE_MULTI, retries=1)
                return data, self._meta(started, reply, refs, "multi", text)
            except LLMError as exc:
                failures.append(str(exc))
            text, _ = P.natural(story, panel, with_refs=True, lineup=True)
            images, mode = [imaging.lineup(images)], "lineup"
        else:
            mode = "single" if images else "text"
        data, reply = self.llm.generate_image(text, refs=images, models=IMAGE_SINGLE)
        reply.attempts = failures + reply.attempts
        return data, self._meta(started, reply, refs, mode, text)

    @staticmethod
    def _meta(started, reply, refs, mode, text) -> dict:
        return {"seconds": round(time.monotonic() - started, 2), "model": reply.model, "mode": mode,
                "refs": refs, "fallbacks": reply.attempts, "prompt": text}
