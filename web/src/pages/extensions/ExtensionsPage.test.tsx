import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { TrustDialog } from '../settings/ExtensionsSection';
import type { ExtensionInfo } from '../../api/open';
import { Toaster } from '../../components/toast';
import ExtensionsPage from './ExtensionsPage';

afterEach(() => vi.unstubAllGlobals());
function CurrentSearch() {
  return <output data-testid="search-params">{useLocation().search}</output>;
}
const item = {
  id: 'sample',
  name: '画稿助手',
  version: '1.2.0',
  description: '整理画稿',
  author: '作者',
  homepage: '',
  tags: ['tools'],
  source: 'remote',
  package_url: 'https://example.com/sample.zip',
  sha256: '123abc',
  installed: null,
  action: 'install',
};
const catalog = {
  source: { url: '', builtin: true, checked_at: '', error: '' },
  catalog_digest: 'catalog-sha',
  items: [item, { ...item, id: 'theme-sample', name: '主题扩展', tags: ['themes'] }],
};
const routes = {
  'GET /api/extension-market': catalog,
  'GET /api/extensions': { items: [], safe_mode: false },
  'GET /api/extension-panels': [],
};
it('searches extensions without treating theme contributions as separate packages', async () => {
  mockFetch(routes);
  renderWithProviders(<ExtensionsPage />);
  await screen.findByText('画稿助手');
  expect(screen.getByText('主题扩展')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索扩展' }), {
    target: { value: '主题扩展' },
  });
  expect(screen.getByText('主题扩展')).toBeInTheDocument();
  expect(screen.queryByText('画稿助手')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索扩展' }), {
    target: { value: '不存在' },
  });
  expect(screen.getByText('没有匹配搜索的扩展。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
  expect(screen.getByRole('textbox', { name: '搜索扩展' })).toHaveFocus();
});
it('supports keyboard navigation between linked extension tabs and panels', () => {
  mockFetch(routes);
  renderWithProviders(
    <>
      <ExtensionsPage />
      <CurrentSearch />
    </>,
  );
  const marketTab = screen.getByRole('tab', { name: '扩展市场' });
  const installedTab = screen.getByRole('tab', { name: /已安装/ });
  const marketPanel = document.getElementById(marketTab.getAttribute('aria-controls')!)!;
  const installedPanel = document.getElementById(installedTab.getAttribute('aria-controls')!)!;

  expect(marketPanel).toHaveAttribute('role', 'tabpanel');
  expect(marketPanel).toHaveAttribute('aria-labelledby', marketTab.id);
  expect(installedPanel).toHaveAttribute('role', 'tabpanel');
  expect(installedPanel).toHaveAttribute('aria-labelledby', installedTab.id);
  expect(marketTab).toHaveAttribute('tabindex', '0');
  expect(installedTab).toHaveAttribute('tabindex', '-1');

  fireEvent.keyDown(marketTab, { key: 'End' });
  expect(installedTab).toHaveFocus();
  expect(installedTab).toHaveAttribute('aria-selected', 'true');
  expect(marketPanel).toHaveAttribute('hidden');
  expect(installedPanel).not.toHaveAttribute('hidden');
  expect(screen.getByTestId('search-params')).toHaveTextContent('?tab=installed');

  fireEvent.keyDown(installedTab, { key: 'ArrowRight' });
  expect(marketTab).toHaveFocus();
  expect(marketTab).toHaveAttribute('aria-selected', 'true');
  expect(installedTab).toHaveAttribute('tabindex', '-1');
  expect(screen.getByTestId('search-params')).toHaveTextContent('');

  fireEvent.keyDown(marketTab, { key: 'ArrowLeft' });
  expect(installedTab).toHaveFocus();
  fireEvent.keyDown(installedTab, { key: 'Home' });
  expect(marketTab).toHaveFocus();
});
it('installs only the reviewed catalog package and leaves activation to the user', async () => {
  const calls = mockFetch({
    ...routes,
    'POST /api/extension-market/sample/install': {
      ...item,
      digest: 'package-sha',
      status: 'disabled',
      runs_code: true,
      contributions: [],
      panels: [],
    },
  });
  renderWithProviders(<ExtensionsPage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看详情 · 画稿助手' }));
  fireEvent.click(screen.getAllByRole('button', { name: '安装' }).at(-1)!);
  await screen.findByText('信任并启用');
  expect(calls.find((call) => call.url.endsWith('/sample/install'))?.body).toEqual({
    expected_catalog_digest: 'catalog-sha',
    expected_sha256: '123abc',
  });
  expect(calls.some((call) => call.url.endsWith('/enable'))).toBe(false);
});
it('saves an alternative catalog source from its single settings entry', async () => {
  const calls = mockFetch({ ...routes, 'PUT /api/extension-market/source': catalog });
  renderWithProviders(<ExtensionsPage />);
  await screen.findByText('画稿助手');
  fireEvent.click(screen.getByRole('button', { name: '目录源' }));
  fireEvent.change(screen.getByLabelText('目录地址'), {
    target: { value: 'https://example.com/catalog.json' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      url: 'https://example.com/catalog.json',
    }),
  );
});

it.each(['error', 'active'] as const)(
  'keeps trust review open when activation returns %s with an error',
  async (status) => {
    const extension = {
      ...item,
      digest: 'package-sha',
      status: 'disabled',
      runs_code: true,
      contributions: [],
      panels: [],
    } as unknown as ExtensionInfo;
    mockFetch({
      'POST /api/extensions/sample/enable': { ...extension, status, error: '启动失败' },
    });
    const close = vi.fn();
    renderWithProviders(
      <>
        <TrustDialog ext={extension} onClose={close} />
        <Toaster />
      </>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '信任并启用' }));
    await screen.findByText('启动失败');
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  },
);
