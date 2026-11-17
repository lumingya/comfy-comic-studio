import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { UpdatesSection } from './UpdatesSection';

const status = {
  current: '4.0.0',
  dev_checkout: false,
  keys_configured: true,
  auto_check: true,
  last_check: null,
  pending: null,
  activity: { phase: 'idle', error: '' },
};

const release = {
  tag: 'v3.9.0',
  version: '3.9.0',
  name: 'Mio v3.9.0',
  published_at: '2026-10-01',
  prerelease: false,
  notes: '恢复之前的排版。',
  installable: true,
  unavailable_reason: '',
};

afterEach(() => vi.unstubAllGlobals());

it('shows release notes only after selection, then installs the chosen older release', async () => {
  const calls = mockFetch({
    'GET /api/update': status,
    'GET /api/update/releases': { items: [release], page: 1, has_more: false },
    'GET /api/settings': {},
    'POST /api/update/install': { ...status, activity: { phase: 'preparing', error: '' } },
  });
  const user = userEvent.setup();
  renderWithProviders(<UpdatesSection />);
  await screen.findByRole('button', { name: /v3.9.0/ });
  expect(screen.queryByText(release.notes)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /v3.9.0/ }));
  expect(screen.getByText(release.notes)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '安装此版本' }));
  await waitFor(() =>
    expect(calls.find((call) => call.url === '/api/update/install')?.body).toEqual({
      tag: 'v3.9.0',
    }),
  );
});

it('keeps unsigned releases browsable without offering an unsafe installation', async () => {
  mockFetch({
    'GET /api/update': { ...status, keys_configured: false },
    'GET /api/update/releases': {
      items: [{ ...release, installable: false, unavailable_reason: '此版本尚未提供签名安装包' }],
      page: 1,
      has_more: false,
    },
    'GET /api/settings': {},
  });
  const user = userEvent.setup();
  renderWithProviders(<UpdatesSection />);
  await user.click(await screen.findByRole('button', { name: /v3.9.0/ }));
  expect(screen.getByRole('button', { name: '安装此版本' })).toBeDisabled();
  expect(screen.getByText(release.notes)).toBeVisible();
  expect(screen.getByText('此版本尚未提供签名安装包')).toBeVisible();
});

it('checks in the background and saves the startup check preference', async () => {
  const calls = mockFetch({
    'GET /api/update': status,
    'GET /api/update/releases': { items: [], page: 1, has_more: false },
    'GET /api/settings': {},
    'POST /api/update/check': { ...status, activity: { phase: 'checking', error: '' } },
    'PATCH /api/update/preferences': { ...status, auto_check: false },
  });
  const user = userEvent.setup();
  renderWithProviders(<UpdatesSection />);
  await user.click(await screen.findByRole('checkbox', { name: '启动时检查更新' }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ auto_check: false }),
  );
  await user.click(screen.getByRole('button', { name: '检查更新' }));
  await waitFor(() =>
    expect(calls.some((call) => call.url === '/api/update/check?background=true')).toBe(true),
  );
  expect(screen.getByText('官方仓库还没有发布版本。')).toBeVisible();
});

it('moves between release pages without accumulating duplicate controls', async () => {
  const calls = mockFetch({
    'GET /api/update': status,
    'GET /api/update/releases': { items: [release], page: 1, has_more: true },
    'GET /api/settings': {},
  });
  const user = userEvent.setup();
  renderWithProviders(<UpdatesSection />);
  await user.click(await screen.findByRole('button', { name: '下一页' }));
  await waitFor(() => expect(calls.some((call) => call.url.includes('page=2'))).toBe(true));
  expect(screen.getAllByRole('button', { name: '检查更新' })).toHaveLength(1);
});
