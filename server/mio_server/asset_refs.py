"""One reference walk for current documents, snapshots and portable creation kits."""

from __future__ import annotations

from .models import Episode, Series


def referenced_assets(series: Series, episodes: list[Episode], documents=()) -> set[str]:
    """Include controls, variant patches, cloud request references and edit masks."""
    found: set[str] = set()

    def walk(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"asset_id", "cover_asset_id", "mask_asset_id", "$asset"} and isinstance(
                    child, str
                ):
                    if child:
                        found.add(child)
                else:
                    walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(series.model_dump(mode="json"))
    for episode in episodes:
        walk(episode.model_dump(mode="json"))
    for document in documents:
        walk(document.model_dump(mode="json"))
    return found
