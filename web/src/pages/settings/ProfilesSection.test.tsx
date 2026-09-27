import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { RenderProfile } from '../../api/types';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { ProfilesSection } from './ProfilesSection';

const profile: RenderProfile = {
  id: 'profile_default',
  name: 'Baseline profile',
  dialect: 'tags',
  draft: [],
  final: [],
  edits: {},
  candidates: 1,
  instances: [],
  base_width: 832,
  quality_tags: null,
  negative_tags: null,
  cloud_shape: false,
  model_group: null,
  cloud_channel: '',
  created_at: '2026-09-27T00:00:00Z',
  updated_at: '2026-09-27T00:00:00Z',
};

afterEach(() => vi.unstubAllGlobals());

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
  await user.click(screen.getByRole('button', { name: '新出图配置' }));
  const workflow = container.querySelectorAll<HTMLSelectElement>('.stage-row select')[1];
  await waitFor(() => expect(workflow).toHaveTextContent('Test workflow'));
  await user.selectOptions(workflow, 'wf-test');
  await user.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  const saved = calls.find((c) => c.method === 'POST')!.body as RenderProfile;
  expect(saved.draft).toHaveLength(1);
  expect(saved.draft[0]).toMatchObject({ workflow_id: 'wf-test', enabled: true, feed: 'previous' });
  expect(Object.keys(saved.draft[0]).sort()).toEqual(
    ['id', 'kind', 'workflow_id', 'variant', 'values', 'overrides', 'enabled', 'feed'].sort(),
  );
});
