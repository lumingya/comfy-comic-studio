import type { Take } from '../api/types';

const ref = { slot: 1, asset_id: 'ref_1', role: 'character', owner: '林夏', reason: '角色参考' };

export const cloudRequest: NonNullable<Take['cloud_request']> = {
  channel_id: 'chat',
  kind: 'chat_image',
  model: 'image-model',
  requested: {
    prompt: 'Draw a quiet garden.',
    negative: 'blur',
    width: 896,
    height: 1344,
    seed: 42,
    reference_mode: 'manual',
    refs: [ref],
  },
  effective: {
    prompt: 'Draw a quiet garden. Avoid: blur. Portrait 896x1344.',
    negative: 'blur',
    width: null,
    height: null,
    size: null,
    seed: null,
    reference_mode: 'lineup',
    refs: [ref],
    options: {},
  },
  parameter_modes: { negative: 'prompt', size: 'prompt', seed: 'unsupported' },
  adjustments: ['multi_reference_lineup'],
};
