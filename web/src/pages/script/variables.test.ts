import { describe, expect, it } from 'vitest';
import { episode, series } from '../../test/fixtures';
import { suggestedVariables, variableTable } from './variables';

describe('variableTable (mirror of pipeline/variables.table)', () => {
  const panel = episode.panels[0];

  it('derives the built-ins from the panel and bible', () => {
    const withTags = {
      ...series,
      bible: {
        ...series.bible,
        characters: [{ ...series.bible.characters[0], tag_description: ['short black hair'] }],
      },
    };
    const table = variableTable(withTags, panel);
    expect(table.character).toBe('short black hair');
    expect(table.char1).toBe('short black hair');
    expect(table['林夏']).toBe('short black hair');
    expect(table.scene).toBe('convenience store');
    expect(table.style).toBe('watercolor');
    expect(table['描述']).toBe(panel.description);
  });

  it('lets series variables and panel $values override the built-ins', () => {
    const table = variableTable(
      { ...series, variables: { style: 'ink', weapon: 'katana' } },
      { ...panel, overrides: { ...panel.overrides, values: { $weapon: 'bow', steps: 30 } } },
    );
    expect(table.style).toBe('ink');
    expect(table.weapon).toBe('bow');
    expect(table.steps).toBeUndefined();
  });

  it('suggests the series presets before the built-ins', () => {
    expect(suggestedVariables({ ...series, variables: { weapon: '', style: '' } })).toEqual([
      'weapon',
      'style',
      'character',
      'scene',
    ]);
  });
});
