import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Puzzle } from 'lucide-react';
import { Loading } from '../components/ui';
import { QueryError } from '../app/errors';
import { compareSurfaces, surfaceIdentity, useWorkspaceSurfaces } from './hostSurfaces';
import { WorkspaceFrame } from './hostFrame';
import { FloatingSurface } from './hostFloating';
import { useWorkspaceEvents } from './hostEvents';
import './host.css';

export { useWorkspaceSurfaces } from './hostSurfaces';
export type { WorkspaceSurface } from './hostSurfaces';

export function WorkspaceExtensionPage() {
  const { t } = useTranslation();
  const { extensionId, surfaceId } = useParams();
  const surfaces = useWorkspaceSurfaces();
  if (surfaces.isPending) return <Loading />;
  if (surfaces.isError) return <QueryError error={surfaces.error} onRetry={surfaces.refetch} />;
  const surface = surfaces.data?.items
    .filter((item) => item.extension_id === extensionId && (!surfaceId || item.id === surfaceId))
    .sort(compareSurfaces)[0];
  if (!surface)
    return (
      <div className="empty">
        <Link className="btn" to="/extensions?tab=installed">
          <Puzzle size={18} />
          {t('settings.tabs.extensions')}
        </Link>
      </div>
    );
  return (
    <div className="workspace-extension-page">
      <WorkspaceFrame key={surfaceIdentity(surface)} surface={surface} floating={false} />
    </div>
  );
}

export function WorkspaceExtensionOverlays({ path }: { path: string }) {
  const surfaces = useWorkspaceSurfaces();
  const ordered = [...(surfaces.data?.items ?? [])].sort(compareSurfaces);
  const { onSubscribe, onEventResult } = useWorkspaceEvents();
  return (
    <>
      {ordered
        .filter((item) => {
          if (item.mode !== 'floating') return false;
          return item.global !== false;
        })
        .map((surface, index) => (
          <FloatingSurface
            key={surfaceIdentity(surface)}
            surface={surface}
            index={index}
            visible={
              path !== `/extensions/${surface.extension_id}` &&
              path !== `/extensions/${surface.extension_id}/${surface.id}`
            }
            onSubscribe={onSubscribe}
            onEventResult={onEventResult}
          />
        ))}
    </>
  );
}
