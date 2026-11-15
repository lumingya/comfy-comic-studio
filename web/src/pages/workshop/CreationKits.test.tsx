import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KitImport, KitInspection } from '../../api/creationKits';
import type { AssemblyPreview } from '../../api/workshop';
import { configInstance, configProfile, configurationRoutes } from '../../test/configuration';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { CreationKitImport, CreationKitImportPreview } from './CreationKitImport';
import { ExportPicker } from './ExportPicker';
import AssembleDialog from './AssembleDialog';

const file = () => new File(['opaque archive'], 'sample.mio-kit.zip', { type: 'application/zip' });
const kitReport: KitInspection = {
  title: 'Rainy stories',
  sha256: 'a'.repeat(64),
  episodes: [{ id: 'old_board', title: 'Rainy street', panels: 2 }],
  presets: [{ id: 'old_preset', title: 'Watercolor' }],
  profiles: [{ id: 'old_profile', name: 'Mixed profile' }],
  workflows: [{ id: 'old_workflow', name: 'Custom workflow' }],
  external: [{ profile_id: 'old_profile', local: true, cloud: true }],
  asset_count: 2,
  warnings: ['Server inspection warning'],
};
const fail = () => new Response(JSON.stringify({ detail: 'offline' }), { status: 503 });

function kitFetch(extra: Record<string, unknown> = {}) {
  const calls = mockFetch(configurationRoutes(extra));
  const dispatch = globalThis.fetch;
  const inspections: Request[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/api/creation-kits/inspect') {
      inspections.push(request);
      return new Response(JSON.stringify(kitReport), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return dispatch(input, init);
  });
  return { calls, inspections };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('creation kit import', () => {
  it('keeps the original import action and opens kit preview without saving', async () => {
    const { calls, inspections } = kitFetch();
    const legacy = vi.fn();
    const { container } = renderWithProviders(
      <CreationKitImport label="导入" legacyLabel="分镜 JSON" onLegacy={legacy} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '导入' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '分镜 JSON' }));
    expect(legacy).toHaveBeenCalledOnce();
    const input = container.querySelector<HTMLInputElement>('input[accept=".zip"]')!;
    await userEvent.upload(input, file());
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('1 份分镜 · 1 份预设 · 2 个引用素材');
    expect(
      within(dialog).getByText('查看分镜、预设与工作流').closest('details'),
    ).not.toHaveAttribute('open');
    expect(within(dialog).getByRole('button', { name: '确认导入' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(inspections).toHaveLength(1);
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  });

  it('requires both local and cloud bindings for a hybrid profile and excludes disabled instances', async () => {
    const { calls } = kitFetch({
      'GET /api/instances': {
        instances: [
          configInstance,
          { ...configInstance, id: 'off', name: 'Disabled server', enabled: false },
        ],
        pool: {},
      },
      'POST /api/creation-kits/import': {
        series_id: 'kit_new',
        episode_ids: ['board_new'],
        preset_ids: ['preset_new'],
        id_map: {},
        unbound_profile_ids: [],
      },
    });
    const close = vi.fn();
    renderWithProviders(<CreationKitImportPreview file={file()} onClose={close} />);
    await userEvent.selectOptions(await screen.findByLabelText('Mixed profile'), 'bind');
    expect(screen.queryByLabelText('Disabled server')).toBeNull();
    const submit = screen.getByRole('button', { name: '确认导入' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText('测试 ComfyUI'));
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('云端渠道'), 'images');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(close).toHaveBeenCalled());
    const body = calls.find((call) => call.url === '/api/creation-kits/import')?.body as KitImport;
    expect(body.profiles).toEqual({
      old_profile: { instances: ['comfy_test'], cloud_channel: 'images' },
    });
    expect(atob(body.archive_base64)).toBe('opaque archive');
    expect(body.idempotency_key).toEqual(expect.any(String));
  });

  it('allows explicit pending configuration and reuses a failed import intent until bindings change', async () => {
    const { calls } = kitFetch({ 'POST /api/creation-kits/import': fail });
    renderWithProviders(<CreationKitImportPreview file={file()} onClose={vi.fn()} />);
    const mode = await screen.findByLabelText('Mixed profile');
    await userEvent.selectOptions(mode, 'unbound');
    const submit = screen.getByRole('button', { name: '确认导入' });
    const sent = () =>
      calls
        .filter((call) => call.url === '/api/creation-kits/import')
        .map((call) => call.body as KitImport);
    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => {
      expect(sent()).toHaveLength(2);
      expect(submit).toBeEnabled();
    });
    expect(sent()[0].profiles).toEqual({ old_profile: { unbound: true } });
    expect(sent()[1].idempotency_key).toBe(sent()[0].idempotency_key);
    await userEvent.selectOptions(mode, 'bind');
    await userEvent.click(screen.getByLabelText('测试 ComfyUI'));
    await userEvent.selectOptions(screen.getByLabelText('云端渠道'), 'chat');
    await userEvent.click(submit);
    await waitFor(() => expect(sent()).toHaveLength(3));
    expect(sent()[2].idempotency_key).not.toBe(sent()[1].idempotency_key);
  });
});

