import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { AssistantDialog } from './AssistantDialog';

const proposal = {
  base_revision: 7,
  instruction: '改成雨夜',
  ops: [
    {
      id: 'op1',
      op: 'update_panel',
      summary: '第 3 格改为夜晚',
      target: 'p3',
      changes: { time: ['day', 'night'] },
      before: null,
      after: null,
      blocked: null,
    },
    {
      id: 'op2',
      op: 'update_panel',
      summary: '第 5 格加台词',
      target: 'p5',
      changes: { dialogues: [[], [{ text: '好久不见' }]] },
      before: null,
      after: null,
      blocked: '格已锁定',
    },
    {
      id: 'op3',
      op: 'add_panel',
      summary: '新增一格',
      target: null,
      changes: {},
      before: null,
      after: { description: '雨中的街道' },
      blocked: null,
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

async function openWithProposal() {
  const calls = mockFetch({
    'POST /api/episodes/ep1/assistant/propose': proposal,
    'POST /api/episodes/ep1/assistant/apply': { applied: ['op1'], revision: 8 },
  });
  const onOpenChange = vi.fn();
  renderWithProviders(<AssistantDialog episodeId="ep1" open onOpenChange={onOpenChange} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), '改成雨夜');
  await user.click(screen.getByRole('button', { name: '生成修改建议' }));
  await screen.findByText('第 3 格改为夜晚');
  return { calls, user, onOpenChange };
}

describe('AssistantDialog diff review', () => {
  it('shows before/after per field and preselects only applicable ops', async () => {
    await openWithProposal();
    expect(screen.getByText('day')).toHaveClass('before');
    expect(screen.getByText('night')).toHaveClass('after');
    expect(screen.getByRole('checkbox', { name: '第 3 格改为夜晚' })).toBeChecked();
    const blocked = screen.getByRole('checkbox', { name: '第 5 格加台词' });
    expect(blocked).toBeDisabled();
    expect(blocked).not.toBeChecked();
    expect(screen.getByText(/格已锁定/)).toBeInTheDocument();
  });

  it('applies only the accepted subset against the base revision', async () => {
    const { calls, user, onOpenChange } = await openWithProposal();
    await user.click(screen.getByRole('checkbox', { name: '新增一格' }));
    await user.click(screen.getByRole('button', { name: '应用选中的 1 条' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const apply = calls.find((c) => c.url.endsWith('/assistant/apply'))!;
    expect(apply.body).toMatchObject({ accepted: ['op1'], base_revision: 7 });
    expect((apply.body as { ops: unknown[] }).ops).toHaveLength(3);
  });
});
