import { api, data, raw } from './client';
import type { components } from './schema';

type S = components['schemas'];
export type BackupCreated = S['BackupCreated'];
export type BackupInspection = S['BackupInspection'];
export type BackupHead = S['BackupHead'];
export type RestorePlan = S['RestorePlan'];
export type BackupRecord = S['BackupRecord'];
export type RestoreRecord = S['RestoreRecord'];
export const MAX_WORKSPACE_BACKUP_BYTES = 12 * 1024 ** 3;

export async function workspaceBackupHead() {
  return data(await api.GET('/api/backups/head'));
}

export async function listWorkspaceBackups(offset = 0, limit = 20) {
  return data(await api.GET('/api/backups', { params: { query: { offset, limit } } }));
}

export async function listWorkspaceRestorePlans(offset = 0, limit = 20) {
  return data(
    await api.GET('/api/backups/restore-plans', { params: { query: { offset, limit } } }),
  );
}

export async function deleteWorkspaceBackup(backupId: string) {
  await api.DELETE('/api/backups/{backup_id}', { params: { path: { backup_id: backupId } } });
}

export async function deleteWorkspaceRestorePlan(planId: string) {
  await api.DELETE('/api/backups/restore-plans/{plan_id}', {
    params: { path: { plan_id: planId } },
  });
}

export async function createWorkspaceBackup(includeCredentials = false) {
  return data(
    await api.POST('/api/backups', { body: { include_credentials: includeCredentials } }),
  );
}

/** Binary bodies remain opaque; schemas type the response without base64 or browser extraction. */
export async function inspectWorkspaceBackup(file: File): Promise<BackupInspection> {
  return (
    await raw('/api/backups/inspect', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  ).json();
}

export async function stageWorkspaceRestore(file: File): Promise<RestorePlan> {
  return (
    await raw('/api/backups/restore-plans', {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  ).json();
}

export async function getWorkspaceRestorePlan(planId: string) {
  return data(
    await api.GET('/api/backups/restore-plans/{plan_id}', {
      params: { path: { plan_id: planId } },
    }),
  );
}

export async function applyWorkspaceRestore(plan: RestorePlan) {
  return data(
    await api.POST('/api/backups/restore-plans/{plan_id}/apply', {
      params: { path: { plan_id: plan.id } },
      body: { expected_head: plan.expected_head, expected_archive_sha256: plan.inspection.sha256 },
    }),
  );
}

export async function cancelWorkspaceRestore(planId: string) {
  return data(
    await api.POST('/api/backups/restore-plans/{plan_id}/cancel', {
      params: { path: { plan_id: planId } },
    }),
  );
}

export const workspaceBackupDownloadUrl = (backupId: string) =>
  `/api/backups/${encodeURIComponent(backupId)}/download`;

/** Let the browser stream multi-gigabyte downloads instead of allocating a JS Blob. */
export function downloadWorkspaceBackup(backupId: string) {
  const anchor = document.createElement('a');
  anchor.href = workspaceBackupDownloadUrl(backupId);
  anchor.download = `${backupId}.mio-workspace.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

const planStorageKey = () => `mio.restore-plan:${window.location.origin}`;

/** This is only a lookup hint. A plan must be fetched from the current server before use. */
export function rememberedRestorePlan(): string | null {
  try {
    const id = sessionStorage.getItem(planStorageKey());
    return id && /^restore_[a-f0-9]{12}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function rememberRestorePlan(id: string | null) {
  try {
    if (id) sessionStorage.setItem(planStorageKey(), id);
    else sessionStorage.removeItem(planStorageKey());
  } catch {
    /* Storage-disabled browsers can still finish the current restore flow. */
  }
}
