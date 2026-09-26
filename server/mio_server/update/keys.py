"""Release public keys this build trusts: ``key_id`` (first 16 hex chars) → public key (hex).

Empty on purpose until the maintainer creates a signing key:

    python tools/release_keygen.py --out ~/mio-release.key

then pastes the printed line here and stores the secret as the ``MIO_RELEASE_KEY`` repository
secret for the release workflow.  With no trusted key the updater only tells users where to
download releases manually — it never installs anything unverified.
"""

TRUSTED_KEYS: dict[str, str] = {}
