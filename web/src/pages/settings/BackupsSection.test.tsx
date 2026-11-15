import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_WORKSPACE_BACKUP_BYTES,
  rememberRestorePlan,
  type BackupInspection,
  type RestorePlan,
} from '../../api/backups';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { BackupsSection } from './BackupsSection';

const planId = 'restore_123456abcdef';
const archiveSha = 'a'.repeat(64);
const currentHead = 'b'.repeat(64);
const report: BackupInspection = {
  sha256: archiveSha,
  size: 3 * 1024 * 1024,
  series_count: 2,
  episode_count: 7,
  asset_count: 25,
  checkpoint_count: 3,
  job_count: 12,
  warnings: [],
  manifest: {
    format: 'mio.workspace',
    version: 1,
    schema_version: 2,
    source_head: 'f'.repeat(64),
    created_at: '2026-11-15T00:00:00Z',
    includes_credentials: false,
    exclusions: ['extension packages', 'API tokens', 'URL credentials'],
    entries: [],
  },
};
const staged: RestorePlan = {
  id: planId,
  inspection: report,
  expected_head: currentHead,
  created_at: '2026-11-15T00:00:00Z',
  state: 'staged',
  protection_backup_id: null,
  message: '',
};
const pending: RestorePlan = {
  ...staged,
  state: 'pending',
  protection_backup_id: 'backup_123456abcdef',
};
const archiveFile = () =>
  new File(['opaque zip archive'], 'work.mio-workspace.zip', { type: 'application/zip' });
const fail = (detail: string, status = 409) => new Response(JSON.stringify({ detail }), { status });

function backupFetch(
  routes: Record<string, unknown> = {},
  upload: { inspect?: unknown; stage?: unknown } = {},
) {
  const calls = mockFetch({
    [`GET /api/backups/restore-plans/${planId}`]: staged,
    'GET /api/backups/head': { head: currentHead, active_job_ids: [] },
    [`POST /api/backups/restore-plans/${planId}/apply`]: { plan: pending, requires_restart: true },
    [`POST /api/backups/restore-plans/${planId}/cancel`]: {
      ...staged,
      state: 'rejected',
      message: 'Canceled before restart.',
    },
    ...routes,
  });
  const dispatch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (
      request.method === 'POST' &&
      ['/api/backups/inspect', '/api/backups/restore-plans'].includes(path)
    ) {
      calls.push({ method: request.method, url: path, body: '[opaque archive]' });
      const value = path.endsWith('/inspect')
        ? (upload.inspect ?? report)
        : (upload.stage ?? staged);
      const result = typeof value === 'function' ? await value() : value;
      return result instanceof Response
        ? result
        : new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }
    return dispatch(input, init);
  });
  return calls;
}

async function openRestore() {
  await userEvent.click(screen.getByRole('button', { name: '从备份恢复…' }));
  return screen.getByRole('dialog');
}

