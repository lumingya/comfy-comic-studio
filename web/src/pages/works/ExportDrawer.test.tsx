import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useToasts } from '../../components/toast';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { PresentationDrawer } from './ExportDrawer';
import type { ExportDraft } from './presentation';

const defaultDraft: ExportDraft = {
  themeColor: '',
  border: 0,
  signature: 'Mio',
  captions: true,
  deduplicateCaptions: true,
  prompts: false,
  profile: 'auto',
  preset: 'webtoon',
  quality: 'q90',
};
const routes = () => ({
  'GET /api/export/presets': [
    { id: 'webtoon', label: '条漫平台', width: 800, max_height: 1280, format: 'JPEG' },
    { id: 'kuaikan', label: '国内平台', width: 750, max_height: 1500, format: 'JPEG' },
  ],
});
const choose = (value: string) =>
  fireEvent.change(screen.getByLabelText('导出格式'), { target: { value } });
const run = () => fireEvent.click(screen.getByRole('button', { name: '导出' }));

function mount(overrides: Partial<ComponentProps<typeof PresentationDrawer>> = {}) {
  const onPlatform = vi.fn();
  const onClose = vi.fn();
  function Harness() {
    const [draft, setDraft] = useState(defaultDraft);
    const [look, setLook] = useState('export-paper');
    return (
      <PresentationDrawer
        open
        onClose={onClose}
        templates={[
          { id: 'export-paper', title: '纸页', description: '' },
          { id: 'export-gallery', title: '展册', description: '' },
        ]}
        infos={[]}
        look={look}
        native="mio-fit"
        onLook={setLook}
        draft={draft}
        onDraft={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        layout="webtoon"
        onLayout={vi.fn()}
        seriesId="ser_1"
        episodes={[{ id: 'ep_1', title: '第一话' }]}
        episodeId="ep_1"
        title="海风来信"
        lettered
        onPlatform={onPlatform}
        {...overrides}
      />
    );
  }
  renderWithProviders(<Harness />);
  return { onPlatform, onClose };
}

beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:export'), revokeObjectURL: vi.fn() }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useToasts.getState().items.forEach((item) => useToasts.getState().dismiss(item.id));
});

it.each(['html', 'pdf', 'zip'])(
  'downloads only %s with the settings available for that format',
  async (format) => {
    const calls = mockFetch({
      ...routes(),
      'POST /api/export/album': {},
      'POST /api/export/portable': {},
    });
    mount();
    choose(format);
    expect(screen.getAllByRole('button', { name: '导出' })).toHaveLength(1);
    expect(screen.queryByLabelText('画册版式') !== null).toBe(format === 'html');
    expect(screen.queryByLabelText('包含旁白与台词') !== null).toBe(format !== 'pdf');
    expect(screen.queryByLabelText('平台预设')).toBeNull();
    if (format === 'html')
      fireEvent.change(screen.getByLabelText('画册版式'), { target: { value: 'export-gallery' } });
    fireEvent.change(screen.getByLabelText(/^图片处理/), { target: { value: 'publish' } });
    run();
    expect(await screen.findByRole('status')).toHaveTextContent('文件已下载');
    const requests = calls.filter((call) => call.method === 'POST');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(format === 'html' ? '/api/export/album' : '/api/export/portable');
    expect(requests[0].body).toMatchObject({
      episode_ids: ['ep_1'],
      title: '海风来信',
      lettered: true,
      image_profile: 'publish',
      ...(format === 'html' ? { template_id: 'export-gallery', signature: 'Mio' } : { format }),
    });
    expect(calls.some((call) => call.url.includes('/bundle'))).toBe(false);
  },
);

it.each(['html', 'pdf', 'zip'])(
  'exports a 150-character album title as %s within the API title limit',
  async (format) => {
    const calls = mockFetch({
      ...routes(),
      'POST /api/export/album': {},
      'POST /api/export/portable': {},
    });
    const title = '海'.repeat(150);
    mount({ title });
    choose(format);
    run();
    expect(await screen.findByRole('status')).toHaveTextContent('文件已下载');
    const requests = calls.filter((call) => call.method === 'POST');
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({ title: title.slice(0, 120) });
    expect(screen.getByText(title)).toBeInTheDocument();
  },
);

it('exports slices with the chosen platform and quality', async () => {
  const calls = mockFetch({ ...routes(), 'GET /api/episodes/ep_1/export': {} });
  const { onPlatform } = mount();
  choose('slices');
  await screen.findByRole('option', { name: '国内平台' });
  expect(onPlatform).toHaveBeenLastCalledWith(true);
  expect(screen.queryByLabelText(/^图片处理/)).toBeNull();
  expect(screen.queryByLabelText('画册版式')).toBeNull();
  fireEvent.change(screen.getByLabelText('平台预设'), { target: { value: 'kuaikan' } });
  fireEvent.change(screen.getByLabelText('画质'), { target: { value: 'lossless' } });
  run();
  expect(await screen.findByRole('status')).toHaveTextContent('文件已下载');
  const requests = calls.filter((call) => call.url.includes('/ep_1/export?'));
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe('/api/episodes/ep_1/export?fmt=slices&preset=kuaikan&quality=0');
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
  choose('html');
  expect(onPlatform).toHaveBeenLastCalledWith(false);
});

