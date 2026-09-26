"""Frontend-state adapters.

Some custom nodes keep their real values in the ComfyUI frontend and sync them to the server
through their own routes, so the API-format JSON carries nothing. Example: ParameterControlPanel
(ComfyUI-Danbooru-Gallery) exports ``pcp_ui: ''``; steps, CFG, sampler and "save image" live in
server memory, pushed by the browser and lost when ComfyUI restarts. A headless runner has to
capture that state once (``snapshot``) and push it back before a run when the server is empty.

Changes are applied only for the run and the previous server state is restored afterwards, so
a ComfyUI tab the user has open keeps its own values.
"""
from __future__ import annotations

import copy
import urllib.parse

from .client import ComfyError


class ParameterControlPanel:
    class_type = "ParameterControlPanel"

    def capture(self, client, node_id: str) -> list:
        query = urllib.parse.urlencode({"node_id": node_id})
        return client.get_json(f"/danbooru_gallery/pcp/load_config?{query}").get("parameters") or []

    def push(self, client, node_id: str, state: list) -> None:
        client.post_json("/danbooru_gallery/pcp/save_config", {"node_id": str(node_id), "parameters": state})

    def change(self, state: list, changes: dict) -> list:
        out = copy.deepcopy(state)
        params = {p.get("name"): p for p in out if p.get("type") != "separator"}
        for name, value in changes.items():
            if name not in params:
                raise ComfyError(f"参数面板里没有「{name}」，可用：{'、'.join(map(str, params))}")
            params[name]["value"] = value
        return out

    def describe(self, state: list) -> dict:
        return {p.get("name"): p.get("value") for p in state if p.get("type") not in ("separator", "image")}


ADAPTERS = {adapter.class_type: adapter for adapter in (ParameterControlPanel(),)}


def stateful_nodes(graph: dict) -> dict[str, str]:
    return {node_id: node["class_type"] for node_id, node in graph.items() if node.get("class_type") in ADAPTERS}


def capture(client, graph: dict) -> dict:
    """Current server-side state of every stateful node in ``graph``."""
    return {node_id: {"class_type": cls, "state": ADAPTERS[cls].capture(client, node_id)}
            for node_id, cls in stateful_nodes(graph).items()}


def prepare(client, graph: dict, saved: dict | None = None, changes: dict | None = None) -> list:
    """Ensure every stateful node in ``graph`` has state on the server and apply ``changes``.

    ``saved`` comes from ``snapshot``; ``changes`` is ``{node_id: {param_name: value}}``. Returns
    the items to hand to :func:`restore` after the run.
    """
    saved, changes = saved or {}, changes or {}
    undo = []
    for node_id, cls in stateful_nodes(graph).items():
        adapter = ADAPTERS[cls]
        current = adapter.capture(client, node_id)
        base = current or (saved.get(node_id) or {}).get("state") or []
        if not base:
            raise ComfyError(
                f"节点 {node_id}（{cls}）在 ComfyUI 里没有参数：请在 ComfyUI 界面打开一次这个工作流，"
                f"或用 snapshot 保存的状态文件（配置里的 state）"
            )
        desired = adapter.change(base, changes.get(node_id) or {})
        if desired != current:
            adapter.push(client, node_id, desired)
            undo.append((node_id, cls, current))
    return undo


def restore(client, undo: list) -> None:
    for node_id, cls, state in undo:
        try:
            ADAPTERS[cls].push(client, node_id, state)
        except ComfyError:
            pass