const preset = (id: string) => ({ id, title: id, entries: [], groups: [], bindings: [] });
const kit = {
  ...series,
  id: 'kit_new',
  kind: 'kit' as const,
  title: 'Imported kit',
  presets: [preset('kit_preset')],
  default_profile_id: 'kit_profile',
};
const assemblyReport: AssemblyPreview = {
  title: 'Ready',
  storyboard_id: 'kit_board',
  profile_id: 'kit_profile',
  preset_ids: ['kit_preset'],
  panels: [
    {
      panel_id: 'kit_panel',
      title: 'Kit panel',
      order: 0,
      profile_id: 'kit_profile',
      dialect: 'tags',
      positive: 'SERVER COMPOSED',
      negative: '',
      dialogues: [],
      variables: [],
    },
  ],
};
const assemblyRoutes = () =>
  configurationRoutes({
    'GET /api/creation-kits': [kit],
    'GET /api/series/kit_new': kit,
    'GET /api/workshop': { ...series, id: 'ws', presets: [preset('workshop_preset')] },
    'GET /api/series/ws/episodes': {
      items: [{ id: 'ws_board', title: 'Workshop story', panel_count: 1 }],
    },
    'GET /api/episodes/ws_board': { ...episode, id: 'ws_board' },
    'GET /api/series/kit_new/episodes': {
      items: [{ id: 'kit_board', title: 'Kit story', panel_count: 2 }],
    },
    'GET /api/episodes/kit_board': { ...episode, id: 'kit_board', series_id: 'kit_new' },
    'GET /api/profiles': [
      configProfile,
      { ...configProfile, id: 'kit_profile', name: 'Kit profile', binding_required: true },
    ],
    'POST /api/creation-kits/kit_new/preview': assemblyReport,
  });
const next = () => fireEvent.click(screen.getByRole('button', { name: '下一步' }));

