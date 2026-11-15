import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssembleVars, AssemblyPreview, Preset } from '../../api/workshop';
import { configProfile, configSettings, configurationRoutes } from '../../test/configuration';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import AssembleDialog from './AssembleDialog';

const preset = (id: string): Preset => ({
  id,
  title: id,
  groups: [],
  bindings: [],
  entries: [],
  positive_prompt: '',
  negative_prompt: '',
});
const routes = () =>
  configurationRoutes({
    'GET /api/workshop': { ...series, id: 'ws', presets: [preset('Alpha'), preset('Beta')] },
    'GET /api/series/ws/episodes': { items: [{ id: 'sb', title: 'Story', panel_count: 1 }] },
    'GET /api/episodes/sb': { ...episode, id: 'sb' },
  });
const report = (body: AssembleVars): AssemblyPreview => ({
  title: body.title,
  storyboard_id: body.storyboard_id,
  profile_id: '',
  preset_ids: body.preset_ids,
  panels: [
    {
      panel_id: 'frame',
      title: 'A rainy scene',
      order: 0,
      profile_id: '',
      dialect: 'tags',
      positive: Object.hasOwn(body.variables ?? {}, 'weather')
        ? `SERVER ${body.variables!.weather}`
        : 'SERVER {weather}',
      negative: 'SERVER negative',
      dialogues: ['SERVER dialogue'],
      variables: [
        {
          key: 'weather',
          field: 'overrides.raw_prompt',
          value: body.variables?.weather ?? null,
          source: Object.hasOwn(body.variables ?? {}, 'weather') ? 'request' : 'missing',
          source_id: null,
          source_title: null,
          status: Object.hasOwn(body.variables ?? {}, 'weather')
            ? body.variables!.weather
              ? 'resolved'
              : 'empty'
            : 'missing',
          chain: ['weather'],
        },
      ],
    },
  ],
});
const preview = (body: unknown) => report(body as AssembleVars);
const fail = () => new Response(JSON.stringify({ detail: 'offline' }), { status: 503 });
const next = () => fireEvent.click(screen.getByRole('button', { name: '下一步' }));
async function mount() {
  renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
  await screen.findByRole('option', { name: /Story/ });
  await waitFor(() => expect(screen.getByLabelText('出图工作流或云端服务')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('出图工作流或云端服务'), {
    target: { value: 'workflow:wf_demo' },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled());
  next();
}
afterEach(() => vi.unstubAllGlobals());

describe('assembly image service selection', () => {
  it('blocks an empty storyboard before the next step and links to its editor', async () => {
    const calls = mockFetch({
      ...routes(),
      'GET /api/series/ws/episodes': { items: [{ id: 'empty', title: 'Empty', panel_count: 0 }] },
    });
    renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
    await screen.findByText('此分镜尚无分幕');
    await waitFor(() => expect(screen.getByLabelText('出图工作流或云端服务')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('出图工作流或云端服务'), {
      target: { value: 'workflow:wf_demo' },
    });
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '编辑分镜' })).toHaveAttribute(
      'href',
      '/workshop/story/empty',
    );
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });
  it('selects a workflow or channel directly and recalls each route independently', async () => {
    const calls = mockFetch({
      ...routes(),
      'GET /api/settings': {
        ...configSettings,
        generation_defaults: {
          'workflow:wf_demo': { candidates: 4, width: 768, height: 1024 },
          'channel:images': { candidates: 2 },
        },
      },
      'POST /api/workshop/assemble/preview': preview,
      'POST /api/workshop/assemble': { series, episode },
    });
    renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
    const route = await screen.findByLabelText('出图工作流或云端服务');
    await waitFor(() => expect(route).toBeEnabled());
    expect(route).toHaveValue('');
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    fireEvent.change(route, { target: { value: 'workflow:wf_demo' } });
    expect(screen.getByLabelText('每幕生成张数')).toHaveValue(4);
    expect(screen.getByLabelText('宽度（像素）')).toHaveValue(768);
    fireEvent.change(route, { target: { value: 'channel:images' } });
    expect(screen.getByLabelText('每幕生成张数')).toHaveValue(2);
    expect(screen.getByLabelText('画面尺寸')).toHaveValue('original');
    next();
    expect(screen.getByRole('checkbox', { name: /Alpha/ })).not.toBeChecked();
    next();
    fireEvent.click(screen.getByRole('button', { name: '稍后生成' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/workshop/assemble')?.body).toMatchObject({
        preset_ids: [],
        generation: { cloud_channel_id: 'images', candidates: 2, width: null, height: null },
      }),
    );
    expect(calls.some((c) => c.url.endsWith('/queue/start'))).toBe(false);
  });

  it('starts the assembled task only when Start generation is chosen', async () => {
    const calls = mockFetch({
      ...routes(),
      'POST /api/workshop/assemble/preview': preview,
      'POST /api/workshop/assemble': { series, episode },
      'POST /api/workshop/queue/start': {},
    });
    await mount();
    next();
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/queue/start'))?.body).toEqual({
        album_ids: [series.id],
      }),
    );
  });

  it('blocks submission without a workflow, cloud channel, or advanced plan', async () => {
    mockFetch({
      ...routes(),
      'GET /api/profiles': [],
      'GET /api/workflows': [],
      'GET /api/settings': { ...configSettings, image_channels: [] },
    });
    renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
    await screen.findByRole('link', { name: '配置工作流或 API' });
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  });

  it('keeps an explicit source plan available alongside direct workflows', async () => {
    mockFetch({
      ...routes(),
      'GET /api/workshop': { ...series, id: 'ws', default_profile_id: configProfile.id },
    });
    renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText('出图工作流或云端服务')).toHaveValue(
        `profile:${configProfile.id}`,
      ),
    );
  });
});

