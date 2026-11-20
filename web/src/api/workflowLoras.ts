import { useQuery } from '@tanstack/react-query';
import { raw } from './client';
import type { WorkflowLoraGroup } from './workflowTrial';

export type LoraSlotPatch = {
  key: string;
  name: string;
  enabled?: boolean;
  strength?: number;
  clip?: number;
};
export type LoraGroupPatch = { key: string; loras: LoraSlotPatch[] };
export type LoraSlotOverrides = { groups: LoraGroupPatch[] };

export type WorkflowLoraControls = {
  groups: WorkflowLoraGroup[];
  adapters?: { id: string; source: string }[];
  reason?: string;
};

export function useWorkflowLoras(workflowId: string, enabled = true) {
  return useQuery({
    queryKey: ['workflow-loras', workflowId],
    enabled: enabled && !!workflowId,
    retry: false,
    queryFn: async ({ signal }): Promise<WorkflowLoraControls> =>
      (await raw(`/api/workflows/${encodeURIComponent(workflowId)}/loras`, { signal })).json(),
  });
}
