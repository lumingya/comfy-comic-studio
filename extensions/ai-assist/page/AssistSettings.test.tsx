import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

  it('keeps edits made during a successful save and submits them only on the next save', async () => {
    let finish!: (value: Settings) => void;
    const pending = new Promise<Settings>((resolve) => {
      finish = resolve;
    });
    let attempts = 0;
    const calls = mockFetch({
      'PUT /api/ext/ai-assist/settings': (body: unknown) => (++attempts === 1 ? pending : body),
    });
    const { onClose, onModeChange } = renderSettings();
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), {
      target: { value: '先保存名称' },
    });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    fireEvent.change(screen.getByRole('textbox', { name: '模型' }), {
      target: { value: 'last-user-intent' },
    });
    await act(async () => {
      finish({ ...saved, channels: [{ ...saved.channels[0], name: '先保存名称' }] });
      await pending;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '模型' })).toHaveValue('last-user-intent');
    expect((calls.find((c) => c.method === 'PUT')!.body as Settings).channels[0].model).toBe(
      'old-model',
    );
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect((calls.filter((c) => c.method === 'PUT')[1].body as Settings).channels[0].model).toBe(
      'last-user-intent',
    );
  });

  it('keeps a post-submit reversal dirty against the saved snapshot and preserves it after failure', async () => {
    let finish!: (value: Settings) => void;
    const pending = new Promise<Settings>((resolve) => {
      finish = resolve;
    });
    let attempts = 0;
    const calls = mockFetch({
      'PUT /api/ext/ai-assist/settings': (body: unknown) => {
        if (++attempts === 1) return pending;
        if (attempts === 2)
          return new Response(JSON.stringify({ detail: '磁盘写入失败' }), { status: 500 });
        return body;
      },
    });
    const { onClose } = renderSettings();
    const model = screen.getByRole('textbox', { name: '模型' });
    fireEvent.change(model, { target: { value: 'submitted-model' } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    fireEvent.change(model, { target: { value: 'old-model' } });
    await act(async () => {
      finish({ ...saved, channels: [{ ...saved.channels[0], model: 'submitted-model' }] });
      await pending;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘写入失败');
    expect(model).toHaveValue('old-model');
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect((calls.filter((c) => c.method === 'PUT')[2].body as Settings).channels[0].model).toBe(
      'old-model',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['模型与渠道', '操作权限', '显示方式'])(
    'disables the entire %s form while saving a display mode change that can unload the iframe',
    async (activeTab) => {
      let finish!: (value: Settings) => void;
      const pending = new Promise<Settings>((resolve) => {
        finish = resolve;
      });
      const calls = mockFetch({
        'PUT /api/ext/ai-assist/settings': () => pending,
        'GET /api/ext/ai-assist/tools': { items: [] },
      });
      const { onClose, onModeChange } = renderSettings();
      await userEvent.click(screen.getByRole('tab', { name: '显示方式' }));
      await userEvent.selectOptions(screen.getByRole('combobox', { name: '显示方式' }), 'page');
      await userEvent.click(screen.getByRole('tab', { name: activeTab }));
      await userEvent.click(screen.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
      for (const tab of screen.getAllByRole('tab')) expect(tab).toBeDisabled();
      const form = document.querySelector('.assist-config-body')!;
      for (const control of form.querySelectorAll('input, select, button'))
        expect(control).toBeDisabled();
      if (activeTab === '模型与渠道') {
        const model = screen.getByRole('textbox', { name: '模型' });
        await userEvent.type(model, 'unsaved-after-mode-submit');
        expect(model).toHaveValue('old-model');
      }
      await userEvent.click(
        screen.getByRole('tab', { name: activeTab === '模型与渠道' ? '显示方式' : '模型与渠道' }),
      );
      expect(screen.getByRole('tab', { name: activeTab })).toHaveAttribute('aria-selected', 'true');
      expect(onModeChange).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => {
        finish({ ...saved, mode: 'page' });
        await pending;
      });
      await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('page'));
      expect(onClose).toHaveBeenCalledOnce();
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
      expect((calls.find((c) => c.method === 'PUT')!.body as Settings).channels[0].model).toBe(
        'old-model',
      );
    },
  );

  it('re-enables all fields with the intact draft after a display mode save fails', async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    mockFetch({ 'PUT /api/ext/ai-assist/settings': () => pending });
    const { onClose, onModeChange } = renderSettings();
    fireEvent.change(screen.getByRole('textbox', { name: '模型' }), {
      target: { value: 'keep-this-model' },
    });
    await userEvent.click(screen.getByRole('tab', { name: '显示方式' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '显示方式' }), 'page');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('combobox', { name: '显示方式' })).toBeDisabled();
    await act(async () => {
      finish(new Response(JSON.stringify({ detail: '磁盘写入失败' }), { status: 500 }));
      await pending;
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘写入失败');
    expect(screen.getByRole('combobox', { name: '显示方式' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: '显示方式' })).toHaveValue('page');
    for (const tab of screen.getAllByRole('tab')) expect(tab).toBeEnabled();
    await userEvent.click(screen.getByRole('tab', { name: '模型与渠道' }));
    expect(screen.getByRole('textbox', { name: '模型' })).toHaveValue('keep-this-model');
    expect(screen.getByRole('textbox', { name: '模型' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
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
