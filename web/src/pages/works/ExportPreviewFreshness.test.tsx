import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { PresentationDrawer } from './ExportDrawer';
import type { ExportDraft } from './presentation';

const draft: ExportDraft = {
  themeColor: '',
  border: 0,
  signature: '',
  captions: true,
  deduplicateCaptions: true,
  prompts: false,
  profile: 'auto',
  preset: 'webtoon',
  quality: 'q90',
};

afterEach(() => vi.unstubAllGlobals());

it('requests current artwork when export preview reopens with unchanged settings', async () => {
  let artwork = 'Originally adopted artwork';
  const html = () => `<!doctype html><html><body>${artwork}</body></html>`;
  const calls = mockFetch({
    'GET /api/export/presets': [],
    'POST /api/export/album': () =>
      new Response(html(), { headers: { 'content-type': 'text/html' } }),
  });
  renderWithProviders(
    <PresentationDrawer
      open
      onClose={vi.fn()}
      templates={[{ id: 'export-paper', title: 'Paper', description: '' }]}
      infos={[]}
      look="export-paper"
      native="mio-fit"
      onLook={vi.fn()}
      draft={draft}
      onDraft={vi.fn()}
      layout="webtoon"
      onLayout={vi.fn()}
      seriesId="series"
      episodes={[{ id: 'episode', title: 'Episode' }]}
      episodeId="episode"
      title="Album"
      lettered
      onPlatform={vi.fn()}
    />,
  );
  const open = () =>
    fireEvent.click(screen.getByRole('button', { name: i18n.t('reader.templatePreview.open') }));
  const frame = () => screen.getByTitle(i18n.t('reader.templatePreview.frameTitle'));

  open();
  await waitFor(() => expect(frame()).toHaveAttribute('srcdoc', html()));
  fireEvent.click(screen.getByRole('button', { name: i18n.t('reader.templatePreview.close') }));

  // Adoption changes the server's rendered album without changing export parameters or IDs.
  artwork = 'Newly adopted artwork';
  open();
  await waitFor(() => expect(frame()).toHaveAttribute('srcdoc', html()));
  const previews = calls.filter((call) => call.url === '/api/export/album');
  expect(previews).toHaveLength(2);
  expect(previews[1].body).toEqual(previews[0].body);
});
