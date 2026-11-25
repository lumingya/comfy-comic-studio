import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { PresentationDrawer } from './ExportDrawer';
import { ExportPreviewDialog } from './ExportPreviewDialog';
import { TemplatePreview, useExportDraft, type ExportDraft } from './presentation';
import { ExportBooks } from './ShelfDialogs';
import type { SeriesCard } from '../../api/types';
import { series } from '../../test/fixtures';
import { TemplateStudio } from './TemplateStudio';
import type { AlbumTemplateDoc, AlbumTemplateInfo } from '../../api/open';

const t = (key: string) => i18n.t(key);
const draft: ExportDraft = {
  themeColor: '',
  border: 0,
  signature: '',
  captions: false,
  deduplicateCaptions: true,
  prompts: false,
  includeSourceData: true,
  profile: 'auto',
  preset: 'webtoon',
  quality: 'q90',
};
const completed = { id: 'job_export', state: 'completed', items: [] };
const routes = {
  'GET /api/settings': {},
  'GET /api/export/presets': [],
  'POST /api/export/jobs/album': completed,
  'GET /api/jobs/job_export': completed,
  'GET /api/export/jobs/job_export/file': {},
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:export'), revokeObjectURL: vi.fn() }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('never restores or stores source-data consent in saved export preferences or platform presets', async () => {
  mockFetch(routes);
  localStorage.setItem(
    'mio.reader.export',
    JSON.stringify({ includeSourceData: true, preset: 'remembered', profile: 'archive' }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const first = renderHook(() => useExportDraft(), { wrapper });
  expect(first.result.current[0]).toMatchObject({ includeSourceData: false, preset: 'remembered' });
  act(() => first.result.current[1]({ includeSourceData: true, preset: 'chosen' }));
  expect(first.result.current[0]).toMatchObject({ includeSourceData: true, prompts: false });
  const stored = JSON.parse(localStorage.getItem('mio.reader.export')!);
  expect(stored).not.toHaveProperty('includeSourceData');
  expect(stored).not.toHaveProperty('include_source_data');
  expect(stored.preset).toBe('chosen');
  first.unmount();
  const second = renderHook(() => useExportDraft(), { wrapper });
  expect(second.result.current[0]).toMatchObject({ includeSourceData: false, preset: 'chosen' });
});

it('requires fresh consent each time the reader export dialog opens and does not enable prompt display', async () => {
  const calls = mockFetch(routes);
  function Harness({ open }: { open: boolean }) {
    const [settings, update] = useExportDraft();
    return (
      <PresentationDrawer
        open={open}
        onClose={vi.fn()}
        templates={[{ id: 'export-monograph', title: 'Monograph', description: '' }]}
        infos={[]}
        look="export-monograph"
        native="mio-fit"
        onLook={vi.fn()}
        draft={settings}
        onDraft={update}
        layout="webtoon"
        onLayout={vi.fn()}
        seriesId="series"
        episodes={[{ id: 'episode', title: 'Episode' }]}
        episodeId="episode"
        title="Album"
        lettered
        onPlatform={vi.fn()}
      />
    );
  }
  const view = renderWithProviders(<Harness open />);
  const consent = () => screen.getByRole('checkbox', { name: t('exportUi.includeSourceData') });
  expect(consent()).not.toBeChecked();
  expect(screen.getByText(t('exportUi.sourceDataWarning'))).toBeVisible();
  fireEvent.click(consent());
  fireEvent.click(screen.getByRole('button', { name: t('common.export') }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t('exportUi.started')));
  expect(calls.find((call) => call.url === '/api/export/jobs/album')?.body).toMatchObject({
    include_source_data: true,
    show_prompts: false,
  });
  expect(JSON.parse(localStorage.getItem('mio.reader.export')!)).not.toHaveProperty(
    'includeSourceData',
  );
  view.rerender(<Harness open={false} />);
  view.rerender(<Harness open />);
  expect(consent()).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: t('common.export') }));
  await waitFor(() =>
    expect(calls.filter((call) => call.url === '/api/export/jobs/album')).toHaveLength(2),
  );
  expect(calls.filter((call) => call.url === '/api/export/jobs/album')[1].body).toMatchObject({
    include_source_data: false,
    show_prompts: false,
  });
});

