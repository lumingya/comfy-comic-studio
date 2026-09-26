/**
 * Vertical (竖排) typesetting — mirror of `server/mio_server/pipeline/vertical.py`.
 * Keep the tables in sync; both test suites pin the same samples.
 */

export const VERTICAL_FORMS: Record<string, string> = {
  '，': '︐',
  ',': '︐',
  '、': '︑',
  '。': '︒',
  '：': '︓',
  ':': '︓',
  '；': '︔',
  ';': '︔',
  '！': '︕',
  '!': '︕',
  '？': '︖',
  '?': '︖',
  '…': '︙',
  '‥': '︰',
  '—': '︱',
  '–': '︲',
  '（': '︵',
  '(': '︵',
  '）': '︶',
  ')': '︶',
  '｛': '︷',
  '{': '︷',
  '｝': '︸',
  '}': '︸',
  '〔': '︹',
  '〕': '︺',
  '【': '︻',
  '】': '︼',
  '《': '︽',
  '》': '︾',
  '〈': '︿',
  '〉': '﹀',
  '「': '﹁',
  '」': '﹂',
  '『': '﹃',
  '』': '﹄',
  '［': '﹇',
  '[': '﹇',
  '］': '﹈',
  ']': '﹈',
  ー: '丨',
  '～': '≀',
  '~': '≀',
};

const COMBINED: Record<string, string> = {
  '!!': '‼',
  '！！': '‼',
  '!?': '⁉',
  '！？': '⁉',
  '?!': '⁈',
  '？！': '⁈',
  '??': '⁇',
};
const NO_START = new Set('︐︑︒︓︔︕︖︙︰︶︸︺︼︾﹀﹂﹄﹈‼⁉⁈⁇');
const NO_END = new Set('︵︷︹︻︽︿﹁﹃﹇');

/** Glyphs in vertical form; whitespace dropped, `\n` kept as a break. */
export function glyphs(text: string): string[] {
  const out: string[] = [];
  const chars = Array.from(text);
  let i = 0;
  while (i < chars.length) {
    const pair = chars[i] + (chars[i + 1] ?? '');
    if (COMBINED[pair]) {
      out.push(COMBINED[pair]);
      i += 2;
      continue;
    }
    const ch = chars[i];
    i += 1;
    if (ch === '\n') out.push('\n');
    else if (/\s/.test(ch)) continue;
    else out.push(VERTICAL_FORMS[ch] ?? ch);
  }
  return out;
}

/** Balanced columns of at most `maxChars` cells; the first column is the rightmost. */
export function columns(text: string, maxChars: number): string[][] {
  const limit = Math.max(2, maxChars);
  const cols: string[][] = [];
  const paras: string[][] = [[]];
  for (const g of glyphs(text)) {
    if (g === '\n') paras.push([]);
    else paras[paras.length - 1].push(g);
  }
  for (const cells of paras) {
    if (!cells.length) continue;
    const n = Math.ceil(cells.length / limit);
    const size = Math.ceil(cells.length / n);
    const part: string[][] = [];
    for (let k = 0; k < cells.length; k += size) part.push(cells.slice(k, k + size));
    for (let k = 1; k < part.length; k++) {
      while (part[k].length && NO_START.has(part[k][0])) part[k - 1].push(part[k].shift()!);
      while (part[k - 1].length > 1 && NO_END.has(part[k - 1][part[k - 1].length - 1]))
        part[k].unshift(part[k - 1].pop()!);
    }
    cols.push(...part.filter((p) => p.length));
  }
  return cols;
}

export function blockSize(cols: string[][], fontSize: number, colGap: number): [number, number] {
  if (!cols.length) return [0, 0];
  const w = cols.length * fontSize + (cols.length - 1) * colGap;
  const h = Math.max(...cols.map((c) => c.length)) * Math.round(fontSize * 1.05);
  return [w, h];
}

/** Cell centres `(glyph, x, y)`: columns right → left, glyphs top → bottom. */
export function cellCenters(
  cols: string[][],
  center: [number, number],
  fontSize: number,
  colGap: number,
): { ch: string; x: number; y: number }[] {
  const [w, h] = blockSize(cols, fontSize, colGap);
  const step = Math.round(fontSize * 1.05);
  const out: { ch: string; x: number; y: number }[] = [];
  cols.forEach((col, k) => {
    const x = center[0] + w / 2 - fontSize / 2 - k * (fontSize + colGap);
    col.forEach((ch, j) => out.push({ ch, x, y: center[1] - h / 2 + step * j + step / 2 }));
  });
  return out;
}