async function inspectFile() {
  const dialog = await openRestore();
  const input = dialog.querySelector<HTMLInputElement>('input[type=file]')!;
  await userEvent.upload(input, archiveFile());
  await userEvent.click(within(dialog).getByRole('button', { name: '检查文件' }));
  await within(dialog).findByText('文件检查通过，当前工作区未修改。');
  return dialog;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('workspace backup export', () => {
  it('excludes credentials by default and streams a server-created download', async () => {
    const calls = backupFetch({
      'POST /api/backups': { id: 'backup_created', inspection: report },
    });
    renderWithProviders(<BackupsSection />);
    await userEvent.click(screen.getByRole('button', { name: '导出工作区备份' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('高级选项').closest('details')).not.toHaveAttribute('open');
    expect(within(dialog).getByLabelText('将已配置的密钥和令牌一起备份')).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: '创建并下载' }));
    await within(dialog).findByText('备份已创建，下载已开始。');
    expect(calls.find((call) => call.url === '/api/backups')?.body).toEqual({
      include_credentials: false,
    });
    expect(within(dialog).getByText(/2 个作品或资源库.*25 个素材/)).toBeVisible();
    expect(within(dialog).getByText('文件大小：3.0 MiB')).toBeVisible();
    expect(within(dialog).getByRole('link', { name: '再次下载' })).toHaveAttribute(
      'href',
      '/api/backups/backup_created/download',
    );
    await userEvent.click(within(dialog).getByText('备份不包含'));
    expect(within(dialog).getByText('API 令牌')).toBeVisible();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect(calls.filter((call) => call.url.includes('restore'))).toHaveLength(0);
  });

  it('includes credentials only after an explicit advanced selection', async () => {
    const calls = backupFetch({
      'POST /api/backups': {
        id: 'backup_secret',
        inspection: { ...report, manifest: { ...report.manifest, includes_credentials: true } },
      },
    });
    renderWithProviders(<BackupsSection />);
    await userEvent.click(screen.getByRole('button', { name: '导出工作区备份' }));
    await userEvent.click(screen.getByText('高级选项'));
    await userEvent.click(screen.getByLabelText('将已配置的密钥和令牌一起备份'));
    expect(screen.getByText('勾选后文件包含访问凭据，请只保存到你信任的位置。')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '创建并下载' }));
    expect(await screen.findByText('这份文件包含凭据')).toBeVisible();
    expect(calls.find((call) => call.url === '/api/backups')?.body).toEqual({
      include_credentials: true,
    });
  });
});

