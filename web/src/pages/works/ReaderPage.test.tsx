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
  panel_boxes: { p0: [0, 400, 800, 1600], p1: [0, 2600, 800, 3800] } as Record<string, number[]>,
  captions: { p0: 'Resolved caption from server', p1: '' },
  display_captions: {} as Record<string, string>,
};
let metadata = geometry;

function mount(mode = 'single', layout = 'webtoon', suffix = '', episodeFailure?: Response) {
  localStorage.setItem('mio.reader.mode', mode);
  localStorage.setItem('mio.reader.layout', layout);
  const calls = mockFetch({
    'GET /api/series/ser_1': series,
    'GET /api/series/ser_1/episodes': () => {
      if (episodeFailure) {
        const response = episodeFailure;
        episodeFailure = undefined;
        return response;
      }
      return { items: [{ id: 'ep_1', title: '第一话' }] };
    },
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
  it('turns one short mobile panel per key and lets manual scrolling take over', async () => {
    const count = 120;
    const panels = Array.from({ length: count }, (_, i) => ({
      ...savedEpisode.panels[0],
      id: `mobile-${i}`,
      order: i,
      description: `Mobile scene ${i + 1}`,
    }));
    currentEpisode = {
      ...savedEpisode,
      panels,
      takes: panels.map((panel, i) => ({
        ...savedEpisode.takes[0],
        id: `mobile-take-${i}`,
        panel_id: panel.id,
      })),
    };
    metadata = {
      ...geometry,
      panel_boxes: Object.fromEntries(
        panels.map((panel, i) => [panel.id, [0, i * 300, 800, i * 300 + 280]]),
      ),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(count * 225);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const index = Number(this.dataset.pageAnchor);
      const scroll = document.getElementById('reader-canvas')?.scrollTop ?? 0;
      const top = this.hasAttribute('data-page-anchor') ? 64 + index * 225 - scroll : 64;
      return new DOMRect(0, top, 390, 210);
    });
    const { client } = mount('auto');
    await screen.findByAltText('Mobile scene 1');
    expect(screen.getByAltText('Mobile scene 1')).toHaveAttribute('width', '800');
    expect(screen.getByAltText('Mobile scene 1')).toHaveAttribute('height', '280');
    expect(screen.getByAltText('Mobile scene 120')).toHaveStyle({ width: 'min(100%, 800px)' });
    const root = document.getElementById('reader-canvas')!;
    Object.defineProperty(root, 'scrollTo', {
      configurable: true,
      value: ({ top }: ScrollToOptions) => {
        const next = Math.max(0, Math.min(top ?? 0, root.scrollHeight - root.clientHeight));
        if (root.scrollTop !== next) {
          root.scrollTop = next;
          fireEvent.scroll(root);
        }
      },
    });
    expect(root.style.overflowAnchor).toBe('none');
    fireEvent.scroll(root);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelector('#page-position')).toHaveTextContent('01 / 120');
    for (const next of [2, 3, 4, 5]) {
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      await waitFor(() =>
        expect(document.querySelector('#page-position')).toHaveTextContent(
          `${String(next).padStart(2, '0')} / 120`,
        ),
      );
      fireEvent(root, new Event('scrollend'));
    }
    fireEvent.wheel(root, { deltaY: 600 });
    root.scrollTop = 225 * 10 + 1;
    fireEvent.scroll(root);
    fireEvent(root, new Event('scrollend'));
    await waitFor(() =>
      expect(document.querySelector('#page-position')).toHaveTextContent('11 / 120'),
    );
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(document.querySelector('#page-position')).toHaveTextContent('10 / 120');
    await act(async () => {
      metadata = { ...metadata, revision: 'mobile-updated' };
      client.setQueryData(keys.episode('ep_1'), { ...currentEpisode, revision: 2 });
    });
    await waitFor(() =>
      expect(screen.getByAltText('Mobile scene 1')).toHaveAttribute(
        'src',
        expect.stringContaining('mobile-updated'),
      ),
    );
    expect(document.querySelector('#page-position')).toHaveTextContent('10 / 120');
    fireEvent.click(document.querySelector('[aria-controls="room-filmstrip"]')!);
    fireEvent.click(document.querySelector('#room-filmstrip button:last-child')!);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelector('#page-position')).toHaveTextContent('120 / 120');
    fireEvent(root, new Event('scrollend'));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelector('#page-position')).toHaveTextContent('119 / 120');
  });

  it('retries a failed chapter list without presenting it as an empty album', async () => {
    const { calls } = mount(
      'single',
      'webtoon',
      '',
      Response.json({ detail: 'chapter request temporarily failed' }, { status: 503 }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('chapter request temporarily failed');
    expect(document.querySelector('.room-empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByAltText('第 1 格');
    expect(calls.filter((call) => call.url === '/api/series/ser_1')).toHaveLength(1);
    expect(calls.filter((call) => call.url.startsWith('/api/series/ser_1/episodes'))).toHaveLength(
      2,
    );
  });

  it('closes an expanded filmstrip before leaving the reader', async () => {
    mount();
    await screen.findByAltText('第 1 格');
    const film = document.querySelector<HTMLButtonElement>('[aria-controls="room-filmstrip"]')!;
    fireEvent.click(film);
    expect(document.querySelector('#room-filmstrip')).toBeVisible();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(document.querySelector('#room-filmstrip')).not.toBeVisible();
    expect(film).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeVisible();
  });
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
