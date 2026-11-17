import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, Puzzle } from 'lucide-react';
import { raw } from '../api/client';
import { Loading } from '../components/ui';
import { QueryError } from '../app/errors';
import './host.css';

export interface WorkspaceSurface {
  extension_id: string;
  id: string;
  title: string;
  mode: 'floating' | 'page';
  url: string;
}
export function useWorkspaceSurfaces() {
  return useQuery({
    queryKey: ['extension-surfaces'],
    queryFn: async () =>
      (await raw('/api/extension-surfaces')).json() as Promise<{ items: WorkspaceSurface[] }>,
    retry: false,
  });
}

/** Reviewed application extensions run their own built assets; the host never imports their code. */
function WorkspaceFrame({ surface, floating }: { surface: WorkspaceSurface; floating: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const session = useRef(crypto.randomUUID());
  const qc = useQueryClient();
  const navigate = useNavigate();
  const context = () => {
    const style = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      Array.from({ length: style.length }, (_, index) => style.item(index))
        .filter((key) => key.startsWith('--'))
        .map((key) => [key, style.getPropertyValue(key)]),
    );
    return {
      type: 'mio:workspace:context',
      session: session.current,
      tokens,
      theme: document.documentElement.dataset.theme,
      locale: document.documentElement.lang || 'zh-CN',
      floating,
    };
  };
  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage(context(), location.origin);
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.session !== session.current
      )
        return;
      if (event.data.type === 'mio:workspace:ready') send();
      if (event.data.type === 'mio:workspace:changed') void qc.invalidateQueries();
      if (
        event.data.type === 'mio:workspace:navigate' &&
        [
          '/',
          `/extensions/${surface.extension_id}`,
          '/extensions?tab=installed',
          '/settings?tab=extensions',
        ].includes(event.data.path)
      )
        navigate(event.data.path);
    };
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'lang', 'data-font-scale', 'data-density'],
    });
    window.addEventListener('message', listener);
    return () => {
      observer.disconnect();
      window.removeEventListener('message', listener);
    };
  }, [surface.extension_id, floating, qc, navigate]);
  return (
    <iframe
      ref={frame}
      className="workspace-extension-frame"
      title={surface.title}
      sandbox="allow-scripts allow-same-origin allow-downloads"
      referrerPolicy="no-referrer"
      src={`${surface.url}#mio-session=${session.current}&floating=${floating ? '1' : '0'}`}
      onLoad={() => frame.current?.contentWindow?.postMessage(context(), location.origin)}
    />
  );
}

export function WorkspaceExtensionPage() {
  const { t } = useTranslation();
  const { extensionId } = useParams();
  const surfaces = useWorkspaceSurfaces();
  if (surfaces.isPending) return <Loading />;
  if (surfaces.isError) return <QueryError error={surfaces.error} onRetry={surfaces.refetch} />;
  const surface = surfaces.data?.items.find((item) => item.extension_id === extensionId);
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
      <WorkspaceFrame surface={surface} floating={false} />
    </div>
  );
}

function FloatingSurface({ surface, index }: { surface: WorkspaceSurface; index: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const clamp = () => {
      const rect = panel.current?.getBoundingClientRect();
      if (!rect || !open) return;
      setPosition((value) => ({
        x: value.x + Math.max(0, -rect.left) - Math.max(0, rect.right - innerWidth),
        y: value.y + Math.max(0, -rect.top) - Math.max(0, rect.bottom - innerHeight),
      }));
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [open]);
  return (
    <>
      {!open && (
        <button
          className="btn workspace-extension-launcher"
          style={{ bottom: 50 + index * 48 }}
          onClick={() => setOpen(true)}
        >
          <Puzzle size={18} />
          {surface.title}
        </button>
      )}
      <div
        ref={panel}
        className="workspace-extension-floating"
        hidden={!open}
        style={{ transform: `translate(${position.x}px, ${position.y}px)`, right: 24 + index * 24 }}
      >
        <header
          className="workspace-extension-handle"
          onPointerDown={(event) => {
            if ((event.target as Element).closest('button,a')) return;
            drag.current = { x: event.clientX, y: event.clientY, dx: position.x, dy: position.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || !panel.current) return;
            const rect = panel.current.getBoundingClientRect();
            setPosition({
              x: Math.min(
                position.x + innerWidth - rect.right,
                Math.max(position.x - rect.left, drag.current.dx + event.clientX - drag.current.x),
              ),
              y: Math.min(
                position.y + innerHeight - rect.bottom,
                Math.max(position.y - rect.top, drag.current.dy + event.clientY - drag.current.y),
              ),
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <span>{surface.title}</span>
          <span className="spacer" />
          <Link
            className="btn ghost icon sm"
            to={`/extensions/${surface.extension_id}`}
            aria-label={t('settings.ext.expand')}
          >
            <Maximize2 size={14} />
          </Link>
          <button
            className="btn ghost icon sm"
            aria-label={t('settings.ext.minimize')}
            onClick={() => setOpen(false)}
          >
            <Minimize2 size={14} />
          </button>
        </header>
        <WorkspaceFrame surface={surface} floating />
      </div>
    </>
  );
}
export function WorkspaceExtensionOverlays({ path }: { path: string }) {
  const surfaces = useWorkspaceSurfaces();
  return (
    <>
      {surfaces.data?.items
        .filter((item) => item.mode === 'floating' && path !== `/extensions/${item.extension_id}`)
        .map((surface, index) => (
          <FloatingSurface
            key={`${surface.extension_id}:${surface.id}`}
            surface={surface}
            index={index}
          />
        ))}
    </>
  );
}
