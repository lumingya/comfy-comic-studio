import { Maximize, RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import { stripUrl } from '../../api/production';
import { useUI } from '../../app/ui-store';
import { Empty } from '../../components/ui';
import { pickAdopted } from '../canvas/adopted';
import { useEpisodeContext } from './EpisodePage';

/**
 * Reads the composed strip exactly as exported (server-rendered, with lettering). Before a layout
 * exists it falls back to the adopted panels stacked in order.
 */
export default function ReaderTab() {
  const { t } = useTranslation();
  const { episode } = useEpisodeContext();
  const variantId = useUI((s) => s.variantId);
  const [bust, setBust] = useState(0);
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const images = pickAdopted(episode.takes, variantId);
  const ordered = [...episode.panels].sort((a, b) => a.order - b.order).filter((p) => images[p.id]);

  if (!ordered.length) return <Empty>{t('canvas.noAdopted')}</Empty>;
  const laidOut = Object.keys(episode.strip.panel_boxes).length > 0;

  return (
    <div className="reader" ref={frame}>
      <div className="reader-tools">
        <span className="small muted grow">
          {laidOut && !failed ? t('reader.composed') : t('reader.stacked')}
        </span>
        <button className="btn ghost sm" onClick={() => (setFailed(false), setBust(bust + 1))}>
          <RefreshCw size={13} /> {t('reader.refresh')}
        </button>
        <button className="btn ghost sm" onClick={() => frame.current?.requestFullscreen?.()}>
          <Maximize size={13} /> {t('reader.fullscreen')}
        </button>
      </div>
      <div className="reader-page">
        {laidOut && !failed ? (
          <img
            src={stripUrl(episode.id, `${episode.updated_at}-${bust}`, variantId)}
            alt={episode.title}
            onError={() => setFailed(true)}
          />
        ) : (
          ordered.map((p) => (
            <img key={p.id} src={assetUrl(images[p.id], 1080)} alt="" loading="lazy" />
          ))
        )}
      </div>
    </div>
  );
}
