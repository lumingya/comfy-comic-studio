import { ImagePlus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl, uploadAsset } from '../../api/client';
import { REF_ROLES, type AssetRef, type RefRole } from '../../api/types';
import { toastError } from '../../components/toast';
import { FilePick } from '../../components/ui';

/** Reference image strip: upload, pick the role (front / side / outfit …), remove. */
export function References(props: {
  value: AssetRef[];
  onChange: (refs: AssetRef[]) => void;
  defaultRole?: RefRole;
  outfits?: string[];
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const refs = props.value ?? [];

  const add = async (file: File) => {
    setBusy(true);
    try {
      const asset = await uploadAsset(file, file.name);
      props.onChange([
        ...refs,
        {
          asset_id: asset.id,
          role: props.defaultRole ?? 'front',
          label: '',
          outfit: null,
          expression: null,
        },
      ]);
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<AssetRef>) =>
    props.onChange(refs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="ref-strip">
      {refs.map((ref, i) => (
        <figure key={`${ref.asset_id}-${i}`} className="ref-card">
          <img src={assetUrl(ref.asset_id, 256)} alt={ref.label || ref.role} loading="lazy" />
          <button
            className="ref-remove"
            aria-label={t('common.remove')}
            onClick={() => props.onChange(refs.filter((_, j) => j !== i))}
          >
            <X size={12} />
          </button>
          <figcaption>
            <select
              className="select"
              value={ref.role}
              aria-label={t('bible.role')}
              onChange={(e) => update(i, { role: e.target.value as RefRole })}
            >
              {REF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {props.outfits?.length ? (
              <select
                className="select"
                value={ref.outfit ?? ''}
                aria-label={t('script.outfit')}
                onChange={(e) => update(i, { outfit: e.target.value || null })}
              >
                <option value="">{t('common.auto')}</option>
                {props.outfits.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : null}
          </figcaption>
        </figure>
      ))}
      <FilePick className="ref-add" accept="image/*" onFile={add} disabled={busy}>
        {busy ? <span className="spinner" /> : <ImagePlus size={20} />}
        <span className="small">{t('common.upload')}</span>
      </FilePick>
    </div>
  );
}
