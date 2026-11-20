import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { RenderProfile } from '../../api/types';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { ProfilesSection } from './ProfilesSection';
import { imageChannel } from '../../test/configuration';

const profile: RenderProfile = {
  id: 'profile_default',
  name: 'Baseline profile',
  dialect: 'tags',
  draft: [],
  final: [],
  edits: {},
  candidates: 1,
  instances: [],
  binding_required: false,
  base_width: 832,
  quality_tags: null,
  negative_tags: null,
  cloud_shape: false,
  cloud_refine: false,
  model_group: null,
  cloud_channel: '',
  cloud_recipe: null,
  created_at: '2026-09-27T00:00:00Z',
  updated_at: '2026-09-27T00:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

it.each(['', 'images'])(
  'only binds an imported profile after an explicit channel selection: %s',
  async (channel) => {
    const imported = {
      ...profile,
      id: 'kit-profile',
      name: 'Imported profile',
      cloud_shape: true,
      binding_required: true,
      cloud_channel: 'unbound-kit-profile',
    };
    const calls = mockFetch({
      'GET /api/profiles': [imported],
      'GET /api/workflows': [],
      'GET /api/instances': { instances: [] },
      'GET /api/settings': { image_channels: [imageChannel] },
      'PUT /api/profiles/kit-profile': (body: unknown) => body,
    });
    const user = userEvent.setup();
    const { container } = renderWithProviders(<ProfilesSection />);
    await screen.findByText(/此套装尚未绑定出图服务/);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: imageChannel.label })).toBeInTheDocument(),
    );
    const select = Array.from(container.querySelectorAll('select')).find((element) =>
      Array.from(element.options).some((option) => option.value === 'images'),
    )!;
    await user.selectOptions(select, channel);
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    const saved = calls.find((call) => call.method === 'PUT')!.body as RenderProfile;
    expect(saved.binding_required).toBe(channel === '');
    expect(saved.cloud_channel).toBe(channel);
  },
);

it('saves a newly added stage without UI-only fields rejected by the strict server model', async () => {
  const calls = mockFetch({
    'GET /api/profiles': [profile],
    'GET /api/workflows': [{ id: 'wf-test', name: 'Test workflow', variants: [] }],
    'GET /api/instances': { instances: [] },
    'GET /api/settings': { image_channels: [] },
    'POST /api/profiles': (body: unknown) => body,
  });
  const user = userEvent.setup();
  const { container } = renderWithProviders(<ProfilesSection />);
  await screen.findByRole('button', { name: /Baseline profile/ });
  await user.click(screen.getByRole('button', { name: '新建方案' }));
  const workflow = container.querySelectorAll<HTMLSelectElement>('.stage-row select')[1];
  await waitFor(() => expect(workflow).toHaveTextContent('Test workflow'));
  await user.selectOptions(workflow, 'wf-test');
  await user.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  const saved = calls.find((c) => c.method === 'POST')!.body as RenderProfile;
  expect(saved.draft).toHaveLength(1);
  expect(saved.draft[0]).toMatchObject({
    workflow_id: 'wf-test',
    enabled: true,
    feed: 'previous',
    feed_output: null,
  });
  expect(Object.keys(saved.draft[0]).sort()).toEqual(
    [
      'id',
      'kind',
      'workflow_id',
      'variant',
      'values',
      'overrides',
      'slot_overrides',
      'enabled',
      'feed',
      'feed_output',
    ].sort(),
  );
});