it('forces source data off in the live reader and full-screen preview even with consent checked', async () => {
  const calls = mockFetch({
    'POST /api/export/album': () => new Response('<!doctype html><p>Reading preview</p>'),
  });
  renderWithProviders(
    <>
      <TemplatePreview episodeId="ep-live" templateId="export-monograph" lettered draft={draft} />
      <ExportPreviewDialog
        open
        onClose={vi.fn()}
        episodeId="ep-trial"
        templateId="export-monograph"
        lettered
        draft={draft}
        title="Album"
      />
    </>,
  );
  await screen.findByTitle(t('reader.previewTitle'));
  await screen.findByTitle(t('reader.templatePreview.frameTitle'));
  expect(calls).toHaveLength(2);
  for (const call of calls)
    expect(call.body).toMatchObject({
      include_source_data: false,
      show_prompts: false,
      show_captions: false,
      image_profile: 'preview',
    });
});

it('forces source data off in the template studio preview', async () => {
  const template: AlbumTemplateDoc = {
    id: 'export-monograph',
    title: 'Monograph',
    description: '',
    author: '',
    version: '',
    layout: 'webtoon',
    options: {
      accent: '#123456',
      background: '#ffffff',
      paper: '#ffffff',
      text: '#000000',
      width: 900,
      gap: 20,
      radius: 0,
      font: 'serif',
      subtitle: '',
      cover_crop: false,
      cover_focal_x: 50,
      cover_focal_y: 50,
      chapter_header: true,
    },
    html: '<p>Template</p>',
    assets: {},
  };
  const calls = mockFetch({
    'GET /api/album-templates/export-monograph': template,
    'POST /api/export/album': () => new Response('<!doctype html><p>Studio preview</p>'),
  });
  renderWithProviders(
    <TemplateStudio
      templates={[{ ...template, source: 'builtin', layout_name: 'Webtoon' } as AlbumTemplateInfo]}
      initialId={template.id}
      preview={{ episodeId: 'episode', lettered: true, captions: false }}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
  expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
    include_source_data: false,
    image_profile: 'preview',
    show_captions: false,
  });
});

it('defaults batch HTML exports to no source data and resets consent when the dialog reopens', async () => {
  const calls = mockFetch({
    'GET /api/settings': {},
    'GET /api/album-templates': [{ id: 'export-monograph', title: 'Monograph' }],
    'GET /api/series/a/episodes': { items: [{ id: 'ep-a' }], total: 1 },
    'POST /api/export/album': {},
  });
  const close = vi.fn();
  const books = [{ ...series, id: 'a' }] as SeriesCard[];
  const element = (open: boolean) => (
    <ExportBooks open={open} onOpenChange={close} books={books} collectionTitle="Albums" />
  );
  const view = renderWithProviders(element(true));
  const consent = () => screen.getByRole('checkbox', { name: t('exportUi.includeSourceData') });
  expect(consent()).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: t('common.export') }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(calls.find((call) => call.url === '/api/export/album')?.body).toMatchObject({
    include_source_data: false,
  });
  fireEvent.click(consent());
  fireEvent.click(screen.getByRole('button', { name: t('common.export') }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
  expect(calls.filter((call) => call.url === '/api/export/album')[1].body).toMatchObject({
    include_source_data: true,
  });
  expect(calls.filter((call) => call.url === '/api/export/album')[1].body).not.toHaveProperty(
    'show_prompts',
  );
  view.rerender(element(false));
  view.rerender(element(true));
  expect(consent()).not.toBeChecked();
});
