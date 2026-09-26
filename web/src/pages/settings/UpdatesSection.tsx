import { Download, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateAction, useUpdateStatus } from '../../api/open';
import { usePatchSettings, useSettings } from '../../api/system';
import { toast, toastError } from '../../components/toast';
import { Field, Loading, TextInput } from '../../components/ui';

function formatSize(bytes: number): string {
  return bytes > 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function FeedField() {
  const { t } = useTranslation();
  const settings = useSettings();
  const patch = usePatchSettings();
  const stored = (settings.data as unknown as { update_feed?: string } | undefined)?.update_feed;
  const [feed, setFeed] = useState<string | null>(null);
  const value = feed ?? stored ?? '';
  return (
    <Field label={t('settings.updates.feed')} hint={t('settings.updates.feedHint')}>
      <div className="row">
        <TextInput mono className="grow" value={value} onChange={setFeed} placeholder="GitHub" />
        {feed !== null && feed !== stored ? (
          <button
            className="btn primary sm"
            disabled={patch.isPending}
            onClick={() =>
              patch.mutate(
                { update_feed: feed.trim() },
                { onSuccess: () => (toast(t('common.saved')), setFeed(null)), onError: toastError },
              )
            }
          >
            {t('common.save')}
          </button>
        ) : null}
      </div>
    </Field>
  );
}

export function UpdatesSection() {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const action = useUpdateAction();

  if (!status.data) return <Loading />;
  const s = status.data;
  const check = s.last_check;
  const busy = action.isPending;

  return (
    <section className="col" style={{ gap: 14, maxWidth: 720 }}>
      <div className="card col" style={{ gap: 14 }}>
        <div className="update-hero">
          <div className="col" style={{ gap: 4 }}>
            <span className="overline">{t('settings.updates.current')}</span>
            <span className="version">v{s.current}</span>
          </div>
          <span className="grow" />
          <button
            className="btn"
            disabled={busy}
            onClick={() => action.mutate('check', { onError: toastError })}
          >
            {busy && action.variables === 'check' ? (
              <span className="spinner" />
            ) : (
              <RefreshCw size={15} />
            )}
            {t('settings.updates.check')}
          </button>
        </div>
        {s.pending ? (
          <p className="small accent-text" style={{ margin: 0 }}>
            {t('settings.updates.pending', { version: s.pending.version })}
          </p>
        ) : null}
        {check ? (
          <div className="col" style={{ gap: 8 }}>
            <p className="small soft" style={{ margin: 0 }}>
              {check.available
                ? t('settings.updates.available', {
                    version: check.latest,
                    size: formatSize(check.size),
                  })
                : t('settings.updates.upToDate', { version: check.latest })}
              <span className="muted"> · {check.at}</span>
            </p>
            {check.available && check.notes ? (
              <pre className="notes small card">{check.notes}</pre>
            ) : null}
            {check.available && !s.pending ? (
              <div>
                <button
                  className="btn primary"
                  disabled={busy || s.dev_checkout}
                  onClick={() =>
                    action.mutate('download', {
                      onSuccess: () => toast(t('settings.updates.staged')),
                      onError: toastError,
                    })
                  }
                >
                  {busy && action.variables === 'download' ? (
                    <span className="spinner" />
                  ) : (
                    <Download size={15} />
                  )}
                  {t('settings.updates.download')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {s.dev_checkout ? (
          <p className="small warn-text" style={{ margin: 0 }}>
            {t('settings.updates.devCheckout')}
          </p>
        ) : null}
        {!s.keys_configured ? (
          <p className="small warn-text" style={{ margin: 0 }}>
            {t('settings.updates.noKeys')}
          </p>
        ) : (
          <p className="row small muted" style={{ margin: 0 }}>
            <ShieldCheck size={14} /> {t('settings.updates.signed')}
          </p>
        )}
        <a className="small row" href={s.releases_page} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> {t('settings.updates.releases')}
        </a>
      </div>
      <FeedField />
    </section>
  );
}
