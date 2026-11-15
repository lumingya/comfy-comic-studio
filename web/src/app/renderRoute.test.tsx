import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderProfile } from '../api/types';
import {
  configInstance,
  configProfile,
  configSettings,
  configurationRoutes,
} from '../test/configuration';
import { episode, series } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/utils';
import { GenerateStage } from '../pages/script/GenerateStage';
import AssembleDialog from '../pages/workshop/AssembleDialog';
import { resolveCloud, resolveProfile, useRenderRoute } from './renderRoute';
import { useSetupChecks } from './setup';

const cloud: RenderProfile = {
  ...configProfile,
  id: 'cloud',
  name: '云端配置',
  cloud_shape: true,
  cloud_channel: 'images',
};
const workshop = { ...series, id: 'ws', kind: 'workshop', default_profile_id: cloud.id };
const storyboard = { ...episode, id: 'sb', series_id: 'ws', takes: [] };
const base = () =>
  configurationRoutes({
    'GET /api/profiles': [configProfile, cloud],
    'GET /api/workflows': [],
    'GET /api/instances': { instances: [] },
    'GET /api/workshop': workshop,
    'GET /api/series': [],
    'GET /api/series/ws/episodes': { items: [{ id: 'sb', title: '测试分镜', panel_count: 2 }] },
    'GET /api/episodes/sb': storyboard,
    'GET /api/jobs': [],
  });

afterEach(() => vi.unstubAllGlobals());

function Route({ override, fallback }: { override?: string; fallback?: string }) {
  const route = useRenderRoute(override, fallback);
  return (
    <>
      <output>{route.state}</output>
      <span>{route.summary}</span>
      <a href={route.to}>{route.detail}</a>
    </>
  );
}
function Checks() {
  const checks = useSetupChecks();
  return (
    <>
      {checks.map((check) => (
        <output key={check.id} data-testid={check.id}>
          {check.state}: {check.detail}
        </output>
      ))}
    </>
  );
}

