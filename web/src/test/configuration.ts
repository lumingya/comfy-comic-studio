import type {
  AppSettings,
  ComfyInstance,
  ImageChannel,
  RenderProfile,
  WorkflowDocument,
  WorkflowSummary,
} from '../api/types';

export const imageChannel: ImageChannel = {
  id: 'images',
  label: '主力图像服务',
  kind: 'openai_images',
  base_url: 'https://images.test/v1',
  api_key: '••••••',
  model: 'image-test',
  negative: 'blur',
  width: 832,
  height: 1216,
  size: '',
  quality: '',
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  ref_strength: 0.6,
};
export const configSettings: AppSettings = {
  llm: {
    base_url: 'https://shared.test/v1',
    api_key: '••••••',
    text_models: ['text-test'],
    vision_models: ['vision-test'],
    image_models: ['chat-image-test'],
    timeout: 240,
    pace: 0,
  },
  qa: { votes: 3, auto_adopt: true, faces: true },
  guard_terms: [],
  trash_days: 30,
  locale: 'zh-CN',
  theme: 'system',
  image_channels: [
    imageChannel,
    { ...imageChannel, id: 'chat', label: '备用代理', kind: 'chat_image', base_url: '', model: '' },
  ],
  image_channel: '',
};
export const configInstance: ComfyInstance = {
  id: 'comfy_test',
  name: '测试 ComfyUI',
  base_url: 'http://127.0.0.1:8188',
  enabled: true,
  capacity: 1,
  tags: ['local'],
};
export const configProfile: RenderProfile = {
  id: 'profile_default',
  name: '测试出图配置',
  dialect: 'tags',
  draft: [
    {
      id: 'stage1',
      kind: 'generate',
      workflow_id: 'wf_demo',
      variant: null,
      values: { seed: 7 },
      overrides: { '/3/inputs/steps': 25 },
      enabled: true,
      feed: 'previous',
    },
  ],
  final: [],
  edits: {},
  candidates: 3,
  instances: ['comfy_test'],
  base_width: 832,
  quality_tags: null,
  negative_tags: null,
  cloud_shape: false,
  model_group: null,
  cloud_channel: '',
  created_at: '2026-09-28T00:00:00Z',
  updated_at: '2026-09-28T00:00:00Z',
};
export const configWorkflow: WorkflowDocument = {
  id: 'wf_demo',
  name: '测试工作流',
  source: 'import',
  notes: 'Keep these notes',
  graph: {
    '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, positive: ['6', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'before' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'negative' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216 } },
    '9': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
  },
  config: {
    mapping: { seed: '/3/inputs/seed', negative: ['/6/inputs/text', '/7/inputs/text'] },
    values: { steps: 28 },
    overrides: { '/3/inputs/steps': 30 },
    guard: ['blocked'],
    variants: {},
    frontend: { custom: { keep: true } },
    state: {},
  },
  describe: {
    bindings: {
      prompt: ['6.text (heuristic)'],
      seed: ['3.seed (mapping)'],
      output: ['9 (heuristic)'],
    },
    problems: [],
    variants: [],
    image_inputs: [],
    nodes: 5,
    checkpoint: '',
  },
};
export const configSummary: WorkflowSummary = {
  id: configWorkflow.id,
  name: configWorkflow.name,
  source: 'import',
  nodes: 5,
  variants: [],
  image_inputs: [],
  checkpoint: null,
  updated_at: '2026-09-28T00:00:00Z',
};
export function configurationRoutes(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/settings': configSettings,
    'GET /api/registry': { cloud_adapter: [] },
    'GET /api/profiles': [configProfile],
    'GET /api/instances': { instances: [configInstance], pool: {} },
    'GET /api/workflows': [configSummary],
    'GET /api/workflows/wf_demo': configWorkflow,
    ...extra,
  };
}
