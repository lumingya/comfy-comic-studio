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
const completed = { id: 'job_export', state: 'completed', items: [] };
const routes = () => ({
  'POST /api/export/jobs/album': completed,
  'POST /api/export/jobs/portable': completed,
  'POST /api/export/jobs/strip': completed,
  'GET /api/jobs/job_export': completed,
  'GET /api/export/jobs/job_export/file': {},
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
  let current = overrides;
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
        {...current}
      />
    );
  }
  const view = renderWithProviders(<Harness />);
  return {
    onPlatform,
    onClose,
    rerender: (patch: typeof overrides) => {
      current = { ...current, ...patch };
      view.rerender(<Harness />);
    },
  };
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
      'POST /api/export/jobs/album': completed,
      'POST /api/export/jobs/portable': completed,
    });
    mount();
    choose(format);
    expect(screen.getAllByRole('button', { name: '导出' })).toHaveLength(1);
    expect(screen.queryByRole('group', { name: '画册版式' }) !== null).toBe(format === 'html');
    expect(screen.queryByLabelText('包含旁白与台词') !== null).toBe(format !== 'pdf');
    expect(screen.queryByLabelText('平台预设')).toBeNull();
    if (format === 'html') fireEvent.click(screen.getByRole('button', { name: '展册' }));
    fireEvent.change(screen.getByLabelText(/^图片处理/), { target: { value: 'publish' } });
    run();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
    const requests = calls.filter((call) => call.method === 'POST');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      format === 'html' ? '/api/export/jobs/album' : '/api/export/jobs/portable',
    );
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
      'POST /api/export/jobs/album': completed,
      'POST /api/export/jobs/portable': completed,
    });
    const title = '海'.repeat(150);
    mount({ title });
    choose(format);
    run();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
    const requests = calls.filter((call) => call.method === 'POST');
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({ title: title.slice(0, 120) });
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  },
);

it('exports slices with the chosen platform and quality', async () => {
  const calls = mockFetch({ ...routes(), 'GET /api/episodes/ep_1/export': {} });
  const { onPlatform } = mount();
  choose('slices');
  await screen.findByRole('option', { name: '国内平台' });
  expect(onPlatform).toHaveBeenLastCalledWith(true);
  expect(screen.queryByLabelText(/^图片处理/)).toBeNull();
  expect(screen.queryByRole('group', { name: '画册版式' })).toBeNull();
  fireEvent.change(screen.getByLabelText('平台预设'), { target: { value: 'kuaikan' } });
  fireEvent.change(screen.getByLabelText('画质'), { target: { value: 'lossless' } });
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  const requests = calls.filter((call) => call.url === '/api/export/jobs/strip');
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toMatchObject({
    episode_id: 'ep_1',
    fmt: 'slices',
    preset: 'kuaikan',
    quality: 0,
  });
  choose('html');
  expect(onPlatform).toHaveBeenLastCalledWith(false);
});

it.each([
  ['lossless', null],
  ['q90', 90],
] as const)(
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
    expect(screen.queryByRole('group', { name: '画册版式' })).toBeNull();
    fireEvent.change(screen.getByLabelText('画质'), { target: { value: quality } });
    run();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
    const requests = calls.filter((call) => call.url === '/api/export/jobs/strip');
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      episode_id: 'ep_1',
      fmt: 'long',
      preset: 'webtoon',
      quality: query,
    });
  },
);

it('downloads the entire editable source without requiring a selected episode', async () => {
  const calls = mockFetch({ ...routes(), 'GET /api/series/ser_1/bundle': {} });
  mount({ episodeId: undefined, episodes: [] });
  expect(screen.getByRole('button', { name: '导出' })).toBeDisabled();
  choose('source');
  expect(screen.getByRole('button', { name: '导出' })).toBeEnabled();
  expect(screen.queryByLabelText(/^图片处理/)).toBeNull();
  expect(screen.queryByRole('group', { name: '画册版式' })).toBeNull();
  expect(screen.queryByLabelText('套装名称')).toBeNull();
  expect(screen.getByText('导出整本作品')).toBeInTheDocument();
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('文件已下载'));
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
  expect(screen.queryByRole('group', { name: '画册版式' })).toBeNull();
  expect(screen.queryByLabelText(/^图片处理/)).toBeNull();
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('文件已下载'));
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
    'POST /api/export/jobs/portable': () =>
      ++attempts === 1
        ? new Response(JSON.stringify({ detail: '导出暂时失败' }), { status: 503 })
        : completed,
  });
  mount();
  choose('pdf');
  run();
  expect(await screen.findByRole('alert')).toHaveTextContent('导出暂时失败');
  expect(screen.getByLabelText('导出格式')).toHaveValue('pdf');
  expect(screen.getByRole('button', { name: '导出' })).toBeEnabled();
  run();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
    '/api/export/jobs/portable',
    '/api/export/jobs/portable',
  ]);
  const posts = calls.filter((call) => call.method === 'POST');
  expect(posts[0].body).toEqual(posts[1].body);
});

