"""A complete history-backed output protocol, without internal application access."""

import base64

from mio_server.comfy.client import OutputImage


class InlineImages:
    def freeze(self, node, options):
        if node["class_type"] != "MioInlineImages":
            raise ValueError("This adapter requires MioInlineImages")
        if options:
            raise ValueError("This protocol has no options")
        return {}

    def collect(self, output, plan, transport):
        values = output["images_base64"]
        if not isinstance(values, list):
            raise ValueError("images_base64 must be a list")
        return [
            OutputImage(
                "", "inline.png", "", "output", base64.b64decode(v, validate=True)
            )
            for v in values
        ]


def activate(mio):
    mio.contribute(
        "comfy_output_adapter", "inline-images", InlineImages(), title="内联图片"
    )
