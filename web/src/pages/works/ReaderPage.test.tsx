import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { keys } from '../../api/keys';
import type { Episode } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { episode, series } from '../../test/fixtures';
import { mockFetch } from '../../test/utils';
import ReaderPage from './ReaderPage';

const savedEpisode = {
  ...episode,
  strip: { ...episode.strip, lettering: [] },
  takes: [episode.takes[0], { ...episode.takes[0], id: 'second', panel_id: 'p1' }],
};
let currentEpisode: Episode = savedEpisode;
const geometry = {
  revision: 'saved-crop-lettering-1',
  width: 800,
  height: 4000,
  panel_boxes: { p0: [0, 400, 800, 1600], p1: [0, 2600, 800, 3800] },
  captions: { p0: 'Resolved caption from server', p1: '' },
  display_captions: {} as Record<string, string>,
};
let metadata = geometry;

function mount(mode = 'single', layout = 'webtoon', suffix = '') {
  localStorage.setItem('mio.reader.mode', mode);
  localStorage.setItem('mio.reader.layout', layout);
  const calls = mockFetch({
    'GET /api/series/ser_1': series,
    'GET /api/series/ser_1/episodes': { items: [{ id: 'ep_1', title: '第一话' }] },
    'GET /api/episodes/ep_1': () => currentEpisode,
    'GET /api/episodes/ep_1/reading': () => metadata,
    'GET /api/album-templates': [
      { id: 'mio-fit', title: '留白', description: '', options: {} },
      { id: 'export-monograph', title: '典藏画集', description: '', options: {} },
      { id: 'export-nocturne', title: '暗房放映', description: '', options: {} },
      { id: 'export-folio', title: '精装对页', description: '', options: {} },
    ],
    'GET /api/settings': {},
    'GET /api/export/presets': [],
    'POST /api/export/album': () =>
      new Response('<!doctype html><p>Complete saved composition</p>', {
        headers: { 'content-type': 'text/html' },
      }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/gallery/ser_1${suffix}`]}>
        <Routes>
          <Route path="/gallery/:seriesId" element={<ReaderPage />}>
            <Route path="layout" element={<div aria-label="Layout editor" role="region" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, calls };
}

beforeEach(() => {
  currentEpisode = savedEpisode;
  metadata = structuredClone(geometry);
  localStorage.clear();
  useUI.setState({ defaultReaderMode: 'webtoon' });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.id === 'reader-canvas' ? 1400 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.id === 'reader-canvas' ? 900 : 0;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('saved reading composition', () => {
  it('falls back to Monograph when the saved template is no longer installed', async () => {
    localStorage.setItem('mio.reader.look', 'removed-template');
    const { calls } = mount();
    await screen.findByTitle('展示模板预览');
    await waitFor(() => expect(localStorage.getItem('mio.reader.look')).toBe('export-monograph'));
    const previews = calls.filter((call) => call.url === '/api/export/album');
    expect(previews.length).toBeGreaterThan(0);
    expect(
      previews.every(
        (call) => (call.body as { template_id: string }).template_id === 'export-monograph',
      ),
    ).toBe(true);
  });

  it.each(['webtoon', 'gallery', 'spread'])(
    'uses composited panels and saved captions in %s',
    async (layout) => {
      const { calls } = mount('single', layout);
      const image = await screen.findByAltText('第 1 格');
      const url = new URL(image.getAttribute('src')!, 'http://localhost');
      expect(url.pathname).toBe('/api/episodes/ep_1/panels/p0/image');
      expect(url.searchParams.get('width')).toBe('1600');
      expect(url.searchParams.get('revision')).toBe(geometry.revision);
      expect(document.querySelector('.scroll-caption')).toHaveTextContent(
        'Resolved caption from server',
      );
      expect(document.querySelector('#page-position')).toHaveTextContent(
        layout === 'spread' ? '01–02 / 02' : '01 / 02',
      );
      expect(
        [...document.querySelectorAll('img')].some((img) => img.src.includes('/api/assets/')),
      ).toBe(false);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
      expect(document.querySelector('.room-brand')).toBeNull();
      expect(document.querySelector('[data-mio-colophon]')).toBeNull();
      if (layout !== 'spread') {
        fireEvent.click(screen.getByRole('button', { name: '下一页' }));
        expect(document.querySelector('#page-position')).toHaveTextContent('02 / 02');
        fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
        expect(document.querySelector('#page-position')).toHaveTextContent('01 / 02');
      }
    },
  );

  it('gives the template its own reading area without an empty footer or success banner', async () => {
    localStorage.setItem('mio.reader.look', 'export-monograph');
    const { calls } = mount();
    const frame = await screen.findByTitle('展示模板预览');
    expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('Complete saved composition'));
    expect(document.getElementById('reader')).toHaveAttribute('data-reader-view', 'preview');
    expect(frame.closest('.room-template')).not.toBeNull();
    expect(document.querySelector('.room-footer')).toBeNull();
    expect(document.getElementById('presentation-preview-status')).toBeNull();
    expect(screen.getByRole('button', { name: '排版' })).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/export/album')?.body).toMatchObject({
      lettered: true,
      template_id: 'export-monograph',
    });
  });

  it('round-trips the template preview frame and layout through the iframe protocol', async () => {
    localStorage.setItem('mio.reader.look', 'export-monograph');
    mount();
    const frame = (await screen.findByTitle('展示模板预览')) as HTMLIFrameElement;
    const child = frame.contentWindow!;
    const post = vi.spyOn(child, 'postMessage').mockImplementation(() => {});
    const position = { y: 117, spread: 2, frame: 7, mode: 'single' };
    window.dispatchEvent(
      new MessageEvent('message', {
        source: child,
        data: { type: 'mio-reader-state', ...position },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: { type: 'mio-reader-state', y: 0, spread: 0 },
      }),
    );
    fireEvent.load(frame);
    expect(post).toHaveBeenCalledWith({ type: 'mio-reader-restore', ...position }, '*');
  });

  it('keeps reader actions outside the layout area without an unused reading footer', async () => {
    mount('single', 'webtoon', '/layout');
    const editor = await screen.findByRole('region', { name: 'Layout editor' });
    expect(document.getElementById('reader')).toHaveAttribute('data-reader-view', 'layout');
    expect(editor.closest('.room-layout')).not.toBeNull();
    expect(document.querySelector('.room-footer')).toBeNull();
    expect(screen.getByRole('button', { name: '排版' }).closest('.room-layout')).toBeNull();
  });

  it('reads unsaved art continuously with separate captions instead of an auto-lettered strip', async () => {
    currentEpisode = {
      ...savedEpisode,
      strip: { ...savedEpisode.strip, panel_boxes: {}, crops: {}, lettering: [] },
    };
    metadata = {
      ...geometry,
      panel_boxes: { p0: [0, 0, 800, 400], p1: [0, 400, 800, 800] },
    };
    mount('continuous');
    await screen.findByAltText('第 1 格');
    expect(document.querySelector('.reader-saved-strip')).toBeNull();
    expect(document.querySelector('.scroll-caption')).toHaveTextContent(
      'Resolved caption from server',
    );
    expect(document.querySelectorAll('#reader-canvas img')).toHaveLength(2);
  });

  it('previews unlaid-out art without asking the template exporter to generate lettering', async () => {
    currentEpisode = {
      ...savedEpisode,
      strip: { ...savedEpisode.strip, panel_boxes: {}, crops: {}, lettering: [] },
    };
    localStorage.setItem('mio.reader.look', 'export-monograph');
    const { calls } = mount();
    await screen.findByTitle('展示模板预览');
    expect(calls.find((c) => c.url === '/api/export/album')?.body).toMatchObject({
      lettered: false,
      show_captions: true,
    });
  });

  it('keeps saved lettering but shows its scene text separately only when requested', async () => {
    currentEpisode = { ...savedEpisode, strip: episode.strip };
    metadata = { ...geometry, display_captions: { p0: '', p1: '' } };
    // The former automatically saved default is not an explicit choice to duplicate text.
    localStorage.setItem('mio.reader.export', JSON.stringify({ captions: true }));
    mount();
    const image = await screen.findByAltText('第 1 格');
    expect(image).toHaveAttribute('src', expect.stringContaining('/panels/p0/image'));
    expect(document.querySelector('.scroll-caption')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '本幕文字' })[0]);
    expect(document.getElementById('room-info')).not.toHaveAttribute('hidden');
    expect(document.getElementById('room-info')).toHaveTextContent('Resolved caption from server');
  });

  it('keeps uncovered panel text and partial captions beside a saved composition', async () => {
    currentEpisode = { ...savedEpisode, strip: episode.strip };
    metadata = {
      ...geometry,
      captions: { p0: 'Already embedded. Still below.', p1: 'Other panel narration' },
      display_captions: { p0: 'Still below.', p1: 'Other panel narration' },
    };
    mount();
    await screen.findByAltText('第 1 格');
    expect([...document.querySelectorAll('.scroll-caption')].map((p) => p.textContent)).toEqual([
      'Still below.',
      'Other panel narration',
    ]);
  });

  it('requests per-panel caption deduplication for saved templates without hiding all captions', async () => {
    currentEpisode = { ...savedEpisode, strip: episode.strip };
    localStorage.setItem('mio.reader.look', 'export-monograph');
    const { calls } = mount();
    await screen.findByTitle('展示模板预览');
    expect(calls.find((c) => c.url === '/api/export/album')?.body).toMatchObject({
      lettered: true,
      show_captions: true,
      deduplicate_captions: true,
    });
  });

  it('honors an explicit caption preference for a saved lettered template', async () => {
    currentEpisode = { ...savedEpisode, strip: episode.strip };
    localStorage.setItem('mio.reader.look', 'export-monograph');
    localStorage.setItem('mio.reader.export', JSON.stringify({ captionPreference: true }));
    const { calls } = mount();
    await screen.findByTitle('展示模板预览');
    expect(calls.find((c) => c.url === '/api/export/album')?.body).toMatchObject({
      lettered: true,
      show_captions: true,
      deduplicate_captions: false,
    });
  });

  it('uses one full strip with saved geometry anchors for continuous reading', async () => {
    mount('continuous');
    const image = await screen.findByAltText('保存后的条漫，包含裁切、留白与嵌字');
    const url = new URL(image.getAttribute('src')!, 'http://localhost');
    expect(url.pathname).toBe('/api/episodes/ep_1/strip.png');
    expect(url.searchParams.get('revision')).toBe(geometry.revision);
    expect(image).toHaveAttribute('width', '800');
    expect(image).toHaveAttribute('height', '4000');
    expect(document.querySelectorAll('#reader-canvas img')).toHaveLength(1);
    expect(document.querySelector('[data-page-anchor="0"]')).toHaveStyle({ top: '10%' });
    expect(document.querySelector('[data-page-anchor="1"]')).toHaveStyle({ top: '65%' });
    expect(document.querySelector('.reader-strip-captions')).toHaveTextContent(
      'Resolved caption from server',
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(document.querySelector('#page-position')).toHaveTextContent('02 / 02');
    fireEvent.click(screen.getByRole('button', { name: '单页' }));
    expect(await screen.findByAltText('第 1 格')).toHaveAttribute(
      'src',
      expect.stringContaining('/panels/p0/image'),
    );
  });

  it('refreshes composed image URLs on episode and series edits', async () => {
    const { client, calls } = mount();
    const first = await screen.findByAltText('第 1 格');
    const firstUrl = first.getAttribute('src');
    metadata = { ...metadata, revision: 'new-crop' };
    await act(async () => {
      client.setQueryData(keys.episode('ep_1'), { ...savedEpisode, revision: 4 });
    });
    await waitFor(() =>
      expect(screen.getByAltText('第 1 格').getAttribute('src')).not.toBe(firstUrl),
    );
    const croppedUrl = screen.getByAltText('第 1 格').getAttribute('src');
    metadata = {
      ...metadata,
      revision: 'new-variables',
      captions: { ...metadata.captions, p0: 'Updated variable caption' },
    };
    await act(async () => {
      client.setQueryData(keys.series('ser_1'), { ...series, variables: { name: 'new' } });
    });
    await waitFor(() =>
      expect(screen.getByAltText('第 1 格').getAttribute('src')).not.toBe(croppedUrl),
    );
    expect(document.querySelector('.scroll-caption')).toHaveTextContent('Updated variable caption');
    expect(calls.filter((call) => call.url.startsWith('/api/episodes/ep_1/reading'))).toHaveLength(
      3,
    );
  });

  it('fits new image dimensions after revision changes and ignores an old load', async () => {
    const { client } = mount('auto');
    const old = await screen.findByAltText('第 1 格');
    Object.defineProperties(old, { naturalWidth: { value: 800 }, naturalHeight: { value: 1200 } });
    fireEvent.load(old);
    expect(document.querySelector('.mio-reading-stage')).toHaveAttribute('data-count', '2');
    metadata = {
      ...metadata,
      revision: 'wide-crop',
      panel_boxes: { ...metadata.panel_boxes, p0: [0, 400, 800, 800] },
    };
    await act(async () => {
      client.setQueryData(keys.episode('ep_1'), { ...savedEpisode, revision: 4 });
    });
    await waitFor(() => expect(screen.getByAltText('第 1 格')).not.toBe(old));
    const current = screen.getByAltText('第 1 格');
    Object.defineProperties(current, {
      naturalWidth: { value: 800 },
      naturalHeight: { value: 400 },
    });
    fireEvent.load(current);
    fireEvent.load(old);
    expect(document.querySelector('.mio-reading-stage')).toHaveAttribute('data-count', '1');
    expect(current).toHaveAttribute('data-shape', 'wide');
  });
});
