import { useDesktopSelection, type DesktopContext } from '../../app/useDesktopSelection';
import { shortcutBlocked } from '../../app/shortcuts';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Image,
  Maximize2,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import { useActiveRenders } from '../../api/jobs';
import { useRender } from '../../api/production';
import { useTakeAction, type TakeAction } from '../../api/series';
import type { Take } from '../../api/types';
import { useSelection } from '../../app/selection';
import { useUI } from '../../app/ui-store';
import { ContextMenu, useContextMenu, type ContextGroup } from '../../components/ContextMenu';
import { toast, toastError } from '../../components/toast';
import { Empty, Progress, Switch } from '../../components/ui';
import { useEpisodeContext } from '../episode/EpisodePage';
import { BoardRow } from './BoardRow';
import { BoardZoomDialog } from './BoardZoomDialog';
import { CloudRequestDetails, TakeParameterSummary } from '../../components/CloudRequestDetails';

export default function BoardTab() {
  const { t } = useTranslation();
  const { episode } = useEpisodeContext();
  const showRejected = useUI((state) => state.showRejected);
  const setShowRejected = useUI((state) => state.setShowRejected);
  const { mutate: render, isPending: rendering } = useRender(episode.id);
  const { mutate: takeAction, mutateAsync: takeActionAsync } = useTakeAction(episode.id);
  const { byPanel } = useActiveRenders(episode.id);
  const [zoomId, setZoomId] = useState<string | null>(null);

  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  // Index once per data update, rather than scanning and sorting all candidates per row
  // whenever a selection, context menu or zoom changes. Other variants stay untouched.
  const takeIndex = useMemo(() => {
    const byId = new Map<string, Take>();
    const byPanel = new Map<string, Take[]>();
    const adopted = new Set<string>();
    const populated = new Set<string>();
    for (const take of episode.takes) {
      if (take.variant_id) continue;
      byId.set(take.id, take);
      if (take.status === 'adopted') adopted.add(take.panel_id);
      if (take.status !== 'rejected') populated.add(take.panel_id);
      const group = byPanel.get(take.panel_id);
      if (group) group.push(take);
      else byPanel.set(take.panel_id, [take]);
    }
    for (const group of byPanel.values())
      group.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { byId, byPanel, adoptedPanels: adopted.size, populated };
  }, [episode.takes]);
  const rows = useMemo(
    () =>
      panels.map((panel) => {
        const all = takeIndex.byPanel.get(panel.id) ?? [];
        return {
          panel,
          takes: showRejected ? all : all.filter((take) => take.status !== 'rejected'),
        };
      }),
    [panels, takeIndex, showRejected],
  );
  const { adoptedPanels } = takeIndex;
  // Zoom works on ids so the dialog follows live data (adopting shows at once).
  const visible = useMemo(() => rows.flatMap((row) => row.takes), [rows]);
  const visibleIds = useMemo(() => visible.map((tk) => tk.id), [visible]);
  const selection = useSelection(visibleIds);
  const menu = useContextMenu<DesktopContext>();
  const desktop = useDesktopSelection({
    itemAttribute: 'data-selection-id',
    selection,
    enabled: !zoomId,
    pinned: false,
    contextOpen: !!menu.state,
    onExit: selection.clear,
    onOpen: setZoomId,
    onDelete: (list) => {
      void actMany(list, 'reject');
    },
    onContext: menu.openAt,
    onCloseContext: menu.close,
  });

  const takeById = (id: string) => takeIndex.byId.get(id);
  const zoom = zoomId ? takeIndex.byId.get(zoomId) : undefined;
  const zoomIndex = zoom ? visible.indexOf(zoom) : -1;
  const zoomPanel = zoom ? panels.findIndex((p) => p.id === zoom.panel_id) : -1;
  const step = (delta: number) => {
    if (!visible.length) return;
    const next = visible[(Math.max(zoomIndex, 0) + delta + visible.length) % visible.length];
    setZoomId(next.id);
  };
  const missing = useMemo(
    () => panels.filter((p) => !p.locked && !takeIndex.populated.has(p.id)),
    [panels, takeIndex],
  );

  const run = useCallback(
    (panelIds: string[] | null) =>
      render(
        { panel_ids: panelIds, variant_ids: [null] },
        { onSuccess: () => toast(t('board.queued')), onError: toastError },
      ),
    [render, t],
  );
  const act = useCallback(
    (take: Take, a: TakeAction) =>
      takeAction({ takeId: take.id, action: a }, { onError: toastError }),
    [takeAction],
  );
  const clearSelection = selection.clear;
  const openZoom = useCallback(
    (id: string) => {
      clearSelection();
      setZoomId(id);
    },
    [clearSelection],
  );
  // Batch: sequential so exclusive adopts settle in list order (last adopted per panel wins).
  const actMany = async (ids: string[], a: TakeAction) => {
    try {
      for (const id of ids) {
        const take = takeById(id);
        if (!take) continue;
        if (a === 'adopt' && take.status === 'adopted') continue;
        if (a === 'reject' && take.status === 'rejected') continue;
        if (a === 'restore' && take.status !== 'rejected') continue;
        await takeActionAsync({ takeId: id, action: a });
      }
      toast(t(`board.batch.${a}`, { count: ids.length }));
      if (a === 'reject' && !showRejected) selection.clear();
    } catch (error) {
      toastError(error);
    }
  };
  const menuGroups = (ids: string[]): ContextGroup[] => {
    const one = ids.length === 1 ? takeById(ids[0]) : undefined;
    const n = ids.length;
    return [
      {
        heading: n > 1 ? t('board.batch.selected', { count: n }) : undefined,
        items: [
          ...(one
            ? [
                {
                  label: t('board.zoom'),
                  icon: <Maximize2 size={14} />,
                  onSelect: () => setZoomId(one.id),
                },
              ]
            : []),
          {
            label: n > 1 ? t('board.batch.adoptN', { count: n }) : t('board.adopt'),
            icon: <Check size={14} />,
            onSelect: () => void actMany(ids, 'adopt'),
          },
          {
            label: n > 1 ? t('board.batch.rejectN', { count: n }) : t('board.reject'),
            icon: <X size={14} />,
            danger: true,
            onSelect: () => void actMany(ids, 'reject'),
          },
          {
            label: t('board.restore'),
            icon: <RotateCcw size={14} />,
            onSelect: () => void actMany(ids, 'restore'),
            disabled: !ids.some((id) => takeById(id)?.status === 'rejected'),
          },
        ],
      },
    ];
  };

  // In the zoom view: ←/→ browse every take on the board, A adopts, X rejects.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (
        shortcutBlocked(e, document.getElementById('board-zoom')) ||
        e.repeat ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key.toLowerCase() === 'a' && zoom.status !== 'adopted') act(zoom, 'adopt');
      else if (e.key.toLowerCase() === 'x' && zoom.status !== 'rejected') act(zoom, 'reject');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!panels.length)
    return (
      <Empty
        icon={<Image size={24} />}
        action={
          <Link className="btn primary" to="../script">
            {t('episode.script')}
          </Link>
        }
      >
        {t('board.noPanels')}
      </Empty>
    );

  return (
    <div className="board">
      <div className="board-toolbar">
        <Switch checked={showRejected} onChange={setShowRejected} label={t('board.showRejected')} />
        <span className="board-summary small muted">
          {t('series.adoptedOf', { done: adoptedPanels, total: panels.length })}
          <Progress
            value={adoptedPanels / panels.length}
            className={adoptedPanels >= panels.length ? 'done' : ''}
          />
        </span>
        <span className="grow" />
        <button
          className="btn"
          disabled={!missing.length || rendering}
          onClick={() => run(missing.map((p) => p.id))}
        >
          {t('board.renderMissing', { count: missing.length })}
        </button>
        <button className="btn primary" disabled={rendering} onClick={() => run(null)}>
          <Play size={15} /> {t('board.renderAll')}
        </button>
      </div>

      <div
        className="desktop-list"
        ref={desktop.ref}
        tabIndex={0}
        role="region"
        aria-label={t('interaction.list')}
        onClickCapture={desktop.onClickCapture}
        onContextMenu={desktop.onContextMenu}
        onPointerDown={desktop.onPointerDown}
        onDragStartCapture={desktop.onDragStartCapture}
      >
        {(desktop.snapshot ?? selection.ids).length > 1 ? (
          <div className="selection-bar" role="status">
            <span className="count">
              {t('board.batch.selected', { count: selection.ids.length })}
            </span>
            <span className="grow" />
            <button className="btn ghost sm" onClick={() => void actMany(selection.ids, 'adopt')}>
              <Check size={13} /> {t('board.adopt')}
            </button>
            <button
              className="btn ghost sm danger"
              onClick={() => void actMany(selection.ids, 'reject')}
            >
              <X size={13} /> {t('board.reject')}
            </button>
            <button className="btn ghost sm" onClick={selection.clear} title="Esc">
              {t('common.cancel')}
            </button>
          </div>
        ) : null}
        <div className="board-rows">
          {rows.map(({ panel, takes }, index) => (
            <BoardRow
              key={panel.id}
              panel={panel}
              index={index}
              takes={takes}
              pending={(byPanel[panel.id] ?? []).filter((item) => !item.variantId)}
              selected={selection.set}
              contextId={
                menu.state?.payload.focusId &&
                takeById(menu.state.payload.focusId)?.panel_id === panel.id
                  ? menu.state.payload.focusId
                  : undefined
              }
              rendering={rendering}
              onRender={run}
              onAction={act}
              onZoom={openZoom}
            />
          ))}
        </div>
      </div>
      {menu.state ? (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          groups={menuGroups(menu.state.payload.ids)}
          returnFocus={menu.state.payload.target}
          onClose={menu.close}
        />
      ) : null}
      <BoardZoomDialog
        open={!!zoom}
        onOpenChange={(o) => !o && setZoomId(null)}
        title={
          zoom
            ? `${t('script.panelNo', { n: zoomPanel + 1 })} · ${zoomIndex + 1} / ${visible.length}`
            : ''
        }
        description={
          zoom ? (
            <>
              {zoom.stage} · <TakeParameterSummary take={zoom} />
            </>
          ) : undefined
        }
        footer={
          zoom ? (
            <>
              <button className="btn ghost" onClick={() => step(-1)}>
                <ChevronLeft size={15} /> <span className="kbd">←</span>
              </button>
              <button className="btn ghost" onClick={() => step(1)}>
                <span className="kbd">→</span> <ChevronRight size={15} />
              </button>
              <span className="grow" />
              {zoom.status === 'rejected' ? (
                <button className="btn" onClick={() => act(zoom, 'restore')}>
                  {t('board.restore')}
                </button>
              ) : (
                <button className="btn ghost danger" onClick={() => act(zoom, 'reject')}>
                  <X size={15} /> {t('board.reject')} <span className="kbd">X</span>
                </button>
              )}
              <button
                className="btn primary"
                disabled={zoom.status === 'adopted'}
                onClick={() => act(zoom, 'adopt')}
              >
                <Check size={15} />
                {zoom.status === 'adopted' ? t('board.adopted') : t('board.adopt')}
                {zoom.status === 'adopted' ? null : <span className="kbd">A</span>}
              </button>
            </>
          ) : null
        }
      >
        {zoom ? (
          <>
            <div className="zoom">
              <img src={assetUrl(zoom.asset_id)} alt="" />
            </div>
            <CloudRequestDetails snapshot={zoom.cloud_request} />
          </>
        ) : null}
      </BoardZoomDialog>
    </div>
  );
}
