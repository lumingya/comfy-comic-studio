import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssembleVars, AssemblyPreview, Preset } from '../../api/workshop';
import { configProfile, configurationRoutes } from '../../test/configuration';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import AssembleDialog from './AssembleDialog';

const preset = (id: string): Preset => ({ id, title: id, groups: [], bindings: [], entries: [] });
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
  next();
}
afterEach(() => vi.unstubAllGlobals());

describe('assembly image service selection', () => {
  it('switches actual profiles with the service and sends only the selected cloud snapshot', async () => {
    const cloud = {
      ...configProfile,
      id: 'cloud',
      name: 'Cloud profile',
      cloud_shape: true,
      cloud_channel: 'images',
    };
    const calls = mockFetch({
      ...routes(),
      'GET /api/profiles': [cloud, configProfile],
      'POST /api/workshop/assemble/preview': preview,
      'POST /api/workshop/assemble': { series, episode },
    });
    renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Story/ });
    const service = screen.getByLabelText('图像服务');
    const profile = screen.getByLabelText('出图配置');
    expect(service).toHaveValue('local');
    expect(profile).toHaveValue('');
    fireEvent.change(service, { target: { value: 'cloud' } });
    expect(profile).toHaveValue('cloud');
    expect(within(profile).queryByRole('option', { name: configProfile.name })).toBeNull();
    expect(screen.getByText('纯云端出图 · 主力图像服务')).toBeVisible();
    fireEvent.change(service, { target: { value: 'local' } });
    expect(profile).toHaveValue('');
    fireEvent.change(service, { target: { value: 'cloud' } });
    next();
    next();
    await waitFor(() =>
      expect(calls.find((call) => call.url.endsWith('/assemble/preview'))?.body).toMatchObject({
        profile_id: 'cloud',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '添加待命任务' }));
    await waitFor(() =>
      expect(calls.find((call) => call.url === '/api/workshop/assemble')?.body).toMatchObject({
        profile_id: 'cloud',
      }),
    );
    expect(
      calls
        .filter((call) => call.method !== 'GET')
        .every((call) => call.url.startsWith('/api/workshop/assemble')),
    ).toBe(true);
  });

  it('blocks missing-service submission in both modes and links to configuration', async () => {
    const calls = mockFetch(routes());
    const close = vi.fn();
    renderWithProviders(<AssembleDialog onClose={close} />);
    await screen.findByRole('option', { name: /Story/ });
    fireEvent.change(screen.getByLabelText('图像服务'), { target: { value: 'cloud' } });
    expect(screen.getByLabelText('出图配置')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('尚未选择纯云端出图的出图配置');
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '画布连线' }));
    fireEvent.click(screen.getByRole('button', { name: '调入分镜' }));
    fireEvent.click(screen.getByRole('button', { name: '调入预设' }));
    screen
      .getAllByRole('checkbox', { hidden: true })
      .forEach((checkbox) => fireEvent.click(checkbox));
    expect(screen.getByRole('button', { name: '批量生成 · 加入待命' })).toBeDisabled();
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
    const configure = screen.getByRole('link', { name: '管理出图配置' });
    expect(configure).toHaveAttribute('href', '/engine?tab=profiles');
    fireEvent.click(configure);
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves a source hybrid profile and panel-specific configuration warning', async () => {
    mockFetch({
      ...routes(),
      'GET /api/workshop': { ...series, id: 'ws', default_profile_id: 'mixed' },
      'GET /api/profiles': [
        configProfile,
        {
          ...configProfile,
          id: 'mixed',
          name: 'Mixed profile',
          cloud_shape: true,
          cloud_refine: true,
        },
      ],
      'GET /api/episodes/sb': {
        ...episode,
        id: 'sb',
        panels: [
          {
            ...episode.panels[0],
            overrides: { ...episode.panels[0].overrides, profile_id: configProfile.id },
          },
        ],
      },
    });
    renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Story/ });
    expect(screen.getByLabelText('图像服务')).toHaveValue('hybrid');
    expect(screen.getByLabelText('出图配置')).toHaveValue('');
    await screen.findByText('部分分幕单独指定了出图配置，生成时优先使用分幕设置。');
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('图像服务'), { target: { value: 'local' } });
    expect(screen.getByLabelText('出图配置')).toHaveValue(configProfile.id);
    fireEvent.change(screen.getByLabelText('图像服务'), { target: { value: 'hybrid' } });
    expect(screen.getByLabelText('出图配置')).toHaveValue('');
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
  });
});

describe('assembly review and durable retry intent', () => {
  it('keeps real preset ordering and uses server substitutions with editable empty variables', async () => {
    const calls = mockFetch({
      ...routes(),
      'POST /api/workshop/assemble/preview': preview,
      'POST /api/workshop/assemble': { series, episode },
    });
    await mount();
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
    fireEvent.click(screen.getByRole('button', { name: '添加待命任务' }));
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
    expect(screen.getByRole('button', { name: '添加待命任务' })).toBeEnabled();
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
    const submit = screen.getByRole('button', { name: '添加待命任务' });
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
    fireEvent.click(screen.getByRole('button', { name: '批量生成 · 加入待命' }));
    fireEvent.click(screen.getByRole('button', { name: '确认创建 2 个待命任务' }));
    await waitFor(() => expect(screen.getAllByLabelText('输出画册名称')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '批量生成 · 加入待命' }));
    fireEvent.click(screen.getByRole('button', { name: '确认创建 1 个待命任务' }));
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
