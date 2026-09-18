"""Targeted ComfyUI cancellation; never send a global interrupt or clear queue.
Uses the atomic /api/jobs/{id}/cancel API; no unsafe legacy global fallback.
"""

import json
import urllib.request
import urllib.parse
import urllib.error


def cancel_prompt(base, prompt_id):
    if not prompt_id:
        return {"state": "not_submitted"}

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None

    opener = urllib.request.build_opener(NoRedirect)

    def call(path, data=None):
        req = urllib.request.Request(
            base.rstrip("/") + path,
            data=None if data is None else json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
        )
        with opener.open(req, timeout=5) as response:
            raw = response.read(1024 * 1024)
            return json.loads(raw) if raw else {}

    # Current ComfyUI performs identity check and interruption under its queue lock.
    # A client-side GET /queue followed by global /interrupt has a race and is unsafe.
    try:
        result = call(
            "/api/jobs/" + urllib.parse.quote(str(prompt_id), safe="") + "/cancel", {}
        )
        if not isinstance(result.get("cancelled"), bool):
            raise ValueError("ComfyUI cancellation response missing acknowledgement")
        return {
            "state": (
                "cancel_dispatched" if result["cancelled"] else "finished_or_absent"
            ),
            "promptId": prompt_id,
        }
    except urllib.error.HTTPError as exc:
        if exc.code not in (404, 405):
            raise
        call("/queue", {"delete": [prompt_id]})
        queue = call("/queue")
        if any(
            len(item) > 1 and item[1] == prompt_id
            for item in queue.get("queue_running", [])
        ):
            return {
                "state": "unconfirmed",
                "promptId": prompt_id,
                "message": "此 ComfyUI 不支持原子定向取消；已清理本任务排队项。请升级 ComfyUI 或在其界面中断，Mio 不会冒险全局中断其他任务。",
            }
        return {"state": "removed_or_finished", "promptId": prompt_id}
