import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCreationKits } from '../../api/creationKits';
import { useSeries } from '../../api/series';
import { useWorkshop } from '../../api/workshop';
import { QueryError } from '../../app/errors';
import {
  AutoSaveGuard,
  flushDraft,
  flushEditors,
  type AutosaveController,
} from '../../app/useAutoDraft';
import { toastError } from '../../components/toast';

const Drafts = createContext<Set<AutosaveController> | null>(null);

/** React Router supports one navigation blocker. Register the story header and active panel
 * together so a failed synopsis save cannot disappear behind another editor's blocker.
 */
export function WorkshopDraftBoundary({ children }: { children: ReactNode }) {
  const drafts = useRef(new Set<AutosaveController>()).current;
  const combined = useMemo<AutosaveController>(
    () => ({
      state: 'idle',
      touch: () => {},
      busy: () => [...drafts].some((draft) => draft.busy()),
      flush: async () => {
        for (const draft of [...drafts]) await flushDraft(draft);
      },
      discard: () => {
        for (const draft of drafts) draft.discard();
      },
    }),
    [drafts],
  );
  return (
    <Drafts.Provider value={drafts}>
      <AutoSaveGuard save={combined} includeSearch />
      {children}
    </Drafts.Provider>
  );
}

export function WorkshopDraftGuard({ save }: { save: AutosaveController }) {
  const drafts = useContext(Drafts);
  useEffect(() => {
    if (!drafts) return;
    drafts.add(save);
    return () => {
      drafts.delete(save);
    };
  }, [drafts, save.flush]);
  return drafts ? null : <AutoSaveGuard save={save} includeSearch />;
}

/** Source stays in the URL; selecting a library never copies its content into the default one. */
export function workshopHref(path: string, kitId?: string, query?: Record<string, string>) {
  const params = new URLSearchParams(query);
  if (kitId) params.set('kit', kitId);
  return `${path}${params.size ? `?${params}` : ''}`;
}

export function useWorkshopSource() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const kitId = params.get('kit') ?? '';
  const workshop = useWorkshop(!kitId);
  const kit = useSeries(kitId || undefined);
  const query = kitId ? kit : workshop;
  const invalid = !!kitId && !!kit.data && kit.data.kind !== 'kit';
  return {
    ...query,
    kitId,
    data: invalid ? undefined : query.data,
    error: invalid ? new Error(t('workshopSource.invalid')) : query.error,
  };
}

/** Quiet, shared library selector inside the existing workshop frame. */
export function WorkshopSourcePicker({ tab }: { tab: 'story' | 'presets' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const kitId = params.get('kit') ?? '';
  const kits = useCreationKits();
  const [busy, setBusy] = useState(false);
  const change = async (next: string) => {
    if (busy || next === kitId) return;
    setBusy(true);
    try {
      await flushEditors();
      navigate(workshopHref(`/workshop/${tab}`, next));
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };
  // Keep the default page as spare as before until a kit exists.
  if (!kitId && !kits.data?.length && !kits.error) return null;
  return (
    <div className="workshop-asset-head">
      <label>
        {t('workshopSource.label')}
        <select value={kitId} disabled={busy} onChange={(event) => void change(event.target.value)}>
          <option value="">{t('kits.workshop')}</option>
          {kitId && !kits.data?.some((item) => item.id === kitId) ? (
            <option value={kitId}>
              {t(kits.isPending ? 'kits.loadingSource' : 'kits.missingSource')}
            </option>
          ) : null}
          {(kits.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      {kitId ? <span className="small muted">{t('workshopSource.hint')}</span> : null}
      {kits.error ? <QueryError error={kits.error} onRetry={kits.refetch} /> : null}
    </div>
  );
}
