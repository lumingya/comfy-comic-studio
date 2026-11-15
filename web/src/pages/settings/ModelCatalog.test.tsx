import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ModelCatalogRequest, ModelCatalogResponse } from '../../api/modelCatalog';
import { mockFetch } from '../../test/utils';
import { ModelCatalog } from './ModelCatalog';

const request: ModelCatalogRequest = {
  kind: 'chat_image',
  base_url: 'https://draft.example/v1',
  api_key: 'private-draft-key',
  channel_id: 'draft-channel',
};
const catalog: ModelCatalogResponse = {
  source: 'remote',
  models: [
    { id: 'picture-v2', name: 'Picture' },
    { id: 'story-model', name: 'Story', group: 'text' },
  ],
};

afterEach(() => vi.unstubAllGlobals());

it('fetches the current draft only on demand, searches and selects without submitting the form', async () => {
  const calls = mockFetch({ 'POST /api/settings/models': catalog });
  const submit = vi.fn();
  function Form() {
    const [model, setModel] = useState('custom-model');
    return (
      <form onSubmit={submit}>
        <label>
          模型 ID
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <ModelCatalog request={request} selected={[model]} onSelect={setModel} />
      </form>
    );
  }
  const user = userEvent.setup();
  const { container } = render(<Form />);
  expect(calls).toHaveLength(0);
  expect(screen.getByLabelText('模型 ID')).toHaveValue('custom-model');
  await user.click(screen.getByRole('button', { name: '获取模型' }));
  await screen.findByRole('button', { name: 'picture-v2 Picture' });
  expect(calls).toEqual([{ method: 'POST', url: '/api/settings/models', body: request }]);
  expect(container.innerHTML).not.toContain('private-draft-key');
  await user.type(screen.getByRole('searchbox', { name: '搜索模型' }), 'pic{Enter}');
  expect(screen.queryByRole('button', { name: /story-model/ })).toBeNull();
  const option = screen.getByRole('button', { name: 'picture-v2 Picture' });
  option.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByLabelText('模型 ID')).toHaveValue('picture-v2');
  expect(option).toHaveAttribute('aria-pressed', 'true');
  expect(submit).not.toHaveBeenCalled();
  expect(calls).toHaveLength(1);
});

it('discards results and errors when a connection draft changes', async () => {
  let rejectRequest = false;
  mockFetch({
    'POST /api/settings/models': () =>
      rejectRequest
        ? new Response(JSON.stringify({ detail: '目录暂不可用' }), { status: 404 })
        : catalog,
  });
  const onSelect = vi.fn();
  const view = render(<ModelCatalog request={request} onSelect={onSelect} />);
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  await screen.findByRole('button', { name: /picture-v2/ });
  const changed = { ...request, api_key: 'new-secret' };
  view.rerender(<ModelCatalog request={changed} onSelect={onSelect} />);
  expect(screen.queryByText('picture-v2')).toBeNull();
  expect(screen.queryByRole('searchbox')).toBeNull();
  rejectRequest = true;
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('目录暂不可用');
  view.rerender(
    <ModelCatalog
      request={{ ...changed, base_url: 'https://other.example/v1' }}
      onSelect={onSelect}
    />,
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: '获取模型' })).toBeEnabled();
});

