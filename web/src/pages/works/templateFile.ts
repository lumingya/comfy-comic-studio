/**
 * 导入画册模板 (legacy parseExportTemplateFile): a template file is either the JSON document
 * (bare, or wrapped as `{ template }` by old exports) or a plain HTML page — its <title> becomes
 * the name and a `comfycomic-export-template` meta tag, when present, carries the rest.
 * Every import gets a fresh id, so it is always an independent copy that never replaces an
 * existing template.
 */

const LEGACY_KIND = 'comfycomic.export-template';
const META = /<meta\b[^>]*comfycomic-export-template[^>]*>\s*/gi;

export const newTemplateId = () =>
  `my-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export class TemplateFileError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function decodeMeta(content: string): Record<string, unknown> {
  const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  const meta: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isRecord(meta)) throw new Error('meta');
  return meta;
}

export function parseTemplateFile(
  text: string,
  fileName: string,
  messages: { invalid: string; notTemplate: string; badMeta: string; fromHtml: string },
  id: () => string = newTemplateId,
): Record<string, unknown> {
  const name = fileName.replace(/\.(html?|json)$/i, '').trim() || 'template';
  if (/^\s*[[{]/.test(text)) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new TemplateFileError(messages.invalid);
    }
    const tpl = isRecord(data) && isRecord(data.template) ? data.template : data;
    if (!isRecord(tpl)) throw new TemplateFileError(messages.invalid);
    if (typeof tpl.kind === 'string' && tpl.kind !== LEGACY_KIND)
      throw new TemplateFileError(messages.notTemplate);
    if (typeof tpl.html !== 'string') throw new TemplateFileError(messages.invalid);
    const title = typeof tpl.title === 'string' && tpl.title.trim() ? tpl.title.trim() : name;
    return { ...tpl, id: id(), title: title.slice(0, 80) };
  }
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const tag = doc.querySelector('meta[name="comfycomic-export-template"]');
  let meta: Record<string, unknown> = {};
  if (tag) {
    try {
      meta = decodeMeta(tag.getAttribute('content') ?? '');
    } catch {
      throw new TemplateFileError(messages.badMeta);
    }
  }
  const heading = doc.querySelector('title')?.textContent?.trim() ?? '';
  const title =
    typeof meta.title === 'string' && meta.title.trim()
      ? meta.title.trim()
      : heading && !heading.includes('{{')
        ? heading
        : name;
  return {
    description: messages.fromHtml,
    layout: 'webtoon',
    ...meta,
    // The source stays byte for byte (a DOM round trip would move loop markers out of tables).
    html: text.replace(META, ''),
    id: id(),
    title: title.slice(0, 80),
  };
}