describe('render routes', () => {
  it('resolves panel, series and builtin defaults without silently replacing a missing selection', () => {
    const profiles = [configProfile, cloud];
    expect(resolveProfile(profiles, cloud.id, configProfile.id).profile).toBe(cloud);
    expect(resolveProfile(profiles, null, cloud.id).profile).toBe(cloud);
    expect(resolveProfile(profiles).profile).toBe(configProfile);
    expect(resolveProfile(profiles, 'gone', cloud.id)).toEqual({ id: 'gone', profile: undefined });
    expect(resolveCloud(cloud, configSettings).channel?.id).toBe('images');
    expect(
      resolveCloud({ ...cloud, cloud_channel: '' }, { ...configSettings, image_channel: 'chat' })
        .channel?.id,
    ).toBe('chat');
    expect(resolveCloud({ ...cloud, cloud_channel: '' }, configSettings)).toMatchObject({
      id: '',
      configured: true,
    });
    expect(resolveCloud({ ...cloud, cloud_channel: 'gone' }, configSettings)).toMatchObject({
      id: 'gone',
      configured: false,
    });
  });

  it('does not probe ComfyUI for a cloud profile even when local instances exist', async () => {
    const calls = mockFetch({ ...base(), 'GET /api/instances': { instances: [configInstance] } });
    renderWithProviders(<Route override={cloud.id} />);
    await screen.findByText('configured');
    expect(screen.getByText(/纯云端出图 · 主力图像服务/)).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith('/health'))).toBe(false);
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  it('renders a task snapshot without requiring its profile in the configuration library', async () => {
    const calls = mockFetch({ ...base(), 'GET /api/profiles': [] });
    const generate = vi.fn();
    renderWithProviders(
      <GenerateStage
        episode={episode}
        panelId="p0"
        defaultProfileId="task:channel:images"
        taskProfile={{ ...cloud, id: 'task:channel:images' }}
        candidates={3}
        onGenerate={generate}
      />,
    );
    await screen.findByText(/纯云端出图 · 主力图像服务 · 已配置/);
    expect(document.querySelector('.stage-notice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /生成.*3/ }));
    expect(generate).toHaveBeenCalledWith(3);
    expect(calls.some((call) => call.url.endsWith('/health'))).toBe(false);
  });

  it('checks all eligible instances and accepts a later reachable one, excluding other instances', async () => {
    const local = { ...configProfile, instances: ['down', 'up'] };
    const calls = mockFetch({
      ...base(),
      'GET /api/profiles': [local],
      'GET /api/instances': {
        instances: ['other', 'down', 'up'].map((id) => ({ ...configInstance, id, name: id })),
      },
      'GET /api/instances/down/health': { ok: false, stats: {} },
      'GET /api/instances/up/health': { ok: true, stats: {} },
    });
    renderWithProviders(<Route />);
    await screen.findByText('online');
    expect(screen.getByText('使用 up')).toBeInTheDocument();
    expect(
      calls
        .filter((call) => call.url.endsWith('/health'))
        .map((call) => call.url)
        .sort(),
    ).toEqual(['/api/instances/down/health', '/api/instances/up/health']);
  });

  it('requires local resources for explicit hybrid and preserves missing channel identity', async () => {
    mockFetch({ ...base(), 'GET /api/profiles': [{ ...cloud, cloud_refine: true }] });
    const view = renderWithProviders(<Route override={cloud.id} />);
    await screen.findByText('unset');
    expect(screen.getByText(/云端出图 \+ 本地精修/)).toBeInTheDocument();
    view.unmount();
    mockFetch({ ...base(), 'GET /api/profiles': [{ ...cloud, cloud_channel: 'deleted' }] });
    renderWithProviders(<Route override={cloud.id} />);
    await screen.findByText('missing');
    expect(screen.getByText('纯云端出图 · deleted')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/engine?tab=channels');
  });

  it('checks the workshop cloud default without requiring a local workflow', async () => {
    const calls = mockFetch(base());
    renderWithProviders(<Checks />);
    await waitFor(() => expect(screen.getByTestId('service')).toHaveTextContent('done:'));
    expect(screen.getByTestId('service')).toHaveTextContent('尚未验证真实服务可用性');
    expect(screen.getByTestId('workflow')).toHaveTextContent('done: 纯云端不需要');
    expect(calls.some((call) => call.url.endsWith('/health'))).toBe(false);
  });

  it('shows cloud panel overrides on a local work and local overrides on a cloud work', async () => {
    mockFetch(base());
    const generate = vi.fn();
    const view = renderWithProviders(
      <GenerateStage
        episode={episode}
        panelId="p0"
        profileId={cloud.id}
        defaultProfileId={configProfile.id}
        onGenerate={generate}
      />,
    );
    await screen.findByText(/纯云端出图 · 主力图像服务 · 已配置/);
    expect(screen.getByText(/实际请求记录可在候选详情查看/)).toBeInTheDocument();
    expect(document.querySelector('.stage-notice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    expect(generate).toHaveBeenCalledOnce();
    view.unmount();
    renderWithProviders(
      <GenerateStage
        episode={episode}
        panelId="p0"
        profileId={configProfile.id}
        defaultProfileId={cloud.id}
        onGenerate={vi.fn()}
      />,
    );
    await screen.findByText(/此配置没有可用的 ComfyUI 实例/);
    expect(screen.queryByText(/实际请求记录可在候选详情查看/)).toBeNull();
    expect(screen.getByRole('link', { name: '检查出图配置' })).toHaveAttribute(
      'href',
      '/engine?tab=instances',
    );
  });

  it('shows the selected assembly route in the final summary and only creates a snapshot', async () => {
    const calls = mockFetch({
      ...base(),
      'POST /api/workshop/assemble': { series, episode },
      'POST /api/workshop/assemble/preview': {
        title: '',
        storyboard_id: 'sb',
        profile_id: cloud.id,
        preset_ids: [],
        panels: [],
      },
    });
    renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('出图工作流或云端服务')).toHaveValue(
        `profile:${cloud.id}`,
      ),
    );
    fireEvent.change(within(dialog).getByLabelText('出图工作流或云端服务'), {
      target: { value: `profile:${configProfile.id}` },
    });
    expect(within(dialog).getByLabelText('出图工作流或云端服务')).toHaveValue(
      `profile:${configProfile.id}`,
    );
    fireEvent.change(within(dialog).getByLabelText('出图工作流或云端服务'), {
      target: { value: `profile:${cloud.id}` },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));
    expect(within(dialog).getByText(cloud.name)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '稍后生成' }));
    await waitFor(() =>
      expect(calls.find((call) => call.url === '/api/workshop/assemble')?.body).toMatchObject({
        generation: { profile_id: cloud.id },
      }),
    );
    expect(
      calls
        .filter((call) => call.method === 'POST')
        .every((call) =>
          ['/api/workshop/assemble', '/api/workshop/assemble/preview'].includes(call.url),
        ),
    ).toBe(true);
  });
});
