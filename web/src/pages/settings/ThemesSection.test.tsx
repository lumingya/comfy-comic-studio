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

it('imports a standalone theme ZIP without applying it or entering extension review', async () => {
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
  await userEvent.click(screen.getByRole('button', { name: '导入主题' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '从 JSON / ZIP 文件导入' }));
  const input = view.container.querySelector<HTMLInputElement>('input[accept=".json,.zip"]')!;
  const archive = new File(['fixture ZIP'], 'linen.zip', { type: 'application/zip' });
  await userEvent.upload(input, archive);
  await waitFor(() => expect(requests.some((request) => request.method === 'POST')).toBe(true));
  expect(useUI.getState().theme).toBe('paper');
  expect(requests.filter((request) => request.method === 'POST')).toEqual([
    { url: '/api/themes/package', method: 'POST', body: archive },
  ]);
  expect(screen.queryByText('扩展审阅')).toBeNull();
});

it('imports a standalone theme folder without applying it through the theme API', async () => {
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
  await userEvent.click(await screen.findByRole('button', { name: '导入主题' }));
  await userEvent.click(screen.getByRole('menuitem', { name: '从主题文件夹导入' }));
  const input = view.container.querySelector<HTMLInputElement>('input[webkitdirectory]')!;
  const file = new File([JSON.stringify(custom)], 'theme.json', { type: 'application/json' });
  Object.defineProperty(file, 'webkitRelativePath', { value: 'linen/theme.json' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
  await waitFor(() => expect(requests.some((entry) => entry.method === 'POST')).toBe(true));
  const request = requests.find((entry) => entry.method === 'POST')!;
  expect(useUI.getState().theme).toBe('paper');
  expect(request.url).toBe('/api/themes/folder');
  expect(request.body).toBeInstanceOf(FormData);
  expect((request.body as FormData).getAll('files')).toHaveLength(1);
});

it('persists background opacity and keeps theme scripts explicitly opt-in', async () => {
  const videoTheme = {
    ...custom,
    id: 'moving-paper',
    source: 'theme-package',
    background: {
      kind: 'video',
      url: '/api/themes/moving-paper/assets/assets/bg.mp4',
      opacity: 0.3,
    },
    script_url: '/api/themes/moving-paper/script',
    script_digest: 'a'.repeat(64),
  };
  mockFetch({ 'GET /api/themes': [videoTheme] });
  renderWithProviders(<ThemesSection />);
  const enableScript = await screen.findByRole('checkbox', { name: '启用隔离脚本' });
  expect(enableScript).not.toBeChecked();
  await userEvent.click(enableScript);
  expect(screen.queryByRole('slider', { name: '背景透明度' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '打开 雨后纸页 的更多设置' }));
  const dialog = within(await screen.findByRole('dialog'));
  const opacity = dialog.getByRole('slider', { name: '背景透明度' });
  expect(opacity).toHaveValue('0.3');
  fireEvent.change(opacity, { target: { value: '0.7' } });
  await waitFor(() => expect(useUI.getState().themeOpacity['moving-paper']).toBe(0.7));
  expect(useUI.getState().enabledThemeScripts).toContain('moving-paper:' + 'a'.repeat(64));
});

it('does not reuse script consent when a package changes under the same theme id', async () => {
  useUI.setState({ enabledThemeScripts: ['moving-paper:' + 'a'.repeat(64)] });
  mockFetch({
    'GET /api/themes': [
      {
        ...custom,
        id: 'moving-paper',
        source: 'theme-package',
        script_url: '/api/themes/moving-paper/script',
        script_digest: 'b'.repeat(64),
      },
    ],
  });
  renderWithProviders(<ThemesSection />);
  expect(await screen.findByRole('checkbox', { name: '启用隔离脚本' })).not.toBeChecked();
});

it('preserves existing JSON import without applying the imported theme', async () => {
  const document = { ...custom, source: undefined };
  const calls = mockFetch({ 'GET /api/themes': [custom], 'POST /api/themes': custom });
  const view = renderWithProviders(<ThemesSection />);
  await screen.findByRole('button', { name: '导出' });
  const file = new File([JSON.stringify(document)], 'theme.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(document) });
  await userEvent.upload(view.container.querySelector('input[accept=".json,.zip"]')!, file);
  await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
  expect(useUI.getState().theme).toBe('paper');
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

const media = [
  { kind: 'image', mime_type: 'image/png', animated: false },
  { kind: 'image', mime_type: 'image/gif', animated: true },
  { kind: 'image', mime_type: 'image/png', animated: true },
  { kind: 'image', mime_type: 'image/webp', animated: true },
  { kind: 'video', mime_type: 'video/mp4', animated: false },
] as const;

it.each(
  ['package', 'private'].flatMap((source) =>
    media.map((descriptor) => ({ source, ...descriptor })),
  ),
)(
  'uses effective $source $mime_type animated=$animated inside more settings',
  async ({ source, kind, animated, mime_type }) => {
    useUI.setState({
      theme: custom.id,
      themeOpacity: {},
      themeBackgroundPaused: false,
      allowThemeVideoWithReducedMotion: false,
    });
    const background = { kind, animated, mime_type, url: '/package-media', opacity: 0.5 };
    const wallpaper = {
      kind,
      animated,
      mime_type,
      url: '/private-media',
      id: 'private',
      filename: 'wallpaper',
    };
    mockFetch({
      'GET /api/themes': [{ ...custom, background: source === 'package' ? background : null }],
      [`GET /api/themes/${custom.id}/preferences`]:
        source === 'private' ? { wallpaper_id: wallpaper.id } : {},
      [`GET /api/themes/${custom.id}/wallpapers`]: {
        items: source === 'private' ? [wallpaper] : [],
      },
    });
    renderWithProviders(<ThemesSection />);
    const openSettings = await screen.findByRole('button', {
      name: '打开 雨后纸页 的更多设置',
    });
    const card = screen.getByText(custom.name).closest('.theme-card') as HTMLElement;
    expect(within(card).queryByRole('slider', { name: '背景透明度' })).not.toBeInTheDocument();
    expect(
      within(card).queryByRole('checkbox', { name: /系统减少动态效果时仍播放视频背景/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(openSettings);
    const controls = within(await screen.findByRole('dialog'));
    const slider = await controls.findByRole('slider', { name: '背景透明度' });
    expect(slider).toHaveValue(source === 'package' ? '0.5' : '0.35');
    expect(
      Boolean(controls.queryByRole('checkbox', { name: /系统减少动态效果时仍播放视频背景/ })),
    ).toBe(kind === 'video');
    fireEvent.change(slider, { target: { value: '0.7' } });
    expect(useUI.getState().themeOpacity[custom.id]).toBe(0.7);
  },
);

it('hides video controls when a private static image overrides a package video', async () => {
  mockFetch({
    'GET /api/themes': [
      {
        ...custom,
        background: {
          kind: 'video',
          animated: false,
          mime_type: 'video/mp4',
          url: '/video',
          opacity: 0.4,
        },
      },
    ],
    [`GET /api/themes/${custom.id}/preferences`]: { wallpaper_id: 'private' },
    [`GET /api/themes/${custom.id}/wallpapers`]: {
      items: [
        {
          id: 'private',
          filename: 'static.png',
          kind: 'image',
          animated: false,
          mime_type: 'image/png',
          url: '/private.png',
        },
      ],
    },
  });
  useUI.setState({ theme: custom.id });
  renderWithProviders(<ThemesSection />);
  await userEvent.click(await screen.findByRole('button', { name: '打开 雨后纸页 的更多设置' }));
  const controls = within(await screen.findByRole('dialog'));
  await controls.findByRole('slider', { name: '背景透明度' });
  await waitFor(() =>
    expect(
      controls.queryByRole('checkbox', { name: /系统减少动态效果时仍播放视频背景/ }),
    ).not.toBeInTheDocument(),
  );
});

it.each([false, true])(
  'keeps wallpaper choices after reopening more settings with custom page=%s',
  async (customPage) => {
    useUI.setState({
      theme: custom.id,
      themeOpacity: { [custom.id]: 0.45 },
      allowThemeVideoWithReducedMotion: true,
    });
    mockFetch({
      'GET /api/themes': [
        {
          ...custom,
          background: { kind: 'video', url: '/video', opacity: 0.3 },
          settings_page_url: customPage ? '/settings-page' : undefined,
        },
      ],
      [`GET /api/themes/${custom.id}/preferences`]: {},
    });
    renderWithProviders(<ThemesSection />);
    await userEvent.click(await screen.findByRole('button', { name: '打开 雨后纸页 的更多设置' }));
    const controls = within(await screen.findByRole('dialog'));
    const opacity = controls.getByRole('slider', { name: '背景透明度' });
    const motion = controls.getByRole('checkbox', {
      name: /系统减少动态效果时仍播放视频背景/,
    });
    expect(opacity).toHaveValue('0.45');
    expect(motion).toBeChecked();
    if (customPage) expect(await controls.findByTitle(custom.name)).toBeInTheDocument();
    fireEvent.change(opacity, { target: { value: '0.65' } });
    await userEvent.click(motion);
    await userEvent.click(controls.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: '背景透明度' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '打开 雨后纸页 的更多设置' }));
    const reopened = within(await screen.findByRole('dialog'));
    expect(reopened.getByRole('slider', { name: '背景透明度' })).toHaveValue('0.65');
    expect(
      reopened.getByRole('checkbox', { name: /系统减少动态效果时仍播放视频背景/ }),
    ).not.toBeChecked();
    expect(useUI.getState().themeOpacity[custom.id]).toBe(0.65);
    expect(useUI.getState().allowThemeVideoWithReducedMotion).toBe(false);
  },
);