it('ignores late results from an old address after a newer request has finished', async () => {
  let finishOld!: (data: ModelCatalogResponse) => void;
  const calls = mockFetch({
    'POST /api/settings/models': (body: unknown) =>
      (body as ModelCatalogRequest).base_url === request.base_url
        ? new Promise<ModelCatalogResponse>((resolve) => {
            finishOld = resolve;
          })
        : { source: 'remote', models: [{ id: 'new-service-model' }] },
  });
  const view = render(<ModelCatalog request={request} onSelect={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  await waitFor(() => expect(finishOld).toBeTypeOf('function'));
  expect(screen.getByRole('button', { name: '正在获取…' })).toBeDisabled();
  view.rerender(
    <ModelCatalog
      request={{ ...request, base_url: 'https://new.example/v1' }}
      onSelect={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  await screen.findByRole('button', { name: 'new-service-model' });
  await act(async () => finishOld(catalog));
  expect(screen.queryByText('picture-v2')).toBeNull();
  expect(screen.getByRole('button', { name: 'new-service-model' })).toBeInTheDocument();
  expect(calls).toHaveLength(2);
});

it('keeps manual entry available on failure and allows retry', async () => {
  let attempts = 0;
  mockFetch({
    'POST /api/settings/models': () =>
      ++attempts === 1
        ? new Response(JSON.stringify({ detail: '请检查 API 密钥' }), { status: 401 })
        : catalog,
  });
  const select = vi.fn();
  render(<ModelCatalog request={request} onSelect={select} selected={['unlisted-model']} />);
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请检查 API 密钥');
  expect(screen.getByText('仍可手动填写模型 ID。')).toBeInTheDocument();
  expect(select).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByRole('button', { name: /picture-v2/ });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(select).not.toHaveBeenCalled();
});

it('labels bundled reference models honestly and never selects them automatically', async () => {
  mockFetch({
    'POST /api/settings/models': {
      source: 'bundled',
      notice: '服务未提供动态目录。',
      models: [{ id: 'nai-example' }],
    },
  });
  const select = vi.fn();
  render(<ModelCatalog request={{ ...request, kind: 'novelai' }} onSelect={select} />);
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  await screen.findByText('内置参考列表');
  expect(screen.queryByText('服务返回的模型')).toBeNull();
  expect(screen.getByText('服务未提供动态目录。')).toBeInTheDocument();
  expect(select).not.toHaveBeenCalled();
});

it('supports empty catalogs, no search matches, and refresh', async () => {
  let attempts = 0;
  mockFetch({
    'POST /api/settings/models': () =>
      ++attempts === 1 ? { source: 'remote', models: [] } : catalog,
  });
  render(<ModelCatalog request={request} onSelect={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await screen.findByText('暂未获取到模型，可手动填写模型 ID。')).toBeInTheDocument();
  expect(screen.queryByRole('searchbox')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '刷新模型' }));
  const search = await screen.findByRole('searchbox');
  await userEvent.type(search, 'missing');
  expect(screen.getByText('没有匹配的模型')).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'text' } });
  expect(screen.getByRole('button', { name: 'story-model Story text' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /picture-v2/ })).toBeNull();
});

it('shows installed ComfyUI models as read-only entries with their groups', async () => {
  mockFetch({
    'POST /api/settings/models': {
      source: 'remote',
      models: [
        { id: 'comic.safetensors', group: 'checkpoints' },
        { id: 'comic.safetensors', group: 'loras' },
      ],
    },
  });
  render(
    <ModelCatalog request={{ kind: 'comfyui', base_url: 'http://localhost:8188', api_key: '' }} />,
  );
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await screen.findAllByText('comic.safetensors')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /comic.safetensors/ })).toBeNull();
  expect(screen.getByText('checkpoints')).toBeInTheDocument();
  expect(screen.getByText('仅查看已安装模型；实际使用的模型由工作流决定。')).toBeInTheDocument();
});

it('does not fetch while the parent configuration is unavailable', async () => {
  const calls = mockFetch({ 'POST /api/settings/models': catalog });
  render(<ModelCatalog request={request} disabled />);
  const button = screen.getByRole('button', { name: '获取模型' });
  expect(button).toBeDisabled();
  await userEvent.click(button);
  expect(calls).toHaveLength(0);
});

it('bounds a large model list while still searching and selecting from the entire catalog', async () => {
  // The local ComfyUI discovery returned 12,078 plugin/model choices during live validation.
  const calls = mockFetch({
    'POST /api/settings/models': {
      source: 'remote',
      models: Array.from({ length: 12078 }, (_, index) => ({
        id: `installed-model-${index}`,
        group: 'CustomPlugin.model',
      })),
    },
  });
  const select = vi.fn();
  render(<ModelCatalog request={request} onSelect={select} />);
  await userEvent.click(screen.getByRole('button', { name: '获取模型' }));
  expect(await screen.findByText('共 12078 个模型')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(100);
  expect(screen.getByText('显示前 100 项，请搜索缩小范围')).toBeInTheDocument();
  expect(screen.queryByText('installed-model-12077')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'installed-model-12077' } });
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.queryByText('显示前 100 项，请搜索缩小范围')).toBeNull();
  await userEvent.click(
    screen.getByRole('button', { name: 'installed-model-12077 CustomPlugin.model' }),
  );
  expect(select).toHaveBeenCalledWith('installed-model-12077');
  expect(calls).toHaveLength(1);
});
