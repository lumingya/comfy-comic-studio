"""Token-aware variable search and one pure preview/apply transformation."""

from pydantic import ValidationError

from ..models import Episode, Series
from ..pipeline.variables import PATTERN, series_table
from ..storage import Conflict
from .common import head, snapshot
from .fields import FIELDS, definitions, text_fields, variable_bindings
from .models import (
    VariableApply,
    VariableChange,
    VariableOccurrence,
    VariableOperation,
    VariablePreview,
    VariableQuery,
    VariableResult,
    VariableSearch,
)


def _matches(text, key):
    # Exact legal keys only: do not reinterpret whitespace, wildcard syntax or {{escapes}}.
    return [match for match in PATTERN.finditer(text) if match.group(1) == key]


def find_variables(ctx, series_id: str, query: VariableQuery) -> VariableSearch:
    with ctx.store.tx():
        series, episodes = snapshot(ctx.store, series_id)
        data, eps = series.model_dump(), [e.model_dump() for e in episodes]
        occurrences = []
        for field in text_fields(data, eps):
            count = len(_matches(field.value, query.key))
            if count:
                occurrences.append(
                    VariableOccurrence(
                        owner_id=field.owner_id,
                        path=field.path,
                        kind="text",
                        value=field.value,
                        count=count,
                        locked=field.locked,
                    )
                )
        for key, owner, path, _, _, _, locked in definitions(data, eps):
            if key == query.key:
                occurrences.append(
                    VariableOccurrence(
                        owner_id=owner,
                        path=path,
                        kind="definition",
                        value=key,
                        locked=locked,
                    )
                )
        for binding, path in variable_bindings(data):
            if binding["value"] == query.key:
                occurrences.append(
                    VariableOccurrence(
                        owner_id=series.id,
                        path=path,
                        kind="binding",
                        value=query.key,
                    )
                )
        return VariableSearch(
            head=head(series, episodes), key=query.key, occurrences=occurrences, fields=FIELDS
        )


def transform(series: Series, episodes: list[Episode], command: VariableOperation):
    """Return private, validated replacements and a reviewable plan; never mutate inputs."""
    data, eps = series.model_dump(), [ep.model_dump() for ep in episodes]
    changes, conflicts = [], []

    def record(owner, path, kind, before, after, locked=False):
        if before == after:
            return
        changes.append(
            VariableChange(
                owner_id=owner,
                path=path,
                kind=kind,
                before=before,
                after=after,
                locked=locked,
            )
        )
        if locked and not command.include_locked:
            conflicts.append(f"locked text: {owner}{path}")

    defs = list(definitions(data, eps))
    if command.action == "rename":
        if any(key == command.value for key, *_ in defs):
            conflicts.append(f"variable key already defined: {command.value}")
        builtins = series_table(series.model_copy(update={"variables": {}}))
        builtins.update(
            {
                key: ""
                for key in (
                    "character",
                    "角色",
                    "scene",
                    "场景",
                    "description",
                    "描述",
                    "shot",
                    "angle",
                    "char1",
                    "char2",
                    "char3",
                    "char4",
                    "style",
                    "画风",
                )
            }
        )
        if command.value in builtins:
            conflicts.append(f"new key would shadow a built-in variable: {command.value}")
        if not any(key == command.key for key, *_ in defs) and command.key in builtins:
            conflicts.append("built-in variables cannot be renamed; use replace for references")

    replacement = "{" + command.value + "}" if command.action == "rename" else command.value
    for field in text_fields(data, eps):
        if not _matches(field.value, command.key):
            continue
        before = field.value
        after = PATTERN.sub(
            lambda m: replacement if m.group(1) == command.key else m.group(0), before
        )
        record(field.owner_id, field.path, "text", before, after, field.locked)
        field.set(after)

    for binding, path in variable_bindings(data):
        if binding["value"] == command.key:
            record(series.id, path, "binding", command.key, command.value)
            binding["value"] = command.value
            if command.action == "replace":
                record(
                    series.id,
                    path.removesuffix("value") + "source",
                    "binding",
                    "variable",
                    "literal",
                )
                binding["source"] = "literal"

    if command.action == "rename":
        for key, owner, path, container, actual_key, is_dict, locked in defs:
            if key != command.key:
                continue
            record(owner, path, "definition", command.key, command.value, locked)
            if is_dict:
                prefix = "$" if owner != series.id else ""
                # Collision is reported above; never overwrite it even in a preview snapshot.
                if prefix + command.value not in container:
                    container[prefix + command.value] = container.pop(actual_key)
            else:
                container[actual_key] = command.value

    if not command.include_locked and any(c.owner_id == series.id for c in changes):
        if any(p.locked for ep in episodes for p in ep.panels) or any(
            layer.locked for ep in episodes for layer in ep.strip.lettering
        ):
            conflicts.append(
                "series text/definitions may affect locked panels; set include_locked to edit"
            )
    updated_series, updated_episodes = series, episodes
    try:
        updated_series = Series.model_validate(data)
        updated_episodes = [Episode.model_validate(ep) for ep in eps]
    except ValidationError as exc:
        conflicts.append(f"replacement would make a document invalid: {exc.errors()[0]['msg']}")
    preview = VariablePreview(
        head=head(series, episodes),
        changes=changes,
        conflicts=list(dict.fromkeys(conflicts)),
        fields=FIELDS,
    )
    return preview, updated_series, updated_episodes


def preview_variables(ctx, series_id: str, command: VariableOperation) -> VariablePreview:
    with ctx.store.tx():
        series, episodes = snapshot(ctx.store, series_id)
        return transform(series, episodes, command)[0]


def apply_variables(ctx, series_id: str, command: VariableApply) -> VariableResult:
    # Enumerate owners before the guard; the full head is rechecked under the guard + tx.
    owners = [series_id, *(ep.id for ep in ctx.store.list_episodes(series_id))]
    with ctx.engine.operation_guard(owners), ctx.store.tx():
        series, episodes = snapshot(ctx.store, series_id)
        if head(series, episodes) != command.expected_head:
            raise Conflict("series content changed; preview the variable operation again")
        preview, series, episodes = transform(series, episodes, command)
        if preview.conflicts:
            raise Conflict("; ".join(preview.conflicts))
        changed = {change.owner_id for change in preview.changes}
        if series.id in changed:
            ctx.store.save_series(series)
        for episode in episodes:
            if episode.id in changed:
                ctx.store.save_episode(episode)
        return VariableResult(
            **preview.model_dump(exclude={"head"}),
            head=head(series, episodes),
            previous_head=command.expected_head,
            series=series,
            episodes=[episode for episode in episodes if episode.id in changed],
        )
