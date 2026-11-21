import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkflowInspection } from '../../api/system';
import { configWorkflow, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { WorkflowsSection } from './WorkflowsSection';

afterEach(() => vi.unstubAllGlobals());

const report: WorkflowInspection = {
  format: 'api',
  importable: true,
  compilable: true,
  bindings: [{ kind: 'prompt', node: '6', field: 'text', source: 'heuristic' }],
  candidates: [{ kind: 'ref', node: '8', field: 'image', source: 'candidate' }],
  variants: ['draft', 'final'],
  missing: [],
  output_nodes: ['9'],
  selected_nodes: ['6', '9'],
  dependencies: [],
  models: [],
  issues: [],
};

async function upload(container: HTMLElement, workflow: unknown) {
  const text = JSON.stringify(workflow);
  const file = new File([text], 'synthetic.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  await userEvent.upload(container.querySelector('input[type="file"]')!, file);
  return screen.findByRole('dialog');
}

it.each(['graph', 'prompt', 'workflow'])(
  'preserves a raw API graph whose node ID is %s in both inspection and save',
  async (id) => {
    const graph = structuredClone(configWorkflow.graph);
    graph[id] = graph['6'];
    delete graph['6'];
    graph['3'].inputs.positive = [id, 0];
    const calls = mockFetch(
      configurationRoutes({
        'POST /api/workflows/inspect': {
          ...report,
          bindings: [{ kind: 'prompt', node: id, field: 'text', source: 'heuristic' }],
        },
        'POST /api/workflows': configWorkflow,
      }),
    );
    const { container } = renderWithProviders(<WorkflowsSection />);
    const dialog = await upload(container, graph);
    await within(dialog).findByText('ComfyUI API');
    await userEvent.click(within(dialog).getByText('调整参数映射'));
    await userEvent.click(within(dialog).getByRole('combobox', { name: '正向提示词' }));
    expect(screen.getByRole('option', { name: `#${id} · CLIPTextEncode → text` })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(dialog).getByRole('button', { name: '保存工作流' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((call) => call.url === '/api/workflows/inspect')?.body).toEqual({
      workflow: graph,
      variant: null,
    });
    expect(
      calls.find((call) => call.url === '/api/workflows' && call.method === 'POST')?.body,
    ).toEqual({
      name: 'synthetic',
      graph,
      notes: '',
    });
  },
);

it('blocks manual and detected mapping edits until the selected variant report arrives', async () => {
  let finishVariant!: (value: unknown) => void;
  let pending = true;
  const calls = mockFetch(
    configurationRoutes({
      'POST /api/workflows/inspect': (body: unknown) => {
        const variant = (body as { variant: string | null }).variant;
        if (variant === 'final' && pending) {
          pending = false;
          return new Promise((resolve) => {
            finishVariant = resolve;
          });
        }
        return {
          ...report,
          bindings: [
            {
              kind: 'prompt',
              node: variant === 'final' ? '7' : '6',
              field: 'text',
              source: 'heuristic',
            },
          ],
        };
      },
    }),
  );
  const { container } = renderWithProviders(<WorkflowsSection />);
  const dialog = await upload(container, configWorkflow.graph);
  await userEvent.click(await within(dialog).findByText('调整参数映射'));
  await userEvent.selectOptions(within(dialog).getByLabelText('输出变体'), 'final');
  const adopt = within(dialog).getByRole('button', { name: '采纳识别结果' });
  expect(adopt).toBeDisabled();
  expect(within(dialog).getByRole('combobox', { name: '正向提示词' })).toBeDisabled();
  expect(within(dialog).getByRole('status')).toHaveTextContent('加载中');
  expect(within(dialog).getByRole('button', { name: '保存工作流' })).toBeDisabled();
  await userEvent.click(adopt);
  expect(calls.filter((call) => call.url === '/api/workflows/inspect')).toHaveLength(2);
  finishVariant({
    ...report,
    bindings: [{ kind: 'prompt', node: '7', field: 'text', source: 'heuristic' }],
  });
  await waitFor(() => expect(adopt).toBeEnabled());
  await userEvent.click(adopt);
  await waitFor(() =>
    expect(calls.filter((call) => call.url === '/api/workflows/inspect')).toHaveLength(3),
  );
  const last = calls.filter((call) => call.url === '/api/workflows/inspect').at(-1)?.body;
  expect(last).toMatchObject({
    variant: 'final',
    workflow: { graph: configWorkflow.graph, config: { mapping: { prompt: '/7/inputs/text' } } },
  });
  // Image role suggestions require an explicit choice and never join detected mappings.
  expect(
    (last as { workflow: { config: { mapping: object } } }).workflow.config.mapping,
  ).not.toHaveProperty('ref');
});
