import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkflowDocument } from '../../api/types';
import { configWorkflow, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { WorkflowsSection } from './WorkflowsSection';

afterEach(() => vi.unstubAllGlobals());

it('binds a plugin parameter to multiple inputs while preserving links, unknown config and other targets', async () => {
  let doc = structuredClone(configWorkflow);
  doc.graph['42'] = {
    class_type: 'ThirdPartyControl',
    _meta: { title: '角色控制' },
    inputs: { strength: 0.8, model: ['3', 0] },
  };
  doc.graph['43'] = {
    class_type: 'ThirdPartyControl',
    _meta: { title: '背景控制' },
    inputs: { strength: 0.6 },
  };
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/workflows/wf_demo': () => doc,
      'PATCH /api/workflows/wf_demo': (body: unknown) => (doc = { ...doc, ...(body as object) }),
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  const parameter = await screen.findByRole('textbox', {
    name: '参数名，例如 steps 或 control_strength',
  });
  await userEvent.type(parameter, 'control_strength');
  await userEvent.click(screen.getByRole('button', { name: '添加参数' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'control_strength' }));
  await userEvent.type(
    screen.getByRole('combobox', { name: '搜索control_strength' }),
    '角色 strength',
  );
  expect(screen.getAllByRole('option')).toHaveLength(1);
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('combobox', { name: '为control_strength添加目标' }));
  await userEvent.type(
    screen.getByRole('combobox', { name: '搜索为control_strength添加目标' }),
    '43',
  );
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')).toBeDefined());
  const patch = calls.find((call) => call.method === 'PATCH')!.body as Partial<WorkflowDocument>;
  expect(patch.config).toEqual({
    ...configWorkflow.config,
    mapping: {
      ...configWorkflow.config.mapping,
      control_strength: ['/42/inputs/strength', '/43/inputs/strength'],
    },
  });
  expect(patch.graph).toBeUndefined();
  expect(doc.graph['42'].inputs.model).toEqual(['3', 0]);
});

it('edits and removes individual targets of an existing mapping without replacing the whole array', async () => {
  const calls = mockFetch(
    configurationRoutes({
      'PATCH /api/workflows/wf_demo': (body: unknown) => ({
        ...configWorkflow,
        ...(body as object),
      }),
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  await screen.findByRole('combobox', { name: '负向提示词 · 目标 2' });
  await userEvent.click(screen.getByRole('button', { name: '移除负向提示词目标 1' }));
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')).toBeDefined());
  expect(
    (calls.find((call) => call.method === 'PATCH')!.body as Partial<WorkflowDocument>).config
      ?.mapping,
  ).toEqual({ seed: '/3/inputs/seed', negative: '/7/inputs/text' });
});

it('saves qualified output and inspect mappings as multiple nodes without changing linked inputs', async () => {
  let doc = structuredClone(configWorkflow);
  doc.graph['42'] = {
    class_type: 'PreviewImage',
    _meta: { title: '草稿预览' },
    inputs: { images: ['3', 0] },
  };
  doc.graph['43'] = {
    class_type: 'PreviewImage',
    _meta: { title: '备用预览' },
    inputs: { images: ['3', 0] },
  };
  doc.graph['44'] = {
    class_type: 'ShowText',
    _meta: { title: '正向检查' },
    inputs: { text: ['6', 0] },
  };
  doc.graph['45'] = {
    class_type: 'ShowText',
    _meta: { title: '负向检查' },
    inputs: { text: ['7', 0] },
  };
  doc.config.mapping = { ...doc.config.mapping, 'inspect:final': '/44' };
  const originalGraph = structuredClone(doc.graph);
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/workflows/wf_demo': () => doc,
      'PATCH /api/workflows/wf_demo': (body: unknown) => (doc = { ...doc, ...(body as object) }),
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  expect(await screen.findByRole('combobox', { name: 'inspect:final' })).toHaveTextContent(
    '#44 · 正向检查',
  );
  await userEvent.click(screen.getByRole('combobox', { name: '为inspect:final添加目标' }));
  await userEvent.click(screen.getByRole('option', { name: '#45 · 负向检查' }));

  await userEvent.type(
    screen.getByRole('textbox', { name: '参数名，例如 steps 或 control_strength' }),
    'output:draft',
  );
  await userEvent.click(screen.getByRole('button', { name: '添加参数' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'output:draft' }));
  await userEvent.click(screen.getByRole('option', { name: '#42 · 草稿预览' }));
  await userEvent.click(screen.getByRole('combobox', { name: '为output:draft添加目标' }));
  await userEvent.click(screen.getByRole('option', { name: '#43 · 备用预览' }));
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')).toBeDefined());
  const patch = calls.find((call) => call.method === 'PATCH')!.body as Partial<WorkflowDocument>;
  expect(patch.config).toEqual({
    ...configWorkflow.config,
    mapping: {
      ...configWorkflow.config.mapping,
      'inspect:final': ['/44', '/45'],
      'output:draft': ['/42', '/43'],
    },
  });
  expect(patch.graph).toBeUndefined();
  expect(doc.graph).toEqual(originalGraph);
});

it('mounts JSON editors on demand and keeps unsaved contents after closing and reopening a panel', async () => {
  mockFetch(configurationRoutes());
  renderWithProviders(<WorkflowsSection />);
  await screen.findByDisplayValue('测试工作流');
  expect(screen.queryByRole('textbox', { name: '原始工作流 JSON' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: '高级映射与参数 JSON' })).toBeNull();
  const summary = screen.getByText('编辑 JSON', { selector: 'summary strong' });
  await userEvent.click(summary);
  const editor = await screen.findByRole('textbox', { name: '高级映射与参数 JSON' });
  const draft = JSON.stringify({ ...configWorkflow.config, values: { steps: 47 } });
  fireEvent.change(editor, { target: { value: draft } });
  await userEvent.click(summary);
  await userEvent.click(summary);
  expect(screen.getByRole('textbox', { name: '高级映射与参数 JSON' })).toHaveValue(draft);
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
});
