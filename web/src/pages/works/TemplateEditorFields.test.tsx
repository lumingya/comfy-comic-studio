import { fireEvent, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AlbumTemplateDoc, AlbumTemplateInfo } from '../../api/open';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { TemplateEditorFields } from './TemplateEditorFields';
import { TemplateStudio } from './TemplateStudio';

const template: AlbumTemplateDoc = {
  id: 'export-monograph',
  formatVersion: 1,
  title: 'Monograph',
  description: '',
  author: '',
  version: '3.0.0',
  layout: 'gallery',
  options: {
    accent: '#8b5a3c',
    background: '#f5f1e9',
    paper: '#fcfbf7',
    text: '#1a1816',
    width: 1080,
    gap: 48,
    radius: 8,
    font: 'serif',
    subtitle: '',
    cover_crop: true,
    cover_focal_x: 50,
    cover_focal_y: 50,
    chapter_header: true,
  },
  html: '<article data-mio-curated-edition><h1>{{title}}</h1>.edition-heading</article>',
  assets: {},
};

it('edits subtitle, focal crop and chapter header as template options', () => {
  const onChange = vi.fn();
  const { container } = render(
    <TemplateEditorFields tpl={template} tab="design" builtin onChange={onChange} />,
  );

  fireEvent.change(container.querySelector<HTMLInputElement>('#et-subtitle')!, {
    target: { value: '暮色来信' },
  });
  fireEvent.change(container.querySelector<HTMLInputElement>('#et-cover-focus-x')!, {
    target: { value: '24' },
  });
  fireEvent.change(container.querySelector<HTMLInputElement>('#et-cover-focus-y')!, {
    target: { value: '76' },
  });
  fireEvent.click(container.querySelector<HTMLInputElement>('#et-chapter-header')!);

  expect(onChange).toHaveBeenLastCalledWith({
    ...template,
    options: {
      ...template.options,
      chapter_header: false,
    },
  });
  expect(onChange).toHaveBeenCalledWith({
    ...template,
    options: { ...template.options, subtitle: '暮色来信' },
  });
  expect(onChange).toHaveBeenCalledWith({
    ...template,
    options: { ...template.options, cover_focal_x: 24 },
  });
  expect(onChange).toHaveBeenCalledWith({
    ...template,
    options: { ...template.options, cover_focal_y: 76 },
  });
});

it('refreshes the unsaved live preview after a design edit without saving the template', async () => {
  const calls = mockFetch({
    'GET /api/album-templates/export-monograph': template,
    'POST /api/export/album': (body: unknown) => {
      const draft = (body as { template: AlbumTemplateDoc }).template;
      return new Response(`<!doctype html><p>${draft.options.subtitle}</p>`);
    },
  });
  const onSaved = vi.fn();
  renderWithProviders(
    <TemplateStudio
      templates={[{ ...template, source: 'builtin', layout_name: 'Gallery' } as AlbumTemplateInfo]}
      initialId={template.id}
      preview={{ episodeId: 'episode', lettered: true, captions: false }}
      onSaved={onSaved}
      onClose={vi.fn()}
    />,
  );

  await waitFor(() =>
    expect(
      calls.filter((call) => call.method === 'POST' && call.url === '/api/export/album'),
    ).toHaveLength(1),
  );
  fireEvent.change(document.getElementById('et-subtitle')!, {
    target: { value: '暮色专刊' },
  });

  await waitFor(() =>
    expect(
      calls.filter((call) => call.method === 'POST' && call.url === '/api/export/album'),
    ).toHaveLength(2),
  );
  const previewCalls = calls.filter(
    (call) => call.method === 'POST' && call.url === '/api/export/album',
  );
  expect((previewCalls[1].body as { template: AlbumTemplateDoc }).template.options.subtitle).toBe(
    '暮色专刊',
  );
  await waitFor(() =>
    expect(document.getElementById('template-preview')).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('暮色专刊'),
    ),
  );
  expect(calls.some((call) => call.method === 'POST' && call.url.includes('/import'))).toBe(false);
  expect(onSaved).not.toHaveBeenCalled();
});
