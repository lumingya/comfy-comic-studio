import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { configurationRoutes, configSettings } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import type { AppSettings } from '../../api/types';
import { GeneralSection } from './GeneralSection';
import { ChannelsSection } from './ChannelsSection';
import { InstancesSection } from './InstancesSection';

afterEach(() => vi.unstubAllGlobals());
const catalog = { models: [{ id: 'custom-model' }], source: 'remote', notice: '' };

it('replaces a saved password without the mask and makes clearing explicit', async () => {
  const calls = mockFetch(
    configurationRoutes({
      'PATCH /api/settings': (patch: unknown) => ({ ...configSettings, ...(patch as object) }),
    }),
  );
  renderWithProviders(<GeneralSection />);
  const key = await screen.findByPlaceholderText('已保存密钥，输入新密钥即可替换');
  expect(key).toHaveValue('');
  await userEvent.type(key, 'replacement-key');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
  expect((calls.find((call) => call.method === 'PATCH')!.body as AppSettings).llm.api_key).toBe(
    'replacement-key',
  );
  await userEvent.click(screen.getByRole('button', { name: '清除密钥' }));
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2));
  expect((calls.filter((call) => call.method === 'PATCH')[1].body as AppSettings).llm.api_key).toBe(
    '',
  );
});

it('adds image models without exposing or modifying the assistant text models', async () => {
  const calls = mockFetch(
    configurationRoutes({
      'POST /api/settings/models': catalog,
      'PATCH /api/settings': (patch: unknown) => ({ ...configSettings, ...(patch as object) }),
    }),
  );
  renderWithProviders(<GeneralSection />);
  await screen.findByDisplayValue('https://shared.test/v1');
  expect(screen.queryByText('文本模型')).toBeNull();
  for (const scope of screen.getAllByRole('region', { name: '模型目录' })) {
    await userEvent.click(within(scope).getByRole('button', { name: '获取模型' }));
    await userEvent.click(await within(scope).findByRole('button', { name: 'custom-model' }));
  }
  expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
  const llm = (calls.find((call) => call.method === 'PATCH')!.body as AppSettings).llm;
  expect(llm.text_models).toBeUndefined();
  expect(llm.vision_models).toBeUndefined();
  expect(llm.image_models).toEqual(['chat-image-test', 'custom-model']);
});

it('fetches a cloud draft and applies a selected model without saving or generating', async () => {
  const calls = mockFetch(configurationRoutes({ 'POST /api/settings/models': catalog }));
  renderWithProviders(<ChannelsSection />);
  const key = await screen.findByPlaceholderText('已保存密钥，输入新密钥即可替换');
  await userEvent.type(key, 'new-key');
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  await userEvent.click(await screen.findByRole('button', { name: 'custom-model' }));
  expect(screen.getByRole('textbox', { name: /^模型/ })).toHaveValue('custom-model');
  expect(calls.filter((call) => call.method !== 'GET')).toEqual([
    {
      method: 'POST',
      url: '/api/settings/models',
      body: {
        kind: 'openai_images',
        channel_id: 'images',
        base_url: 'https://images.test/v1',
        api_key: 'new-key',
      },
    },
  ]);
});

it('identifies the invalid channel after switching to a healthy one', async () => {
  mockFetch(configurationRoutes());
  renderWithProviders(<ChannelsSection />);
  const address = await screen.findByDisplayValue('https://images.test/v1');
  await userEvent.clear(address);
  await userEvent.type(address, 'broken-address');
  await userEvent.click(screen.getByRole('button', { name: /备用代理/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('主力图像服务');
  expect(screen.getByRole('button', { name: /主力图像服务/ })).toHaveTextContent('地址有误');
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
});

it('browses installed ComfyUI models at an unsaved address without saving the instance', async () => {
  const calls = mockFetch(configurationRoutes({ 'POST /api/settings/models': catalog }));
  renderWithProviders(<InstancesSection />);
  const address = await screen.findByDisplayValue('http://127.0.0.1:8188');
  await userEvent.clear(address);
  await userEvent.type(address, 'http://127.0.0.1:8288');
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  await screen.findByText('custom-model');
  expect(screen.queryByRole('button', { name: 'custom-model' })).toBeNull();
  expect(calls.filter((call) => call.method !== 'GET')).toEqual([
    {
      method: 'POST',
      url: '/api/settings/models',
      body: { kind: 'comfyui', base_url: 'http://127.0.0.1:8288', api_key: '' },
    },
  ]);
});
