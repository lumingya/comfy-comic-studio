import { useQueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppSettings, ImageChannel } from '../../api/types';
import { configSettings, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import * as confirmation from '../../components/confirm';
import { ChannelsSection } from './ChannelsSection';
import { GeneralSection } from './GeneralSection';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function Refresh() {
  const qc = useQueryClient();
  return (
    <button onClick={() => void qc.invalidateQueries({ queryKey: ['settings'] })}>refresh</button>
  );
}

it('sends only the edited general field after a refresh and retains edits made during save', async () => {
  let settings = { ...structuredClone(configSettings), write_revision: 'first-revision' };
  let finish!: (settings: AppSettings) => void;
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/settings': () => settings,
      'PATCH /api/settings': () =>
        new Promise<AppSettings>((resolve) => {
          finish = resolve;
        }),
    }),
  );
  renderWithProviders(
    <>
      <GeneralSection />
      <Refresh />
    </>,
  );
  const address = await screen.findByDisplayValue('https://shared.test/v1');
  fireEvent.change(address, { target: { value: 'https://mine.test/v1' } });
  settings = {
    ...settings,
    write_revision: 'remote-revision',
    trash_days: 180,
    guard_terms: ['remote'],
    llm: { ...settings.llm, timeout: 600 },
  };
  await userEvent.click(screen.getByText('refresh'));
  await waitFor(() =>
    expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/settings')).toHaveLength(2),
  );
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
    llm: { base_url: 'https://mine.test/v1' },
    expected: { llm: { base_url: 'https://shared.test/v1' } },
  });
  expect(address).toBeEnabled();
  fireEvent.change(address, { target: { value: 'https://later.test/v1' } });
  finish({ ...settings, llm: { ...settings.llm, base_url: 'https://mine.test/v1' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
  expect(address).toHaveValue('https://later.test/v1');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
  expect(calls.filter((c) => c.method === 'PATCH')[1].body).toEqual({
    llm: { base_url: 'https://later.test/v1' },
    expected: { llm: { base_url: 'https://mine.test/v1' } },
  });
  finish({ ...settings, llm: { ...settings.llm, base_url: 'https://later.test/v1' } });
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存' })).toBeNull());
});

it('compares an edited masked credential with its original opaque revision after refresh', async () => {
  let settings = { ...structuredClone(configSettings), write_revision: 'original-secret-revision' };
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/settings': () => settings,
      'PATCH /api/settings': () =>
        new Response(JSON.stringify({ detail: 'Settings changed' }), { status: 409 }),
    }),
  );
  renderWithProviders(
    <>
      <GeneralSection />
      <Refresh />
    </>,
  );
  await screen.findByDisplayValue('https://shared.test/v1');
  const key = document.querySelector<HTMLInputElement>('input[type=password]')!;
  fireEvent.change(key, { target: { value: 'offline-intent' } });
  settings = { ...settings, write_revision: 'remote-secret-revision' };
  await userEvent.click(screen.getByText('refresh'));
  await waitFor(() =>
    expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/settings')).toHaveLength(2),
  );
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
    expected_revision: 'original-secret-revision',
    llm: { api_key: 'offline-intent' },
    expected: { llm: { api_key: '••••••' } },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
  expect(key).toHaveValue('offline-intent');
});

