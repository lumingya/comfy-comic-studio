import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowInspection } from '../../api/system';
import type { WorkflowDocument } from '../../api/types';
import { configWorkflow, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { WorkflowsSection } from './WorkflowsSection';

afterEach(() => vi.unstubAllGlobals());

const inspection: WorkflowInspection = {
  format: 'api',
  importable: true,
  compilable: true,
  bindings: [
    { kind: 'output', node: '9', field: null, qualifier: null, source: 'ext:demo:output' },
  ],
  candidates: [{ kind: 'prompt', node: '6', field: 'text', qualifier: null, source: 'candidate' }],
  missing: ['prompt'],
  output_nodes: ['9'],
  variants: [],
  selected_nodes: ['3', '6', '9'],
  dependencies: [{ class_type: 'SaveImage', nodes: ['9'] }],
  models: [{ node: '1', field: 'ckpt_name', value: 'comic.safetensors' }],
  issues: [{ code: 'dependencies_unchecked', severity: 'info', message: 'unchecked' }],
};

async function upload(container: HTMLElement, value: unknown, name = 'sample.json') {
  const file = new File([JSON.stringify(value)], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => JSON.stringify(value) });
  await userEvent.upload(container.querySelector('input[type="file"]')!, file);
  return screen.findByRole('dialog');
}

describe('workflow import preview', () => {
  it('inspects before saving, keeps detailed reports collapsed, and cancel makes no library write', async () => {
    const calls = mockFetch(configurationRoutes({ 'POST /api/workflows/inspect': inspection }));
    const { container } = renderWithProviders(<WorkflowsSection />);
    const dialog = await upload(container, configWorkflow.graph);
    await within(dialog).findByText('ComfyUI API');
    expect(within(dialog).getByText('尚未绑定：正向提示词')).toBeInTheDocument();
    expect(within(dialog).getByText('查看可能的绑定目标').closest('details')).not.toHaveAttribute(
      'open',
    );
    expect(within(dialog).getByText('原始工作流 JSON').closest('details')).not.toHaveAttribute(
      'open',
    );
    await userEvent.click(within(dialog).getByText('查看完整绑定报告'));
    expect(within(dialog).getByText('ext:demo:output')).toBeVisible();
    await userEvent.click(within(dialog).getByText('节点与模型依赖'));
    expect(within(dialog).getByText('comic.safetensors')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([
      {
        method: 'POST',
        url: '/api/workflows/inspect',
        body: { workflow: configWorkflow.graph, variant: null },
      },
    ]);
  });

  it('saves a Mio package only on confirmation and preserves its graph, advanced config and notes', async () => {
    const bundle = {
      name: 'My workflow',
      graph: configWorkflow.graph,
      config: configWorkflow.config,
      notes: 'Keep this note',
    };
    const calls = mockFetch(
      configurationRoutes({
        'POST /api/workflows/inspect': { ...inspection, format: 'mio' },
        'POST /api/workflows': configWorkflow,
      }),
    );
    const { container } = renderWithProviders(<WorkflowsSection />);
    const dialog = await upload(container, bundle);
    await within(dialog).findByText('Mio 工作流包');
    expect(calls.some((call) => call.url === '/api/workflows' && call.method === 'POST')).toBe(
      false,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: '保存工作流' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      calls.find((call) => call.method === 'POST' && call.url === '/api/workflows')?.body,
    ).toEqual(bundle);
    expect(calls.filter((call) => call.method !== 'GET').map((call) => call.url)).toEqual([
      '/api/workflows/inspect',
      '/api/workflows',
    ]);
  });

  it('gives UI-workflow export instructions in the preview and prevents import', async () => {
    const calls = mockFetch(
      configurationRoutes({
        'POST /api/workflows/inspect': {
          format: 'ui',
          importable: false,
          issues: [{ code: 'ui_format', severity: 'error', message: 'editor JSON' }],
        },
      }),
    );
    const { container } = renderWithProviders(<WorkflowsSection />);
    const dialog = await upload(container, { nodes: [], links: [] });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('导出 (API)');
    expect(within(dialog).getByRole('button', { name: '保存工作流' })).toBeDisabled();
    expect(calls.some((call) => call.url === '/api/workflows' && call.method === 'POST')).toBe(
      false,
    );
  });

  it('lets a failed preview retry without saving and sends the selected output variant', async () => {
    let count = 0;
    const calls = mockFetch(
      configurationRoutes({
        'POST /api/workflows/inspect': () =>
          ++count === 1
            ? new Response(JSON.stringify({ detail: 'preview unavailable' }), { status: 503 })
            : { ...inspection, variants: ['draft', 'final'] },
      }),
    );
    const { container } = renderWithProviders(<WorkflowsSection />);
    const dialog = await upload(container, configWorkflow.graph);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('preview unavailable');
    expect(within(dialog).getByRole('button', { name: '保存工作流' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: '重试' }));
    await userEvent.selectOptions(await within(dialog).findByLabelText('输出变体'), 'draft');
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(3));
    expect(calls.at(-1)?.body).toEqual({ workflow: configWorkflow.graph, variant: 'draft' });
    expect(calls.some((call) => call.url === '/api/workflows' && call.method === 'POST')).toBe(
      false,
    );
  });
});

