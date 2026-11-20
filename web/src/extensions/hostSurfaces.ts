import { useQuery } from '@tanstack/react-query';
import { raw } from '../api/client';
import type { FloatingPosition } from '../api/open';
import type { WorkspaceToFrame } from '../api/extensionProtocol';
import type { ExtensionEventDecision } from './eventPipeline';

export function postWorkspace(frame: HTMLIFrameElement | null, message: WorkspaceToFrame) {
  frame?.contentWindow?.postMessage(message, location.origin);
}

export interface WorkspaceSurface {
  extension_id: string;
  id: string;
  title: string;
  mode: 'floating' | 'page';
  url: string;
  priority?: number;
  global?: boolean;
  transparent?: boolean;
  default_position?: FloatingPosition;
  activation?: string;
  digest?: string;
}

export type WorkspaceEventSubscription = {
  surface: WorkspaceSurface;
  frame: HTMLIFrameElement;
  session: string;
  event: 'keydown';
};

export type WorkspaceEventCallbacks = {
  onSubscribe?: (subscription: WorkspaceEventSubscription, enabled: boolean) => void;
  onEventResult?: (
    eventId: string,
    decision: ExtensionEventDecision,
    frame: HTMLIFrameElement,
    session: string,
  ) => void;
  active?: boolean;
};
export function useWorkspaceSurfaces() {
  return useQuery({
    queryKey: ['extension-surfaces'],
    queryFn: async () =>
      (await raw('/api/extension-surfaces')).json() as Promise<{ items: WorkspaceSurface[] }>,
    retry: false,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function compareSurfaces(left: WorkspaceSurface, right: WorkspaceSurface): number {
  return (
    (right.priority ?? 0) - (left.priority ?? 0) ||
    left.extension_id.localeCompare(right.extension_id) ||
    left.id.localeCompare(right.id)
  );
}

export function surfaceIdentity(surface: WorkspaceSurface): string {
  return JSON.stringify([
    surface.extension_id,
    surface.id,
    surface.url,
    surface.activation,
    surface.digest,
  ]);
}

export function subscriptionKey(subscription: WorkspaceEventSubscription): string {
  return `${subscription.surface.extension_id}:${subscription.surface.id}:${subscription.event}`;
}
