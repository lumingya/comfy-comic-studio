from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone

from .models import Episode, Series


def build_package(series: Series, episodes: list[Episode]) -> bytes:
    buf = io.BytesIO()
    manifest = {"format": "mio.v3.package", "created_at": datetime.now(timezone.utc).isoformat(),
                "series_id": series.id, "episodes": [e.id for e in episodes]}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr("series.json", series.model_dump_json(indent=2))
        for episode in episodes:
            zf.writestr(f"episodes/{episode.id}.json", episode.model_dump_json(indent=2))
    return buf.getvalue()
