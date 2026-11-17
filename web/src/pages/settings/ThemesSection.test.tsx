import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { download } from '../../api/client';
import { useUI } from '../../app/ui-store';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { ThemesSection } from './ThemesSection';

vi.mock('../../api/client', async (original) => ({
  ...(await original<typeof import('../../api/client')>()),
  download: vi.fn().mockResolvedValue(new Response()),
}));

const custom = {
  id: 'custom-paper',
  name: '雨后纸页',
  mode: 'light',
  source: 'user',
  author: '',
  tokens: { bg: '#fafafa', accent: '#345678' },
};
const originalState = useUI.getState();

beforeEach(() => {
  useUI.setState({ theme: 'paper' });
  vi.clearAllMocks();
});
afterEach(() => {
  useUI.setState(originalState);
  vi.unstubAllGlobals();
});

it('exports one independent package from the theme card without changing the active theme', async () => {
  mockFetch({ 'GET /api/themes': [custom] });
  renderWithProviders(<ThemesSection />);
  await userEvent.click(await screen.findByRole('button', { name: '导出' }));
  expect(download).toHaveBeenCalledExactlyOnceWith(
    '/api/themes/custom-paper/package',
    'custom-paper.zip',
  );
  expect(useUI.getState().theme).toBe('paper');
  expect(screen.getByRole('link', { name: '主题文件夹与扩展' })).toHaveAttribute(
    'href',
    '/extensions?tab=installed',
  );
});

it('installs ZIP through the shared extension endpoint and opens review without enabling it', async () => {
  const requests: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      requests.push({ url: url.pathname + url.search, method: request.method, body: init?.body });
      return new Response(
        JSON.stringify(
          request.method === 'GET' ? [custom] : { id: 'theme-test', status: 'disabled' },
        ),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
  const view = renderWithProviders(
    <Routes>
      <Route path="/" element={<ThemesSection />} />
      <Route path="/extensions" element={<p>扩展审阅</p>} />
    </Routes>,
  );
  await screen.findByRole('button', { name: '导出' });
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const archive = new File(['fixture ZIP'], 'shared-theme.zip', { type: 'application/zip' });
  await userEvent.upload(input, archive);
  expect(await screen.findByText('扩展审阅')).toBeInTheDocument();
  expect(requests.filter((r) => r.method === 'POST')).toEqual([
    { url: '/api/extensions?replace=false', method: 'POST', body: archive },
  ]);
  expect(useUI.getState().theme).toBe('paper');
});

it('preserves existing JSON import and applies the imported theme', async () => {
  const document = { ...custom, source: undefined };
  const calls = mockFetch({ 'GET /api/themes': [custom], 'POST /api/themes': custom });
  const view = renderWithProviders(<ThemesSection />);
  await screen.findByRole('button', { name: '导出' });
  const file = new File([JSON.stringify(document)], 'theme.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(document) });
  await userEvent.upload(view.container.querySelector('input[type="file"]')!, file);
  await waitFor(() => expect(useUI.getState().theme).toBe('custom-paper'));
  expect(calls.filter((call) => call.method === 'POST')).toEqual([
    { method: 'POST', url: '/api/themes', body: JSON.parse(JSON.stringify(document)) },
  ]);
});

it('shows a failed import without navigating or replacing the existing theme', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      return request.method === 'GET'
        ? new Response(JSON.stringify([custom]), {
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify({ detail: '扩展已存在' }), { status: 400 });
    }),
  );
  const view = renderWithProviders(<ThemesSection />);
  await screen.findByRole('button', { name: '导出' });
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, new File(['fixture'], 'theme.zip', { type: 'application/zip' }));
  await waitFor(() => expect(input).not.toBeDisabled());
  expect(screen.getByRole('link', { name: '主题文件夹与扩展' })).toBeInTheDocument();
  expect(useUI.getState().theme).toBe('paper');
});
