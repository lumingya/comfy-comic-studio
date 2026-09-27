import { Navigate, useLocation, useOutletContext, useParams } from 'react-router-dom';
import type { Episode, Series } from '../../api/types';

export interface EpisodeContext {
  episode: Episode;
  series: Series;
}

export function useEpisodeContext() {
  return useOutletContext<EpisodeContext>();
}

/** Old `/episodes/:id/...` links now live in the workshop (`/workshop/:id/...`). */
export default function EpisodeRedirect() {
  const { episodeId } = useParams();
  const rest = useLocation().pathname.split('/').slice(3).join('/');
  return <Navigate to={`/workshop/${episodeId}/${rest || 'script'}`} replace />;
}
