import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, assetUrl, data } from '../../api/client';
import { keys } from '../../api/keys';
import type { PromptPreview, Series } from '../../api/types';
import { toastError } from '../../components/toast';
import { Modal } from '../../components/ui';
import './bible-assist.css';

/** Fetch only on request, after pending edits are saved; the server chooses the actual slots. */
export function ReferencePreview({
  episodeId,
  panelId,
  series,
  beforeOpen,
}: {
  episodeId: string;
  panelId: string;
  series: Series;
  beforeOpen: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [references, setReferences] = useState<PromptPreview['references'] | null>(null);
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const owners = new Map(
    [...series.bible.characters, ...series.bible.locations, ...series.bible.styles].map((item) => [
      item.id,
      item.name,
    ]),
  );
  const open = async () => {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    try {
      await beforeOpen();
      const preview = await queryClient.fetchQuery({
        queryKey: keys.prompt(episodeId, panelId),
        staleTime: 0,
        queryFn: async () =>
          data(
            await api.GET('/api/episodes/{episode_id}/panels/{panel_id}/prompt', {
              params: { path: { episode_id: episodeId, panel_id: panelId } },
            }),
          ) as unknown as PromptPreview,
      });
      setReferences(preview.references);
    } catch (error) {
      toastError(error);
    } finally {
      opening.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => void open()}>
        {busy ? t('common.loading') : t('bibleAssist.references')}
      </button>
      {references ? (
        <Modal
          open
          onOpenChange={(open) => !open && setReferences(null)}
          title={t('bibleAssist.references')}
        >
          {references.length ? (
            <div className="bible-reference-list">
              {references.map((reference) => (
                <figure key={reference.slot} className="bible-reference-card">
                  <img
                    src={assetUrl(reference.asset_id, 320)}
                    alt={`${owners.get(reference.owner) ?? reference.owner} · ${reference.role}`}
                  />
                  <figcaption>
                    <strong>
                      #{reference.slot} · {owners.get(reference.owner) ?? reference.owner}
                    </strong>
                    <span>{reference.role}</span>
                    <p className="help">{reference.reason}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="help">{t('bibleAssist.noReferences')}</p>
          )}
        </Modal>
      ) : null}
    </>
  );
}