it('cancels the active export and retries that frozen job without a second submission', async () => {
  let state = 'running';
  const calls = mockFetch({
    ...routes(),
    'POST /api/export/jobs/album': { ...completed, state },
    'GET /api/jobs/job_export': () => ({ ...completed, state }),
    'POST /api/jobs/job_export/cancel': () => {
      state = 'canceled';
      return { ...completed, state };
    },
    'POST /api/jobs/job_export/retry': () => {
      state = 'completed';
      return completed;
    },
  });
  mount();
  run();
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  await screen.findByRole('alert');
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
    '/api/export/jobs/album',
    '/api/jobs/job_export/cancel',
    '/api/jobs/job_export/retry',
  ]);
});

it('retries a failed task and downloads its result instead of rendering a new snapshot', async () => {
  let failed = true;
  const calls = mockFetch({
    ...routes(),
    'GET /api/jobs/job_export': () =>
      failed
        ? {
            ...completed,
            state: 'failed',
            items: [{ error: { message: '磁盘空间不足' } }],
          }
        : completed,
    'POST /api/jobs/job_export/retry': () => {
      failed = false;
      return completed;
    },
  });
  mount();
  run();
  expect(await screen.findByRole('alert')).toHaveTextContent('磁盘空间不足');
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
    '/api/export/jobs/album',
    '/api/jobs/job_export/retry',
  ]);
});

it('recovers a lost submission response using the same idempotency key', async () => {
  let lost = true;
  const calls = mockFetch({
    ...routes(),
    'POST /api/export/jobs/album': () => {
      if (lost) {
        lost = false;
        throw new TypeError('network interrupted');
      }
      return completed;
    },
  });
  mount();
  run();
  expect(await screen.findByRole('alert')).toHaveTextContent('network interrupted');
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  const posts = calls.filter((call) => call.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0].body).toEqual(posts[1].body);
  expect(posts[0].body).toMatchObject({ idempotency_key: expect.stringMatching(/^export-/) });
});

it('downloads a completed result again after a network failure without retrying the task', async () => {
  let lost = true;
  const calls = mockFetch({
    ...routes(),
    'GET /api/export/jobs/job_export/file': () => {
      if (lost) {
        lost = false;
        throw new TypeError('download interrupted');
      }
      return {};
    },
  });
  mount();
  run();
  expect(await screen.findByRole('alert')).toHaveTextContent('download interrupted');
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(calls.filter((call) => call.url.endsWith('/file'))).toHaveLength(2);
});

it('selects visual template cards and opens a sandboxed full-screen trial read', async () => {
  const calls = mockFetch({
    ...routes(),
    'POST /api/export/album': new Response('<!doctype html><title>preview</title>', {
      headers: { 'content-type': 'text/html' },
    }),
  });
  mount();
  choose('html');
  fireEvent.click(screen.getByRole('button', { name: '展册' }));
  expect(screen.getByRole('button', { name: '展册' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByText('更多设置'));
  fireEvent.change(screen.getByLabelText('主题色'), { target: { value: '#315b86' } });
  expect(
    screen.getByRole('button', { name: '展册' }).querySelector('.export-template-thumb'),
  ).toHaveStyle({
    '--thumb-accent': '#315b86',
  });
  fireEvent.click(screen.getByRole('button', { name: '全屏试读' }));
  const frame = await screen.findByTitle('画册全屏试读');
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
  expect(calls.filter((call) => call.url === '/api/export/album').at(-1)?.body).toMatchObject({
    template_id: 'export-gallery',
    theme_color: '#315b86',
    image_profile: 'preview',
  });
  fireEvent.click(screen.getByRole('button', { name: '关闭试读' }));
  expect(screen.getByTitle('画册全屏试读').closest('dialog')).not.toHaveAttribute('open');
});

it('starts a fresh export after a successful download so later edits are included', async () => {
  const calls = mockFetch(routes());
  mount();
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  const posts = calls.filter((call) => call.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0].body).not.toEqual(posts[1].body);
});

it('closes while an export runs and resumes waiting when reopened without canceling or resubmitting', async () => {
  let state = 'running';
  const calls = mockFetch({
    ...routes(),
    'GET /api/jobs/job_export': () => ({ ...completed, state }),
  });
  const view = mount();
  run();
  await screen.findByRole('button', { name: '取消' });
  const close = screen.getByRole('button', { name: '收起模板与导出' });
  expect(close).toBeEnabled();
  fireEvent.click(close);
  expect(view.onClose).toHaveBeenCalledTimes(1);
  view.rerender({ open: false });
  state = 'completed';
  view.rerender({ open: true });
  run();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('下载已开始'));
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
});

it('clears an old task when switching episode and prevents its late result from replacing the new status', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const calls = mockFetch({
    ...routes(),
    'GET /api/jobs/job_export': () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const view = mount();
  run();
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender({ episodeId: 'ep_2', title: '第二话' });
  finish!(completed);
  await waitFor(() => expect(screen.getByRole('button', { name: '导出' })).toBeEnabled());
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(calls.some((call) => call.url.endsWith('/file'))).toBe(false);
});
