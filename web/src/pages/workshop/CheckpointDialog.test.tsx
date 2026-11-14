import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckpointPreview, CheckpointSummary } from '../../api/checkpoints';
import { flushEditors } from '../../app/useAutoDraft';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { CheckpointDialog } from './CheckpointDialog';

vi.mock('../../app/useAutoDraft', () => ({ flushEditors: vi.fn() }));
beforeEach(() => {
  vi.mocked(flushEditors).mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

const currentHead = 'a'.repeat(64);
const targetHead = 'b'.repeat(64);
const saved: CheckpointSummary = {
  id: 'cp_first',
  series_id: 'work',
  name: 'First draft',
  created_at: '2026-11-15T12:00:00Z',
  kind: 'manual',
  head: targetHead,
  episode_count: 3,
  deleted_episode_count: 1,
  asset_count: 5,
};
const preview: CheckpointPreview = {
  checkpoint_id: 'cp_first',
  series_id: 'work',
  current_head: currentHead,
  target_head: targetHead,
  series_changed: true,
  added_episode_ids: ['old_episode'],
  changed_episode_ids: ['episode'],
  removed_episode_ids: ['extra_episode'],
  missing_asset_ids: [],
  reference_errors: [],
  active_job_ids: [],
  can_restore: true,
};
const base = '/api/series/work/checkpoints';
const routes = (extra: Record<string, unknown> = {}) => ({
  [`GET ${base}`]: [saved],
  [`GET ${base}/cp_first/preview`]: preview,
  'GET /api/series/work/head': { series_id: 'work', head: currentHead },
  ...extra,
});
const restored = {
  checkpoint_id: saved.id,
  series_id: 'work',
  head: targetHead,
  pre_restore_checkpoint: {
    ...saved,
    id: 'cp_protection',
    name: 'Before restoring First draft',
    kind: 'pre_restore',
  },
  restored_episode_ids: ['old_episode', 'episode'],
  trashed_episode_ids: ['extra_episode'],
};

describe('creative checkpoints', () => {
  it('saves only after drafts finish and guards creation with the current work head', async () => {
    let release!: () => void;
    vi.mocked(flushEditors).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const calls = mockFetch(
      routes({ [`POST ${base}`]: { ...saved, id: 'cp_new', name: 'Before lettering' } }),
    );
    renderWithProviders(<CheckpointDialog seriesId="work" title="Comic" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '保存当前状态' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('存档名称'), '  Before lettering  ');
    await userEvent.click(screen.getByRole('button', { name: '保存当前状态' }));
    expect(screen.getByRole('button', { name: '正在保存…' })).toBeDisabled();
    expect(calls.some((call) => call.url.endsWith('/head') || call.method === 'POST')).toBe(false);
    release();
    expect(await screen.findByRole('status')).toHaveTextContent('已保存「Before lettering」。');
    expect(calls.filter((call) => call.url.endsWith('/head') || call.method === 'POST')).toEqual([
      { method: 'GET', url: '/api/series/work/head', body: undefined },
      { method: 'POST', url: base, body: { name: 'Before lettering', expected_head: currentHead } },
    ]);
    expect(flushEditors).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('存档名称')).toHaveValue('');
  });

  it('previews without restoring and submits exactly the reviewed head on explicit restore', async () => {
    let checkpoints: CheckpointSummary[] = [saved];
    const calls = mockFetch(
      routes({
        [`GET ${base}`]: () => checkpoints,
        [`POST ${base}/cp_first/restore`]: () => {
          checkpoints = [restored.pre_restore_checkpoint as CheckpointSummary, saved];
          return restored;
        },
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    for (const key of [
      'series',
      'episodes',
      'episode',
      'workshop',
      'creation-kits',
      'reading-preview',
      'prompt',
      'strip-report',
      'workshop-queue',
      'trash',
    ])
      client.setQueryData([key, 'cached'], { value: 'old' });
    render(
      <QueryClientProvider client={client}>
        <CheckpointDialog seriesId="work" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: '恢复到此存档' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: '预览恢复变化' }));
    expect(await screen.findByRole('region', { name: '恢复会带来哪些变化' })).toBeInTheDocument();
    expect(flushEditors).toHaveBeenCalledOnce();
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
    expect(screen.getByText(/恢复前会自动保存当前状态/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('查看受影响的分镜与阻断项'));
    expect(screen.getByText('extra_episode')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '恢复到此存档' }));
    expect(
      await screen.findByText('已恢复；原状态保存在「Before restoring First draft」。'),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([
      { method: 'POST', url: `${base}/cp_first/restore`, body: { expected_head: currentHead } },
    ]);
    expect(flushEditors).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: '恢复到此存档' })).toBeNull();
    expect(screen.getByText('恢复前自动保护')).toBeInTheDocument();
    for (const key of [
      'series',
      'episodes',
      'episode',
      'workshop',
      'creation-kits',
      'reading-preview',
      'prompt',
      'strip-report',
      'workshop-queue',
      'trash',
    ])
      expect(client.getQueryState([key, 'cached'])?.isInvalidated).toBe(true);
  });

  it.each([
    ['missing_asset_ids', ['lost_image'], '有 1 个引用素材缺失'],
    ['reference_errors', ['Unknown character'], '有 1 个资料引用不可用'],
    ['active_job_ids', ['running_job'], '还有 1 个相关任务未结束'],
  ])(
    'blocks restore when preview reports %s even if the general flag is true',
    async (field, value, text) => {
      const calls = mockFetch(
        routes({ [`GET ${base}/cp_first/preview`]: { ...preview, [field]: value } }),
      );
      renderWithProviders(<CheckpointDialog seriesId="work" onClose={vi.fn()} />);
      await userEvent.click(await screen.findByRole('button', { name: '预览恢复变化' }));
      await screen.findByRole('button', { name: '恢复到此存档' });
      expect(screen.getAllByText(new RegExp(text as string)).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: '恢复到此存档' })).toBeDisabled();
      expect(calls.some((call) => call.method !== 'GET')).toBe(false);
    },
  );

  it('keeps a conflict visible and requires another preview before sending another restore', async () => {
    let head = currentHead;
    const calls = mockFetch(
      routes({
        [`GET ${base}/cp_first/preview`]: () => ({ ...preview, current_head: head }),
        [`POST ${base}/cp_first/restore`]: () => {
          head = 'c'.repeat(64);
          return new Response(JSON.stringify({ detail: 'work changed since preview' }), {
            status: 409,
          });
        },
      }),
    );
    const close = vi.fn();
    renderWithProviders(<CheckpointDialog seriesId="work" onClose={close} />);
    await userEvent.click(await screen.findByRole('button', { name: '预览恢复变化' }));
    await userEvent.click(await screen.findByRole('button', { name: '恢复到此存档' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('work changed since preview');
    expect(
      screen.getByText('当前状态或恢复条件已发生变化。请重新预览后再决定是否恢复。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复到此存档' })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '预览恢复变化' }));
    await userEvent.click(await screen.findByRole('button', { name: '恢复到此存档' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2));
    expect(calls.filter((call) => call.method === 'POST')[1].body).toEqual({ expected_head: head });
  });

  it('does not create or preview if an editor fails to save, and keeps the typed name', async () => {
    vi.mocked(flushEditors).mockRejectedValue(new Error('Draft could not be saved'));
    const calls = mockFetch(routes());
    renderWithProviders(<CheckpointDialog seriesId="work" onClose={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('存档名称'), 'Keep my name');
    await userEvent.click(screen.getByRole('button', { name: '保存当前状态' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Draft could not be saved');
    expect(screen.getByLabelText('存档名称')).toHaveValue('Keep my name');
    await userEvent.click(screen.getByRole('button', { name: '预览恢复变化' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Draft could not be saved');
    expect(calls.every((call) => call.url === base && call.method === 'GET')).toBe(true);
  });

  it('discards the preview when another checkpoint is selected and requires explicit deletion', async () => {
    const calls = mockFetch(
      routes({
        [`GET ${base}`]: [saved, { ...saved, id: 'cp_second', name: 'Second draft' }],
        [`DELETE ${base}/cp_second`]: new Response(null, { status: 204 }),
      }),
    );
    renderWithProviders(<CheckpointDialog seriesId="work" onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: '预览恢复变化' }));
    await screen.findByRole('button', { name: '恢复到此存档' });
    fireEvent.change(screen.getByLabelText('已有存档'), { target: { value: 'cp_second' } });
    expect(screen.queryByRole('button', { name: '恢复到此存档' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '删除此存档' }));
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: '删除此存档' }));
    await userEvent.click(screen.getByRole('button', { name: '确认删除存档' }));
    expect(await screen.findByText('存档已删除。')).toBeInTheDocument();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([
      { method: 'DELETE', url: `${base}/cp_second`, body: undefined },
    ]);
  });

  it('disables changing or closing the dialog during restore', async () => {
    let finish!: (value: unknown) => void;
    mockFetch(
      routes({
        [`POST ${base}/cp_first/restore`]: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    );
    const close = vi.fn();
    renderWithProviders(<CheckpointDialog seriesId="work" onClose={close} />);
    await userEvent.click(await screen.findByRole('button', { name: '预览恢复变化' }));
    await userEvent.click(await screen.findByRole('button', { name: '恢复到此存档' }));
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.getByRole('button', { name: '正在恢复…' })).toBeDisabled();
    expect(screen.getByLabelText('已有存档')).toBeDisabled();
    expect(screen.getByLabelText('存档名称')).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled();
    finish(restored);
    await screen.findByText(/已恢复；原状态保存在/);
  });
});
