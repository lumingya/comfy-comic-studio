import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AlbumTemplateDoc } from '../../api/open';
import { TemplateEditorFields } from './TemplateEditorFields';

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
