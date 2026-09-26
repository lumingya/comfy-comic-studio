"""Create the Ed25519 key pair that signs release manifests.

    python tools/release_keygen.py --out ~/mio-release.key

* The secret (64 hex chars) goes to ``--out`` — keep it outside the repository, and store it as
  the ``MIO_RELEASE_KEY`` secret of the GitHub repository for the release workflow.
* Paste the printed line into ``server/mio_server/update/keys.py`` → ``TRUSTED_KEYS`` and commit:
  builds from then on accept manifests signed by this key.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from mio_server.update import ed25519  # noqa: E402
from mio_server.update.manifest import key_id  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="where to write the secret key (hex)")
    args = parser.parse_args()
    out = Path(args.out).expanduser()
    if out.exists():
        raise SystemExit(f"{out} already exists; refusing to overwrite a signing key")
    secret, public = ed25519.generate()
    out.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(secret.hex() + "\n")
    print(f"secret key written to {out} (keep it private)")
    print("add to server/mio_server/update/keys.py TRUSTED_KEYS:")
    print(f'    "{key_id(public.hex())}": "{public.hex()}",')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