describe('workspace restore review', () => {
  it('separates inspect, stage and schedule; checks the current head and offers explicit cancellation', async () => {
    const calls = backupFetch();
    renderWithProviders(<BackupsSection />);
    const dialog = await inspectFile();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
      '/api/backups/inspect',
    ]);
    expect(
      within(dialog).queryByRole('button', { name: '安排下次启动恢复' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '暂存恢复计划' }));
    const schedule = await within(dialog).findByRole('button', { name: '安排下次启动恢复' });
    expect(calls.some((call) => call.url.endsWith('/apply'))).toBe(false);
    expect(within(dialog).getByText(/安排恢复时会在本机完整保存当前工作区/)).toBeVisible();
    await userEvent.click(within(dialog).getByText('校验与计划详情'));
    expect(within(dialog).getByText(currentHead)).toBeVisible();
    expect(within(dialog).getByText(archiveSha)).toBeVisible();
    await userEvent.click(schedule);
    expect(await within(dialog).findByText('已安排恢复，请手动重启 Mio')).toBeVisible();
    expect(within(dialog).getByText(/这里不会自动重启服务/)).toBeVisible();
    expect(calls.find((call) => call.url.endsWith('/apply'))?.body).toEqual({
      expected_head: currentHead,
      expected_archive_sha256: archiveSha,
    });
    expect(calls.some((call) => call.url === '/api/backups/head')).toBe(true);
    expect(calls.some((call) => /restart|shutdown|render/.test(call.url))).toBe(false);
    expect(
      within(dialog).getByRole('link', { name: '下载本机保护备份（包含凭据）' }),
    ).toHaveAttribute('href', '/api/backups/backup_123456abcdef/download');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消恢复安排' }));
    await within(dialog).findByText('恢复未执行，当前工作区已保留。');
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(1);
  });

  it('requires restaging when the workspace changes and never sends a stale apply', async () => {
    let stages = 0;
    const newHead = 'c'.repeat(64);
    const calls = backupFetch(
      { 'GET /api/backups/head': { head: newHead, active_job_ids: [] } },
      {
        stage: () => ({ ...staged, expected_head: ++stages === 1 ? currentHead : newHead }),
      },
    );
    renderWithProviders(<BackupsSection />);
    const dialog = await inspectFile();
    await userEvent.click(within(dialog).getByRole('button', { name: '暂存恢复计划' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: '安排下次启动恢复' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('当前工作区已变化');
    expect(calls.filter((call) => call.url.endsWith('/apply'))).toHaveLength(0);
    expect(
      within(dialog).queryByRole('button', { name: '安排下次启动恢复' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: '重新暂存并核对' }));
    await within(dialog).findByRole('button', { name: '安排下次启动恢复' });
    expect(calls.filter((call) => call.url === '/api/backups/restore-plans')).toHaveLength(2);
    expect(calls.filter((call) => call.url.endsWith('/apply'))).toHaveLength(0);
  });

  it('loads only a plan ID hint and verifies it against the current workspace after refresh', async () => {
    rememberRestorePlan(planId);
    const calls = backupFetch({ [`GET /api/backups/restore-plans/${planId}`]: pending });
    const { unmount } = renderWithProviders(<BackupsSection />);
    await screen.findByText('已安排恢复，请手动重启 Mio');
    expect(calls.some((call) => call.url === `/api/backups/restore-plans/${planId}`)).toBe(true);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    expect(sessionStorage.getItem(`mio.restore-plan:${window.location.origin}`)).toBe(planId);
    unmount();
    const foreignCalls = backupFetch({
      [`GET /api/backups/restore-plans/${planId}`]: fail('not found', 404),
    });
    renderWithProviders(<BackupsSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('当前工作区没有这份恢复计划');
    await openRestore();
    expect(screen.queryByRole('button', { name: '安排下次启动恢复' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消恢复安排' })).not.toBeInTheDocument();
    expect(foreignCalls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('rejects oversized or invalid archives before staging and preserves the inspect retry', async () => {
    const calls = backupFetch({}, { inspect: fail('bad archive', 400) });
    renderWithProviders(<BackupsSection />);
    const dialog = await openRestore();
    const input = dialog.querySelector<HTMLInputElement>('input[type=file]')!;
    const oversized = archiveFile();
    Object.defineProperty(oversized, 'size', { value: MAX_WORKSPACE_BACKUP_BYTES + 1 });
    await userEvent.upload(input, oversized);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('不能超过 2 GiB');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    await userEvent.upload(input, archiveFile());
    await userEvent.click(within(dialog).getByRole('button', { name: '检查文件' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('bad archive');
    expect(within(dialog).getByRole('button', { name: '检查文件' })).toBeEnabled();
    expect(calls.some((call) => call.url === '/api/backups/restore-plans')).toBe(false);
  });

  it('does not schedule while jobs remain active or when a plan lookup fails', async () => {
    rememberRestorePlan(planId);
    let reads = 0;
    const calls = backupFetch({
      [`GET /api/backups/restore-plans/${planId}`]: () =>
        ++reads < 3 ? staged : fail('another workspace', 404),
      'GET /api/backups/head': { head: null, active_job_ids: ['job_busy'] },
    });
    renderWithProviders(<BackupsSection />);
    await screen.findByText('恢复计划已暂存');
    const dialog = await openRestore();
    await userEvent.click(within(dialog).getByRole('button', { name: '安排下次启动恢复' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('1 个进行中或待核对');
    expect(calls.filter((call) => call.url.endsWith('/apply'))).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: '安排下次启动恢复' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('another workspace');
    expect(calls.filter((call) => call.url.endsWith('/apply'))).toHaveLength(0);
  });

  it('refuses a staged archive that differs from its inspection', async () => {
    const calls = backupFetch(
      {},
      { stage: { ...staged, inspection: { ...report, sha256: 'e'.repeat(64) } } },
    );
    renderWithProviders(<BackupsSection />);
    const dialog = await inspectFile();
    await userEvent.click(within(dialog).getByRole('button', { name: '暂存恢复计划' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '暂存文件与刚检查的备份不同',
    );
    expect(calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/apply'))).toHaveLength(0);
    expect(within(dialog).getByRole('button', { name: '检查文件' })).toBeEnabled();
  });
});
