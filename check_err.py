import json

with open("jam_events.json", "r", encoding="utf-8") as f:
    events = json.load(f)

timestamps = [e.get("timestamp") for e in events if e.get("timestamp")]
min_t = min(timestamps)

for i, e in enumerate(events):
    t = e.get("timestamp", 0)
    rel_t = (t - min_t) / 1000.0 if t else 0
    data = e.get("data", {})
    payload = data.get("payload", {})
    entry = payload.get("entry", {})
    fetch = payload.get("fetchDetails", {})
    status = fetch.get("status")
    name = entry.get("name", "")
    is_err = payload.get("is_error", False)
    if status == 0 or (status and status >= 400) or is_err:
        print(f"[{rel_t:.2f}s] Event {i}: status={status}, url={name}")