describe('assembly review and durable retry intent', () => {
  it.each(['wizard', 'canvas'] as const)(
    'retains a %s task when queue start returns a notice and retries the same intent',
    async (mode) => {
      let starts = 0;
      const close = vi.fn();
      const calls = mockFetch({
        ...routes(),
        'POST /api/workshop/assemble/preview': preview,
        'POST /api/workshop/assemble': { series, episode },
        'POST /api/workshop/queue/start': () =>
          ++starts === 1 ? { notices: { [series.id]: '工作流缺少节点' } } : {},
      });
      renderWithProviders(<AssembleDialog onClose={close} />);
      await screen.findByRole('option', { name: /Story/ });
      await waitFor(() => expect(screen.getByLabelText('出图工作流或云端服务')).toBeEnabled());
      fireEvent.change(screen.getByLabelText('出图工作流或云端服务'), {
        target: { value: 'workflow:wf_demo' },
      });
      if (mode === 'canvas') {
        fireEvent.click(screen.getByRole('button', { name: '画布连线' }));
        fireEvent.click(screen.getByRole('button', { name: '调入分镜' }));
      } else {
        next();
        next();
      }
      const start = screen.getByRole('button', { name: '开始生成' });
      fireEvent.click(start);
      await waitFor(() => {
        expect(starts).toBe(1);
        expect(start).toBeEnabled();
      });
      expect(close).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      if (mode === 'canvas') expect(screen.getAllByLabelText('输出画册名称')).toHaveLength(1);
      fireEvent.click(start);
      await waitFor(() => expect(close).toHaveBeenCalledOnce());
      const sent = calls
        .filter((call) => call.url === '/api/workshop/assemble')
        .map((call) => call.body as AssembleVars);
      expect(sent).toHaveLength(2);
      expect(sent[0].idempotency_key).toBe(sent[1].idempotency_key);
    },
  );
  it('keeps real preset ordering and uses server substitutions with editable empty variables', async () => {
    const calls = mockFetch({
      ...routes(),
      'POST /api/workshop/assemble/preview': preview,
      'POST /api/workshop/assemble': { series, episode },
    });
    await mount();
    fireEvent.click(screen.getByRole('checkbox', { name: /Alpha/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Beta/ }));
    fireEvent.click(screen.getByRole('button', { name: '上移 Beta' }));
    const order = screen.getByRole('list', { name: '预设应用顺序' });
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Beta', 'Alpha']);
    next();
    expect(screen.getByLabelText('画册名称')).toHaveAttribute('maxlength', '120');
    const missing = await screen.findByRole('button', {
      name: /第 1 幕.*原始提示词.*weather.*未定义/,
    });
    fireEvent.click(missing);
    expect(screen.getByRole('listitem', { name: '原始提示词 · {weather}' })).toHaveFocus();
    expect(screen.getByText('SERVER {weather}')).toBeVisible();
    expect(screen.getByText('SERVER dialogue')).toBeVisible();
    fireEvent.change(screen.getByLabelText('临时变量 weather'), { target: { value: 'rain' } });
    await screen.findByText('SERVER rain');
    fireEvent.change(screen.getByLabelText('临时变量 weather'), { target: { value: '' } });
    await waitFor(() =>
      expect(screen.getByRole('listitem', { name: '原始提示词 · {weather}' })).toHaveTextContent(
        '空值',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '稍后生成' }));
    await waitFor(() =>
      expect(calls.some((call) => call.url === '/api/workshop/assemble')).toBe(true),
    );
    expect(calls.find((call) => call.url === '/api/workshop/assemble')?.body).toMatchObject({
      preset_ids: ['Beta', 'Alpha'],
      variables: { weather: '' },
      idempotency_key: expect.any(String),
    });
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('reports preview failure without claiming coverage and allows explicit retry', async () => {
    let attempt = 0;
    mockFetch({
      ...routes(),
      'POST /api/workshop/assemble/preview': (body: unknown) =>
        ++attempt === 1 ? fail() : preview(body),
    });
    await mount();
    next();
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法核对变量');
    expect(screen.queryByText(/没有未解决的变量/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '稍后生成' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    await screen.findByRole('button', { name: /第 1 幕.*weather/ });
  });

  it('discards a late preview for an older request', async () => {
    let finishOld: (value: unknown) => void = () => {};
    let oldBody: AssembleVars;
    const calls = mockFetch({
      ...routes(),
      'POST /api/workshop/assemble/preview': (body: unknown) => {
        if ((body as AssembleVars).title === 'new') return { ...preview(body), panels: [] };
        oldBody = body as AssembleVars;
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      },
    });
    await mount();
    next();
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/assemble/preview'))).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('画册名称'), { target: { value: 'new' } });
    await screen.findByText('已核对 0 幕，没有未解决的变量。');
    finishOld(report(oldBody!));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /第 1 幕.*weather/ })).not.toBeInTheDocument(),
    );
  });

  it('reuses the submission key after failure and changes it when the request changes', async () => {
    // Plain HTTP on a LAN exposes getRandomValues but may not expose randomUUID.
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const calls = mockFetch({
      ...routes(),
      'POST /api/workshop/assemble/preview': preview,
      'POST /api/workshop/assemble': fail,
    });
    await mount();
    next();
    const submit = screen.getByRole('button', { name: '稍后生成' });
    const sent = () =>
      calls
        .filter((call) => call.url === '/api/workshop/assemble')
        .map((call) => call.body as AssembleVars);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(sent()).toHaveLength(1);
      expect(submit).toBeEnabled();
    });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(sent()).toHaveLength(2);
      expect(submit).toBeEnabled();
    });
    expect(sent()[1].idempotency_key).toBe(sent()[0].idempotency_key);
    expect(sent()[0].idempotency_key).toMatch(/^[a-f0-9]{32}$/);
    fireEvent.change(screen.getByLabelText('画册名称'), { target: { value: 'changed' } });
    fireEvent.click(submit);
    await waitFor(() => expect(sent()).toHaveLength(3));
    expect(sent()[2].idempotency_key).not.toBe(sent()[1].idempotency_key);
  });

  it('keeps a failed canvas node key after removing already successful nodes', async () => {
    let attempts = 0;
    const calls = mockFetch({
      ...routes(),
      'POST /api/workshop/assemble': () => (++attempts === 2 ? fail() : { series, episode }),
    });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '画布连线' }));
    fireEvent.click(screen.getByRole('button', { name: '调入分镜' }));
    fireEvent.click(screen.getByRole('button', { name: '调入分镜' }));
    fireEvent.click(screen.getByRole('button', { name: '调入预设' }));
    const checkboxes = screen.getAllByRole('checkbox', { hidden: true });
    checkboxes.forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(screen.getByRole('button', { name: '稍后生成' }));
    await waitFor(() => expect(screen.getAllByLabelText('输出画册名称')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '稍后生成' }));
    await waitFor(() =>
      expect(calls.filter((call) => call.url === '/api/workshop/assemble')).toHaveLength(3),
    );
    const sent = calls
      .filter((call) => call.url === '/api/workshop/assemble')
      .map((call) => call.body as AssembleVars);
    expect(sent[0].idempotency_key).not.toBe(sent[1].idempotency_key);
    expect(sent[2].idempotency_key).toBe(sent[1].idempotency_key);
  });
});
