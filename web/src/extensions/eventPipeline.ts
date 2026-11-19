import { BRIDGE, type EventDecision } from '../api/extensionProtocol';

export type ExtensionEventDecision = EventDecision;

export async function dispatchByPriority<T>(
  items: T[],
  priority: (item: T) => number,
  dispatch: (item: T) => Promise<ExtensionEventDecision>,
): Promise<T | null> {
  const ordered = [...items].sort((left, right) => priority(right) - priority(left));
  for (const item of ordered) {
    const decision = await dispatch(item);
    if (
      decision === BRIDGE.workspace.decisions.handled ||
      decision === BRIDGE.workspace.decisions.stopPropagation
    )
      return item;
  }
  return null;
}
