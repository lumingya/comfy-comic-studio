import type { Panel, Series } from '../../api/types';

const tags = (items: (string | null | undefined)[]) => items.filter(Boolean).join(', ');

/**
 * What `{name}` resolves to for this panel — the client mirror of `pipeline/variables.table`
 * (panel-local `$name` values → series variables → built-ins).  Used to paint the prompt box;
 * the compiled preview from the server stays the source of truth.
 */
export function variableTable(series: Series, panel: Panel): Record<string, string> {
  const out: Record<string, string> = {};
  const cast: string[] = [];
  panel.characters.forEach((pc, i) => {
    const ch = series.bible.characters.find((c) => c.id === pc.character_id);
    if (!ch) return;
    const outfit = (ch.outfits ?? {})[pc.outfit] ?? [];
    const value = tags([...ch.tag_description, ch.trigger, ...outfit, ...(pc.tags ?? [])]);
    cast.push(value);
    if (i < 4) out[`char${i + 1}`] = value;
    out[ch.name] = value;
    out[ch.id!] = value;
  });
  out.character = out['角色'] = tags(cast);
  const loc = series.bible.locations.find((l) => l.id === panel.location_id);
  out.scene = out['场景'] = loc ? tags(loc.tags) : '';
  const style = series.bible.styles[0];
  out.style = out['画风'] = style ? tags(style.tag_description) : '';
  out.description = out['描述'] = panel.description;
  out.shot = panel.shot;
  out.angle = panel.angle;
  for (const [k, v] of Object.entries(series.variables ?? {})) out[k] = String(v ?? '');
  for (const [k, v] of Object.entries(panel.overrides.values ?? {}))
    if (k.startsWith('$')) out[k.slice(1)] = String(v ?? '');
  return out;
}

/** Variables worth offering as one-click chips: the series' own presets first, then built-ins. */
export function suggestedVariables(series: Series): string[] {
  const own = Object.keys(series.variables ?? {});
  const builtins = ['character', 'style', 'scene'].filter((k) => !own.includes(k));
  return [...own, ...builtins];
}
