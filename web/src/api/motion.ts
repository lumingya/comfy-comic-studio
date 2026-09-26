import { useQuery } from '@tanstack/react-query';
import { api, data } from './client';

export type MotionMove =
  'still' | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down' | 'shake';

export interface MotionShot {
  panel_id: string;
  index: number;
  move: MotionMove;
  auto_move: MotionMove;
  move_overridden: boolean;
  hold: number;
  auto_hold: number;
  lines: { text: string; speaker: string; kind: string }[];
  description: string;
  has_image: boolean;
}

export interface MotionPlan {
  moves: MotionMove[];
  shots: MotionShot[];
  total_seconds: number;
}

/** Keyed by the episode revision so the plan refreshes after every panel edit. */
export function useMotionPlan(episodeId: string, variantId: string | null, revision: number) {
  return useQuery({
    queryKey: ['motion-plan', episodeId, variantId, revision],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      data(
        await api.GET('/api/episodes/{episode_id}/motion-plan', {
          params: { path: { episode_id: episodeId }, query: { variant_id: variantId } },
        }),
      ) as unknown as MotionPlan,
  });
}
