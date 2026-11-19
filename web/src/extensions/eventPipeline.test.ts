import { describe, expect, it, vi } from 'vitest';
import { dispatchByPriority } from './eventPipeline';

describe('extension event priority pipeline', () => {
  it('dispatches higher priority first and stops when consumed', async () => {
    const calls: string[] = [];
    const winner = await dispatchByPriority(
      [
        { id: 'low', priority: 0 },
        { id: 'high', priority: 20 },
        { id: 'middle', priority: 10 },
      ],
      (item) => item.priority,
      async (item) => {
        calls.push(item.id);
        return item.id === 'middle' ? 'handled' : 'continue';
      },
    );
    expect(calls).toEqual(['high', 'middle']);
    expect(winner?.id).toBe('middle');
  });

  it('continues when handlers decline and resolves empty chains', async () => {
    const dispatch = vi.fn(async () => 'continue' as const);
    const winner = await dispatchByPriority(
      [{ priority: 0 }, { priority: 1 }],
      (item) => item.priority,
      dispatch,
    );
    expect(winner).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(2);
    await expect(dispatchByPriority([], () => 0, dispatch)).resolves.toBeNull();
  });
});
