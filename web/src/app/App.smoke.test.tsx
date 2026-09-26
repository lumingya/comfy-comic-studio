import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { episode, job, series } from '../test/fixtures';
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

afterEach(() => vi.unstubAllGlobals());

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('every route mounts with API data', () => {
  it('works', async () => {
    mount('/');
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
    mount('/episodes/ep_1/script');
    expect(await screen.findByText('masterpiece, 1girl, short black hair')).toBeInTheDocument();
    expect(screen.getByText('未定义的变量：天气')).toBeInTheDocument();
  });

  it('episode → board with takes and live items', async () => {
    mount('/episodes/ep_1/board');
    expect(await screen.findByText('全部出草稿')).toBeInTheDocument();
    expect(screen.getAllByText('已采用').length).toBeGreaterThan(0);
    expect(await screen.findByText('第 1 格 · 候选 1')).toBeInTheDocument();
    expect(screen.getByText('结果未确认，请到任务页处理')).toBeInTheDocument();
  });

  it('episode → canvas', async () => {
    mount('/episodes/ep_1/canvas');
    expect(await screen.findByText('重排分格')).toBeInTheDocument();
  });

  it('episode → reader shows the composed strip', async () => {
    mount('/episodes/ep_1/read');
    const img = await screen.findByAltText('第一话');
    expect(img.getAttribute('src')).toContain('/api/episodes/ep_1/strip.png');
  });

  it('episode → export', async () => {
    mount('/episodes/ep_1/export');
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
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('picking a theme writes its tokens onto <html>', async () => {
    mount('/settings?tab=themes');
    fireEvent.click(await screen.findByText('纸'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#f3f4ef');
  });

  it('episode → extension panel in a sandboxed iframe', async () => {
    mount('/episodes/ep_1/ext/demo.stats');
    const frame = await screen.findByTitle('字数统计');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toContain('episode=ep_1');
  });

  it('episode → export → motion comic plan and override', async () => {
    mount('/episodes/ep_1/export');
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
    mount('/episodes/ep_1/export');
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
});
