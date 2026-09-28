import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ComfyInstance, RenderProfile, WorkflowDocument } from '../../api/types';
import { ConfirmHost } from '../../components/confirm';
import { Toaster, useToasts } from '../../components/toast';
import {
  configInstance,
  configProfile,
  configSettings,
  configSummary,
  configWorkflow,
  configurationRoutes,
} from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import EnginePage from '../engine/EnginePage';
import { ChannelsSection, newChannel } from './ChannelsSection';
import { jsonObject, validHttpUrl } from './ConfigurationParts';
import { GeneralSection } from './GeneralSection';
import { InstancesSection } from './InstancesSection';
import { ProfilesSection } from './ProfilesSection';
import { WorkflowsSection } from './WorkflowsSection';

afterEach(() => {
  vi.unstubAllGlobals();
  useToasts.getState().items.forEach((item) => useToasts.getState().dismiss(item.id));
});
const expand = async (label: string) => {
  const summary = screen.getByText(label, { selector: 'summary strong' }).closest('summary')!;
  const ancestors: HTMLDetailsElement[] = [];
  let ancestor = summary.parentElement?.parentElement ?? null;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) ancestors.unshift(ancestor);
    ancestor = ancestor.parentElement;
  }
  for (const details of ancestors) await userEvent.click(details.querySelector('summary')!);
  await userEvent.click(summary);
};

it('channel IDs are generated without collisions; no internal ID rename is needed', () => {
  expect(newChannel(['ch1', 'ch3']).id).toBe('ch2');
});

