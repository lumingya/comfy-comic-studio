import { CircleAlert, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SaveState as State } from '../app/autosave';

/** "Saving… / Saved / Unsaved / Save failed" next to an autosaving editor. */
export function SaveState({ state, invalid }: { state: State; invalid?: boolean }) {
  const { t } = useTranslation();
  if (invalid)
    return (
      <span className="save-state error">
        <CircleAlert size={13} /> {t('common.invalidJson')}
      </span>
    );
  if (state === 'saving')
    return (
      <span className="save-state saving" role="status">
        <span className="spinner" /> {t('common.saving')}
      </span>
    );
  if (state === 'pending') return <span className="save-state">{t('canvas.unsaved')}</span>;
  if (state === 'error')
    return (
      <span className="save-state error">
        <CircleAlert size={13} /> {t('common.saveFailed')}
      </span>
    );
  if (state === 'saved')
    return (
      <span className="save-state saved">
        <Check size={13} /> {t('common.saved')}
      </span>
    );
  return <span className="save-state">{t('common.autosave')}</span>;
}
