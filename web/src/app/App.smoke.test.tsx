import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { episode, job, series } from '../test/fixtures';
import { useHelp, useQuickStart } from '../components/HelpDrawer';
import { mockFetch } from '../test/utils';
import { makeQueryClient, routes } from './App';
import { useUI } from './ui-store';

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
  calls = mockFetch({
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
    'GET /api/workshop': workshop,
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
    'GET /api/episodes/ep_1/panels/p0/prompt': prompt,
    'GET /api/export/presets': [
      { id: 'webtoon', label: 'Webtoon', width: 800, max_height: 1280, format: 'jpg' },
    ],
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
    'GET /api/episodes/ep_1/motion-plan': {
      moves: [
        'still',
        'push_in',
        'pull_out',
        'pan_left',
        'pan_right',
        'pan_up',
        'pan_down',
        'shake',
      ],
      total_seconds: 5.2,
      shots: [
        {
          panel_id: 'p0',
          index: 0,
          move: 'push_in',
          auto_move: 'push_in',
          move_overridden: false,
          hold: 2.6,
          auto_hold: 2.6,
          lines: [{ text: '走吧', speaker: '林', kind: 'speech' }],
          description: '便利店门口',
          has_image: true,
        },
      ],
    },
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
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useHelp.setState({ open: false });
  useQuickStart.setState({ open: false });
  useUI.setState({ studioMode: false });
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

  it('series → variants', async () => {
    mount('/series/ser_1/variants');
    expect(await screen.findByDisplayValue('冬装')).toBeInTheDocument();
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
    // The per-panel render overrides live in the Studio inspector.
    useUI.setState({ studioMode: true });
    mount('/workshop/assembly/ep_1/script');
    const rows = await screen.findAllByText(/^「欢迎光临」$|^第 2 格$/);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Ctrl-click the second row: both panels selected, the batch bar appears.
    fireEvent.click(screen.getByText('第 2 格'), { ctrlKey: true });
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
    // Per-panel render overrides and the one-frame test run are in the editor.
    expect(screen.getByText('出图参数覆盖（只对这一格）')).toBeInTheDocument();
    expect(screen.getAllByText('试出这一格').length).toBeGreaterThan(0);
    // ? opens the page help.
    fireEvent.keyDown(document.body, { key: '?' });
    expect(await screen.findByText('剧本：分格编辑')).toBeInTheDocument();
    expect(screen.getByText('景别 / 角度必须选吗？')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '?' });
    await waitFor(() => expect(screen.queryByText('剧本：分格编辑')).not.toBeInTheDocument());
  });

  it('episode → board with takes and live items', async () => {
    mount('/workshop/assembly/ep_1/board');
    expect(await screen.findByText('全部出草稿')).toBeInTheDocument();
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
    expect(img.getAttribute('src')).toContain('/api/assets/');
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
    const list = document.getElementById('presentation-template-list')!;
    // The native stage (留白) is listed first; picking another template swaps in its preview.
    const choices = await within(list).findAllByRole('button');
    expect(choices.map((b) => b.querySelector('strong')?.textContent)).toEqual([
      '留白 · 完整画面',
      '无缝 · 纯图阅读',
      '海风来信 · 电影长卷',
    ]);
    fireEvent.click(within(list).getByText('海风来信 · 电影长卷'));
    const frame = await screen.findByTitle('展示模板预览');
    expect(frame.getAttribute('srcdoc')).toContain('paper');
    expect(screen.queryByAltText('第 1 格')).toBeNull();
    const call = calls.find((c) => c.url === '/api/export/album');
    expect(call?.body).toMatchObject({ episode_ids: ['ep_1'], template_id: 'export-paper' });
    expect(screen.getByText('版式 · 海风来信 · 电影长卷')).toBeInTheDocument();
    // Search filters the list.
    fireEvent.change(screen.getByLabelText('搜索展示模板'), { target: { value: '无缝' } });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    localStorage.removeItem('mio.reader.look');
  });

  it('help drawer: page help, 开箱检查, tutorials, then the quick start', async () => {
    mount('/workshop/assembly');
    // The queue shows how much setup is left; the chip opens the checklist.
    fireEvent.click(await screen.findByText(/开箱检查还差 \d 项/));
    const drawer = await screen.findByRole('dialog', { name: '装配与队列' });
    expect(within(drawer).getByText(/任务加入后处于待命状态/)).toBeInTheDocument();
    expect(within(drawer).getByText('开箱检查')).toBeInTheDocument();
    expect(within(drawer).getByText('还没有保存的工作流。')).toBeInTheDocument();
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

  it('设置 → 工具与资源 lists the tutorials and the less-used tools', async () => {
    mount('/settings?tab=resources');
    expect(await screen.findByRole('heading', { name: '工具与资源' })).toBeInTheDocument();
    for (const name of ['快速开始教程', '使用教程 · 教程中心', '全部服务端任务', '工程备份与恢复'])
      expect(screen.getByText(name)).toBeInTheDocument();
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
    const marks = document.querySelectorAll('.prompt-paint mark[data-prompt-variable]');
    expect([...marks].map((m) => (m as HTMLElement).dataset.state)).toEqual(['defined', 'empty']);
    expect(screen.getByText(/识别到 2 个变量，其中 1 个还没有值：outfit/)).toBeInTheDocument();
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

  it('装配: the 3-step wizard adds a standby task without generating', async () => {
    mount('/workshop/assembly');
    expect(await screen.findByText('等待你的安排')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建生成任务' }));
    await screen.findByRole('dialog', { name: '新建生成任务' });
    await screen.findByRole('option', { name: /海风来信/ });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText(/还缺 \{天气\}/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByLabelText('画册名称')).toHaveValue('海风来信 · 林夏');
    fireEvent.click(screen.getByRole('button', { name: '添加待命任务' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/workshop/assemble')).toBe(
        true,
      ),
    );
    const call = calls.find((c) => c.url === '/api/workshop/assemble')!;
    expect(call.body).toMatchObject({ storyboard_id: 'sb_1', preset_ids: ['pre_1'] });
    expect(calls.some((c) => c.url.includes('/render'))).toBe(false);
  });

  it('episode → export', async () => {
    mount('/gallery/ser_1/export');
    expect(await screen.findByText('导出并下载')).toBeInTheDocument();
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

  it('classic mode: prompt, characters and the generate stage; no studio drawer', async () => {
    mount('/workshop/assembly/ep_1/script');
    expect(await screen.findByLabelText('画面提示词')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成 \d 张/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /林夏/, pressed: true })).toBeInTheDocument();
    expect(screen.queryByText('出图参数覆盖（只对这一格）')).toBeNull();
    expect(screen.queryByText('剧本助手')).toBeNull();
  });

  it('generate queues the chosen number of candidates for this panel', async () => {
    mount('/workshop/assembly/ep_1/script');
    fireEvent.click(await screen.findByRole('button', { name: '4', pressed: false }));
    fireEvent.click(screen.getByRole('button', { name: /生成 4 张/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/render'))).toBe(true),
    );
    const call = calls.find((c) => c.method === 'POST' && c.url.includes('/render'))!;
    expect(call.body).toMatchObject({ panel_ids: ['p0'], candidates: 4 });
  });

  it('studio mode switch in settings is persisted', async () => {
    mount('/settings?tab=studio');
    fireEvent.click(await screen.findByRole('radio', { name: /专业模式 · Studio/ }));
    expect(useUI.getState().studioMode).toBe(true);
    expect(JSON.parse(localStorage.getItem('mio.ui') ?? '{}').state.studioMode).toBe(true);
  });

  it('classic board hides QA, finalize and variants', async () => {
    mount('/workshop/assembly/ep_1/board');
    expect(await screen.findByText('全部出草稿')).toBeInTheDocument();
    expect(screen.queryByText('质检已采用的图')).toBeNull();
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

  it('episode → export → motion comic plan and override', async () => {
    mount('/gallery/ser_1/export');
    fireEvent.click(await screen.findByText('动态漫'));
    expect(await screen.findByText('1 个镜头 · 约 5s')).toBeInTheDocument();
    expect(screen.getByText('便利店门口')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('自动（推近）'), { target: { value: 'shake' } });
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/panels/p0'))).toBe(true),
    );
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({ changes: { motion: { move: 'shake', hold: null } } });
  });

  it('episode → export → album', async () => {
    mount('/gallery/ser_1/export');
    fireEvent.click(await screen.findByText('画册'));
    expect(await screen.findByText('画册模板')).toBeInTheDocument();
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
    expect(await screen.findByText('切换配置项')).toBeInTheDocument();
  });
});
