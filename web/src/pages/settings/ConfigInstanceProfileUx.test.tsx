import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComfyInstance, RenderProfile } from '../../api/types';
import { useToasts } from '../../components/toast';
import { configInstance, configProfile, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { InstancesSection } from './InstancesSection';
import { ProfilesSection } from './ProfilesSection';

afterEach(() => {
  vi.unstubAllGlobals();
  useToasts.getState().items.forEach((item) => useToasts.getState().dismiss(item.id));
});

it('checks an unchanged connection without a saving message or another submission', async () => {
  let finish!: (result: unknown) => void;
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/instances/comfy_test/health': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
  );
  renderWithProviders(<InstancesSection />);
  const address = await screen.findByDisplayValue(configInstance.base_url);
  await userEvent.click(screen.getByRole('button', { name: '检查连接' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(screen.queryByText('正在保存…')).toBeNull();
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  expect(address).toBeDisabled();
  fireEvent.submit(address.closest('form')!);
  expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  finish({ id: configInstance.id, ok: true, stats: {} });
  expect(await screen.findByText(/服务连接正常/)).toBeInTheDocument();
  expect(address).toBeEnabled();
});

it('shows saving only until an edited connection has been persisted, then checks it', async () => {
  let instance = { ...configInstance };
  let finishSave!: (saved: ComfyInstance) => void;
  let finishHealth!: (result: unknown) => void;
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/instances': () => ({ instances: [instance], pool: {} }),
      'PUT /api/instances/comfy_test': (body: unknown) =>
        new Promise<ComfyInstance>((resolve) => {
          instance = body as ComfyInstance;
          finishSave = resolve;
        }),
      'GET /api/instances/comfy_test/health': () =>
        new Promise((resolve) => {
          finishHealth = resolve;
        }),
    }),
  );
  renderWithProviders(<InstancesSection />);
  const address = await screen.findByDisplayValue(configInstance.base_url);
  fireEvent.change(address, { target: { value: 'http://127.0.0.1:8199' } });
  await userEvent.click(screen.getByRole('button', { name: '保存并检查连接' }));
  expect(await screen.findByText('正在保存…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  await waitFor(() => expect(finishSave).toBeTypeOf('function'));
  finishSave(instance);
  await waitFor(() => expect(finishHealth).toBeTypeOf('function'));
  expect(screen.queryByText('正在保存…')).toBeNull();
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  fireEvent.submit(address.closest('form')!);
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  finishHealth({ id: configInstance.id, ok: true, stats: {} });
  expect(await screen.findByText(/服务连接正常/)).toBeInTheDocument();
});

it('hides local server selection for pure cloud while retaining existing bindings', async () => {
  const cloud: RenderProfile = { ...configProfile, cloud_shape: true, cloud_channel: 'images' };
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/profiles': [cloud],
      'PUT /api/profiles/profile_default': (body: unknown) => body,
    }),
  );
  renderWithProviders(<ProfilesSection />);
  const name = await screen.findByDisplayValue(cloud.name);
  expect(screen.getByText('云端生成可能按张计费；保存配置不会出图。')).toBeInTheDocument();
  const advanced = screen.getByText('提示词与多服务调度').closest('summary')!;
  await userEvent.click(advanced);
  expect(screen.queryByRole('checkbox', { name: /测试 ComfyUI/ })).toBeNull();
  expect(screen.queryByText('不勾选表示使用所有已启用服务；需要固定服务时再勾选。')).toBeNull();
  fireEvent.change(name, { target: { value: 'Cloud profile' } });
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
      name: 'Cloud profile',
      instances: configProfile.instances,
    }),
  );
});

it.each([false, true])(
  'lets local routes remove disabled servers but prevents adding them again (hybrid: %s)',
  async (hybrid) => {
    const disabledSelected = { ...configInstance, enabled: false };
    const disabledOther = { ...disabledSelected, id: 'other', name: 'Stopped server' };
    const enabled = { ...configInstance, id: 'enabled', name: 'Enabled server' };
    const profile: RenderProfile = {
      ...configProfile,
      cloud_shape: hybrid,
      cloud_refine: hybrid,
      final: hybrid ? configProfile.draft : [],
      cloud_channel: hybrid ? 'images' : '',
    };
    const calls = mockFetch(
      configurationRoutes({
        'GET /api/profiles': [profile],
        'GET /api/instances': { instances: [disabledSelected, disabledOther, enabled], pool: {} },
        'PUT /api/profiles/profile_default': (body: unknown) => body,
      }),
    );
    renderWithProviders(<ProfilesSection />);
    await screen.findByDisplayValue(profile.name);
    expect(screen.queryByText('云端生成可能按张计费；保存配置不会出图。') !== null).toBe(hybrid);
    await userEvent.click(screen.getByText('提示词与多服务调度').closest('summary')!);
    const selected = await screen.findByRole('checkbox', { name: /测试 ComfyUI/ });
    expect(selected).toBeChecked();
    expect(selected).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Stopped server/ })).toBeDisabled();
    const available = screen.getByRole('checkbox', { name: /Enabled server/ });
    expect(available).toBeEnabled();
    await userEvent.click(selected);
    expect(selected).not.toBeChecked();
    expect(selected).toBeDisabled();
    await userEvent.click(available);
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
        instances: ['enabled'],
      }),
    );
  },
);
