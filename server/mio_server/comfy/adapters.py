"""Frontend-state adapters.

Some custom nodes keep their real values in the ComfyUI frontend and sync them to the server
through their own routes, so the API-format JSON carries nothing. Example: ParameterControlPanel
(ComfyUI-Danbooru-Gallery) exports ``pcp_ui: ''``; steps, CFG, sampler and "save image" live in
server memory, pushed by the browser and lost when ComfyUI restarts. A headless runner has to
capture that state once (``snapshot``) and push it back before a run when the server is empty.

Production tasks use a frozen snapshot and a durable restoration journal. They require exclusive
use of the endpoint; external ComfyUI browser tabs are not controlled by Mio's scheduler.
Conflicting third-party edits are preserved for explicit recovery rather than overwritten.
"""

from __future__ import annotations

import copy
import math
import urllib.parse

from .client import ComfyError


class ParameterControlPanel:
    class_type = "ParameterControlPanel"

    def capture(self, client, node_id: str) -> list:
        query = urllib.parse.urlencode({"node_id": node_id})
        return client.get_json(f"/danbooru_gallery/pcp/load_config?{query}").get("parameters") or []

    def push(self, client, node_id: str, state: list) -> None:
        client.post_json(
            "/danbooru_gallery/pcp/save_config", {"node_id": str(node_id), "parameters": state}
        )

    def change(self, state: list, changes: dict) -> list:
        out = copy.deepcopy(state)
        params = {p.get("name"): p for p in out if p.get("type") != "separator"}
        for name, value in changes.items():
            if name not in params:
                raise ComfyError(f"参数面板里没有「{name}」，可用：{'、'.join(map(str, params))}")
            params[name]["value"] = value
        return out

    def describe(self, state: list) -> dict:
        return {
            p.get("name"): p.get("value")
            for p in state
            if p.get("type") not in ("separator", "image")
        }


ADAPTERS = {adapter.class_type: adapter for adapter in (ParameterControlPanel(),)}


def _json_value(value) -> bool:
    if value is None or type(value) in (str, bool, int):
        return True
    if type(value) is float:
        return math.isfinite(value)
    if isinstance(value, list):
        return all(_json_value(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and _json_value(item) for key, item in value.items())
    return False


def validate_state(state, *, nonempty: bool = False) -> None:
    """Validate the plugin's JSON envelope without prescribing its parameter types."""
    if not isinstance(state, list) or (nonempty and not state):
        raise ComfyError("参数面板状态必须是非空参数列表" if nonempty else "参数面板状态必须是列表")
    names = set()
    for parameter in state:
        if not isinstance(parameter, dict) or not _json_value(parameter):
            raise ComfyError("参数面板参数必须是有效的 JSON 对象")
        if "type" in parameter and not isinstance(parameter["type"], str):
            raise ComfyError("参数面板参数类型必须是字符串")
        if parameter.get("type") == "separator":
            continue
        name = parameter.get("name")
        if not isinstance(name, str) or not name or name in names:
            raise ComfyError("参数面板参数名称必须非空且唯一")
        names.add(name)


def desired_state(class_type: str, saved: list, changes: dict) -> list:
    validate_state(saved, nonempty=True)
    if not isinstance(changes, dict) or not _json_value(changes):
        raise ComfyError("参数面板覆盖值必须是有效的 JSON 对象")
    return ADAPTERS[class_type].change(saved, copy.deepcopy(changes))


def stateful_nodes(graph: dict) -> dict[str, str]:
    return {
        node_id: node["class_type"]
        for node_id, node in graph.items()
        if node.get("class_type") in ADAPTERS
    }


def prepare_plan(client, plan: dict, journal_callback) -> list[dict]:
    """Capture every before-state, then journal write intent before each remote write.

    The callback must durably persist its full argument or raise. A write can succeed remotely
    even if ``push`` raises, so callers recover from the last callback, never just the return.
    """
    entries = []
    for node_id, item in plan.items():
        adapter = ADAPTERS[item["class_type"]]
        desired = copy.deepcopy(item["desired"])
        validate_state(desired, nonempty=True)
        before = copy.deepcopy(adapter.capture(client, node_id))
        validate_state(before)
        entries.append(
            {
                "node_id": node_id,
                "class_type": item["class_type"],
                "before": before,
                "desired": desired,
                "write_intent": False,
                "status": "captured",
            }
        )
        journal_callback(copy.deepcopy(entries))
    for entry in entries:
        if entry["before"] == entry["desired"]:
            entry["status"] = "prepared"
            journal_callback(copy.deepcopy(entries))
            continue
        entry.update(write_intent=True, status="applying")
        journal_callback(copy.deepcopy(entries))
        adapter = ADAPTERS[entry["class_type"]]
        adapter.push(client, entry["node_id"], copy.deepcopy(entry["desired"]))
        if adapter.capture(client, entry["node_id"]) != entry["desired"]:
            raise ComfyError(f"节点 {entry['node_id']} 参数面板写入后校验失败")
        entry["status"] = "applied"
        journal_callback(copy.deepcopy(entries))
    return entries


def restore_plan(client, entries: list[dict], journal_callback) -> list[dict]:
    """Restore all intended writes in reverse order, preserving third-party changes.

    Failed reads/writes and conflicting values are returned for explicit reconciliation. Journal
    failures propagate immediately: no subsequent remote write is safe without a durable record.
    """
    entries = copy.deepcopy(entries)
    issues = []
    for entry in reversed(entries):
        if not entry.get("write_intent") or entry.get("status") == "restored":
            continue
        entry["status"] = "restoring"
        journal_callback(copy.deepcopy(entries))
        issue = None
        try:
            adapter = ADAPTERS[entry["class_type"]]
            current = adapter.capture(client, entry["node_id"])
            if current == entry["before"]:
                entry["status"] = "restored"
            elif current != entry["desired"]:
                entry["status"] = "conflict"
                issue = {"kind": "conflict", "error": "参数面板已被其他客户端修改，保留当前值"}
            else:
                adapter.push(client, entry["node_id"], copy.deepcopy(entry["before"]))
                if adapter.capture(client, entry["node_id"]) != entry["before"]:
                    raise ComfyError("参数面板恢复后校验失败")
                entry["status"] = "restored"
        except Exception as exc:
            entry["status"] = "restore_failed"
            issue = {"kind": "restore_failed", "error": str(exc)}
        if issue:
            entry["error"] = issue["error"]
            issues.append({"node_id": entry["node_id"], **issue})
        else:
            entry.pop("error", None)
        journal_callback(copy.deepcopy(entries))
    return issues


def capture(client, graph: dict) -> dict:
    """Current server-side state of every stateful node in ``graph``."""
    return {
        node_id: {"class_type": cls, "state": ADAPTERS[cls].capture(client, node_id)}
        for node_id, cls in stateful_nodes(graph).items()
    }


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
