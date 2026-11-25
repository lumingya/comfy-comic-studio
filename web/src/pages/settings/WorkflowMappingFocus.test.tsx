import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkflowInspection } from '../../api/system';
import { configWorkflow } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { WorkflowImportPreview } from './WorkflowInspection';

afterEach(() => vi.unstubAllGlobals());

const report: WorkflowInspection = {
  format: 'api',
  importable: true,
  compilable: true,
  bindings: [{ kind: 'prompt', node: '6', field: 'text', source: 'heuristic' }],
  variants: ['draft', 'final'],
};

function preview(mapping = {}) {
  let finish!: (value: WorkflowInspection) => void;
  const calls = mockFetch({
    'POST /api/workflows/inspect': () =>
      new Promise<WorkflowInspection>((resolve) => {
        finish = resolve;
      }),
  });
  renderWithProviders(
    <WorkflowImportPreview
      workflow={configWorkflow.graph}
      graph={configWorkflow.graph}
      config={{ mapping }}
      initialInspection={report}
      name="Focus test"
      saving={false}
      saveError={null}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { calls, settle: () => finish(report) };
}

async function choosePrompt() {
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByText('调整参数映射'));
  const trigger = within(dialog).getByRole('combobox', { name: '正向提示词' });
  trigger.focus();
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.type(screen.getByRole('combobox', { name: '搜索正向提示词' }), '/7/inputs/text');
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(within(dialog).getByRole('combobox', { name: '正向提示词' })).toBeDisabled(),
  );
  return dialog;
}

it.each([{}, { prompt: '/6/inputs/text' }])(
  'restores the chosen mapping trigger after keyboard selection and pending inspection: %j',
  async (mapping) => {
    const { calls, settle } = preview(mapping);
    const dialog = await choosePrompt();
    await waitFor(() => expect(calls).toHaveLength(1));
    // Browsers blur controls when their containing fieldset becomes disabled.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    settle();
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: '正向提示词' })).toHaveFocus(),
    );
    expect(within(dialog).getByRole('combobox', { name: '正向提示词' })).toHaveTextContent('#7');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('combobox', { name: '搜索正向提示词' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: '正向提示词' })).toHaveFocus(),
    );
  },
);

it('preserves a later user focus choice while mapping inspection is pending', async () => {
  const { settle } = preview();
  const dialog = await choosePrompt();
  const variant = within(dialog).getByLabelText('输出变体');
  await userEvent.click(variant);
  settle();
  await waitFor(() =>
    expect(within(dialog).getByRole('combobox', { name: '正向提示词' })).toBeEnabled(),
  );
  expect(variant).toHaveFocus();
});

it('does not move focus on initial inspection or unrelated output variant changes', async () => {
  const { settle } = preview();
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '关闭' })).toHaveFocus());
  await userEvent.click(within(dialog).getByText('调整参数映射'));
  const variant = within(dialog).getByLabelText('输出变体');
  await userEvent.selectOptions(variant, 'final');
  settle();
  await waitFor(() =>
    expect(within(dialog).getByRole('combobox', { name: '正向提示词' })).toBeEnabled(),
  );
  expect(variant).toHaveFocus();
});
