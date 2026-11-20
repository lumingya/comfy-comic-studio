import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { configSummary } from '../../test/configuration';
import { workflowLoras } from '../../test/workflowLoras';
import type { Episode } from '../../api/types';
import { useToasts } from '../../components/toast';
import StoryboardEditor from './StoryboardEditor';
const toasts = () => useToasts.getState().items.map((i) => i.text);
let ep: Episode;
vi.mock('../../components/confirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../episode/EpisodePage', () => ({ useEpisodeContext: () => ({ episode: ep, series }) }));
beforeEach(() => {
  for (const item of useToasts.getState().items) useToasts.getState().dismiss(item.id);
  ep = structuredClone(episode);
  ep.id = 'sb_test';
});
afterEach(() => {
  const measure = HTMLElement.prototype.getBoundingClientRect;
  if (vi.isMockFunction(measure)) measure.mockRestore();
  vi.unstubAllGlobals();
});
const prompt = () => document.getElementById('workshop-frame-prompt') as HTMLTextAreaElement;
const negative = () => document.getElementById('workshop-frame-negative') as HTMLTextAreaElement;
const rows = () => [
  ...document.querySelectorAll<HTMLButtonElement>('.workshop-frames-list [data-selection-id]'),
];
function start(fail = false, routes: Parameters<typeof mockFetch>[0] = {}) {
  const calls = mockFetch({
    'GET /api/workshop': series,
    'PATCH /api/episodes/sb_test/panels/p0': (body: unknown) => {
      if (fail) return new Response(JSON.stringify({ detail: 'offline' }), { status: 503 });
      const changes = (body as { changes: object }).changes;
      ep = {
        ...ep,
        revision: ep.revision + 1,
        panels: ep.panels.map((p) => (p.id === 'p0' ? { ...p, ...changes } : p)),
      };
      return ep;
    },
    ...routes,
  });
  renderWithProviders(<StoryboardEditor />);
  return calls;
}
describe('storyboard editing recovery', () => {
  it('saves a workflow-specific scene LoRA and can restore task inheritance', async () => {
    ep.panels[0].overrides.slot_overrides = { model: 'manual.safetensors' };
    const calls = start(false, {
      'GET /api/workflows': [configSummary],
      'GET /api/workflows/wf_demo/loras': workflowLoras,
    });
    fireEvent.click(screen.getByText('此幕画面参数'));
    fireEvent.click(screen.getByText('本幕的 LoRA'));
    const workflow = await screen.findByRole('combobox', { name: '覆写适用的工作流' });
    await waitFor(() => expect(workflow).toBeEnabled());
    fireEvent.change(workflow, { target: { value: 'wf_demo' } });
    const toggle = await screen.findByRole('combobox', { name: 'ink.safetensors' });
    expect(toggle).toHaveValue('inherit');
    fireEvent.change(toggle, { target: { value: 'on' } });
    const strength = screen.getByRole('spinbutton', { name: 'ink.safetensors 模型强度' });
    fireEvent.change(strength, { target: { value: '0.8' } });
    fireEvent.change(strength, { target: { value: '0.65' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(ep.panels[0].overrides.slot_overrides).toEqual({
        model: 'manual.safetensors',
        workflow_id: 'wf_demo',
        groups: [
          {
            key: 'group',
            loras: [{ key: 'ink', name: 'ink.safetensors', enabled: true, strength: 0.65 }],
          },
        ],
      }),
    );
    expect(ep.panels[1].overrides.slot_overrides).toEqual({});
    fireEvent.change(toggle, { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(ep.panels[0].overrides.slot_overrides).toEqual({ model: 'manual.safetensors' }),
    );
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2);
  });

  it('resizes the frame list without changing the active frame or saving story content', () => {
    const calls = start();
    const handle = screen.getByRole('separator');
    const before = Number(handle.getAttribute('aria-valuenow'));
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', String(before + 10));
    expect(document.querySelector('[data-editor-key]')).toHaveAttribute('data-editor-key', 'p0');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    fireEvent.keyDown(handle, { key: 'Enter' });
  });
  it('saves prompt and negative from one coherent draft instead of overwriting the previous override', async () => {
    const calls = start();
    fireEvent.change(prompt(), { target: { value: 'new prompt' } });
    fireEvent.change(negative(), { target: { value: 'new negative' } });
    fireEvent.blur(negative());
    await waitFor(() => expect(ep.panels[0].overrides.raw_negative).toBe('new negative'));
    expect(ep.panels[0].overrides.raw_prompt).toBe('new prompt');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });
  it('flushes the last keystroke before switching frames', async () => {
    start();
    fireEvent.change(prompt(), { target: { value: 'last keystroke' } });
    fireEvent.click(rows()[1]);
    await waitFor(() =>
      expect(document.querySelector('[data-editor-key]')).toHaveAttribute('data-editor-key', 'p1'),
    );
    expect(ep.panels[0].overrides.raw_prompt).toBe('last keystroke');
  });
  it('stays on the original frame with its input when saving fails', async () => {
    const calls = start(true);
    fireEvent.change(prompt(), { target: { value: 'keep me' } });
    fireEvent.click(rows()[1]);
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').length).toBeGreaterThan(0),
    );
    await screen.findByText(/保存失败/);
    expect(document.querySelector('[data-editor-key]')).toHaveAttribute('data-editor-key', 'p0');
    expect(prompt()).toHaveValue('keep me');
  });
  it('filters visible frame rows without losing frames or changing the open editor', () => {
    ep.panels[0].description = 'Doorway';
    ep.panels[0].overrides.raw_prompt = '{character} waits';
    ep.panels[1].dialogues = [];
    ep.panels[1].overrides.raw_prompt = '';
    start();

    fireEvent.change(screen.getByRole('combobox', { name: '筛选分幕' }), {
      target: { value: 'empty' },
    });
    expect(rows().map((row) => row.dataset.selectionId)).toEqual(['p1']);
    expect(document.querySelector('[data-editor-key]')).toHaveAttribute('data-editor-key', 'p0');

    fireEvent.change(screen.getByRole('combobox', { name: '筛选分幕' }), {
      target: { value: 'variables' },
    });
    expect(rows().map((row) => row.dataset.selectionId)).toEqual(['p0']);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索分幕…' }), {
      target: { value: 'doorway' },
    });
    expect(rows().map((row) => row.dataset.selectionId)).toEqual(['p0']);

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索分幕…' }), {
      target: { value: 'no match' },
    });
    expect(screen.getByText('没有符合条件的分幕。')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: /^移动第/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索分幕…' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '筛选分幕' }), {
      target: { value: 'all' },
    });
    expect(rows()).toHaveLength(2);
    expect(document.querySelector('[data-editor-key]')).toHaveAttribute('data-editor-key', 'p0');
  });
  it('edits the caption it displays rather than creating a second, contradictory line', async () => {
    start();
    const text = document.getElementById('workshop-frame-caption')!;
    fireEvent.change(text, { target: { value: 'new dialogue' } });
    fireEvent.blur(text);
    await waitFor(() => expect(ep.panels[0].dialogues[0].text).toBe('new dialogue'));
    expect(ep.panels[0].dialogues).toHaveLength(1);
    expect(ep.panels[0].dialogues[0].kind).toBe('speech');
  });
  it('expands unsaved frame variables, leaving escaped braces plain and marking missing values', async () => {
    ep.panels[0].overrides.values = { $preview_label: '{description} near {scene}' };
    const calls = start();
    fireEvent.change(screen.getByRole('textbox', { name: '分幕名称' }), {
      target: { value: 'The doorway' },
    });
    fireEvent.change(prompt(), {
      target: { value: '{preview_label}, {{escaped}}, {unknown}' },
    });
    fireEvent.change(negative(), { target: { value: 'Avoid {character}' } });
    fireEvent.change(document.getElementById('workshop-frame-caption')!, {
      target: { value: 'We arrived at {scene}.' },
    });
    const summary = screen.getByText('变量展开预览');
    const preview = within(summary.closest('details')!);
    fireEvent.click(summary);
    expect(await preview.findByText(/The doorway near convenience store/)).toHaveTextContent(
      'The doorway near convenience store, {escaped}, {unknown}',
    );
    expect(preview.getByText('{unknown}', { selector: 'mark' })).toHaveAttribute(
      'title',
      '当前分镜没有定义此变量',
    );
    expect(preview.getByText('{character}', { selector: 'mark' })).toHaveAttribute(
      'title',
      '此变量在当前分镜中没有值',
    );
    expect(preview.queryByText('{escaped}', { selector: 'mark' })).not.toBeInTheDocument();
    expect(preview.getByText('We arrived at convenience store.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
  it('gives frame right-click a temporary target and supports range selection plus Escape', () => {
    start();
    fireEvent.contextMenu(rows()[1]);
    expect(rows()[1]).toHaveClass('is-context');
    expect(rows()[1]).not.toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(rows()[1]).toHaveFocus();
    expect(rows()[1]).not.toHaveClass('is-context');
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.click(rows()[1], { shiftKey: true });
    expect(rows().filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(2);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(rows().filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(0);
  });
});

describe('sorting storyboard frames', () => {
  const orderUrl = '/api/episodes/sb_test/panels/reorder';
  const routes = {
    [`POST ${orderUrl}`]: (body: unknown) => {
      const { order } = body as { order: string[] };
      ep = {
        ...ep,
        panels: ep.panels.map((panel) => ({ ...panel, order: order.indexOf(panel.id!) })),
      };
      return ep;
    },
  };

  async function liftFirstFrame() {
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (!this.matches('.workshop-frame-row')) return getRect.call(this);
      const index = [...this.parentElement!.querySelectorAll('.workshop-frame-row')].indexOf(this);
      return new DOMRect(0, index * 52, 200, 46);
    });
    const handle = screen.getByRole('button', { name: /^移动第 1 幕/ });
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    // The sensor waits one task before listening on the document to avoid handling pickup twice.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handle).toHaveAttribute('aria-pressed', 'true');
    return handle;
  }

  it('persists a keyboard drop after flushing the draft, keeping the editor on the same frame', async () => {
    const calls = start(false, routes);
    fireEvent.change(prompt(), { target: { value: 'save before reordering' } });
    const handle = await liftFirstFrame();
    fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
    await screen.findByText('当前位置为第 2 幕。');
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await waitFor(() => expect(rows().map((row) => row.dataset.selectionId)).toEqual(['p1', 'p0']));
    expect(calls.map((call) => call.url)).toEqual(['/api/episodes/sb_test/panels/p0', orderUrl]);
    expect(calls[1].body).toMatchObject({ order: ['p1', 'p0'] });
    expect(ep.panels[0].overrides.raw_prompt).toBe('save before reordering');
    expect(document.querySelector('[data-editor-key]')).toHaveAttribute('data-editor-key', 'p0');
    expect(handle).toHaveFocus();
  });

  it('cancels a keyboard drag without clearing the current multiselection or writing the order', async () => {
    const calls = start(false, routes);
    fireEvent.click(rows()[1], { ctrlKey: true });
    const handle = await liftFirstFrame();
    fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
    await screen.findByText('当前位置为第 2 幕。');
    fireEvent.keyDown(handle, { key: 'Escape', code: 'Escape' });
    await screen.findByText('已取消移动。');
    expect(rows()[1]).toHaveAttribute('aria-selected', 'true');
    expect(calls).toHaveLength(0);
  });

  it('leaves the order and draft available for retry when saving fails before a drop', async () => {
    const calls = start(true, routes);
    fireEvent.change(prompt(), { target: { value: 'pending change' } });
    const handle = await liftFirstFrame();
    fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown' });
    await screen.findByText('当前位置为第 2 幕。');
    fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
    await screen.findByText(/保存失败/);
    expect(calls.every((call) => call.url !== orderUrl)).toBe(true);
    expect(rows().map((row) => row.dataset.selectionId)).toEqual(['p0', 'p1']);
    expect(prompt()).toHaveValue('pending change');
  });
});

describe('adding frames (legacy workshop-add-frame / batchFramesModal)', () => {
  const routes = () => ({
    'GET /api/workshop': series,
    'POST /api/episodes/sb_test/panels': (body: unknown) => {
      const { panel } = body as { panel: { description: string } };
      ep = {
        ...ep,
        panels: [...ep.panels, { ...ep.panels[0], id: 'p_new', order: 99, ...panel }],
      };
      return ep;
    },
    'POST /api/episodes/sb_test/panels/import': (body: unknown) => {
      const { panels } = body as { panels: { description: string }[] };
      ep = {
        ...ep,
        panels: [
          ...ep.panels,
          ...panels.map((p, i) => ({ ...ep.panels[0], id: `p_b${i}`, order: 10 + i, ...p })),
        ],
      };
      return ep;
    },
    'PATCH /api/episodes/sb_test': (body: unknown) => {
      ep = { ...ep, ...(body as object) };
      return ep;
    },
  });

  it('「新增分幕」 appends a blank 「第 N 幕」 at the end, even with an earlier frame open', async () => {
    const calls = mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(screen.getByRole('button', { name: '新增分幕' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({
      after: null,
      panel: { description: '第 3 幕', overrides: { raw_prompt: '' } },
    });
  });

  it('prefills the common prompt start, appends the batch and remembers the template', async () => {
    ep.panels = ep.panels.map((p, i) => ({
      ...p,
      overrides: { ...p.overrides, raw_prompt: `{character}, {style}, shot ${i}` },
    }));
    const calls = mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(screen.getByRole('button', { name: '批量新增…' }));
    const dialog = await screen.findByRole('dialog', { name: '批量新增分幕' });
    expect(dialog).toHaveTextContent('最多还可新增 510 幕。');
    expect(document.getElementById('batch-frames-base')).toHaveValue('{character}, {style}, ');
    expect(dialog).toHaveTextContent('已按现有分幕的共同开头预填。');
    fireEvent.change(document.getElementById('batch-frames-count')!, { target: { value: '2' } });
    fireEvent.change(document.getElementById('batch-frames-pattern')!, {
      target: { value: '镜头 {n}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '新增分幕' }));
    await waitFor(() => expect(ep.base_prompt).toBe('{character}, {style}, '));
    const imported = calls.find((c) => c.url.endsWith('/panels/import'))!;
    expect(imported.body).toEqual({
      after: null,
      panels: [
        { description: '镜头 3', overrides: { raw_prompt: '{character}, {style}, ' } },
        { description: '镜头 4', overrides: { raw_prompt: '{character}, {style}, ' } },
      ],
    });
    await waitFor(() => expect(toasts()).toContain('已新增 2 个分幕'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses a count beyond the frames left', async () => {
    mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(screen.getByRole('button', { name: '批量新增…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(document.getElementById('batch-frames-count')!, { target: { value: '600' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('最多还可新增 510 幕。');
    expect(within(dialog).getByRole('button', { name: '新增分幕' })).toBeDisabled();
  });
});

describe('负向「应用到所有分幕」', () => {
  it('saves the open frame first, then applies the typed negative to every frame', async () => {
    const order: string[] = [];
    mockFetch({
      'GET /api/workshop': series,
      'PATCH /api/episodes/sb_test/panels/p0': (body: unknown) => {
        order.push('patch');
        const changes = (body as { changes: { overrides?: object } }).changes;
        ep = {
          ...ep,
          panels: ep.panels.map((p) =>
            p.id === 'p0' ? { ...p, overrides: { ...p.overrides, ...changes.overrides } } : p,
          ),
        };
        return ep;
      },
      'POST /api/episodes/sb_test/panels/batch': (body: unknown) => {
        order.push('batch');
        const { changes } = body as { changes: { overrides: object } };
        ep = {
          ...ep,
          panels: ep.panels.map((p) => ({
            ...p,
            overrides: { ...p.overrides, ...changes.overrides },
          })),
        };
        return ep;
      },
    });
    renderWithProviders(<StoryboardEditor />);
    fireEvent.change(prompt(), { target: { value: 'typed prompt' } });
    fireEvent.change(negative(), { target: { value: 'blurry' } });
    fireEvent.click(screen.getByRole('button', { name: '应用到所有分幕' }));
    await waitFor(() => expect(toasts()).toContain('负向提示词已应用到 2 个分幕'));
    expect(order).toEqual(['patch', 'batch']);
    expect(ep.panels.map((p) => p.overrides.raw_negative)).toEqual(['blurry', 'blurry']);
    expect(ep.panels[0].overrides.raw_prompt).toBe('typed prompt');
  });
});

describe('bulk delete (legacy workshop-frame-delete-bulk)', () => {
  const routes = () => ({
    'GET /api/workshop': series,
    'POST /api/episodes/sb_test/panels/batch-delete': (body: unknown) => {
      const { panel_ids } = body as { panel_ids: string[] };
      ep = { ...ep, panels: ep.panels.filter((p) => !panel_ids.includes(p.id!)) };
      return ep;
    },
    'POST /api/episodes/sb_test/panels/import': (body: unknown) => {
      const { panels } = body as { panels: object[] };
      ep = {
        ...ep,
        panels: [
          ...ep.panels,
          ...panels.map(
            (p, i) => ({ ...p, id: `back${i}`, order: 50 + i }) as Episode['panels'][0],
          ),
        ],
      };
      return ep;
    },
    'POST /api/episodes/sb_test/panels/reorder': (body: unknown) => {
      const { order } = body as { order: string[] };
      ep = {
        ...ep,
        panels: ep.panels.map((p) => ({ ...p, order: order.indexOf(p.id!) })),
      };
      return ep;
    },
  });

  it('refuses to delete every frame', async () => {
    const calls = mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.click(rows()[1], { shiftKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await waitFor(() => expect(toasts()).toContain('分镜至少保留一幕。'));
    expect(calls.some((c) => c.url.includes('batch-delete'))).toBe(false);
  });

  it('can be undone: the frames come back where they were', async () => {
    const calls = mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await waitFor(() => expect(toasts()).toContain('已删除 1 幕分镜'));
    const undo = useToasts.getState().items.find((i) => i.text === '已删除 1 幕分镜')!;
    undo.action!.onClick();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/panels/reorder'))).toBe(true));
    const reorder = calls.find((c) => c.url.endsWith('/panels/reorder'))!;
    expect(reorder.body).toMatchObject({ order: ['back0', 'p1'] });
  });

  it('restores the last edit saved immediately before deleting a frame', async () => {
    const calls = mockFetch({
      ...routes(),
      'PATCH /api/episodes/sb_test/panels/p0': (body: unknown) => {
        const changes = (body as { changes: object }).changes;
        ep = {
          ...ep,
          panels: ep.panels.map((p) => (p.id === 'p0' ? { ...p, ...changes } : p)),
        };
        return ep;
      },
    });
    renderWithProviders(<StoryboardEditor />);
    fireEvent.change(prompt(), { target: { value: 'last edit before deletion' } });
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await waitFor(() => expect(ep.panels).toHaveLength(1));
    await waitFor(() => expect(toasts()).toContain('已删除 1 幕分镜'));
    const undo = useToasts.getState().items.find((i) => i.text === '已删除 1 幕分镜')!;
    undo.action!.onClick();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/panels/reorder'))).toBe(true));
    expect(ep.panels.find((p) => p.id === 'back0')?.overrides.raw_prompt).toBe(
      'last edit before deletion',
    );
  });

  it('keeps the frame and its draft if saving the undo snapshot fails', async () => {
    const calls = mockFetch({
      ...routes(),
      'PATCH /api/episodes/sb_test/panels/p0': () =>
        new Response(JSON.stringify({ detail: 'offline' }), { status: 503 }),
    });
    renderWithProviders(<StoryboardEditor />);
    fireEvent.change(prompt(), { target: { value: 'unsaved edit' } });
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await screen.findByText(/保存失败/);
    expect(calls.some((c) => c.url.endsWith('/panels/batch-delete'))).toBe(false);
    expect(ep.panels).toHaveLength(2);
    expect(prompt()).toHaveValue('unsaved edit');
  });
});

describe('starting templates and pending drafts', () => {
  it('fills only prompts still empty after the active draft has been saved', async () => {
    ep.base_prompt = 'starting template';
    const calls = mockFetch({
      'GET /api/workshop': series,
      'PATCH /api/episodes/sb_test/panels/p0': (body: unknown) => {
        const changes = (body as { changes: object }).changes;
        ep = {
          ...ep,
          panels: ep.panels.map((p) => (p.id === 'p0' ? { ...p, ...changes } : p)),
        };
        return ep;
      },
      'PATCH /api/episodes/sb_test/panels/p1': (body: unknown) => {
        const changes = (body as { changes: { overrides: object } }).changes;
        ep = {
          ...ep,
          panels: ep.panels.map((p) =>
            p.id === 'p1' ? { ...p, overrides: { ...p.overrides, ...changes.overrides } } : p,
          ),
        };
        return ep;
      },
      'POST /api/episodes/sb_test/panels/batch': (body: unknown) => {
        const { panel_ids, changes } = body as {
          panel_ids: string[];
          changes: { overrides: object };
        };
        ep = {
          ...ep,
          panels: ep.panels.map((p) =>
            panel_ids.includes(p.id!)
              ? { ...p, overrides: { ...p.overrides, ...changes.overrides } }
              : p,
          ),
        };
        return ep;
      },
    });
    renderWithProviders(<StoryboardEditor />);
    fireEvent.change(prompt(), { target: { value: 'newly written prompt' } });
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.click(rows()[1], { shiftKey: true });
    fireEvent.contextMenu(rows()[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: /为 2 幕空白提示词插入起手模板/ }));
    await waitFor(() => expect(ep.panels[1].overrides.raw_prompt).toBe('starting template'));
    expect(ep.panels[0].overrides.raw_prompt).toBe('newly written prompt');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
    expect(calls.some((c) => c.url.endsWith('/panels/batch'))).toBe(false);
  });
});
