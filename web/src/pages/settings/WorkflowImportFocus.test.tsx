import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkflowInspection } from '../../api/system';
import { configWorkflow, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { WorkflowsSection } from './WorkflowsSection';

afterEach(() => vi.unstubAllGlobals());

const inspection: WorkflowInspection = {
  format: 'api',
  importable: true,
  compilable: true,
  bindings: [],
  candidates: [],
  missing: [],
  output_nodes: ['9'],
  variants: [],
  issues: [],
};

async function openPreview() {
  const user = userEvent.setup();
  const { container } = renderWithProviders(<WorkflowsSection />);
  await screen.findByRole('textbox', { name: '搜索工作流或模型' });
  const trigger = screen.getByRole('button', { name: '导入工作流' });
  await user.click(trigger);
  const text = JSON.stringify(configWorkflow.graph);
  const file = new File([text], 'workflow.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  await user.upload(container.querySelector('input[type="file"]')!, file);
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('ComfyUI API');
  expect(trigger).toBeDisabled();
  return { user, trigger, dialog };
}

it.each(['Escape', 'Cancel', 'Close'])(
  'returns focus to the import button after %s dismisses the preview',
  async (action) => {
    mockFetch(configurationRoutes({ 'POST /api/workflows/inspect': inspection }));
    const { user, trigger, dialog } = await openPreview();
    if (action === 'Escape') await user.keyboard('{Escape}');
    else
      await user.click(
        within(dialog).getByRole('button', { name: action === 'Cancel' ? '取消' : '关闭' }),
      );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toBeEnabled();
  },
);

it('waits for a delayed save to finish before closing and returning focus', async () => {
  let finishSave!: (value: unknown) => void;
  mockFetch(
    configurationRoutes({
      'POST /api/workflows/inspect': inspection,
      'POST /api/workflows': () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    }),
  );
  const { user, trigger, dialog } = await openPreview();
  await user.click(within(dialog).getByRole('button', { name: '保存工作流' }));
  await waitFor(() => expect(finishSave).toBeDefined());
  await user.keyboard('{Escape}');
  expect(dialog).toBeVisible();
  expect(trigger).toBeDisabled();
  await act(async () => finishSave(configWorkflow));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger).toBeEnabled();
});

it('preserves an explicit focus choice made immediately after the preview closes', async () => {
  mockFetch(configurationRoutes({ 'POST /api/workflows/inspect': inspection }));
  const { dialog } = await openPreview();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  const search = screen.getByRole('textbox', { name: '搜索工作流或模型' });
  search.focus();
  // Radix dispatches its close autofocus after unmount on the next task.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(search).toHaveFocus();
});
