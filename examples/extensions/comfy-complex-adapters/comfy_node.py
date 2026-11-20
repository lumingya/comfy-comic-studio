"""Optional ComfyUI custom_nodes/mio_artifact_output/__init__.py; not a Mio entry point."""

import base64
import io

from PIL import Image


class MioArtifactOutput:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",)}}

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "emit"
    CATEGORY = "Mio/Examples"

    def emit(self, images):
        if not 1 <= len(images) <= 16:
            raise ValueError("MioArtifactOutput accepts one to sixteen images")
        artifacts = []
        for tensor in images:
            pixels = (tensor.cpu().numpy() * 255).clip(0, 255).astype("uint8")
            stream = io.BytesIO()
            Image.fromarray(pixels).save(stream, format="PNG")
            payload = stream.getvalue()
            if len(payload) > 10 * 1024 * 1024:
                raise ValueError("MioArtifactOutput image exceeds 10 MiB")
            artifacts.append({"base64": base64.b64encode(payload).decode("ascii")})
        return {"ui": {"artifacts": artifacts}}


NODE_CLASS_MAPPINGS = {"MioArtifactOutput": MioArtifactOutput}
