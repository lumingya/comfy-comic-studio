import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SeriesCard } from '../../api/types';
import { series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { ExportBooks } from './ShelfDialogs';
import { useToasts } from '../../components/toast';

const books = [
  { ...series, id: 'a', title: '第一本' },
  { ...series, id: 'b', title: '第二本' },
] as SeriesCard[];
const page = (id: string) => ({ items: [{ id }], total: 1 });
const routes = () => ({
  'GET /api/album-templates': [{ id: 'export-paper', title: '纸页', description: '' }],
  'GET /api/settings': { signature: 'Mio' },
  'GET /api/series/a/episodes': page('ep-a'),
  'GET /api/series/b/episodes': page('ep-b'),
});
const choose = (value: string) =>
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value } });
const run = () => fireEvent.click(screen.getByRole('button', { name: '导出' }));
const mount = () => {
  const close = vi.fn();
  renderWithProviders(
    <ExportBooks books={books} open collectionTitle="画册集" onOpenChange={close} />,
  );
  return close;
};

beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useToasts.getState().items.forEach((item) => useToasts.getState().dismiss(item.id));
});

it.each(['html', 'pdf', 'zip'])(
  'exports only the chosen %s format with all selected episodes',
  async (format) => {
    const calls = mockFetch({
      ...routes(),
      'POST /api/export/album': {},
      'POST /api/export/portable': {},
    });
    const close = mount();
    await screen.findByRole('option', { name: '纸页' });
    choose(format);
    expect(screen.queryByRole('option', { name: '纸页' }) !== null).toBe(format === 'html');
    run();
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    const requests = calls.filter((call) => call.method === 'POST');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(format === 'html' ? '/api/export/album' : '/api/export/portable');
    expect(requests[0].body).toMatchObject({
      episode_ids: ['ep-a', 'ep-b'],
      title: '画册集',
      image_profile: 'auto',
      lettered: true,
    });
    expect(requests[0].body).toMatchObject(
      format === 'html' ? { template_id: 'export-paper', signature: 'Mio' } : { format },
    );
  },
);

it('blocks a merge over 50 episodes without silently truncating or downloading', async () => {
  const calls = mockFetch({
    ...routes(),
    'GET /api/series/a/episodes': {
      items: Array.from({ length: 50 }, (_, i) => ({ id: `ep-${i}` })),
      total: 50,
    },
    'POST /api/export/album': {},
  });
  const close = mount();
  await screen.findByRole('option', { name: '纸页' });
  run();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
  expect(close).not.toHaveBeenCalled();
});

it('downloads source bundles directly and retries only unfinished albums after a partial failure', async () => {
  let attempts = 0;
  const calls = mockFetch({
    ...routes(),
    'GET /api/series/a/bundle': {},
    'GET /api/series/b/bundle': () =>
      ++attempts === 1
        ? new Response(JSON.stringify({ detail: 'temporarily unavailable' }), { status: 503 })
        : {},
  });
  const close = mount();
  choose('source');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  run();
  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  run();
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(calls.filter((call) => call.url === '/api/series/a/bundle')).toHaveLength(1);
  expect(calls.filter((call) => call.url === '/api/series/b/bundle')).toHaveLength(2);
  expect(calls.some((call) => call.url.includes('/episodes'))).toBe(false);
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
});

it('exports a separate creation kit for each album, including its presets and all paged storyboards', async () => {
  let pages = 0;
  const calls = mockFetch({
    ...routes(),
    'GET /api/series/a': { presets: [{ id: 'preset-a' }] },
    'GET /api/series/b': { presets: [{ id: 'preset-b' }] },
    'GET /api/series/a/episodes': () =>
      ++pages === 1
        ? { items: [{ id: 'ep-a' }], total: 2 }
        : { items: [{ id: 'ep-a2' }], total: 2 },
    'POST /api/creation-kits/export': {},
  });
  const close = mount();
  choose('kit');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  run();
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(
    calls
      .filter((call) => call.method === 'POST')
      .map((call) => ({ url: call.url, body: call.body })),
  ).toEqual([
    {
      url: '/api/creation-kits/export',
      body: {
        series_id: 'a',
        episode_ids: ['ep-a', 'ep-a2'],
        preset_ids: ['preset-a'],
        title: '第一本',
      },
    },
    {
      url: '/api/creation-kits/export',
      body: { series_id: 'b', episode_ids: ['ep-b'], preset_ids: ['preset-b'], title: '第二本' },
    },
  ]);
});

it('excludes presets when unchecked and never needs to read them', async () => {
  const calls = mockFetch({ ...routes(), 'POST /api/creation-kits/export': {} });
  const close = mount();
  choose('kit');
  fireEvent.click(screen.getByRole('checkbox'));
  run();
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(
    calls
      .filter((call) => call.method === 'POST')
      .map((call) => (call.body as { preset_ids: string[] }).preset_ids),
  ).toEqual([[], []]);
  expect(calls.some((call) => /^\/api\/series\/[ab]$/.test(call.url))).toBe(false);
});

it('re-exports every kit with the new preset choice after a partial failure', async () => {
  let secondAttempts = 0;
  const calls = mockFetch({
    ...routes(),
    'GET /api/series/a': { presets: [{ id: 'preset-a' }] },
    'GET /api/series/b': { presets: [{ id: 'preset-b' }] },
    'POST /api/creation-kits/export': (body: unknown) =>
      (body as { series_id: string }).series_id === 'b' && ++secondAttempts === 1
        ? new Response(JSON.stringify({ detail: 'temporarily unavailable' }), { status: 503 })
        : {},
  });
  const close = mount();
  choose('kit');
  run();
  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.getByRole('status')).toHaveTextContent('1 / 2');
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  run();
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(
    calls
      .filter((call) => call.method === 'POST')
      .map((call) => {
        const body = call.body as { series_id: string; preset_ids: string[] };
        return { series_id: body.series_id, preset_ids: body.preset_ids };
      }),
  ).toEqual([
    { series_id: 'a', preset_ids: ['preset-a'] },
    { series_id: 'b', preset_ids: ['preset-b'] },
    { series_id: 'a', preset_ids: [] },
    { series_id: 'b', preset_ids: [] },
  ]);
});
