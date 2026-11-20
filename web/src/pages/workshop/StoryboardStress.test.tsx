import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Episode, Panel } from '../../api/types';
import { confirm } from '../../components/confirm';
import { useToasts } from '../../components/toast';
import { configSummary } from '../../test/configuration';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { workflowLoras } from '../../test/workflowLoras';
import StoryboardEditor from './StoryboardEditor';

let ep: Episode;
vi.mock('../../components/confirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../episode/EpisodePage', () => ({ useEpisodeContext: () => ({ episode: ep, series }) }));
const rows = () => [
  ...document.querySelectorAll<HTMLButtonElement>('.workshop-frames-list [data-selection-id]'),
];
const ids = () => rows().map((row) => row.dataset.selectionId);
const prompt = () => document.getElementById('workshop-frame-prompt') as HTMLTextAreaElement;
const editor = () => document.querySelector('[data-editor-key]');
const orderUrl = '/api/episodes/sb_stress/panels/reorder';
type FrameDraft = Pick<Panel, 'description' | 'overrides' | 'dialogues'>;

beforeEach(() => {
  vi.mocked(confirm).mockResolvedValue(true);
  for (const item of useToasts.getState().items) useToasts.getState().dismiss(item.id);
  ep = structuredClone(episode);
  ep.id = 'sb_stress';
  ep.panels = Array.from({ length: 120 }, (_, i) => ({
    ...structuredClone(episode.panels[0]),
    id: `p${i}`,
    order: i,
    description: `Frame${String(i).padStart(3, '0')}`,
    dialogues: [],
    overrides: {
      ...structuredClone(episode.panels[0].overrides),
      raw_prompt: i % 3 === 0 ? '{character} in the hall' : i % 3 === 1 ? `scene ${i}` : '',
      slot_overrides: {
        workflow_id: 'wf_demo',
        groups: [
          {
            key: 'group',
            loras: [{ key: 'ink', name: 'ink.safetensors', enabled: i % 2 === 0, strength: 0.7 }],
          },
        ],
      },
    },
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function patchFrame(id: string, changes: FrameDraft): Episode {
  ep = {
    ...ep,
    revision: ep.revision + 1,
    panels: ep.panels.map((panel) => (panel.id === id ? { ...panel, ...changes } : panel)),
  };
  return structuredClone(ep);
}
function start(extra: Parameters<typeof mockFetch>[0] = {}) {
  const calls = mockFetch({
    'GET /api/workshop': series,
    'GET /api/workflows': [configSummary],
    'GET /api/workflows/wf_demo/loras': workflowLoras,
    'PATCH /api/episodes/sb_stress/panels/p0': (body: unknown) =>
      patchFrame('p0', (body as { changes: FrameDraft }).changes),
    [`POST ${orderUrl}`]: (body: unknown) => {
      const { order } = body as { order: string[] };
      ep = {
        ...ep,
        panels: ep.panels.map((panel) => ({ ...panel, order: order.indexOf(panel.id!) })),
      };
      return ep;
    },
    ...extra,
  });
  renderWithProviders(<StoryboardEditor />);
  return calls;
}

async function liftFirstFrame() {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.matches('.workshop-frame-row')) return measure.call(this);
    const index = [...this.parentElement!.querySelectorAll('.workshop-frame-row')].indexOf(this);
    return new DOMRect(0, index * 52, 200, 46);
  });
  const handle = screen.getByRole('button', { name: /^移动第 1 幕/ });
  handle.focus();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(handle).toHaveAttribute('aria-pressed', 'true');
  return handle;
}

describe('120-frame storyboard data consistency', () => {
  it('filters and searches all frames without changing the active draft or persisting a partial list', () => {
    const calls = start();
    expect(rows()).toHaveLength(120);
    fireEvent.change(prompt(), { target: { value: 'pending local text' } });
    const filter = screen.getByRole('combobox', { name: '筛选分幕' });
    fireEvent.change(filter, { target: { value: 'empty' } });
    expect(rows()).toHaveLength(40);
    expect(ids()).toEqual(Array.from({ length: 40 }, (_, i) => `p${i * 3 + 2}`));
    fireEvent.change(filter, { target: { value: 'variables' } });
    expect(ids()).toEqual(Array.from({ length: 40 }, (_, i) => `p${i * 3}`));
    fireEvent.change(filter, { target: { value: 'all' } });
    const search = screen.getByRole('searchbox', { name: '搜索分幕…' });
    fireEvent.change(search, { target: { value: 'fRaMe119' } });
    expect(ids()).toEqual(['p119']);
    expect(screen.queryByRole('button', { name: /^移动第/ })).not.toBeInTheDocument();
    expect(editor()).toHaveAttribute('data-editor-key', 'p0');
    expect(prompt()).toHaveValue('pending local text');
    fireEvent.change(search, { target: { value: '' } });
    expect(rows()).toHaveLength(120);
    expect(ep.panels).toHaveLength(120);
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  });

  it('serializes edits made during an in-flight save before opening frame 120', async () => {
    const pending: { changes: FrameDraft; finish: (value: Episode) => void }[] = [];
    const calls = start({
      'PATCH /api/episodes/sb_stress/panels/p0': (body: unknown) =>
        new Promise<Episode>((finish) => {
          pending.push({ changes: (body as { changes: FrameDraft }).changes, finish });
        }),
    });
    const originalSlots = structuredClone(ep.panels[0].overrides.slot_overrides);
    fireEvent.change(prompt(), { target: { value: 'first draft' } });
    fireEvent.blur(prompt());
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(prompt(), { target: { value: 'newer draft while saving' } });
    fireEvent.click(rows()[119]);
    expect(editor()).toHaveAttribute('data-editor-key', 'p0');
    expect(pending).toHaveLength(1);
    await act(async () => pending[0].finish(patchFrame('p0', pending[0].changes)));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].changes.overrides.raw_prompt).toBe('newer draft while saving');
    expect(pending[1].changes.overrides.slot_overrides).toEqual(originalSlots);
    expect(editor()).toHaveAttribute('data-editor-key', 'p0');
    await act(async () => pending[1].finish(patchFrame('p0', pending[1].changes)));
    await waitFor(() => expect(editor()).toHaveAttribute('data-editor-key', 'p119'));
    expect(ep.panels[0].overrides.raw_prompt).toBe('newer draft while saving');
    expect(ep.panels[119].overrides.raw_prompt).toBe('');
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2);
    expect(ep.panels).toHaveLength(120);
  });

  it('flushes a pending edit before a keyboard drag and sends the complete 120-frame order', async () => {
    const original = structuredClone(ep.panels);
    const calls = start();
    fireEvent.change(prompt(), { target: { value: 'saved before long-list drag' } });
    const handle = await liftFirstFrame();
    fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
    await screen.findByText('当前位置为第 2 幕。');
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    const expected = ['p1', 'p0', ...original.slice(2).map((panel) => panel.id!)];
    await waitFor(() => expect(ids()).toEqual(expected));
    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes.map((call) => call.url)).toEqual(['/api/episodes/sb_stress/panels/p0', orderUrl]);
    expect(writes[1].body).toMatchObject({ order: expected });
    expect(new Set((writes[1].body as { order: string[] }).order).size).toBe(120);
    expect(ep.panels[0].overrides.raw_prompt).toBe('saved before long-list drag');
    expect(editor()).toHaveAttribute('data-editor-key', 'p0');
    expect(ep.panels.map((panel) => panel.overrides.slot_overrides)).toEqual(
      original.map((panel) => panel.overrides.slot_overrides),
    );
  });

  it('restores a 40-frame range deletion with its saved draft, position and distinct LoRA overrides', async () => {
    const original = structuredClone(ep.panels);
    const calls = start({
      'POST /api/episodes/sb_stress/panels/batch-delete': (body: unknown) => {
        const { panel_ids } = body as { panel_ids: string[] };
        ep = { ...ep, panels: ep.panels.filter((panel) => !panel_ids.includes(panel.id!)) };
        return ep;
      },
      'POST /api/episodes/sb_stress/panels/import': (body: unknown) => {
        const { panels } = body as { panels: Panel[] };
        ep = {
          ...ep,
          panels: [
            ...ep.panels,
            ...panels.map((panel, i) => ({ ...panel, id: `restored${i}`, order: 120 + i })),
          ],
        };
        return ep;
      },
    });
    fireEvent.change(prompt(), { target: { value: 'latest text before deleting range' } });
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.click(rows()[39], { shiftKey: true });
    rows()[39].focus();
    fireEvent.keyDown(rows()[39], { key: 'Delete' });
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() => expect(ep.panels).toHaveLength(80));
    await waitFor(() =>
      expect(useToasts.getState().items.some((item) => item.text === '已删除 40 幕分镜')).toBe(
        true,
      ),
    );
    const undo = useToasts.getState().items.find((item) => item.text === '已删除 40 幕分镜')!;
    act(() => undo.action!.onClick());
    const expected = [
      ...Array.from({ length: 40 }, (_, i) => `restored${i}`),
      ...original.slice(40).map((panel) => panel.id!),
    ];
    await waitFor(() => expect(ids()).toEqual(expected));
    expect(calls.find((call) => call.url === orderUrl)?.body).toMatchObject({ order: expected });
    const restored = [...ep.panels].sort((a, b) => a.order - b.order);
    expect(restored).toHaveLength(120);
    expect(restored[0].overrides.raw_prompt).toBe('latest text before deleting range');
    expect(restored.map((panel) => panel.overrides.slot_overrides)).toEqual(
      original.map((panel) => panel.overrides.slot_overrides),
    );
  });

  it('changes the first scene LoRA without contaminating the other 119 scenes', async () => {
    const originals = structuredClone(ep.panels.slice(1));
    const calls = start();
    fireEvent.click(screen.getByText('此幕画面参数'));
    fireEvent.click(screen.getByText('本幕的 LoRA'));
    const toggle = await screen.findByRole('combobox', { name: 'ink.safetensors' });
    expect(toggle).toHaveValue('on');
    fireEvent.change(toggle, { target: { value: 'off' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(ep.panels[0].overrides.slot_overrides).toMatchObject({
        workflow_id: 'wf_demo',
        groups: [{ key: 'group', loras: [{ key: 'ink', enabled: false, strength: 0.7 }] }],
      }),
    );
    expect(ep.panels.slice(1)).toEqual(originals);
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });
});
