import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ImageAdapterInfo } from '../../api/types';
import { useToasts } from '../../components/toast';
import { configSettings, configurationRoutes, imageChannel } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { ChannelsSection } from './ChannelsSection';

const options = {
  quality_mode: 'draft',
  vendor_recipe: {
    prompts: ['first', 'second'],
    scale: 2.5,
    credentials: [{ authorization: '••••••', region: 'offline' }],
  },
  optional: null,
  keep_boolean: false,
};
const adapter: ImageAdapterInfo = {
  id: 'vendor_nested',
  source: 'ext:nested',
  title: 'Offline nested adapter',
  capabilities: ['generate', 'seed'],
  schema: { properties: { quality_mode: { type: 'string', title: 'Quality mode' } } },
  supports_reference: false,
  supports_negative: true,
  supports_seed: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const item of useToasts.getState().items) useToasts.getState().dismiss(item.id);
});
function start(extra: Parameters<typeof configurationRoutes>[0] = {}) {
  const settings: AppSettings = {
    ...configSettings,
    image_channels: [
      {
        ...imageChannel,
        id: 'nested',
        label: 'Nested provider',
        kind: adapter.id,
        extra_options: options,
      },
      { ...imageChannel, id: 'second', label: 'Second provider' },
    ],
  };
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/settings': settings,
      'GET /api/registry': { cloud_adapter: [{ id: adapter.id, title: adapter.title }] },
      'GET /api/image-adapters': [adapter],
      'PATCH /api/settings': (body: unknown) => ({ ...settings, ...(body as object) }),
      ...extra,
    }),
  );
  renderWithProviders(<ChannelsSection />);
  return { calls, settings };
}
async function openOptions() {
  await screen.findByDisplayValue('Nested provider');
  await userEvent.click(screen.getByText('高级参数与标识', { selector: 'summary strong' }));
  return screen.findByRole('textbox', { name: /^扩展参数（JSON）/ });
}
const savedSettings = (calls: ReturnType<typeof mockFetch>) =>
  calls.filter((call) => call.method === 'PATCH').at(-1)?.body as AppSettings;

describe('extension channel structured options', () => {
  it('keeps unknown nested values and masked credentials intact when editing another channel field', async () => {
    const { calls, settings } = start();
    const json = await openOptions();
    expect(JSON.parse((json as HTMLTextAreaElement).value)).toEqual(options);
    expect(screen.queryByRole('textbox', { name: 'vendor_recipe' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /^名称/ }), {
      target: { value: 'Renamed offline provider' },
    });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(savedSettings(calls)?.image_channels).toBeDefined());
    expect(savedSettings(calls).image_channels?.[0]).toMatchObject({
      label: 'Renamed offline provider',
      api_key: '••••••',
      extra_options: options,
    });
    expect(savedSettings(calls).image_channels?.[1]).toEqual(settings.image_channels?.[1]);
    expect(calls.filter((call) => call.url === '/api/image-adapters')).toHaveLength(1);
    expect(calls.some((call) => /generate|render|models/.test(call.url))).toBe(false);
  });

  it('persists JSON types while editing one ordinary extra option', async () => {
    const { calls } = start();
    const json = await openOptions();
    const next = { ...options, quality_mode: 'final' };
    fireEvent.change(json, { target: { value: JSON.stringify(next, null, 2) } });
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(savedSettings(calls)?.image_channels).toBeDefined());
    expect(savedSettings(calls).image_channels?.[0].extra_options).toEqual(next);
    expect(savedSettings(calls).image_channels?.[0].extra_options.vendor_recipe).not.toBeTypeOf(
      'string',
    );
  });

  it('restores the server JSON when canceling a valid options edit', async () => {
    const { calls } = start();
    const json = await openOptions();
    fireEvent.change(json, { target: { value: '{"quality_mode":"changed"}' } });
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    const restored = screen.getByRole('textbox', { name: /^扩展参数（JSON）/ });
    expect(JSON.parse((restored as HTMLTextAreaElement).value)).toEqual(options);
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('shows a bad-JSON error and blocks saving other edits until the invalid options draft is fixed', async () => {
    const { calls } = start();
    const json = await openOptions();
    fireEvent.change(screen.getByRole('textbox', { name: /^名称/ }), {
      target: { value: 'Valid name change' },
    });
    fireEvent.change(json, { target: { value: '{"quality_mode":' } });
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 JSON 对象');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
    fireEvent.change(json, { target: { value: JSON.stringify(options) } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });
});
