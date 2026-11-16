import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { episode, job, series } from '../test/fixtures';
import type { QueueStatus } from '../api/types';
import { configInstance, configProfile, configSettings } from '../test/configuration';
import { cloudRequest } from '../test/cloudRequest';
import { useHelp, useQuickStart } from '../components/HelpDrawer';
import { mockFetch } from '../test/utils';
import { makeQueryClient, routes } from './App';

// jsdom has no canvas: render konva nodes as plain elements so the canvas/edit screens mount.
vi.mock('react-konva', () => {
  const box = ({ children }: { children?: ReactNode }) => <div data-konva="">{children}</div>;
  return {
    Stage: box,
    Layer: box,
    Group: box,
    Rect: box,
    Text: box,
    Line: box,
    Circle: box,
    Ellipse: box,
    Image: box,
    Transformer: () => null,
  };
});

let calls: ReturnType<typeof mockFetch> = [];
let responses: Record<string, unknown>;
const idleQueue: QueueStatus = {
  id: 'queue',
  order: [],
  lane: [],
  paused: false,
  active: null,
  active_job: null,
  concurrency: null,
  notices: {},
  updated_at: '',
  fault: null,
  auto_concurrency: 2,
};

const prompt = {
  tags: {
    positive: 'masterpiece, 1girl, short black hair',
    negative: 'lowres',
    width: 832,
    height: 1109,
    seed: 1,
    dialect: 'tags',
    raw: false,
    refs: [],
    loras: [],
    unresolved: ['天气'],
    sources: [
      { tag: 'masterpiece', source: 'quality' },
      { tag: '1girl', source: 'cast' },
      { tag: 'short black hair', source: 'character:c1' },
    ],
    negative_sources: [{ tag: 'lowres', source: 'negative' }],
  },
  natural: {
    positive: 'A woman with short black hair',
    negative: '',
    width: 832,
    height: 1109,
    seed: 1,
    dialect: 'natural',
    raw: false,
    refs: [],
    loras: [],
    unresolved: [],
  },
  references: [],
};

const settings = {
  llm: {
    base_url: '',
    api_key: '',
    text_models: [],
    vision_models: [],
    image_models: [],
    timeout: 120,
    pace: 0,
  },
  qa: { votes: 3, faces: true, auto_adopt: false },
  guard_terms: [],
  trash_days: 30,
  locale: 'zh-CN',
  theme: 'system',
  image_channels: [],
  image_channel: '',
  update_feed: '',
};

const themes = [
  { id: 'ink', name: '墨', mode: 'dark', author: '', source: 'builtin', tokens: { bg: '#101312' } },
  {
    id: 'paper',
    name: '纸',
    mode: 'light',
    author: '',
    source: 'builtin',
    tokens: { bg: '#f3f4ef' },
  },
];

const { items: _items, ...jobSummary } = job;
// The hidden 创作工坊 series: one storyboard (sb_1) and one preset.
const workshop = {
  ...series,
  id: 'ws_1',
  title: '创作工坊',
  kind: 'workshop' as const,
  presets: [
    {
      id: 'pre_1',
      title: '林夏 · 夏日',
      groups: [{ id: 'g1', title: '主角与服装' }],
      entries: [
        {
          id: 'v1',
          key: 'character',
          label: '角色名 / 提示词',
          value: 'lin xia',
          hint: '',
          group_id: 'g1',
        },
        { id: 'v2', key: 'outfit', label: '服装', value: '', hint: '', group_id: 'g1' },
      ],
    },
  ],
};
const storyboard = {
  ...episode,
  id: 'sb_1',
  series_id: 'ws_1',
  title: '海风来信',
  takes: [],
  panels: episode.panels.map((p) => ({
    ...p,
    overrides: { ...p.overrides, raw_prompt: '1girl, {character}, {outfit}, {天气}' },
  })),
};

