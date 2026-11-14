"""Validate live references without mistaking historical take provenance for ownership."""

from ..asset_refs import referenced_assets
from ..storage import NotFound
from .models import WorkSnapshot


def validate_references(snapshot: WorkSnapshot, store) -> list[str]:
    series, episodes = snapshot.series, snapshot.episodes
    errors: list[str] = []

    def unique(values, label):
        ids = [item.id for item in values]
        if len(ids) != len(set(ids)):
            errors.append(f"duplicate {label} IDs")
        return set(ids)

    unique(episodes, "episode")
    unique(series.presets, "preset")
    unique(series.variants, "variant")
    orders = [episode.order for episode in episodes if not episode.deleted_at]
    if len(orders) != len(set(orders)):
        errors.append("duplicate live episode orders")
    chars = {item.id for item in series.bible.characters}
    locations = {item.id for item in series.bible.locations}
    props = {item.id for item in series.bible.props}
    styles = {item.id for item in series.bible.styles}
    profiles = {series.default_profile_id}
    for preset in series.presets:
        groups = unique(preset.groups, "preset group")
        unique(preset.entries, "preset entry")
        if any(entry.group_id and entry.group_id not in groups for entry in preset.entries):
            errors.append(f"preset {preset.id} references a missing group")
    for variant in series.variants:
        profiles.add(variant.profile_id)
        if not set(variant.characters) <= chars or (
            variant.style_id and variant.style_id not in styles
        ):
            errors.append(f"variant {variant.id} references a missing character or style")
        for cid, changes in variant.characters.items():
            original = series.bible.character(cid)
            if original:
                try:
                    original.model_validate({**original.model_dump(), **changes, "id": cid})
                except ValueError:
                    errors.append(f"variant {variant.id} has an invalid character patch")
    for episode in episodes:
        if episode.series_id != series.id:
            errors.append(f"episode {episode.id} belongs to a different work")
        try:
            existing = store.get_episode(episode.id, include_deleted=True)
            if existing.series_id != series.id:
                errors.append(f"episode ID now belongs to a different work: {episode.id}")
        except NotFound:
            pass
        panels = {panel.id for panel in episode.panels}
        takes = unique(episode.takes, "take")
        for panel in episode.panels:
            profiles.add(panel.overrides.profile_id)
            if not {c.character_id for c in panel.characters} <= chars:
                errors.append(f"panel {panel.id} references a missing character")
            if panel.location_id and panel.location_id not in locations:
                errors.append(f"panel {panel.id} references a missing location")
            if not set(panel.props) <= props:
                errors.append(f"panel {panel.id} references a missing prop")
            if any(d.speaker_id and d.speaker_id not in chars for d in panel.dialogues):
                errors.append(f"panel {panel.id} references a missing speaker")
            for control in panel.controls:
                if control.source == "take" and control.take_id not in takes:
                    errors.append(f"panel {panel.id} control references a missing take")
                if control.source == "asset" and not control.asset_id:
                    errors.append(f"panel {panel.id} control has no asset")
        # A take may intentionally outlive its deleted panel, parent or variant.
        # These historical fields must not prevent restoring its retained image.
        if not set(episode.strip.panel_boxes) <= panels or not set(episode.strip.crops) <= panels:
            errors.append(f"episode {episode.id} layout references a missing panel")
        for layer in episode.strip.lettering:
            if (layer.panel_id and layer.panel_id not in panels) or (
                layer.bridge_to and layer.bridge_to not in panels
            ):
                errors.append(f"lettering {layer.id} references a missing panel")
            if layer.speaker_id and layer.speaker_id not in chars:
                errors.append(f"lettering {layer.id} references a missing speaker")
    for profile_id in sorted(profiles - {None}):
        try:
            store.get_doc("profile", profile_id)
        except NotFound:
            errors.append(f"missing render profile: {profile_id}")
    return errors


def assets_for(snapshot: WorkSnapshot) -> set[str]:
    return referenced_assets(snapshot.series, snapshot.episodes)
