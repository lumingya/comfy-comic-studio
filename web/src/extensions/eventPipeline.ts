export type ExtensionEventDecision = 'continue' | 'handled' | 'stop_propagation';

export async function dispatchByPriority<T>(
  items: T[],
  priority: (item: T) => number,
  dispatch: (item: T) => Promise<ExtensionEventDecision>,
): Promise<T | null> {
  const ordered = [...items].sort((left, right) => priority(right) - priority(left));
  for (const item of ordered) {
    const decision = await dispatch(item);
    if (decision === 'handled' || decision === 'stop_propagation') return item;
  }
  return null;
}
