import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
});

it('imports a standalone theme ZIP and applies it without entering extension review', async () => {
  const imported = { ...custom, id: 'linen', source: 'theme-package' };
  const requests: { url: string; method: string; body: BodyInit | null | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      requests.push({ url: url.pathname, method: request.method, body: init?.body });
      return new Response(JSON.stringify(request.method === 'GET' ? [custom] : imported), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  const view = renderWithProviders(<ThemesSection />);
  await screen.findByRole('button', { name: '导出' });
  const input = view.container.querySelector<HTMLInputElement>('input[accept=".json,.zip"]')!;
  const archive = new File(['fixture ZIP'], 'linen.zip', { type: 'application/zip' });
  await userEvent.upload(input, archive);
  await waitFor(() => expect(useUI.getState().theme).toBe('linen'));
  expect(requests.filter((request) => request.method === 'POST')).toEqual([
    { url: '/api/themes/package', method: 'POST', body: archive },
  ]);
  expect(screen.queryByText('扩展审阅')).toBeNull();
});

it('imports a standalone theme folder through the theme API', async () => {
  const imported = { ...custom, id: 'linen', source: 'theme-package' };
  const requests: { url: string; method: string; body: BodyInit | null | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      requests.push({ url: url.pathname, method: request.method, body: init?.body });
      return new Response(JSON.stringify(request.method === 'GET' ? [custom] : imported), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  const view = renderWithProviders(<ThemesSection />);
  await screen.findByRole('button', { name: '导入文件夹' });
  const input = view.container.querySelector<HTMLInputElement>('input[webkitdirectory]')!;
  const file = new File([JSON.stringify(custom)], 'theme.json', { type: 'application/json' });
  Object.defineProperty(file, 'webkitRelativePath', { value: 'linen/theme.json' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
  await waitFor(() => expect(useUI.getState().theme).toBe('linen'));
  const request = requests.find((entry) => entry.method === 'POST')!;
  expect(request.url).toBe('/api/themes/folder');
  expect(request.body).toBeInstanceOf(FormData);
  expect((request.body as FormData).getAll('files')).toHaveLength(1);
});

it('preserves existing JSON import and applies the imported theme', async () => {
  const document = { ...custom, source: undefined };
  const calls = mockFetch({ 'GET /api/themes': [custom], 'POST /api/themes': custom });
  const view = renderWithProviders(<ThemesSection />);
  await screen.findByRole('button', { name: '导出' });
  const file = new File([JSON.stringify(document)], 'theme.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(document) });
  await userEvent.upload(view.container.querySelector('input[accept=".json,.zip"]')!, file);
  await waitFor(() => expect(useUI.getState().theme).toBe('custom-paper'));
  expect(calls.filter((call) => call.method === 'POST')).toEqual([
    { method: 'POST', url: '/api/themes', body: JSON.parse(JSON.stringify(document)) },
  ]);
});

it('shows a failed theme package import without replacing the current theme', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      return request.method === 'GET'
        ? new Response(JSON.stringify([custom]), {
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response(JSON.stringify({ detail: '主题已存在' }), { status: 400 });
    }),
  );
  const view = renderWithProviders(<ThemesSection />);
  await screen.findByRole('button', { name: '导出' });
  const input = view.container.querySelector<HTMLInputElement>('input[accept=".json,.zip"]')!;
  await userEvent.upload(input, new File(['fixture'], 'theme.zip', { type: 'application/zip' }));
  await waitFor(() => expect(input).not.toBeDisabled());
  expect(screen.getByRole('button', { name: '导出' })).toBeInTheDocument();
  expect(useUI.getState().theme).toBe('paper');
});

it('allows deleting imported standalone packages but not extension-provided themes', async () => {
  const packageTheme = { ...custom, id: 'linen', name: '素纸包', source: 'theme-package' };
  const extensionTheme = { ...custom, id: 'accent', name: '扩展主题', source: 'ai-assist' };
  const calls = mockFetch({
    'GET /api/themes': [packageTheme, extensionTheme],
    'DELETE /api/themes/linen': {},
  });
  const view = renderWithProviders(<ThemesSection />);
  await screen.findByText('素纸包');
  expect(view.container.querySelectorAll('button[aria-label="删除"]')).toHaveLength(1);
  const packageCard = screen.getByText('素纸包').closest('.theme-card') as HTMLElement;
  await userEvent.click(within(packageCard).getByRole('button', { name: '删除' }));
  await waitFor(() => expect(calls.some((call) => call.url === '/api/themes/linen')).toBe(true));
});