it.each([
  ['lossless', ''],
  ['q90', '&quality=90'],
])(
  'exports a long image with %s quality and no ineffective platform settings',
  async (quality, query) => {
    const calls = mockFetch({ ...routes(), 'GET /api/episodes/ep_1/export': {} });
    const { onPlatform } = mount();
    choose('slices');
    await screen.findByRole('option', { name: '国内平台' });
    fireEvent.change(screen.getByLabelText('平台预设'), { target: { value: 'kuaikan' } });
    expect(onPlatform).toHaveBeenLastCalledWith(true);
    choose('long');
    expect(onPlatform).toHaveBeenLastCalledWith(false);
    expect(screen.queryByLabelText('平台预设')).toBeNull();
    expect(screen.queryByText(/750 px/)).toBeNull();
    expect(screen.queryByLabelText(/^图片处理/)).toBeNull();
    expect(screen.queryByLabelText('画册版式')).toBeNull();
    fireEvent.change(screen.getByLabelText('画质'), { target: { value: quality } });
    run();
    expect(await screen.findByRole('status')).toHaveTextContent('文件已下载');
    const requests = calls.filter((call) => call.url.includes('/ep_1/export?'));
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/api/episodes/ep_1/export?fmt=long${query}`);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  },
);

it('downloads the entire editable source without requiring a selected episode', async () => {
  const calls = mockFetch({ ...routes(), 'GET /api/series/ser_1/bundle': {} });
  mount({ episodeId: undefined, episodes: [] });
  expect(screen.getByRole('button', { name: '导出' })).toBeDisabled();
  choose('source');
  expect(screen.getByRole('button', { name: '导出' })).toBeEnabled();
  expect(screen.queryByLabelText(/^图片处理/)).toBeNull();
  expect(screen.queryByLabelText('画册版式')).toBeNull();
  expect(screen.queryByLabelText('套装名称')).toBeNull();
  expect(screen.getByText('导出整本作品')).toBeInTheDocument();
  run();
  expect(await screen.findByRole('status')).toHaveTextContent('文件已下载');
  expect(calls.filter((call) => call.url.includes('/bundle'))).toEqual([
    { method: 'GET', url: '/api/series/ser_1/bundle', body: undefined },
  ]);
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
});

it('includes only selected storyboards and presets in a creation kit, including later pages', async () => {
  let page = 0;
  const calls = mockFetch({
    ...routes(),
    'GET /api/series/ser_1': { presets: [{ id: 'pre_1', title: '林夏' }] },
    'GET /api/series/ser_1/episodes': () =>
      ++page === 1
        ? { items: [{ id: 'ep_1', title: '第一话' }], total: 2 }
        : { items: [{ id: 'ep_2', title: '第二话' }], total: 2 },
    'POST /api/creation-kits/export': {},
  });
  mount();
  choose('kit');
  await screen.findByRole('checkbox', { name: '第二话' });
  expect(screen.getByRole('checkbox', { name: '第一话' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '第一话' }));
  expect(screen.getByRole('button', { name: '导出' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: '第二话' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '林夏' }));
  fireEvent.change(screen.getByLabelText('套装名称'), { target: { value: '海风创作套装' } });
  expect(screen.queryByLabelText('画册版式')).toBeNull();
  expect(screen.queryByLabelText(/^图片处理/)).toBeNull();
  run();
  expect(await screen.findByRole('status')).toHaveTextContent('文件已下载');
  expect(calls.filter((call) => call.method === 'POST')).toEqual([
    {
      method: 'POST',
      url: '/api/creation-kits/export',
      body: {
        series_id: 'ser_1',
        episode_ids: ['ep_2'],
        preset_ids: ['pre_1'],
        title: '海风创作套装',
      },
    },
  ]);
  expect(calls.some((call) => call.url.includes('offset=200'))).toBe(true);
});

it('keeps the selected format after an export error and retries the same endpoint', async () => {
  let attempts = 0;
  const calls = mockFetch({
    ...routes(),
    'POST /api/export/portable': () =>
      ++attempts === 1
        ? new Response(JSON.stringify({ detail: '导出暂时失败' }), { status: 503 })
        : {},
  });
  mount();
  choose('pdf');
  run();
  expect(await screen.findByRole('alert')).toHaveTextContent('导出暂时失败');
  expect(screen.getByLabelText('导出格式')).toHaveValue('pdf');
  expect(screen.getByRole('button', { name: '导出' })).toBeEnabled();
  run();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(await screen.findByRole('status')).toHaveTextContent('文件已下载');
  expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
    '/api/export/portable',
    '/api/export/portable',
  ]);
});
