import { describe, expect, it } from 'vitest';
import en from './en';
import zh from './zh';

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, key: string): string | Tree | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return node;
}

function leaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`),
  );
}

// Every UI source file as text (Vite raw import; test files excluded).
const files = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const code = Object.values(files);
// t('a.b') / t("a.b") and template keys t(`a.b.${x}`) → prefix "a.b"
const staticKeys = new Set(
  code.flatMap((c) => [...c.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)].map((m) => m[1])),
);
const prefixes = new Set(
  code.flatMap((c) => [...c.matchAll(/\bt\(\s*`([\w.]+)\.\$\{/g)].map((m) => m[1])),
);

describe('i18n', () => {
  it('finds keys in the sources', () => {
    expect(staticKeys.size).toBeGreaterThan(100);
  });

  for (const [name, dict] of [
    ['zh', zh],
    ['en', en],
  ] as const) {
    it(`${name} defines every static key used in the UI`, () => {
      const missing = [...staticKeys].filter((k) => typeof lookup(dict as Tree, k) !== 'string');
      expect(missing).toEqual([]);
    });

    it(`${name} defines every dynamic key group`, () => {
      const missing = [...prefixes].filter((k) => typeof lookup(dict as Tree, k) !== 'object');
      expect(missing).toEqual([]);
    });
  }

  it('en mirrors zh exactly', () => {
    expect(leaves(en as Tree).sort()).toEqual(leaves(zh as Tree).sort());
  });
});
