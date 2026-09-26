import { describe, expect, it } from 'vitest';
import { bundlePanels, PanelImportError, parsePanelBundle } from './panelIO';

describe('panel import / export', () => {
  it('round-trips a bundle and accepts bare arrays / single panels', () => {
    const panels = [
      { id: 'p1', description: 'a' },
      { id: 'p2', description: 'b' },
    ] as never[];
    const text = JSON.stringify(bundlePanels(panels));
    expect(parsePanelBundle(text).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(parsePanelBundle(JSON.stringify(panels))).toHaveLength(2);
    expect(parsePanelBundle(JSON.stringify(panels[0]))).toHaveLength(1);
  });

  it('rejects junk with a typed error', () => {
    expect(() => parsePanelBundle('nope')).toThrow(PanelImportError);
    expect(() => parsePanelBundle('[]')).toThrow(PanelImportError);
    expect(() => parsePanelBundle('[1, 2]')).toThrow(PanelImportError);
    expect(() => parsePanelBundle('{"a": 1}')).toThrow(PanelImportError);
  });
});
