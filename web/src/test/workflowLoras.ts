import type { WorkflowLoraGroup } from '../api/workflowTrial';

const range = { min: -5, max: 5 };
export const workflowLoras = {
  groups: [
    {
      key: 'group',
      kind: 'object',
      active: true,
      range,
      supports_independent_toggle: true,
      reason: '',
      loras: ['ink', 'shade'].map((key) => ({
        key,
        name: `${key}.safetensors`,
        strength: 0.65,
        clip: 0.4,
        enabled: true,
        source: 'workflow',
        pinned: true,
        supports_independent_toggle: true,
        supports_strength: true,
        range,
      })),
    },
  ] satisfies WorkflowLoraGroup[],
};
