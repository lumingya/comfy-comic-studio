/** TanStack Query keys in one place so invalidation stays consistent. */
export const keys = {
  seriesList: (deleted = false) => ['series', { deleted }] as const,
  series: (id: string) => ['series', id] as const,
  episodes: (seriesId: string, offset = 0) => ['episodes', seriesId, offset] as const,
  episodesOf: (seriesId: string) => ['episodes', seriesId] as const,
  episode: (id: string) => ['episode', id] as const,
  prompt: (episodeId: string, panelId: string, variant?: string | null) =>
    ['prompt', episodeId, panelId, variant ?? null] as const,
  jobs: (owner?: string) => ['jobs', owner ?? null] as const,
  job: (id: string) => ['job', id] as const,
  settings: ['settings'] as const,
  registry: ['registry'] as const,
  workflows: ['workflows'] as const,
  workflow: (id: string) => ['workflow', id] as const,
  profiles: ['profiles'] as const,
  instances: ['instances'] as const,
  trash: ['trash'] as const,
  presets: ['export-presets'] as const,
};
