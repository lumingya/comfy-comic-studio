import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupRecord, RestorePlan, RestoreRecord } from '../../api/backups';
import { ConfirmHost } from '../../components/confirm';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { BackupHistory } from './BackupHistory';
import { BackupsSection } from './BackupsSection';

const id = 'backup_123456abcdef';
const planId = 'restore_123456abcdef';
const backup: BackupRecord = {
  id,
  created_at: '2026-11-15T00:00:00Z',
  size: 1024,
  retained_bytes: 2048,
  includes_credentials: false,
  protection_plan_ids: [],
  can_delete: true,
};
const record: RestoreRecord = {
  id: planId,
  created_at: backup.created_at,
  state: 'staged',
  protection_backup_id: id,
  retained_bytes: 8192,
  staged_bytes: 2048,
  previous_bytes: 4096,
  pending: false,
  can_delete: true,
  blocked_reason: null,
};
const plan: RestorePlan = {
  id: planId,
  created_at: record.created_at,
  state: 'staged',
  expected_head: 'a'.repeat(64),
  protection_backup_id: null,
  message: '',
  inspection: {
    sha256: 'b'.repeat(64),
    size: 1024,
    series_count: 0,
    episode_count: 0,
    asset_count: 0,
    checkpoint_count: 0,
    job_count: 0,
    warnings: [],
    manifest: {
      format: 'mio.workspace',
      version: 1,
      schema_version: 2,
      jobs_schema_version: 2,
      created_at: backup.created_at,
      source_head: 'a'.repeat(64),
      includes_credentials: false,
      exclusions: [],
      entries: [],
    },
  },
};
const page = <T,>(items: T[], extra = {}) => ({
  items,
  total: items.length,
  offset: 0,
  limit: 20,
  next_offset: null,
  ...extra,
});
const fail = (detail: string, status = 409) => new Response(JSON.stringify({ detail }), { status });

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function renderHistory(onReview = vi.fn(), onDeletedPlan = vi.fn()) {
  renderWithProviders(
    <>
      <BackupHistory onReview={onReview} onDeletedPlan={onDeletedPlan} />
      <ConfirmHost />
    </>,
  );
  return { onReview, onDeletedPlan };
}

async function openHistory(plans = false) {
  await userEvent.click(screen.getByText('本机保留记录', { selector: 'summary' }));
  await screen.findByRole('button', { name: '恢复计划' });
  if (plans) await userEvent.click(screen.getByRole('button', { name: '恢复计划' }));
}