describe('kit assembly source', () => {
  it('reuses an imported kit with server preview and its own profile, including pending configuration', async () => {
    const calls = mockFetch({
      ...assemblyRoutes(),
      'POST /api/creation-kits/kit_new/assemble': { series, episode },
    });
    renderWithProviders(
      <AssembleDialog onClose={vi.fn()} />,
      '/workshop/assembly?new=1&kit=kit_new',
    );
    await screen.findByRole('option', { name: /Kit story/ });
    expect(screen.getByLabelText('分镜来源')).toHaveValue('kit_new');
    expect(screen.getByText('待配置：套装可装配，选择服务后才能生成。')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '出图配置' })).toBeNull();
    next();
    expect(screen.getByRole('checkbox', { name: /kit_preset/ })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /workshop_preset/ })).toBeNull();
    next();
    await screen.findByText('已核对 1 幕，没有未解决的变量。');
    fireEvent.click(screen.getByText('展开各幕替换结果'));
    expect(screen.getByText('SERVER COMPOSED')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '添加待命任务' }));
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/kit_new/assemble'))).toBe(true),
    );
    const body = calls.find((call) => call.url.endsWith('/kit_new/assemble'))?.body;
    expect(body).toMatchObject({
      episode_id: 'kit_board',
      preset_ids: ['kit_preset'],
      variables: {},
      idempotency_key: expect.any(String),
    });
    expect(body).not.toHaveProperty('profile_id');
    expect(calls.some((call) => call.url === '/api/workshop/assemble')).toBe(false);
    expect(
      calls.some((call) => call.url.includes('/render') || call.url.includes('/generate')),
    ).toBe(false);
  });

  it('clears selections, titles and intent keys when changing sources and preserves retries within a source', async () => {
    const calls = mockFetch({
      ...assemblyRoutes(),
      'POST /api/creation-kits/kit_new/assemble': fail,
    });
    renderWithProviders(<AssembleDialog onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /Workshop story/ });
    next();
    next();
    fireEvent.change(screen.getByLabelText('画册名称'), { target: { value: 'Workshop draft' } });
    fireEvent.change(screen.getByLabelText('分镜来源'), { target: { value: 'kit_new' } });
    await screen.findByRole('option', { name: /Kit story/ });
    next();
    next();
    expect(screen.getByLabelText('画册名称')).not.toHaveValue('Workshop draft');
    const submit = screen.getByRole('button', { name: '添加待命任务' });
    const sent = () =>
      calls
        .filter((call) => call.url.endsWith('/kit_new/assemble'))
        .map(
          (call) =>
            call.body as { idempotency_key: string; episode_id: string; preset_ids: string[] },
        );
    fireEvent.click(submit);
    await waitFor(() => {
      expect(sent()).toHaveLength(1);
      expect(submit).toBeEnabled();
    });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(sent()).toHaveLength(2);
      expect(submit).toBeEnabled();
    });
    expect(sent()[0].idempotency_key).toBe(sent()[1].idempotency_key);
    expect(sent()[0].preset_ids).toEqual(['kit_preset']);
    fireEvent.change(screen.getByLabelText('分镜来源'), { target: { value: '' } });
    await screen.findByRole('option', { name: /Workshop story/ });
    next();
    expect(screen.getByRole('checkbox', { name: /workshop_preset/ })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /kit_preset/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('分镜来源'), { target: { value: 'kit_new' } });
    await screen.findByRole('option', { name: /Kit story/ });
    next();
    next();
    fireEvent.click(screen.getByRole('button', { name: '添加待命任务' }));
    await waitFor(() => expect(sent()).toHaveLength(3));
    expect(sent()[2].idempotency_key).not.toBe(sent()[1].idempotency_key);
  });
});

it('exports selected storyboards and presets through the kit API without creating documents', async () => {
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/series/source': { ...series, id: 'source', presets: [preset('A'), preset('B')] },
      'POST /api/creation-kits/export': new Response('archive', {
        headers: { 'content-type': 'application/zip' },
      }),
    }),
  );
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:test');
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  renderWithProviders(
    <ExportPicker
      title="Export"
      noun="分镜"
      items={[
        { id: 'first', title: 'First', meta: '' },
        { id: 'second', title: 'Second', meta: '' },
      ]}
      current="first"
      kit={{ seriesId: 'source' }}
      onExport={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText('导出格式'), 'kit');
  await userEvent.click(await screen.findByLabelText('B'));
  await userEvent.click(screen.getByLabelText('Second'));
  await userEvent.clear(screen.getByLabelText('套装名称'));
  await userEvent.type(screen.getByLabelText('套装名称'), 'Selected kit');
  await userEvent.click(screen.getByRole('button', { name: '导出创作套装' }));
  await waitFor(() =>
    expect(calls.some((call) => call.url === '/api/creation-kits/export')).toBe(true),
  );
  expect(calls.filter((call) => call.method !== 'GET')).toEqual([
    {
      method: 'POST',
      url: '/api/creation-kits/export',
      body: {
        series_id: 'source',
        episode_ids: ['first', 'second'],
        preset_ids: ['B'],
        title: 'Selected kit',
      },
    },
  ]);
});
