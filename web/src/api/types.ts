import type { components } from './schema';

type S = components['schemas'];

export type Series = S['Series'];
/** A series as listed on the works page (plus episode count and cover). */
export type SeriesCard = S['SeriesCard'];
export type Bible = S['Bible-Output'];
export type Character = S['Character-Output'];
export type Location = S['Location-Output'];
export type Style = S['Style-Output'];
export type Prop = S['Prop-Output'];
export type AssetRef = S['AssetRef-Output'];
export type VariantSet = S['VariantSet-Output'];
export type Episode = S['Episode'];
export type Panel = S['Panel'];
export type PanelCharacter = S['PanelCharacter'];
export type PanelOverrides = S['PanelOverrides'];
export type Dialogue = S['Dialogue'];
export type Take = S['Take'];
export type QAResult = S['QAResult'];
export type Strip = S['Strip-Output'];
export type LetteringLayer = S['LetteringLayer-Output'];
export type RenderProfile = S['RenderProfile-Output'];
export type RenderStage = S['RenderStage-Output'];
export type ComfyInstance = S['ComfyInstance-Output'];
export type Asset = S['Asset'];
export type LetterStyle = S['LetterStyle-Output'];
export type ControlInput = S['ControlInput'];
export type PacingSuggestion = S['PacingSuggestion'];
export type PacingPreview = S['PacingPreview'];
export type PacingChanges = S['PacingChanges'];
export type CompositionPreview = S['CompositionPreview'];

export type Shot = Panel['shot'];
export type Angle = Panel['angle'];
export type DialogueKind = Dialogue['kind'];
export type RefRole = AssetRef['role'];

export const SHOTS: Shot[] = ['extreme_close', 'close', 'medium', 'cowboy', 'full', 'wide'];
export const ANGLES: Angle[] = ['eye', 'high', 'low', 'side', 'back', 'dutch'];
export const TIMES: Panel['time'][] = ['', 'morning', 'day', 'evening', 'night'];
export const DIALOGUE_KINDS: DialogueKind[] = ['speech', 'thought', 'narration', 'sfx', 'caption'];
export const WIDTH_MODES: Panel['width_mode'][] = ['full', 'inset', 'bleed', 'frameless'];
export const CONTROL_KINDS: ControlInput['kind'][] = ['pose', 'depth', 'canny', 'lineart'];
export const REF_ROLES: RefRole[] = [
  'front',
  'side',
  'back',
  'expression',
  'outfit',
  'reference',
  'style',
  'sheet',
];

// ---- endpoints that answer with plain dicts -------------------------------------------------

export interface EpisodeSummary {
  id: string;
  series_id: string;
  title: string;
  order: number;
  panel_count: number;
  /** Panels with an adopted base-variant take. */
  adopted_count: number;
  /** First adopted panel image, if any. */
  cover_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export type JobState =
  'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled' | 'blocked';
export type ItemState =
  'pending' | 'running' | 'complete' | 'failed' | 'uncertain' | 'canceled' | 'skipped';

export interface JobItem {
  idx: number;
  state: ItemState;
  label: string;
  attempts: number;
  instance_id: string | null;
  error: { kind: string; message: string } | null;
  result: { images?: { asset_id: string }[] } | null;
  input?: { meta?: { panel_id?: string; variant_id?: string | null; take_id?: string } };
  started: number | null;
  finished: number | null;
}

export interface Job {
  id: string;
  kind: string;
  title: string;
  state: JobState;
  paused: boolean;
  blocked: boolean;
  canceled: boolean;
  owner: string | null;
  error: string | null;
  created: number;
  updated: number;
  items?: JobItem[];
}

export interface JobEvent {
  seq?: number;
  job_id: string;
  idx: number | null;
  type: string;
  data: Record<string, unknown>;
  at: number;
}

export interface CompiledPrompt {
  positive: string;
  negative: string;
  width: number;
  height: number;
  seed: number;
  dialect: string;
  raw: boolean;
  refs: string[];
  loras: { name: string; strength?: number }[];
  unresolved: string[];
}

export interface PromptPreview {
  tags: CompiledPrompt;
  natural: CompiledPrompt;
  references: { slot: number; asset_id: string; role: string; owner: string; reason: string }[];
}

export type OpName =
  | 'add_character'
  | 'update_character'
  | 'add_location'
  | 'update_location'
  | 'add_panel'
  | 'update_panel'
  | 'remove_panel'
  | 'reorder';

export interface DiffOp {
  id: string;
  op: OpName;
  target: string | null;
  summary: string;
  changes?: Record<string, [unknown, unknown]>;
  after?: Record<string, unknown>;
  blocked: string | null;
}

export interface Proposal {
  episode_id: string;
  base_revision: number;
  instruction: string;
  ops: DiffOp[];
}

export interface TrashItem {
  kind: 'series' | 'episode';
  id: string;
  title: string;
  deleted_at: string | null;
  series_id?: string;
  series_title?: string;
  panels?: number;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  source: 'import' | 'builtin' | 'legacy';
  nodes: number;
  variants: string[];
  image_inputs: string[];
  checkpoint: string | null;
  updated_at: string;
}

export interface AppSettings {
  llm: {
    base_url: string;
    api_key: string;
    text_models: string[];
    vision_models: string[];
    image_models: string[];
    timeout: number;
    pace: number;
  };
  qa: { votes: number; faces: boolean; auto_adopt: boolean };
  guard_terms: string[];
  trash_days: number;
  locale: string;
  theme: string;
}

export interface StripReport {
  panels: number;
  layers: number;
  missing: { panel_id: string; text: string }[];
  face_hits: { layer_id: string; ratio: number }[];
  overlaps: [string, string][];
  order: [string, string][];
  outside: string[];
  cut: string[];
  problems: number;
  readable: boolean;
}