describe('retained workspace backup records', () => {
  it('loads only when expanded and pages and refreshes the catalog through the API', async () => {
    let reads = 0;
    const second = { ...backup, id: 'backup_abcdef123456', includes_credentials: true };
    const calls = mockFetch({
      'GET /api/backups': () =>
        ++reads === 1
          ? page([backup], { total: 21, next_offset: 20 })
          : page([second], { total: 21, offset: 20 }),
    });
    renderHistory();
    expect(calls).toHaveLength(0);
    expect(
      screen.getByText('本机保留记录', { selector: 'summary' }).closest('details'),
    ).not.toHaveAttribute('open');
    await openHistory();
    await screen.findByRole('group', { name: id });
    expect(calls[0].url).toBe('/api/backups?offset=0&limit=20');
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    const row = await screen.findByRole('group', { name: second.id });
    expect(calls[1].url).toBe('/api/backups?offset=20&limit=20');
    expect(within(row).getByText('这份文件包含凭据')).toBeVisible();
    expect(within(row).getByRole('link', { name: '下载' })).toHaveAttribute(
      'href',
      `/api/backups/${second.id}/download`,
    );
    expect(screen.getByText('第 2 页 · 共 21 条')).toBeVisible();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(calls.filter((c) => c.url === '/api/backups?offset=20&limit=20')).toHaveLength(2);
  });

  it('requires explicit confirmation and preserves a canceled deletion', async () => {
    let deleted = false;
    const calls = mockFetch({
      'GET /api/backups': () => page(deleted ? [] : [backup]),
      [`DELETE /api/backups/${id}`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    renderHistory();
    await openHistory();
    await userEvent.click(await screen.findByRole('button', { name: `删除「${id}」？` }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/已下载到其他位置的副本不受影响/)).toBeVisible();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: `删除「${id}」？` }));
    dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(await screen.findByText('这里还什么都没有')).toBeVisible();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      `/api/backups/${id}`,
    ]);
  });

  it('shows protection and requires pending cancellation while reviewing a freshly fetched plan', async () => {
    const protectedBackup = { ...backup, protection_plan_ids: [planId], can_delete: false };
    const pending = {
      ...record,
      state: 'pending',
      pending: true,
      can_delete: false,
      blocked_reason: 'pending',
    };
    const verified = { ...plan, state: 'pending', message: 'fresh server plan' };
    const calls = mockFetch({
      'GET /api/backups': page([protectedBackup]),
      'GET /api/backups/restore-plans': page([pending]),
      [`GET /api/backups/restore-plans/${planId}`]: verified,
    });
    const { onReview } = renderHistory();
    await openHistory();
    expect(await screen.findByRole('button', { name: `删除「${id}」？` })).toBeDisabled();
    expect(screen.getByText(/被 1 份恢复计划保护引用/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '恢复计划' }));
    expect(await screen.findByRole('button', { name: `删除「${planId}」？` })).toBeDisabled();
    expect(screen.getByText(/先查看并取消安排/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '查看恢复计划' }));
    expect(onReview).toHaveBeenCalledWith(verified);
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('deletes retained plan directories without automatically deleting their protection archive', async () => {
    let deleted = false;
    const calls = mockFetch({
      'GET /api/backups': page([]),
      'GET /api/backups/restore-plans': () => page(deleted ? [] : [record]),
      [`DELETE /api/backups/restore-plans/${planId}`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    const { onDeletedPlan } = renderHistory();
    await openHistory(true);
    expect(
      await screen.findByText('本机占用 8 KiB · 暂存文件 2 KiB · 恢复前原目录 4 KiB'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: `删除「${planId}」？` }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/保护备份会继续保留/)).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await screen.findByText('这里还什么都没有');
    expect(onDeletedPlan).toHaveBeenCalledWith(planId);
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      `/api/backups/restore-plans/${planId}`,
    ]);
  });

  it('keeps server conflicts visible and refreshes changed protection status', async () => {
    let attempted = false;
    const calls = mockFetch({
      'GET /api/backups': () =>
        page([
          { ...backup, can_delete: !attempted, protection_plan_ids: attempted ? [planId] : [] },
        ]),
      [`DELETE /api/backups/${id}`]: () => {
        attempted = true;
        return fail('backup now protects a restore plan');
      },
    });
    renderHistory();
    await openHistory();
    await userEvent.click(await screen.findByRole('button', { name: `删除「${id}」？` }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'backup now protects a restore plan',
    );
    expect(screen.getByRole('button', { name: `删除「${id}」？` })).toBeDisabled();
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('discovers a plan without a browser hint and still uses the original current-head guard', async () => {
    const calls = mockFetch({
      'GET /api/backups': page([]),
      'GET /api/backups/restore-plans': page([record]),
      [`GET /api/backups/restore-plans/${planId}`]: plan,
      'GET /api/backups/head': { head: 'c'.repeat(64), active_job_ids: [] },
    });
    renderWithProviders(<BackupsSection />);
    await openHistory(true);
    await userEvent.click(await screen.findByRole('button', { name: '查看恢复计划' }));
    const dialog = await screen.findByRole('dialog');
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: '安排下次启动恢复' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('当前工作区已变化');
    expect(calls.some((c) => c.url.endsWith('/apply'))).toBe(false);
    expect(
      calls.filter((c) => c.url === `/api/backups/restore-plans/${planId}`).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
