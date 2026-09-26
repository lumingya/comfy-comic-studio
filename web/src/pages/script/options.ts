import type { Panel } from '../../api/types';

export const WIDTHS: Panel['width_mode'][] = ['full', 'inset', 'bleed', 'frameless'];
export const RATIOS = ['3:4', '2:3', '9:16', '1:1', '4:3', '16:9', '1:2', '2:1'];
/** ComfyUI sampler names accepted by KSampler (free text is allowed too). */
export const SAMPLERS = [
  'euler',
  'euler_ancestral',
  'dpmpp_2m',
  'dpmpp_2m_sde',
  'dpmpp_3m_sde',
  'dpmpp_sde',
  'ddim',
  'uni_pc',
];
