import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import { Field } from '../../components/ui';
import { cropFor, framingFor, type Box, type Framing } from './crop';
import { useImage } from './useImage';

export function PanelInspector(props: {
  assetId: string | undefined;
  box: Box;
  crop: Box | undefined;
  onCrop: (crop: Box | undefined) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const image = useImage(props.assetId ? assetUrl(props.assetId, 1200) : null);
  const framing = image ? framingFor(image, props.box, props.crop) : { zoom: 1, x: 0.5, y: 0.5 };
  const edit = (patch: Partial<Framing>) => {
    if (image) props.onCrop(cropFor(image, props.box, { ...framing, ...patch }));
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <h2 style={{ margin: 0 }}>{t('canvas.crop')}</h2>
      <p className="small muted">{t('canvas.cropHint')}</p>
      <Field label={`${t('canvas.cropZoom')} · ${framing.zoom.toFixed(2)}×`}>
        <input
          type="range"
          aria-label={t('canvas.cropZoom')}
          min={1}
          max={8}
          step={0.01}
          value={framing.zoom}
          disabled={!image}
          onChange={(e) => edit({ zoom: Number(e.target.value) })}
        />
      </Field>
      {(['x', 'y'] as const).map((axis) => (
        <Field key={axis} label={t(axis === 'x' ? 'canvas.cropX' : 'canvas.cropY')}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={framing[axis]}
            disabled={!image}
            onChange={(e) => edit({ [axis]: Number(e.target.value) })}
          />
        </Field>
      ))}
      {!image ? <p role="status">{t('canvas.cropLoading')}</p> : null}
      <button className="btn" disabled={!props.crop} onClick={() => props.onCrop(undefined)}>
        {t('canvas.cropReset')}
      </button>
      <button className="btn ghost" onClick={props.onBack}>
        {t('canvas.strip')}
      </button>
    </div>
  );
}
