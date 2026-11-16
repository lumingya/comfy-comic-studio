"""Copy into ComfyUI/custom_nodes/mio_inline/__init__.py; no model or GPU required."""

import base64
import io

from PIL import Image


class MioInlineImages:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"color": ("STRING", {"default": "#6e8b72"})}}

    RETURN_TYPES = ()
    FUNCTION = "render"
    OUTPUT_NODE = True
    CATEGORY = "Mio/examples"

    def render(self, color):
        images = []
        for fill in (color, "#eeeeee"):
            with Image.new("RGB", (64, 64), fill) as image:
                buf = io.BytesIO()
                image.save(buf, "PNG")
                images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
        return {"ui": {"images_base64": images}}


NODE_CLASS_MAPPINGS = {"MioInlineImages": MioInlineImages}
