import { memo } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ActiveItem } from '../../api/jobs';
import type { TakeAction } from '../../api/series';
import type { Panel, Take } from '../../api/types';
import { PendingCard, TakeCard } from './TakeCard';

interface Props {
  panel: Panel;
  index: number;
  takes: Take[];
  pending: ActiveItem[];
  selected: ReadonlySet<string>;
  contextId?: string;
  rendering: boolean;
  onRender: (ids: string[] | null) => void;
  onAction: (take: Take, action: TakeAction) => void;
  onZoom: (id: string) => void;
}

/** Keep the complete board mounted for marquee/range selection and cross-panel browsing. */
export const BoardRow = memo(function BoardRow(props: Props) {
  const { t } = useTranslation();
  const { panel, index, takes, pending, selected, contextId, onAction, onZoom } = props;
  return (
    <section className="board-row">
      <header className="board-row-head">
        <span className="panel-no mono">{String(index + 1).padStart(2, '0')}</span>
        <div className="grow">
          <div className="small">
            {panel.shot ? <span className="chip">{t(`script.shots.${panel.shot}`)}</span> : null}{' '}
            {panel.description || panel.dialogues[0]?.text}
          </div>
        </div>
        <Link className="btn ghost sm" to={`../script?panel=${panel.id}`}>
          {t('common.edit')}
        </Link>
        <button
          className="btn sm"
          disabled={props.rendering}
          onClick={() => props.onRender([panel.id])}
        >
          <Play size={13} /> {t('board.render')}
        </button>
      </header>
      <div className="take-strip">
        {pending.map((item) => (
          <PendingCard key={`${item.jobId}:${item.idx}`} item={item} />
        ))}
        {takes.map((take) => (
          <TakeCard
            key={take.id}
            take={take}
            checked={selected.has(take.id)}
            context={contextId === take.id}
            onAction={onAction}
            onZoom={onZoom}
          />
        ))}
        {!takes.length && !pending.length ? (
          <div className="take empty small muted">{t('board.noTakes')}</div>
        ) : null}
      </div>
    </section>
  );
}, sameRow);

function sameRow(previous: Props, next: Props) {
  if (
    previous.panel !== next.panel ||
    previous.index !== next.index ||
    previous.takes !== next.takes ||
    previous.contextId !== next.contextId ||
    previous.rendering !== next.rendering ||
    previous.onRender !== next.onRender ||
    previous.onAction !== next.onAction ||
    previous.onZoom !== next.onZoom
  )
    return false;
  if (
    previous.selected !== next.selected &&
    next.takes.some((take) => previous.selected.has(take.id) !== next.selected.has(take.id))
  )
    return false;
  // The live-job hook reconstructs these small records on every render. Compare their
  // displayed values; each PendingCard subscribes to its own preview/progress independently.
  return (
    previous.pending.length === next.pending.length &&
    previous.pending.every((item, index) => {
      const other = next.pending[index];
      return (
        item.jobId === other.jobId &&
        item.idx === other.idx &&
        item.state === other.state &&
        item.label === other.label &&
        item.variantId === other.variantId
      );
    })
  );
}