it('keeps a channel deleted during its create request deleted after the response', async () => {
  vi.spyOn(confirmation, 'confirm').mockResolvedValue(true);
  let body: Record<string, unknown>;
  let finish!: (value: AppSettings) => void;
  const calls = mockFetch(
    configurationRoutes({
      'PATCH /api/settings': (request: unknown) => {
        body = request as Record<string, unknown>;
        return new Promise<AppSettings>((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  renderWithProviders(<ChannelsSection />);
  await screen.findByDisplayValue('主力图像服务');
  await userEvent.click(screen.getByRole('button', { name: '添加渠道' }));
  fireEvent.change(screen.getByRole('textbox', { name: /^名称/ }), {
    target: { value: 'created-then-deleted' },
  });
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const created = (body!.image_channel_edits as { after: ImageChannel }[])[0].after;
  await userEvent.click(screen.getByRole('button', { name: '删除渠道' }));
  await waitFor(() => expect(screen.queryByDisplayValue('created-then-deleted')).toBeNull());
  finish({ ...configSettings, image_channels: [...configSettings.image_channels!, created] });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: /created-then-deleted/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
  expect(calls.filter((c) => c.method === 'PATCH')[1].body).toEqual({
    image_channel_edits: [{ id: 'ch1', before: created, after: null }],
  });
  finish(configSettings);
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存' })).toBeNull());
});

it('retains an existing channel edit entered during saving and rebases its next comparison', async () => {
  let finish!: (value: AppSettings) => void;
  const calls = mockFetch(
    configurationRoutes({
      'PATCH /api/settings': () =>
        new Promise<AppSettings>((resolve) => {
          finish = resolve;
        }),
    }),
  );
  renderWithProviders(<ChannelsSection />);
  const name = await screen.findByDisplayValue('主力图像服务');
  fireEvent.change(name, { target: { value: 'first' } });
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(name).toBeEnabled();
  fireEvent.change(name, { target: { value: 'later' } });
  finish({
    ...configSettings,
    image_channels: configSettings.image_channels!.map((c) =>
      c.id === 'images' ? { ...c, label: 'first' } : c,
    ),
  });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
  expect(name).toHaveValue('later');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
  expect(calls.filter((c) => c.method === 'PATCH')[1].body).toEqual({
    image_channel_edits: [{ id: 'images', before: { label: 'first' }, after: { label: 'later' } }],
  });
  finish({
    ...configSettings,
    image_channels: configSettings.image_channels!.map((c) =>
      c.id === 'images' ? { ...c, label: 'later' } : c,
    ),
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存' })).toBeNull());
});

it('keeps a newly created channel editable during saving, then saves remaining fields as an edit', async () => {
  let submitted: Record<string, unknown>;
  let finish!: (value: AppSettings) => void;
  const calls = mockFetch(
    configurationRoutes({
      'PATCH /api/settings': (body: unknown) => {
        submitted = body as Record<string, unknown>;
        return new Promise<AppSettings>((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  renderWithProviders(<ChannelsSection />);
  await screen.findByDisplayValue('主力图像服务');
  await userEvent.click(screen.getByRole('button', { name: '添加渠道' }));
  const name = screen.getByRole('textbox', { name: /^名称/ });
  fireEvent.change(name, { target: { value: 'new-first' } });
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const created = (submitted!.image_channel_edits as { after: ImageChannel }[])[0].after;
  fireEvent.change(name, { target: { value: 'new-later' } });
  finish({ ...configSettings, image_channels: [...configSettings.image_channels!, created] });
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
  expect(name).toHaveValue('new-later');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
  expect(calls.filter((c) => c.method === 'PATCH')[1].body).toEqual({
    image_channel_edits: [
      { id: 'ch1', before: { label: 'new-first' }, after: { label: 'new-later' } },
    ],
  });
  finish({
    ...configSettings,
    image_channels: [...configSettings.image_channels!, { ...created, label: 'new-later' }],
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存' })).toBeNull());
});

it('sends only channel A label intent and observes remote B model and new channels', async () => {
  let settings = structuredClone(configSettings);
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/settings': () => settings,
      'PATCH /api/settings': () => settings,
    }),
  );
  renderWithProviders(
    <>
      <ChannelsSection />
      <Refresh />
    </>,
  );
  fireEvent.change(await screen.findByDisplayValue('主力图像服务'), { target: { value: 'mine' } });
  settings = {
    ...settings,
    image_channels: [
      ...settings.image_channels!.map((c) =>
        c.id === 'chat' ? { ...c, model: 'remote-model' } : c,
      ),
      { ...settings.image_channels![1], id: 'new-remote', label: 'remote-new' },
    ],
  };
  await userEvent.click(screen.getByText('refresh'));
  await screen.findByRole('button', { name: /remote-new/ });
  await userEvent.click(screen.getByRole('button', { name: /备用代理/ }));
  expect(screen.getByDisplayValue('remote-model')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
  expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
    image_channel_edits: [
      { id: 'images', before: { label: '主力图像服务' }, after: { label: 'mine' } },
    ],
  });
});
