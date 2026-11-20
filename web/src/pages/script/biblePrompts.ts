import type { Panel, Series } from '../../api/types';
import type { PromptSources } from '../workshop/PromptSurface';
import { variableTable } from './variables';

/** Describe the same Bible-derived values the compiler exposes, without inventing new tokens. */
export function biblePromptSources(
  series: Series,
  panel: Panel,
  labels: { bible: (name: string) => string; series: string; panel: string },
): PromptSources {
  const values = variableTable(series, panel);
  const sources: PromptSources = new Map();
  const put = (keys: string[], title: string) => {
    for (const key of keys) {
      if (key in values) sources.set(key, [{ title, value: values[key] }]);
    }
  };
  const cast: string[] = [];
  panel.characters.forEach((entry, index) => {
    const character = series.bible.characters.find((item) => item.id === entry.character_id);
    if (!character) return;
    cast.push(character.name);
    put(
      [character.name, character.id!, ...(index < 4 ? [`char${index + 1}`] : [])],
      labels.bible(character.name),
    );
  });
  if (cast.length) put(['character', '角色'], labels.bible(cast.join('、')));
  const location = series.bible.locations.find((item) => item.id === panel.location_id);
  if (location) put(['scene', '场景'], labels.bible(location.name));
  const style = series.bible.styles[0];
  if (style) put(['style', '画风'], labels.bible(style.name));
  put(Object.keys(series.variables ?? {}), labels.series);
  put(
    Object.keys(panel.overrides.values ?? {})
      .filter((key) => key.startsWith('$'))
      .map((key) => key.slice(1)),
    labels.panel,
  );
  return sources;
}
