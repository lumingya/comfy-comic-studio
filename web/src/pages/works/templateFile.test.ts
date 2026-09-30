import { describe, expect, it } from 'vitest';
import { parseTemplateFile, TemplateFileError } from './templateFile';

const messages = {
  invalid: 'invalid',
  notTemplate: 'not-template',
  badMeta: 'bad-meta',
  fromHtml: 'from-html',
};
const id = () => 'my-fixed';
const HTML =
  '<!doctype html><html><head><title>夏日长卷</title></head><body>' +
  '<table>{{#books}}<tr>{{#frames}}<td><img src="{{image}}"></td>{{/frames}}</tr>{{/books}}</table>' +
  '</body></html>';

describe('parseTemplateFile', () => {
  it('imports a JSON document as an independent copy', () => {
    const out = parseTemplateFile(
      JSON.stringify({ id: 'mio-fit', title: '留白', html: '<p>{{title}}</p>', layout: 'manga' }),
      'x.json',
      messages,
      id,
    );
    expect(out).toMatchObject({ id: 'my-fixed', title: '留白', layout: 'manga' });
  });

  it('unwraps the legacy { template } export and checks its kind', () => {
    const wrapped = { template: { kind: 'comfycomic.export-template', title: 'T', html: 'h' } };
    expect(parseTemplateFile(JSON.stringify(wrapped), 'a.json', messages, id).title).toBe('T');
    const workflow = JSON.stringify({ kind: 'comfycomic.workflow', html: 'h' });
    expect(() => parseTemplateFile(workflow, 'w.json', messages, id)).toThrow('not-template');
    expect(() => parseTemplateFile('{"nodes": []}', 'w.json', messages, id)).toThrow(
      TemplateFileError,
    );
    expect(() => parseTemplateFile('{broken', 'w.json', messages, id)).toThrow('invalid');
  });

  it('turns an HTML page into a template and keeps the source byte for byte', () => {
    const out = parseTemplateFile(HTML, '长卷.html', messages, id);
    expect(out).toMatchObject({
      id: 'my-fixed',
      title: '夏日长卷',
      layout: 'webtoon',
      description: 'from-html',
    });
    expect(out.html).toBe(HTML);
  });

  it('names an HTML page after the file when its <title> is a placeholder', () => {
    const html = HTML.replace('夏日长卷', '{{collectionTitle}}');
    expect(parseTemplateFile(html, '我的版式.htm', messages, id).title).toBe('我的版式');
  });

  it('reads the legacy metadata tag and strips it from the source', () => {
    const meta = btoa(
      String.fromCharCode(
        ...new TextEncoder().encode(JSON.stringify({ title: '墨与叙事', layout: 'manga' })),
      ),
    );
    const html = HTML.replace(
      '</head>',
      `<meta name="comfycomic-export-template" content="${meta}"></head>`,
    );
    const out = parseTemplateFile(html, 'x.html', messages, id);
    expect(out).toMatchObject({ title: '墨与叙事', layout: 'manga' });
    expect(out.html).toBe(HTML);
    const broken = HTML.replace(
      '</head>',
      '<meta name="comfycomic-export-template" content="@@"></head>',
    );
    expect(() => parseTemplateFile(broken, 'x.html', messages, id)).toThrow('bad-meta');
  });
});