it('maps outputs to whole nodes and prevents ordinary bindings from replacing links', async () => {
  let doc = structuredClone(configWorkflow);
  doc.graph['8'] = {
    class_type: 'CustomImageOutput',
    inputs: { images: ['3', 0], sizes: [512, 768, 1024] },
  };
  doc.config.mapping = { ...doc.config.mapping, output: '/9/inputs/images' };
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/workflows/wf_demo': () => doc,
      'PATCH /api/workflows/wf_demo': (body: unknown) => (doc = { ...doc, ...(body as object) }),
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  const output = await screen.findByLabelText(/^结果图片节点/);
  expect(output).toHaveValue('/9');
  expect(within(output).getByRole('option', { name: '#8 · CustomImageOutput' })).toHaveValue('/8');
  expect(within(output).queryByRole('option', { name: /→ images/ })).toBeNull();
  const prompt = screen.getByLabelText(/^正向提示词/);
  expect(within(prompt).queryByRole('option', { name: /→ positive/ })).toBeNull();
  expect(within(prompt).queryByRole('option', { name: /→ images/ })).toBeNull();
  expect(within(prompt).getByRole('option', { name: /→ sizes/ })).toHaveValue('/8/inputs/sizes');
  await userEvent.selectOptions(output, '/8');
  await userEvent.selectOptions(screen.getByLabelText(/^过程预览节点/), '/9');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')?.body).toBeDefined());
  const saved = calls.find((call) => call.method === 'PATCH')!.body as Partial<WorkflowDocument>;
  expect(saved.config?.mapping).toMatchObject({ output: '/8', inspect: '/9' });
  expect(saved.graph).toBeUndefined();
  expect(doc.graph['8'].inputs.images).toEqual(['3', 0]);
});

it('diagnoses the chosen branch and displays required inputs, links, ranges and static limits', async () => {
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/workflows/wf_demo': {
        ...configWorkflow,
        describe: { ...configWorkflow.describe, variants: ['draft', 'final'] },
      },
      'POST /api/workflows/wf_demo/diagnose': {
        ok: false,
        instance: 'comfy_test',
        missing_nodes: [],
        missing_models: [],
        invalid_values: [],
        missing_inputs: [{ node: '3', input: 'model', class_type: 'KSampler' }],
        invalid_links: [{ node: '9', input: 'images', target: 'missing', index: 2 }],
        invalid_inputs: [{ node: '3', input: 'steps', reason: 'min=1' }],
        selected_nodes: ['3', '9'],
        variant: 'draft',
        warnings: ['Only this branch'],
        scope: 'static',
        models: {},
      },
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  await screen.findByDisplayValue('测试工作流');
  await userEvent.click(screen.getByRole('button', { name: '诊断' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('输出变体'), 'draft');
  await userEvent.click(within(dialog).getByRole('button', { name: '诊断' }));
  expect(await within(dialog).findByText('#3 缺少必填输入：model')).toBeInTheDocument();
  expect(within(dialog).getByText(/目标 #missing，输出序号 2/)).toBeInTheDocument();
  expect(within(dialog).getByText(/steps 参数无效：min=1/)).toBeInTheDocument();
  expect(within(dialog).getByText(/不会运行插件自定义校验/)).toBeInTheDocument();
  expect(within(dialog).getByText('本次检查 2 个所选分支节点。')).toBeInTheDocument();
  expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ variant: 'draft' });
  fireEvent.change(within(dialog).getByLabelText('输出变体'), { target: { value: 'final' } });
  expect(within(dialog).queryByText('#3 缺少必填输入：model')).toBeNull();
});
