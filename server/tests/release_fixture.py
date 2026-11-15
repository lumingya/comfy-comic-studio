"""Small reviewed release seeds independent of the developer's mutable workspace."""

import hashlib
import json
from pathlib import Path


def write_release_seed(root: Path) -> dict[str, bytes]:
    shipped = {
        "albums/demo/album.json": b'{"id":"demo","title":"Shipped album","steps":[]}',
        "albums/demo/images/image.webp": b"reviewed image bytes",
    }
    for name, raw in shipped.items():
        path = root / "data" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    (root / "data/distribution.json").write_text(
        json.dumps(
            {
                "schema": "mio.distribution.v1",
                "version": "test",
                "files": {name: hashlib.sha256(raw).hexdigest() for name, raw in shipped.items()},
            }
        ),
        encoding="utf-8",
    )
    return shipped
