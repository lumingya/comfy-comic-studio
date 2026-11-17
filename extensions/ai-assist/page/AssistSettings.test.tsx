import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistSettings as Settings } from './api';
import { mockFetch, renderWithProviders } from './test/utils';
import { AssistSettings } from './AssistSettings';

const saved: Settings = {
  mode: 'floating',
  active_channel_id: 'cloud',
  channels: [
    {
      id: 'cloud',
      name: '我的渠道',
      provider: 'openai',
      base_url: 'https://gateway.example/v1',
      api_key: '••••••',
      model: 'old-model',
    },
  ],
  permissions: {
    scopes: ['read'],
    allow_operations: [],
    deny_operations: [],
    confirm_mutations: true,
  },
  storage_path: 'C:/workspace/extension-data/ai-assist/conversations',
};
const renderSettings = () => {
  const onClose = vi.fn();
  const onModeChange = vi.fn();
  renderWithProviders(
    <AssistSettings settings={saved} onClose={onClose} onModeChange={onModeChange} />,
  );
  return { onClose, onModeChange };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AI assistant configuration', () => {
  it('fetches models from the draft provider, filters and selects one, preserves masked key', async () => {
    const calls = mockFetch({
      'POST /api/ext/ai-assist/models': {
        items: [
          { id: 'claude-opus-5.5', name: 'Claude Opus' },
          { id: 'gemini-test', name: 'Gemini' },
        ],
      },
      'PUT /api/ext/ai-assist/settings': (body: unknown) => body,
    });
    const { onClose } = renderSettings();
    await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
    await screen.findByRole('button', { name: 'Claude Opus' });
    await userEvent.type(screen.getByRole('textbox', { name: '搜索模型或填写模型 ID' }), 'opus');
    expect(screen.queryByRole('button', { name: 'Gemini' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Claude Opus' }));
    expect(screen.getByRole('textbox', { name: '模型' })).toHaveValue('claude-opus-5.5');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(calls.find((c) => c.url.endsWith('/models'))!.body).toEqual(saved.channels[0]);
    const body = calls.find((c) => c.method === 'PUT')!.body as Settings;
    expect(body.channels[0]).toMatchObject({ model: 'claude-opus-5.5', api_key: '••••••' });
    expect(body).not.toHaveProperty('storage_path');
  });

  it('keeps manual model entry available when model discovery fails', async () => {
    const calls = mockFetch({
      'POST /api/ext/ai-assist/models': new Response(JSON.stringify({ detail: '目录不受支持' }), {
        status: 404,
      }),
      'PUT /api/ext/ai-assist/settings': (body: unknown) => body,
    });
    const { onClose } = renderSettings();
    await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('目录不受支持');
    const model = screen.getByRole('textbox', { name: '模型' });
    await userEvent.clear(model);
    await userEvent.type(model, 'custom-model');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect((calls.find((c) => c.method === 'PUT')!.body as Settings).channels[0].model).toBe(
      'custom-model',
    );
  });

  it('saves category permissions and one operation override together', async () => {
    const calls = mockFetch({
      'GET /api/ext/ai-assist/tools': {
        items: [
          {
            id: 'create_storyboard',
            method: 'POST',
            path: '/api/v2/storyboards',
            summary: '新建分镜',
            scope: 'write',
            allowed: false,
          },
        ],
      },
      'PUT /api/ext/ai-assist/settings': (body: unknown) => body,
    });
    const { onClose } = renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: '操作权限' }));
    await userEvent.click(screen.getByRole('switch', { name: '编辑作品' }));
    await userEvent.click(screen.getByRole('switch', { name: '执行修改前询问我' }));
    await userEvent.click(screen.getByText('具体操作'));
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: '新建分镜' }),
      'deny',
    );
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    const body = calls.find((c) => c.method === 'PUT')!.body as Settings;
    expect(body.permissions).toEqual({
      scopes: ['read', 'write'],
      allow_operations: [],
      deny_operations: ['create_storyboard'],
      confirm_mutations: false,
    });
  });

  it('persists the display mode before requesting navigation', async () => {
    const calls = mockFetch({ 'PUT /api/ext/ai-assist/settings': (body: unknown) => body });
    const { onModeChange, onClose } = renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: '显示方式' }));
    expect(screen.getByText(saved.storage_path!)).toBeVisible();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '显示方式' }), 'page');
    expect(onModeChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('page'));
    expect(onClose).toHaveBeenCalledOnce();
    expect((calls.find((c) => c.method === 'PUT')!.body as Settings).mode).toBe('page');
  });

  it('does not navigate or discard the configuration after a failed save', async () => {
    mockFetch({
      'PUT /api/ext/ai-assist/settings': new Response(JSON.stringify({ detail: '磁盘写入失败' }), {
        status: 500,
      }),
    });
    const { onClose, onModeChange } = renderSettings();
    await userEvent.click(screen.getByRole('tab', { name: '显示方式' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '显示方式' }), 'page');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘写入失败');
    expect(onClose).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: '显示方式' })).toHaveValue('page');
  });

  it('hides the previous model catalog after the same channel address changes', async () => {
    mockFetch({
      'POST /api/ext/ai-assist/models': {
        items: [{ id: 'old-provider-model', name: '旧渠道模型' }],
      },
    });
    renderSettings();
    await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
    expect(await screen.findByRole('button', { name: '旧渠道模型' })).toBeVisible();
    const address = screen.getByRole('textbox', { name: 'API 地址' });
    await userEvent.clear(address);
    await userEvent.type(address, 'https://new.example/v1');
    expect(screen.queryByRole('button', { name: '旧渠道模型' })).not.toBeInTheDocument();
  });
});