beforeEach(() => {
  vi.stubGlobal(
    'WebSocket',
    class {
      onopen = null;
      onclose = null;
      onmessage = null;
      close() {}
    },
  );
  responses = {
    'GET /api/series': [series],
    'GET /api/series/ser_1': series,
    'GET /api/series/ser_1/episodes': {
      items: [
        {
          id: 'ep_1',
          series_id: 'ser_1',
          title: '第一话',
          order: 0,
          panel_count: 2,
          created_at: '',
          updated_at: '',
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
    },
    'GET /api/episodes/ep_1': episode,
    'GET /api/episodes/ep_1/reading': {
      revision: 'saved-reading-3',
      width: 800,
      height: 1500,
      panel_boxes: { p0: [0, 170, 800, 1237] },
      captions: { p0: '欢迎光临' },
    },
    'GET /api/workshop': workshop,
    'GET /api/workshop/queue': idleQueue,
    'GET /api/series/ws_1': workshop,
    'GET /api/series/ws_1/episodes': {
      items: [
        {
          id: 'sb_1',
          series_id: 'ws_1',
          title: '海风来信',
          order: 0,
          panel_count: 2,
          created_at: '',
          updated_at: '',
        },
      ],
      total: 1,
      offset: 0,
      limit: 50,
    },
    'GET /api/episodes/sb_1': storyboard,
    'PATCH /api/series/ws_1': (body: unknown) => ({ ...workshop, ...(body as object) }),
    'POST /api/workshop/assemble': { series: series, episode: episode },
    'POST /api/workshop/assemble/preview': {
      title: '海风来信',
      storyboard_id: 'sb_1',
      profile_id: '',
      preset_ids: ['pre_1'],
      panels: [
        {
          panel_id: 'p0',
          title: '海风来信',
          order: 0,
          profile_id: '',
          dialect: 'tags',
          positive: 'lin xia, {天气}',
          negative: '',
          dialogues: [],
          variables: [
            {
              key: '天气',
              field: 'overrides.raw_prompt',
              value: null,
              source: 'missing',
              source_id: null,
              source_title: null,
              status: 'missing',
              chain: ['天气'],
            },
          ],
        },
      ],
    },
    'POST /api/workshop/preview': {
      series: { ...series, id: 'ser_pv', title: '林夏 · 夏日 · 试绘', subtitle: '预设试绘' },
      episode: { ...episode, id: 'ep_pv', series_id: 'ser_pv' },
    },
    'GET /api/episodes/ep_1/panels/p0/prompt': prompt,
    'GET /api/export/presets': [
      { id: 'webtoon', label: 'Webtoon', width: 800, max_height: 1280, format: 'JPEG' },
      { id: 'kuaikan', label: '国内平台', width: 750, max_height: 1500, format: 'JPEG' },
      { id: 'long', label: '整张长图', width: 0, max_height: 0, format: 'PNG' },
    ],
    'GET /api/episodes/ep_1/slices': {
      preset: 'webtoon',
      width: 800,
      height: 2000,
      heights: [1280, 720],
      format: 'JPEG',
      quality: 90,
    },
    'POST /api/export/jobs/portable': { id: 'export_1', state: 'queued', items: [] },
    'GET /api/jobs/export_1': { id: 'export_1', state: 'completed', items: [] },
    'GET /api/export/jobs/export_1/file': () =>
      new Response('zip', {
        status: 200,
        headers: {
          'content-disposition': "attachment; filename*=UTF-8''a.zip",
          'x-mio-export': JSON.stringify({
            profile: 'publish',
            scrubbed: 0,
            recompressed: 2,
            original_bytes: 10,
            output_bytes: 5,
            auto_compressed: false,
            over_budget: false,
          }),
        },
      }),
    'GET /api/jobs': [jobSummary],
    'GET /api/jobs/job_1': job,
    'GET /api/settings': settings,
    'GET /api/profiles': [],
    'GET /api/workflows': [],
    'GET /api/instances': { instances: [], pool: {} },
    'GET /api/registry': {},
    'GET /api/trash': { items: [], retention_days: 30 },
    'GET /api/themes': themes,
    'GET /api/extensions': { items: [], hooks: [], safe_mode: false },
    'GET /api/tokens': { items: [], scopes: ['read', 'write', 'render', 'admin'] },
    'GET /api/webhooks': { items: [], events: { 'job.completed': '任务完成' } },
    'GET /api/update': {
      current: '4.0.0',
      dev_checkout: true,
      keys_configured: false,
      releases_page: 'https://example.invalid/releases',
      last_check: null,
      pending: null,
    },
    'GET /api/album-templates': [],
    'PATCH /api/episodes/ep_1/panels/p0': episode,
    'GET /api/extension-panels': [
      {
        extension: 'demo',
        id: 'stats',
        slot: 'episode',
        title: '字数统计',
        url: '/api/extensions/demo/files/panel.html',
      },
    ],
  };
  calls = mockFetch(responses);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useHelp.setState({ open: false });
  useQuickStart.setState({ open: false });
});

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('every route mounts with API data', () => {
  it.each(['script', 'board'])(
    'shows the stored cloud request in the %s candidate details',
    async (tab) => {
      responses['GET /api/episodes/ep_1'] = {
        ...episode,
        takes: [
          {
            ...episode.takes[0],
            width: 1024,
            height: 1536,
            seed: null,
            cloud_request: cloudRequest,
          },
        ],
      };
      mount(`/workshop/assembly/ep_1/${tab}`);
      // Wait for the lazy route and episode queries before interacting with its candidates.
      const zooms = await screen.findAllByRole('button', { name: '查看大图' }, { timeout: 10000 });
      fireEvent.click(zooms[0]);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/1024×1536.*未应用（渠道不支持）/)).toBeInTheDocument();
      const summary = within(dialog).getByText('云端生成参数');
      expect(summary.closest('details')).not.toHaveAttribute('open');
      fireEvent.click(summary);
      expect(within(dialog).getByRole('row', { name: /种子/ })).toHaveTextContent('42');
      expect(within(dialog).getByRole('row', { name: /参考图/ })).toHaveTextContent('合成参考图');
    },
    // The first lazy route competes with the full suite's parallel module transforms.
    15000,
  );

  const cloudProfile = {
    ...configProfile,
    id: 'cloud',
    name: '云端配置',
    cloud_shape: true,
    cloud_channel: 'images',
  };
  function cloudRoutes() {
    Object.assign(responses, {
      'GET /api/settings': configSettings,
      'GET /api/profiles': [configProfile, cloudProfile],
      'GET /api/workshop': { ...workshop, default_profile_id: configProfile.id },
      'GET /api/instances': { instances: [configInstance] },
      'GET /api/instances/comfy_test/health': { ok: false, stats: {} },
    });
  }

  it.each(['series', 'panel'])(
    'cloud %s selection has no background local probes from the shell or closed help',
    async (selection) => {
      cloudRoutes();
      responses['GET /api/series/ser_1'] = {
        ...series,
        default_profile_id: selection === 'series' ? cloudProfile.id : configProfile.id,
      };
      responses['GET /api/episodes/ep_1'] = {
        ...episode,
        panels: episode.panels.map((panel) => ({
          ...panel,
          overrides: {
            ...panel.overrides,
            profile_id: selection === 'panel' ? cloudProfile.id : null,
          },
        })),
      };
      mount('/workshop/assembly/ep_1/script');
      await screen.findByText('纯云端出图 · 主力图像服务 · 已配置');
      expect(screen.queryByRole('link', { name: '出图配置' })).toBeNull();
      expect(
        within(document.querySelector<HTMLElement>('#topbar')!).getByRole('button', {
          name: '生成任务',
        }),
      ).toBeInTheDocument();
      expect(document.querySelector('.stage-notice')).toBeNull();
      expect(screen.queryByText(/ComfyUI.*未连接/)).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(calls.filter((call) => call.url.endsWith('/health'))).toEqual([]);
    },
  );

  it('assembly switches a local workshop default to cloud without background local health requests', async () => {
    cloudRoutes();
    mount('/workshop/assembly?new=1');
    const dialog = await screen.findByRole('dialog', { name: '新建生成任务' });
    const service = within(dialog).getByRole('combobox', { name: '出图工作流或云端服务' });
    await waitFor(() => expect(service).toBeEnabled());
    await waitFor(() => expect(service).toHaveValue(`profile:${configProfile.id}`));
    fireEvent.change(service, {
      target: { value: 'channel:images' },
    });
    expect(service).toHaveValue('channel:images');
    expect(within(dialog).getByRole('spinbutton', { name: '每幕生成张数' })).toHaveValue(1);
    expect(screen.queryByRole('link', { name: '出图配置' })).toBeNull();
    expect(screen.queryByText(/ComfyUI.*未连接/)).toBeNull();
    expect(calls.filter((call) => call.url.endsWith('/health'))).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '开箱检查' }));
    const help = await screen.findByRole('dialog', { name: '装配与队列' });
    expect(within(help).getByText(/此处检查工坊默认配置/)).toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/health'))).toBe(true));
  });

  it('home: the legacy landing with the setup checklist', async () => {
    mount('/');
    expect(await screen.findByText('让灵感成册。')).toBeInTheDocument();
    expect(screen.getByText('开箱检查')).toBeInTheDocument();
    for (const name of ['首页', '画册集', '创作工坊', '工作流与 API 配置', '设置'])
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
  });

  it('works (画册集)', async () => {
    mount('/gallery');
    expect(await screen.findByText('雨夜便利店')).toBeInTheDocument();
  });

  it('series → episodes', async () => {
    mount('/series/ser_1/episodes');
    expect(await screen.findByText('第一话')).toBeInTheDocument();
  });

  it('series → bible', async () => {
    mount('/series/ser_1/bible');
    expect((await screen.findAllByText('林夏')).length).toBeGreaterThan(0);
  });

  it('series tabs offer no batch variants', async () => {
    mount('/series/ser_1/bible');
    expect((await screen.findAllByText('林夏')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /批量变体/ })).toBeNull();
  });

  it('episode → script with compiled prompt', async () => {
    mount('/workshop/assembly/ep_1/script');
    // Every tag is a chip that names its origin; the plain text stays available for copying.
    expect(
      await screen.findByText('short black hair', undefined, { timeout: 3000 }),
    ).toHaveAttribute('title', '角色: c1');
    expect(screen.getByText('1girl')).toHaveAttribute('title', '人数');
    expect(screen.getByText('masterpiece, 1girl, short black hair')).toBeInTheDocument();
    expect(screen.getByText('未定义的变量：天气')).toBeInTheDocument();
  });

  it('episode → script: multi-select, right-click menu, batch edit and help', async () => {
    mount('/workshop/assembly/ep_1/script');
    const rows = await screen.findAllByText(/^「欢迎光临」$|^第 2 格$/);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Ctrl-click the second row: both panels selected, the batch bar appears.
    fireEvent.click(screen.getByText('第 2 格'), { shiftKey: true });
    expect(screen.getByText('已选 2 格')).toBeInTheDocument();
    // Right-click keeps the multi-selection and offers the batch items.
    fireEvent.contextMenu(screen.getByText('第 2 格'));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('批量编辑')).toBeInTheDocument();
    expect(within(menu).getByText('删除 2 格')).toBeInTheDocument();
    expect(within(menu).getByText('导出 2 格（JSON）')).toBeInTheDocument();
    fireEvent.click(within(menu).getByText('批量编辑'));
    expect(await screen.findByText('批量编辑 2 格')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    // Batch import stays; there is no script assistant.
    expect(screen.getByRole('button', { name: '导入分格（JSON）' })).toBeInTheDocument();
    expect(screen.queryByText('剧本助手')).toBeNull();
    // Per-panel render overrides and the one-frame test run are in the editor.
    expect(screen.getByText('出图参数覆盖（只对这一格）')).toBeInTheDocument();
    expect(screen.getAllByText('生成与挑图').length).toBeGreaterThan(0);
    // ? opens the page help.
    fireEvent.keyDown(document.body, { key: '?' });
    expect(await screen.findByText('剧本：分格编辑')).toBeInTheDocument();
    expect(screen.getByText('景别 / 角度必须选吗？')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '?' });
    await waitFor(() => expect(screen.queryByText('剧本：分格编辑')).not.toBeInTheDocument());
  });

  it('episode → board with takes and live items', async () => {
    mount('/workshop/assembly/ep_1/board');
    expect(await screen.findByText('全部生成')).toBeInTheDocument();
    expect(screen.getAllByText('已采用').length).toBeGreaterThan(0);
    expect(await screen.findByText('第 1 格 · 候选 1')).toBeInTheDocument();
    expect(screen.getByText('结果未确认，请到任务页处理')).toBeInTheDocument();
  });

  it('episode → canvas', async () => {
    mount('/gallery/ser_1/layout');
    expect(await screen.findByText('重排分格')).toBeInTheDocument();
  });

  it('画册集 → the reader dialog shows the adopted pages, nothing to edit', async () => {
    mount('/gallery/ser_1');
    const img = await screen.findByAltText('第 1 格');
    expect(img.getAttribute('src')).toContain('/api/episodes/ep_1/panels/p0/image?');
    expect(document.querySelector('#page-position')?.textContent).toBe('01 / 01');
    expect(screen.getByRole('button', { name: '关闭画册' })).toBeInTheDocument();
    expect(screen.queryByLabelText('画面提示词')).toBeNull();
  });

  it('reader: every template in the drawer changes what you see', async () => {
    const tpl = (id: string, title: string) => ({
      id,
      title,
      description: '',
      author: 'Mio',
      layout: 'webtoon',
      layout_name: 'Webtoon 长卷',
      options: { accent: '#000000', background: '#ffffff', paper: '#ffffff', text: '#000000' },
      source: 'builtin',
    });
    calls = mockFetch({
      'GET /api/series/ser_1': series,
      'GET /api/series/ser_1/episodes': {
        items: [{ id: 'ep_1', series_id: 'ser_1', title: '第一话', order: 0, panel_count: 2 }],
        total: 1,
        offset: 0,
        limit: 50,
      },
      'GET /api/episodes/ep_1': episode,
      'GET /api/episodes/ep_1/reading': {
        revision: 'saved-reading-3',
        width: 800,
        height: 1500,
        panel_boxes: { p0: [0, 170, 800, 1237] },
        captions: { p0: '欢迎光临' },
      },
      'GET /api/album-templates': [
        tpl('export-seamless', '无缝 · 纯图阅读'),
        tpl('mio-fit', '留白 · 完整画面'),
        tpl('export-paper', '海风来信 · 电影长卷'),
      ],
      'POST /api/export/album': () =>
        new Response('<!doctype html><p>paper</p>', { headers: { 'content-type': 'text/html' } }),
    });
    localStorage.removeItem('mio.reader.look');
    mount('/gallery/ser_1/export');
    await screen.findByAltText('第 1 格');
    const layouts = screen.getByLabelText('画册版式');
    // The native stage (留白) is listed first; picking another template swaps in its preview.
    const choices = within(layouts).getAllByRole('option');
    expect(choices.map((option) => option.textContent)).toEqual([
      '留白 · 完整画面',
      '无缝 · 纯图阅读',
      '海风来信 · 电影长卷',
    ]);
    fireEvent.change(layouts, { target: { value: 'export-paper' } });
    const frame = await screen.findByTitle('展示模板预览');
    expect(frame.getAttribute('srcdoc')).toContain('paper');
    expect(screen.queryByAltText('第 1 格')).toBeNull();
    const call = calls.find((c) => c.url === '/api/export/album');
    expect(call?.body).toMatchObject({ episode_ids: ['ep_1'], template_id: 'export-paper' });
    expect(layouts).toHaveValue('export-paper');
    expect(screen.queryByRole('button', { name: /^版式/ })).toBeNull();
    const readerHeader = document.querySelector<HTMLElement>('.room-head')!;
    expect(within(readerHeader).getAllByRole('button', { name: /^导出$/ })).toHaveLength(1);
    fireEvent.change(layouts, { target: { value: 'mio-fit' } });
    expect(await screen.findByAltText('第 1 格')).toBeInTheDocument();
    expect(screen.queryByTitle('展示模板预览')).toBeNull();
    localStorage.removeItem('mio.reader.look');
  });

  it('help drawer: page help, 开箱检查, tutorials, then the quick start', async () => {
    mount('/workshop/assembly');
    // The queue opens the workshop checklist only on demand.
    fireEvent.click(await screen.findByRole('button', { name: '开箱检查' }));
    const drawer = await screen.findByRole('dialog', { name: '装配与队列' });
    expect(within(drawer).getByText(/任务加入后处于待命状态/)).toBeInTheDocument();
    expect(within(drawer).getByText('开箱检查')).toBeInTheDocument();
    expect(
      await within(drawer).findByText('出图配置不存在或无法读取：profile_default'),
    ).toBeInTheDocument();
    // The storyboard uses {天气}, which no preset defines.
    expect(
      await within(drawer).findByText('「海风来信」用到的变量 {天气} 还没有预设定义。'),
    ).toBeInTheDocument();
    expect(
      within(drawer)
        .getByRole('link', { name: /^生成任务/ })
        .getAttribute('href'),
    ).toBe('/manual/docs/guide/FOUNDATION.html');
    expect(
      within(drawer)
        .getByRole('link', { name: /^教程中心/ })
        .getAttribute('href'),
    ).toBe('/manual/docs/index.html');
    expect(within(drawer).getByText('复制诊断信息')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: /快速开始教程/ }));
    const quick = await screen.findByRole('dialog', { name: '快速开始 · 从灵感到一本画册' });
    expect(within(quick).getByText(/导入 ComfyUI 的 API 工作流/)).toBeInTheDocument();
    expect(within(quick).getByText('进阶')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '装配与队列' })).toBeNull();
  });

  it('设置 has six tabs in two groups', async () => {
    mount('/settings');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '工作室',
      '外观与阅读',
      '模型与连接',
      '数据与备份',
      '扩展',
      '关于与更新',
    ]);
    expect(screen.getByText('常用')).toBeInTheDocument();
    expect(screen.getByText('系统')).toBeInTheDocument();
  });

  it('merged settings tabs: themes live in 外观与阅读, tokens in 模型与连接', async () => {
    mount('/settings?tab=themes');
    expect(
      await screen.findByRole('tab', { name: '外观与阅读', selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '主题' })).toBeInTheDocument();
    expect((await screen.findAllByText('跟随系统')).length).toBeGreaterThan(0);
  });

  it('模型与连接 shows the text model API and API tokens & webhooks', async () => {
    mount('/settings?tab=access');
    expect(
      await screen.findByRole('tab', { name: '模型与连接', selected: true }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'API 令牌' })).toBeInTheDocument();
    expect(await screen.findByText('还没有 Webhook')).toBeInTheDocument();
    expect(screen.getByText('接口地址')).toBeInTheDocument();
  });

  it('old episode links: storyboards open in 分镜工坊, album pages in the reader', async () => {
    const router = mount('/episodes/ep_1/read');
    await waitFor(() => expect(router.state.location.pathname).toBe('/gallery/ser_1'));
    await router.navigate('/workshop/sb_1/script');
    await waitFor(() => expect(router.state.location.pathname).toBe('/workshop/story/sb_1'));
  });

  it('分镜工坊: frames, highlighted variables and the per-frame parameters', async () => {
    const router = mount('/workshop');
    await waitFor(() => expect(router.state.location.pathname).toBe('/workshop/story/sb_1'));
    expect(await screen.findByRole('heading', { name: '分镜工坊' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /第 2 格/ })).toBeInTheDocument();
    // Legacy paint: defined / empty / undefined (dotted) — every {name} gets a state.
    const marks = document.querySelectorAll('.prompt-paint mark[data-prompt-variable]');
    expect([...marks].map((m) => (m as HTMLElement).dataset.state)).toEqual([
      'defined',
      'empty',
      'unknown',
    ]);
    expect(
      screen.getByText('识别到 3 个变量 · 1 个未定义（天气） · 1 个值为空（outfit）'),
    ).toBeInTheDocument();
    // The summary foot sits beside the surface, never over the textarea's last line.
    const foot = document
      .querySelector('#workshop-frame-prompt')!
      .closest('.prompt-surface')!.nextElementSibling;
    expect(foot).toHaveClass('prompt-editor-foot');
    expect(
      document.querySelector('#workshop-frame-negative')!.closest('.prompt-surface')!
        .nextElementSibling,
    ).not.toHaveClass('prompt-editor-foot');
    expect(screen.getByText('此幕画面参数')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '去装配此分镜' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workshop/assembly'));
    expect(await screen.findByRole('dialog', { name: '新建生成任务' })).toBeInTheDocument();
  });

  it('预设工坊: groups fold open, values save as the whole preset list', async () => {
    mount('/workshop/presets');
    const toggle = await screen.findByRole('button', { name: '展开「主角与服装」' });
    fireEvent.click(toggle);
    const value = screen.getByRole('textbox', { name: '服装' });
    fireEvent.change(value, { target: { value: 'white dress' } });
    await waitFor(
      () =>
        expect(calls.some((c) => c.method === 'PATCH' && c.url === '/api/series/ws_1')).toBe(true),
      { timeout: 3000 },
    );
    const patch = calls.find((c) => c.method === 'PATCH' && c.url === '/api/series/ws_1')!;
    expect(JSON.stringify(patch.body)).toContain('white dress');
  });

  it('分镜工坊 / 预设工坊: right-clicking the page opens the legacy asset menus', async () => {
    const router = mount('/workshop');
    await waitFor(() => expect(router.state.location.pathname).toBe('/workshop/story/sb_1'));
    await screen.findByRole('button', { name: /第 2 格/ }); // the (lazy) editor is mounted
    fireEvent.contextMenu(screen.getByRole('heading', { name: '分镜工坊' }));
    const story = await screen.findByRole('menu');
    expect(within(story).getByRole('menuitem', { name: /^新增分幕/ })).toBeInTheDocument();
    expect(within(story).getByRole('menuitem', { name: /导出此分镜/ })).toBeInTheDocument();
    expect(within(story).getByRole('menuitem', { name: /导入分镜/ })).toBeInTheDocument();
    // Text fields keep the browser menu.
    fireEvent.keyDown(story, { key: 'Escape' });
    fireEvent.contextMenu(screen.getByLabelText('作品简介'));
    expect(screen.queryByRole('menu')).toBeNull();
    // The frame editor opens the menu of the frame being edited.
    fireEvent.contextMenu(screen.getByText('此幕画面参数'));
    expect(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: /正在编辑这一幕/ }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '创作工坊分区' })).getByRole('button', {
        name: '预设工坊',
      }),
    );
    await screen.findByRole('button', { name: '独立试绘' }); // the (lazy) presets page is mounted
    fireEvent.contextMenu(screen.getByRole('heading', { name: '预设工坊' }));
    const preset = await screen.findByRole('menu');
    expect(within(preset).getByRole('menuitem', { name: /独立试绘/ })).toBeInTheDocument();
    expect(within(preset).getByRole('menuitem', { name: /导出此预设/ })).toBeInTheDocument();
    fireEvent.click(within(preset).getByRole('menuitem', { name: /新建生成任务/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workshop/assembly'));
    expect(await screen.findByRole('dialog', { name: '新建生成任务' })).toBeInTheDocument();
  });

  it('预设工坊: 独立试绘 requires an explicit prompt and preserves its variable references', async () => {
    responses['GET /api/profiles'] = [configProfile];
    responses['POST /api/workshop/queue/start'] = {
      ...idleQueue,
      order: ['ser_pv'],
      lane: ['ser_pv'],
    };
    const router = mount('/workshop/presets');
    fireEvent.click(await screen.findByRole('button', { name: '独立试绘' }));
    const dialog = await screen.findByRole('dialog', { name: '预设独立试绘' });
    const prompt = within(dialog).getByLabelText('画面描述') as HTMLTextAreaElement;
    expect(prompt.value).toBe('');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('出图工作流或云端服务')).toBeEnabled(),
    );
    fireEvent.change(within(dialog).getByLabelText('出图工作流或云端服务'), {
      target: { value: `profile:${configProfile.id}` },
    });
    const start = within(dialog).getByRole('button', { name: '开始生成' });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(calls.some((c) => c.url === '/api/workshop/preview')).toBe(false);
    fireEvent.change(prompt, { target: { value: '{character} wearing {outfit}, portrait' } });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '开始生成' })).toBeEnabled(),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '开始生成' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/workshop/preview')).toBe(
        true,
      ),
    );
    const call = calls.find((c) => c.url === '/api/workshop/preview')!;
    expect(call.body).toMatchObject({
      preset_ids: ['pre_1'],
      prompt: '{character} wearing {outfit}, portrait',
      generation: { profile_id: configProfile.id },
    });
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/workshop/queue/start')?.body).toEqual({
        album_ids: ['ser_pv'],
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/workshop/assembly'));
  });

  it.each([
    { button: '单幕重跑', panelIds: ['p0'], rerun: true },
    { button: '从此幕往后重跑', panelIds: ['p0', 'p1'], rerun: true },
    { button: '单幕生成', panelIds: ['p1'], rerun: false },
  ])('task $button requests candidates without replacing adopted frames', async (action) => {
    responses['GET /api/series'] = [{ ...series, status: 'draft' }];
    responses['GET /api/jobs'] = [];
    responses['GET /api/workshop/queue'] = { order: ['ser_1'], lane: [], notices: {} };
    responses['POST /api/episodes/ep_1/render'] = job;
    mount('/workshop/assembly?task=ser_1');
    const button = await screen.findByRole('button', { name: action.button });
    await waitFor(() => expect(button).toBeEnabled());
    if (action.rerun) {
      expect(button).toHaveAttribute(
        'title',
        '新图保留为候选，采用后替换原图；没有采用图的分幕自动采用首张图',
      );
    }
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        calls.filter((call) => call.method === 'POST' && call.url.endsWith('/render')),
      ).toHaveLength(1),
    );
    expect(
      calls.find((call) => call.method === 'POST' && call.url.endsWith('/render'))?.body,
    ).toEqual({
      panel_ids: action.panelIds,
      adopt_first: true,
      qa: false,
      idempotency_key: expect.any(String),
    });
  });

  it('装配: the 3-step wizard adds a standby task without generating', async () => {
    responses['GET /api/profiles'] = [configProfile];
    mount('/workshop/assembly');
    expect(await screen.findByText('等待你的安排')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建生成任务' }));
    await screen.findByRole('dialog', { name: '新建生成任务' });
    await screen.findByRole('option', { name: /海风来信/ });
    await waitFor(() => expect(screen.getByLabelText('出图工作流或云端服务')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('出图工作流或云端服务'), {
      target: { value: `profile:${configProfile.id}` },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const presetChoice = await screen.findByRole('checkbox', { name: /林夏/ });
    expect(presetChoice).not.toBeChecked();
    fireEvent.click(presetChoice);
    expect(screen.getByRole('list', { name: '预设应用顺序' })).toHaveTextContent('林夏');
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(
      await screen.findByRole('button', { name: /第 1 幕.*原始提示词.*天气.*未定义/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('画册名称')).toHaveValue('海风来信 · 林夏');
    fireEvent.click(screen.getByRole('button', { name: '稍后生成' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/workshop/assemble')).toBe(
        true,
      ),
    );
    const call = calls.find((c) => c.url === '/api/workshop/assemble')!;
    expect(call.body).toMatchObject({ storyboard_id: 'sb_1', preset_ids: ['pre_1'] });
    expect(calls.some((c) => c.url.includes('/render'))).toBe(false);
  });

  it('reader drawer: one export action applies the chosen format and image processing', async () => {
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.href);
    });
    mount('/gallery/ser_1/export');
    const drawer = await screen.findByRole('complementary', { name: '展示模板与导出' });
    expect(within(drawer).getAllByRole('button', { name: '导出' })).toHaveLength(1);
    fireEvent.change(within(drawer).getByLabelText('导出格式'), { target: { value: 'zip' } });
    const profile = within(drawer).getByLabelText(/^图片处理/) as HTMLSelectElement;
    expect([...profile.options].map((o) => o.value)).toEqual([
      'auto',
      'clean',
      'publish',
      'archive',
    ]);
    fireEvent.change(profile, { target: { value: 'publish' } });
    expect(profile).toHaveValue('publish');
    expect(profile.selectedOptions[0].textContent).toContain('2560 px');
    const zip = within(drawer).getByRole('button', { name: '导出' });
    await waitFor(() => expect(zip).toBeEnabled());
    fireEvent.click(zip);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/export/jobs/portable')).toBe(
        true,
      ),
    );
    expect(calls.find((c) => c.url === '/api/export/jobs/portable')!.body).toMatchObject({
      format: 'zip',
      image_profile: 'publish',
      idempotency_key: expect.stringMatching(/^export-/),
    });
    await waitFor(() => expect(within(drawer).getByRole('status')).toHaveTextContent('下载已开始'));
    expect(calls.filter((c) => c.url === '/api/export/jobs/portable')).toHaveLength(1);
    expect(calls.some((c) => c.url === '/api/jobs/export_1')).toBe(true);
    expect(calls.some((c) => c.url === '/api/export/jobs/export_1/file')).toBe(true);
    expect(downloads).toEqual([`${window.location.origin}/api/export/jobs/export_1/file`]);
    expect(within(drawer).queryByLabelText('平台预设')).toBeNull();
    expect(within(drawer).queryByLabelText('画册版式')).toBeNull();
    localStorage.removeItem('mio.reader.export');
  });

  it('reader drawer: the slice preview follows the platform preset', async () => {
    mount('/gallery/ser_1/export');
    const drawer = await screen.findByRole('complementary', { name: '展示模板与导出' });
    fireEvent.change(within(drawer).getByLabelText('导出格式'), {
      target: { value: 'slices' },
    });
    expect(await screen.findByText('切片预览')).toBeInTheDocument();
    await screen.findByRole('option', { name: '国内平台' });
    fireEvent.change(within(drawer).getByLabelText('平台预设'), { target: { value: 'kuaikan' } });
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/episodes/ep_1/slices?preset=kuaikan')).toBe(true),
    );
    fireEvent.change(within(drawer).getByLabelText('画质'), { target: { value: 'lossless' } });
    expect(within(drawer).getByText(/750 px 宽 · 每张 ≤ 1500 px · PNG/)).toBeInTheDocument();
    localStorage.removeItem('mio.reader.export');
  });

  it('jobs with an unconfirmed item', async () => {
    mount('/jobs');
    expect((await screen.findAllByText('第一话 · 草稿')).length).toBeGreaterThan(0);
    expect(await screen.findByText('有 1 个条目结果未确认，不会自动重试。')).toBeInTheDocument();
  });

  it.each(['general', 'workflows', 'profiles', 'instances'])('settings → %s', async (tab) => {
    mount(`/settings?tab=${tab}`);
    expect(await screen.findByRole('tab', { selected: true })).toBeInTheDocument();
  });

  it.each([
    ['channels', '还没有云端出图渠道'],
    ['themes', '跟随系统'],
    ['extensions', '还没有安装扩展'],
    ['access', '还没有 Webhook'],
    ['updates', 'v4.0.0'],
  ])('settings → %s', async (tab, text) => {
    mount(`/settings?tab=${tab}`);
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
  });

  it('script tab: prompt, characters and the generate stage', async () => {
    mount('/workshop/assembly/ep_1/script');
    expect(await screen.findByLabelText('画面提示词')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成 \d 张/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /林夏/, pressed: true })).toBeInTheDocument();
  });

  it('generate uses the frozen task count without overriding it in the request', async () => {
    responses['GET /api/series/ser_1'] = {
      ...series,
      generation: { candidates: 4, profile: configProfile },
    };
    mount('/workshop/assembly/ep_1/script');
    await screen.findByRole('button', { name: /生成 4 张/ });
    expect(screen.queryByRole('button', { name: '4', pressed: false })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /生成 4 张/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/render'))).toBe(true),
    );
    const call = calls.find((c) => c.method === 'POST' && c.url.includes('/render'))!;
    expect(call.body).toMatchObject({ panel_ids: ['p0'] });
    expect(call.body).not.toHaveProperty('candidates');
  });

  it('settings → data offers the .mio.zip import, no legacy import', async () => {
    mount('/settings?tab=data');
    expect(await screen.findByText('导入 .mio.zip')).toBeInTheDocument();
    expect(screen.queryByText('导入旧版数据')).toBeNull();
  });

  it('settings have no mode or feature switches', async () => {
    mount('/settings?tab=themes');
    expect((await screen.findAllByText('跟随系统')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: /功能开关/ })).toBeNull();
    expect(screen.queryByText(/专业模式/)).toBeNull();
  });

  it('board offers no retouch, QA or finalize actions', async () => {
    mount('/workshop/assembly/ep_1/board');
    expect(await screen.findByText('全部生成')).toBeInTheDocument();
    expect(screen.queryByText('质检')).toBeNull();
    expect(screen.queryByText(/出成品档/)).toBeNull();
    expect(screen.queryByText('修图')).toBeNull();
  });

  it('picking a theme writes its tokens onto <html>', async () => {
    mount('/settings?tab=themes');
    fireEvent.click(await screen.findByText('纸'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#f3f4ef');
  });

  it('episode → extension panel in a sandboxed iframe', async () => {
    mount('/workshop/assembly/ep_1/ext/demo.stats');
    const frame = await screen.findByTitle('字数统计');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toContain('episode=ep_1');
  });

  it('reader drawer offers no motion comic or version switch (Studio mode)', async () => {
    mount('/gallery/ser_1/export');
    expect(await screen.findByRole('heading', { name: '导出画册' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /设置镜头并导出/ })).toBeNull();
    expect(screen.queryByLabelText('画面版本')).toBeNull();
  });

  it('trash', async () => {
    mount('/trash');
    expect(await screen.findByText('回收站是空的')).toBeInTheDocument();
  });

  it('unknown route', async () => {
    mount('/nope');
    expect(await screen.findByText('页面不存在')).toBeInTheDocument();
    expect(screen.getByText('回到作品')).toBeInTheDocument();
  });

  it('old links to an album page open its task; ⌘K finds it', async () => {
    const router = mount('/episodes/ep_1/script');
    expect(await screen.findByLabelText('画面提示词')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/workshop/assembly/ep_1/script');
    await router.navigate('/workshop/ep_1/board');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/workshop/assembly/ep_1/board'),
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(await screen.findByPlaceholderText(/搜索画册、分镜与台词/), {
      target: { value: '第一话' },
    });
    expect(await screen.findByText('第一话 · 雨夜便利店')).toBeInTheDocument();
  });

  it('old render settings links open 工作流与 API 配置', async () => {
    const router = mount('/settings?tab=instances');
    await waitFor(() => expect(router.state.location.pathname).toBe('/engine'));
    expect(
      await screen.findByRole('tab', { name: /本地连接/, selected: true }),
    ).toBeInTheDocument();
  });
});