describe('cloud channel configuration', () => {
  it('edits only the selected channel, shows Images size/quality instead of inert width/height, and keeps masked keys', async () => {
    const calls = mockFetch(
      configurationRoutes({
        'PATCH /api/settings': (body: unknown) => ({ ...configSettings, ...(body as object) }),
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ChannelsSection />);
    await screen.findByDisplayValue('主力图像服务');
    expect(screen.queryByLabelText(/^宽/)).toBeNull();
    expect(screen.queryByLabelText(/^高/)).toBeNull();
    expect(screen.queryByDisplayValue('备用代理')).toBeNull();
    expect(screen.getByText('高级参数与标识').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByDisplayValue('images')).toHaveAttribute('readonly');
    await user.type(screen.getByLabelText(/^输出尺寸/), '1024x1536');
    await user.type(screen.getByLabelText(/^输出质量/), 'high');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!.body as AppSettings;
    expect(patch.image_channels?.[0]).toMatchObject({
      id: 'images',
      api_key: '••••••',
      size: '1024x1536',
      quality: 'high',
      width: 832,
      negative: 'blur',
    });
    expect(patch.image_channels?.[1]).toEqual(configSettings.image_channels![1]);
    expect(calls.some((c) => c.url.includes('/render') || c.url.includes('/generate'))).toBe(false);
  });

  it('switching protocol reveals only its supported controls and preserves values from other protocols', async () => {
    const calls = mockFetch(
      configurationRoutes({
        'PATCH /api/settings': (body: unknown) => ({ ...configSettings, ...(body as object) }),
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ChannelsSection />);
    await screen.findByDisplayValue('主力图像服务');
    await user.selectOptions(screen.getByLabelText('类型'), 'novelai');
    expect(screen.getByLabelText(/^宽/)).toHaveValue(832);
    expect(screen.queryByLabelText(/^输出尺寸/)).toBeNull();
    await expand('高级参数与标识');
    fireEvent.change(screen.getByLabelText('提示词引导（scale）'), { target: { value: '6.5' } });
    await user.clear(screen.getByLabelText('采样器'));
    await user.type(screen.getByLabelText('采样器'), 'custom_sampler');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!.body as AppSettings;
    expect(patch.image_channels?.[0]).toMatchObject({
      kind: 'novelai',
      scale: 6.5,
      sampler: 'custom_sampler',
      ref_strength: 0.6,
      steps: 28,
    });
  });

  it('chat channels explain inheritance and do not advertise unsupported size or quality', async () => {
    mockFetch(configurationRoutes());
    renderWithProviders(<ChannelsSection />);
    await userEvent.click(await screen.findByRole('button', { name: /备用代理/ }));
    expect(await screen.findByDisplayValue('备用代理')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^输出尺寸/)).toBeNull();
    expect(screen.queryByLabelText(/^输出质量/)).toBeNull();
    expect(screen.getByText(/不会转发文本服务的密钥/)).toBeInTheDocument();
  });

  it('does not let a default or referenced channel be deleted and silently fall back to another service', async () => {
    mockFetch(
      configurationRoutes({ 'GET /api/settings': { ...configSettings, image_channel: 'images' } }),
    );
    renderWithProviders(<ChannelsSection />);
    await screen.findByRole('textbox', { name: /^名称/ });
    expect(screen.getByRole('button', { name: '删除渠道' })).toBeDisabled();
    expect(screen.getByLabelText(/^默认云端渠道/)).toHaveValue('images');
  });

  it('shows a load failure with retry instead of spinning forever', async () => {
    mockFetch(
      configurationRoutes({
        'GET /api/settings': () =>
          new Response(JSON.stringify({ detail: 'settings unavailable' }), { status: 503 }),
      }),
    );
    renderWithProviders(<ChannelsSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('settings unavailable');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('retains the draft when saving fails', async () => {
    mockFetch(
      configurationRoutes({
        'PATCH /api/settings': () =>
          new Response(JSON.stringify({ detail: 'reference conflict' }), { status: 409 }),
      }),
    );
    renderWithProviders(
      <>
        <ChannelsSection />
        <Toaster />
      </>,
    );
    const name = await screen.findByDisplayValue('主力图像服务');
    fireEvent.change(name, { target: { value: '保留这个草稿' } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('reference conflict');
    expect(screen.getByDisplayValue('保留这个草稿')).toBeInTheDocument();
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument();
  });
});

describe('ComfyUI connections', () => {
  it('saves an edited URL before checking health rather than testing the old address', async () => {
    let instance = { ...configInstance };
    const calls = mockFetch(
      configurationRoutes({
        'GET /api/instances': () => ({ instances: [instance], pool: {} }),
        'PUT /api/instances/comfy_test': (body: unknown) => (instance = body as ComfyInstance),
        'GET /api/instances/comfy_test/health': { id: 'comfy_test', ok: true, stats: {} },
      }),
    );
    renderWithProviders(<InstancesSection />);
    const address = await screen.findByDisplayValue('http://127.0.0.1:8188');
    fireEvent.change(address, { target: { value: 'http://127.0.0.1:8199' } });
    await userEvent.click(screen.getByRole('button', { name: '保存并检查连接' }));
    expect(await screen.findByText(/服务连接正常/)).toBeInTheDocument();
    const put = calls.findIndex((c) => c.method === 'PUT');
    const health = calls.findIndex((c) => c.url.endsWith('/health'));
    expect(put).toBeGreaterThan(-1);
    expect(health).toBeGreaterThan(put);
    expect(calls[put].body).toMatchObject({ base_url: 'http://127.0.0.1:8199' });
  });

  it('uses the backend capacity limit of eight and keeps multi-server settings collapsed', async () => {
    mockFetch(configurationRoutes());
    renderWithProviders(<InstancesSection />);
    await screen.findByDisplayValue('测试 ComfyUI');
    expect(screen.getByText('多服务高级选项').closest('details')).not.toHaveAttribute('open');
    await expand('多服务高级选项');
    const capacity = screen.getByLabelText(/^并发/);
    expect(capacity).toHaveAttribute('max', '8');
    fireEvent.change(capacity, { target: { value: '9' } });
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });
});

describe('render profiles', () => {
  it('creates a cloud-only profile without copying another profile’s expensive settings or requiring ComfyUI', async () => {
    const calls = mockFetch(
      configurationRoutes({
        'GET /api/workflows': [],
        'POST /api/profiles': (body: unknown) => body,
      }),
    );
    renderWithProviders(<ProfilesSection />);
    await userEvent.click(await screen.findByRole('button', { name: '新建纯云端配置' }));
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      cloud_shape: true,
      draft: [],
      final: [],
      edits: {},
      instances: [],
      candidates: 1,
      dialect: 'natural',
    });
  });

  it('keeps advanced stage values and overrides when editing the name', async () => {
    const calls = mockFetch(
      configurationRoutes({ 'PUT /api/profiles/profile_default': (body: unknown) => body }),
    );
    renderWithProviders(<ProfilesSection />);
    fireEvent.change(await screen.findByDisplayValue('测试出图配置'), {
      target: { value: '保留参数' },
    });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect((calls.find((c) => c.method === 'PUT')!.body as RenderProfile).draft).toEqual(
      configProfile.draft,
    );
    expect(screen.getByText('成品、修图与多阶段流程').closest('details')).not.toHaveAttribute(
      'open',
    );
  });
});

describe('workflow editor', () => {
  it('saves mappings without dropping advanced values, one-to-many mappings, notes or frontend state', async () => {
    let doc = structuredClone(configWorkflow);
    const calls = mockFetch(
      configurationRoutes({
        'GET /api/workflows/wf_demo': () => doc,
        'PATCH /api/workflows/wf_demo': (body: unknown) => (doc = { ...doc, ...(body as object) }),
      }),
    );
    renderWithProviders(<WorkflowsSection />);
    const prompt = await screen.findByLabelText(/^正向提示词/);
    await userEvent.selectOptions(prompt, '/7/inputs/text');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const body = calls.find((c) => c.method === 'PATCH')!.body as Partial<WorkflowDocument>;
    expect(body.config).toMatchObject({
      ...configWorkflow.config,
      mapping: { ...configWorkflow.config.mapping, prompt: '/7/inputs/text' },
    });
    expect(body.notes).toBe('Keep these notes');
    expect(body).not.toHaveProperty('graph');
  });

  it('does not let malformed JSON be saved', async () => {
    const calls = mockFetch(configurationRoutes());
    renderWithProviders(<WorkflowsSection />);
    await screen.findByDisplayValue('测试工作流');
    await expand('高级映射与参数 JSON');
    fireEvent.change(screen.getByLabelText('高级映射与参数 JSON'), {
      target: { value: '{ invalid' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('JSON');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('compiles a saved workflow without submitting any generation request', async () => {
    const calls = mockFetch(
      configurationRoutes({
        'POST /api/workflows/wf_demo/compile': {
          graph: configWorkflow.graph,
          outputs: ['9'],
          warnings: [],
        },
      }),
    );
    renderWithProviders(<WorkflowsSection />);
    await screen.findByDisplayValue('测试工作流');
    await expand('编译预览 · 不出图');
    await userEvent.click(screen.getByRole('button', { name: '编译已保存的工作流' }));
    expect(await screen.findByText(/以下是将提交的节点图/)).toBeInTheDocument();
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: 'POST',
      url: '/api/workflows/wf_demo/compile',
      body: { values: { prompt: 'a quiet street', seed: 1 }, variant: null },
    });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '尚未保存的修改' } });
    expect(screen.getByRole('button', { name: '编译已保存的工作流' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '导出工作流与映射' })).toBeDisabled();
    await expand('原始工作流 JSON');
    expect(screen.getByRole('button', { name: '导出原始 API JSON' })).toBeDisabled();
  });

  it('keeps built-in graphs read-only while leaving their mappings editable', async () => {
    mockFetch(
      configurationRoutes({
        'GET /api/workflows': [{ ...configSummary, source: 'builtin' }],
        'GET /api/workflows/wf_demo': { ...configWorkflow, source: 'builtin' },
      }),
    );
    renderWithProviders(<WorkflowsSection />);
    await screen.findByDisplayValue('测试工作流');
    await expand('原始工作流 JSON');
    expect(screen.getByLabelText('原始工作流 JSON')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
    expect(screen.getByLabelText(/^正向提示词/)).toBeEnabled();
  });

  it('diagnosis chooses a real server immediately instead of starting with an unusable blank selection', async () => {
    const calls = mockFetch(
      configurationRoutes({
        'POST /api/workflows/wf_demo/diagnose': {
          ok: true,
          instance: 'comfy_test',
          missing_nodes: [],
          missing_models: [],
          invalid_values: [],
          models: {},
        },
      }),
    );
    renderWithProviders(<WorkflowsSection />);
    await userEvent.click(await screen.findByRole('button', { name: '诊断' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('检查哪台 ComfyUI')).toHaveValue('comfy_test');
    await userEvent.click(within(dialog).getByRole('button', { name: '诊断' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url === '/api/workflows/wf_demo/diagnose?instance_id=comfy_test'),
      ).toBe(true),
    );
  });
});

it('guards query-string tab changes, and cancel keeps the channel draft in place', async () => {
  mockFetch(configurationRoutes());
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/engine',
        element: (
          <>
            <EnginePage />
            <ConfirmHost />
          </>
        ),
      },
    ],
    { initialEntries: ['/engine?tab=channels'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByDisplayValue('主力图像服务'), {
    target: { value: '仍在编辑' },
  });
  await userEvent.click(screen.getByRole('tab', { name: /出图配置/ }));
  const dialog = await screen.findByRole('dialog', { name: '离开此页？' });
  await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  expect(router.state.location.search).toBe('?tab=channels');
  expect(screen.getByDisplayValue('仍在编辑')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: /出图配置/ }));
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: '离开' }),
  );
  await waitFor(() => expect(router.state.location.search).toBe('?tab=profiles'));
});

function RefetchSettings() {
  const client = useQueryClient();
  return (
    <button onClick={() => void client.invalidateQueries({ queryKey: ['settings'] })}>
      refetch
    </button>
  );
}

it('background settings refresh does not overwrite an unsaved text API draft', async () => {
  let settings = structuredClone(configSettings);
  mockFetch(configurationRoutes({ 'GET /api/settings': () => settings }));
  renderWithProviders(
    <>
      <GeneralSection />
      <RefetchSettings />
    </>,
  );
  fireEvent.change(await screen.findByDisplayValue('https://shared.test/v1'), {
    target: { value: 'https://draft.test/v1' },
  });
  settings = { ...settings, llm: { ...settings.llm, base_url: 'https://refetched.test/v1' } };
  await userEvent.click(screen.getByRole('button', { name: 'refetch' }));
  await waitFor(() =>
    expect(screen.getByDisplayValue('https://draft.test/v1')).toBeInTheDocument(),
  );
});

it.each(['http://127.0.0.1:8188', 'https://provider.test/v1'])('accepts HTTP base URL %s', (url) =>
  expect(validHttpUrl(url)).toBe(true),
);
it.each([
  'file:///tmp/key',
  'https://user:secret@provider.test/v1',
  'javascript:alert(1)',
  'https://provider.test/v1?token=secret',
])('rejects unsafe or misplaced credential URL %s', (url) => expect(validHttpUrl(url)).toBe(false));
it.each(['[]', 'null', '"string"'])('requires a JSON object, not %s', (value) =>
  expect(() => jsonObject(value)).toThrow(),
);
