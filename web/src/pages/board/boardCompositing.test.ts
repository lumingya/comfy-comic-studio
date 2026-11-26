import { afterEach, describe, expect, it, vi } from 'vitest';

// Vitest's css:false replaces CSS module imports, including ?raw, with an empty
// string. Read the source so the assertions inspect the actual browser rules.
const { readFileSync } = await vi.importActual<{
  readFileSync: (path: URL, encoding: 'utf8') => string;
}>('node:fs');
const moduleUrl = import.meta.url;
const studioCss = readFileSync(new URL('../../styles/studio.css', moduleUrl), 'utf8');

const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

function badgeRules() {
  const frame = document.createElement('iframe');
  frames.push(frame);
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const style = doc.createElement('style');
  style.textContent = studioCss;
  doc.head.append(style);
  doc.body.innerHTML = '<div class="take-badges"><span class="chip accent">Adopted</span></div>';
  const chip = doc.querySelector('.chip')!;
  return Array.from(style.sheet!.cssRules).filter(
    (rule): rule is CSSStyleRule =>
      rule.type === CSSRule.STYLE_RULE &&
      !(rule as CSSStyleRule).selectorText.includes('::') &&
      chip.matches((rule as CSSStyleRule).selectorText),
  );
}

describe('long-board badge compositing', () => {
  // jsdom cannot time Chrome's Layerize work. This protects the measured CSS
  // invariant; the 120-panel / 1,440-candidate browser probe verifies frame times.
  it('does not create a backdrop-filter layer for every candidate badge', () => {
    const rules = badgeRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const property of ['backdrop-filter', '-webkit-backdrop-filter']) {
        expect(['', 'none']).toContain(rule.style.getPropertyValue(property));
      }
    }
  });

  it('keeps a readable theme surface without overriding semantic chip colors', () => {
    const rules = badgeRules();
    const backgrounds = rules
      .map((rule) => rule.style.getPropertyValue('background'))
      .filter(Boolean);
    expect(backgrounds.at(-1)).toBe('color-mix(in srgb, var(--bg) 92%, transparent)');
    expect(rules.every((rule) => !rule.style.getPropertyValue('color'))).toBe(true);
  });
});
