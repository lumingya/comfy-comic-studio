import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExtensionInfo } from '../../api/open';
import { toastError } from '../../components/toast';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { ExtensionsSection } from './ExtensionsSection';

vi.mock('../../components/toast', () => ({ toast: vi.fn(), toastError: vi.fn() }));

const extension: ExtensionInfo = {
  id: 'sample',
  name: '画稿助手',
  version: '1.0.0',
  builtin: false,
  has_data: true,
  runs_code: true,
  has_python: true,
  has_requirements: false,
  panels: [],
  digest: 'reviewed-digest',
  status: 'disabled',
  error: '',
  restart_required: false,
  contributions: [],
};

function routes(item = extension) {
  return {
    'GET /api/extensions': { items: [item], safe_mode: false, hooks: [] },
    'GET /api/extension-surfaces': { items: [] },
    'GET /api/extension-panels': [],
    'POST /api/extensions/sample/enable': { status: 'active' },
    'DELETE /api/extensions/sample': {},
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

async function openUninstall() {
  await userEvent.click(await screen.findByRole('button', { name: '卸载' }));
  return screen.getByRole('dialog', { name: '卸载「画稿助手」' });
}

it('keeps extension data by default and uninstalls after a single confirmation', async () => {
  const calls = mockFetch(routes());
  renderWithProviders(<ExtensionsSection />);
  const dialog = await openUninstall();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(within(dialog).getByRole('checkbox', { name: '同时删除扩展数据' })).not.toBeChecked();
  expect(within(dialog).getByText('配置与使用数据默认保留。')).toBeInTheDocument();
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

  await userEvent.click(within(dialog).getByRole('button', { name: '卸载' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
    { method: 'DELETE', url: '/api/extensions/sample?delete_data=false', body: undefined },
  ]);
});

it('only deletes data when explicitly checked', async () => {
  const calls = mockFetch(routes());
  renderWithProviders(<ExtensionsSection />);
  const dialog = await openUninstall();
  await userEvent.click(within(dialog).getByRole('checkbox', { name: '同时删除扩展数据' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '卸载' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
    { method: 'DELETE', url: '/api/extensions/sample?delete_data=true', body: undefined },
  ]);
});

it('cancels without a request and resets the data choice when reopened', async () => {
  const calls = mockFetch(routes());
  renderWithProviders(<ExtensionsSection />);
  const dialog = await openUninstall();
  await userEvent.click(within(dialog).getByRole('checkbox', { name: '同时删除扩展数据' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

  const reopened = await openUninstall();
  expect(within(reopened).getByRole('checkbox', { name: '同时删除扩展数据' })).not.toBeChecked();
});

it('keeps the dialog and selected choice available after failure, then allows retry', async () => {
  let attempts = 0;
  const calls = mockFetch({
    ...routes(),
    'DELETE /api/extensions/sample': () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ detail: '扩展仍有任务正在运行' }), { status: 409 })
        : {};
    },
  });
  renderWithProviders(<ExtensionsSection />);
  const dialog = await openUninstall();
  await userEvent.click(within(dialog).getByRole('checkbox', { name: '同时删除扩展数据' }));
  await userEvent.click(within(dialog).getByRole('button', { name: '卸载' }));
  await waitFor(() => expect(toastError).toHaveBeenCalledOnce());
  expect(vi.mocked(toastError).mock.calls[0][0]).toMatchObject({
    message: '扩展仍有任务正在运行',
  });
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByRole('checkbox', { name: '同时删除扩展数据' })).toBeChecked();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '卸载' })).toBeEnabled());

  await userEvent.click(within(dialog).getByRole('button', { name: '卸载' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual([
    '/api/extensions/sample?delete_data=true',
    '/api/extensions/sample?delete_data=true',
  ]);
});

it('always offers data removal with retention selected by default even when no data is reported', async () => {
  const calls = mockFetch(routes({ ...extension, has_data: false }));
  renderWithProviders(<ExtensionsSection />);
  const dialog = await openUninstall();
  expect(within(dialog).getByRole('checkbox', { name: '同时删除扩展数据' })).not.toBeChecked();
  await userEvent.click(within(dialog).getByRole('button', { name: '卸载' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls.some((call) => call.url.endsWith('?delete_data=false'))).toBe(true);
});

it('keeps bundled extensions outside the uninstall flow', async () => {
  const bundled = { ...extension, builtin: true, digest: 'bundled-reviewed-digest' };
  const calls = mockFetch(routes(bundled));
  renderWithProviders(<ExtensionsSection />);
  await userEvent.click(await screen.findByRole('button', { name: '启用' }));
  const dialog = screen.getByRole('dialog', { name: '启用「画稿助手」' });
  expect(within(dialog).getByText(bundled.digest)).toBeInTheDocument();
  expect(
    within(dialog).getByText('这个扩展可以运行代码并访问工作区，请只启用可信来源。'),
  ).toBeInTheDocument();
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/enable'))).toBe(false);
  expect(screen.queryByRole('button', { name: '卸载' })).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: '信任并启用' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls).toContainEqual({
    method: 'POST',
    url: '/api/extensions/sample/enable',
    body: { digest: bundled.digest },
  });
});
