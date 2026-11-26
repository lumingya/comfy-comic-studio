import { afterEach, describe, expect, it, vi } from 'vitest';

const { readFileSync } = await vi.importActual<{
  readFileSync: (path: URL, encoding: 'utf8') => string;
}>('node:fs');

// CSS imports are disabled in Vitest; an indirect URL also avoids Vite's asset rewrite.
const moduleUrl = import.meta.url;
const backdropCss = readFileSync(new URL('./themeBackdrop.css', moduleUrl), 'utf8');
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

const surfaces = [
  ['Radix modal', '<div class="dialog lg"></div>', '.dialog'],
  ['Radix drawer', '<aside class="drawer"></aside>', '.drawer'],
  ['command palette', '<dialog class="command-dialog" open></dialog>', '.command-dialog'],
  ['prompt completion', '<div id="prompt-completion" role="listbox"></div>', '#prompt-completion'],
  ['assembly modal', '<dialog id="modal" open></dialog>', '#modal'],
  ['help dialog', '<dialog id="guide-dialog" open></dialog>', '#guide-dialog'],
  ['template customization', '<dialog class="template-dialog" open></dialog>', '.template-dialog'],
  [
    'template preview',
    '<dialog class="album-preview-dialog" open></dialog>',
    '.album-preview-dialog',
  ],
  [
    'reader export drawer',
    '<dialog id="reader" open><aside class="presentation-drawer export-drawer"></aside></dialog>',
    '.export-drawer',
  ],
] as const;

function mount(markup: string, selector: string, mode: string, dynamic?: boolean) {
  const frame = document.createElement('iframe');
  frames.push(frame);
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.documentElement.dataset.theme = mode;
  if (dynamic !== undefined) {
    doc.documentElement.dataset.themeDynamicBackground = String(dynamic);
  }
  const style = doc.createElement('style');
  style.textContent = backdropCss;
  doc.head.append(style);
  doc.body.innerHTML = markup;
  expect(style.sheet?.cssRules.length).toBeGreaterThan(0);
  const rules = Array.from(style.sheet!.cssRules).filter(
    (rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE,
  );
  const target = doc.querySelector(selector)!;
  const matchingRules = rules.filter(
    (rule) => !rule.selectorText.includes('::') && target.matches(rule.selectorText),
  );
  return { rules, matchingRules };
}

describe('dynamic wallpaper overlay surfaces', () => {
  it.each(surfaces)('gives the %s a stable surface in both theme modes', (_, markup, selector) => {
    for (const mode of ['light', 'dark']) {
      const { matchingRules } = mount(markup, selector, mode, true);
      const backgrounds = matchingRules
        .map((rule) => rule.style.getPropertyValue('background'))
        .filter(Boolean);
      expect(backgrounds.at(-1)).toBe('var(--wallpaper-surface)');
    }
  });

  it.each(surfaces)('preserves static theme surfaces for the %s', (_, markup, selector) => {
    for (const mode of ['light', 'dark']) {
      for (const dynamic of [undefined, false]) {
        const { matchingRules } = mount(markup, selector, mode, dynamic);
        expect(matchingRules.some((rule) => rule.style.getPropertyValue('background'))).toBe(false);
      }
    }
  });

  it('keeps the reader stage and ordinary page panels outside the surface override', () => {
    for (const selector of ['#reader', '.panel']) {
      const { matchingRules } = mount(
        '<dialog id="reader" open><div class="panel"></div></dialog>',
        selector,
        'dark',
        true,
      );
      expect(matchingRules.some((rule) => rule.style.getPropertyValue('background'))).toBe(false);
    }
  });

  it('does not add wallpaper blur to the overlay surfaces', () => {
    const { rules } = mount('<div class="dialog"></div>', '.dialog', 'dark', true);
    for (const rule of rules) {
      for (const property of ['backdrop-filter', '-webkit-backdrop-filter']) {
        expect(['', 'none']).toContain(rule.style.getPropertyValue(property));
      }
    }
  });
});
