"""Reuse the public PCP protocol, while owning a separately reviewed adapter identity."""

from mio_server.comfy.adapters import ParameterControlPanel


def activate(mio):
    mio.contribute(
        "comfy_state_adapter",
        "example-pcp",
        ParameterControlPanel(),
        title="参数面板示例",
    )
