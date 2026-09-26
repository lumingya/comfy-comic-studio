import { Package, Power, PowerOff, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useExtensionAction,
  useExtensions,
  useExtensionPanels,
  useInstallExtension,
  type ExtensionInfo,
} from '../../api/open';
import { ExtensionFrame, panelKey } from '../../components/ExtensionFrame';
import { toast, toastError } from '../../components/toast';
import { Empty, FilePick, Loading, Modal, Switch } from '../../components/ui';

const STATUS_CHIP: Record<ExtensionInfo['status'], string> = {
  active: 'chip ok',
  disabled: 'chip',
  changed: 'chip warn',
  error: 'chip bad',
  invalid: 'chip bad',
};

/** Enabling an extension trusts one exact digest; code-running ones get a louder warning. */
function TrustDialog(props: { ext: ExtensionInfo | null; onClose: () => void }) {
  const { t } = useTranslation();
  const action = useExtensionAction();
  const ext = props.ext;
  return (
    <Modal
      open={!!ext}
      onOpenChange={(open) => !open && props.onClose()}
      title={t('settings.ext.trustTitle', { name: ext?.name ?? '' })}
      description={t('settings.ext.trustHint')}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={action.isPending}
            onClick={() =>
              ext &&
              action.mutate(
                { id: ext.id, action: 'enable', digest: ext.digest },
                {
                  onSuccess: (r) => {
                    const info = r as ExtensionInfo;
                    toast(
                      info.restart_required
                        ? t('settings.ext.restartNeeded')
                        : t('settings.ext.enabled'),
                    );
                    props.onClose();
                  },
                  onError: toastError,
                },
              )
            }
          >
            <Power size={14} /> {t('settings.ext.trust')}
          </button>
        </>
      }
    >
      {ext ? (
        <div className="col" style={{ gap: 10 }}>
          {ext.runs_code ? (
            <p className="row warn-text small" style={{ margin: 0 }}>
              <ShieldAlert size={16} /> {t('settings.ext.runsCode')}
            </p>
          ) : null}
          <div className="small muted">{t('settings.ext.digest')}</div>
          <div className="secret-box">{ext.digest}</div>
        </div>
      ) : null}
    </Modal>
  );
}

function ExtensionCard({ ext, onTrust }: { ext: ExtensionInfo; onTrust: () => void }) {
  const { t } = useTranslation();
  const action = useExtensionAction();
  const run = (name: string) =>
    action.mutate({ id: ext.id, action: name }, { onError: toastError });
  return (
    <div className="card ext-card">
      <div className="row">
        <Package size={16} className="muted" />
        <strong className="grow">
          {ext.name} <span className="small muted mono">{ext.version}</span>
        </strong>
        <span className={STATUS_CHIP[ext.status]}>{t(`settings.ext.status.${ext.status}`)}</span>
      </div>
      {ext.description ? (
        <p className="small soft" style={{ margin: 0 }}>
          {ext.description}
        </p>
      ) : null}
      <div className="ext-meta">
        <span className="chip mono">{ext.id}</span>
        {ext.runs_code ? <span className="chip warn">{t('settings.ext.code')}</span> : null}
        {ext.contributions.map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </div>
      {ext.error ? (
        <p className="small danger" style={{ margin: 0 }}>
          {ext.error}
        </p>
      ) : null}
      {ext.restart_required ? (
        <p className="small warn-text" style={{ margin: 0 }}>
          {t('settings.ext.restartNeeded')}
        </p>
      ) : null}
      <div className="row" style={{ gap: 6 }}>
        {ext.status === 'active' ? (
          <button className="btn sm" disabled={action.isPending} onClick={() => run('disable')}>
            <PowerOff size={13} /> {t('settings.ext.disable')}
          </button>
        ) : ext.status !== 'invalid' ? (
          <button className="btn primary sm" onClick={onTrust}>
            <Power size={13} /> {t('settings.ext.enable')}
          </button>
        ) : null}
        <span className="grow" />
        <button
          className="btn ghost icon sm danger"
          aria-label={t('common.delete')}
          disabled={action.isPending}
          onClick={() => window.confirm(t('settings.ext.confirmRemove')) && run('remove')}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export function ExtensionsSection() {
  const { t } = useTranslation();
  const list = useExtensions();
  const install = useInstallExtension();
  const [replace, setReplace] = useState(false);
  const [trusting, setTrusting] = useState<ExtensionInfo | null>(null);
  const panels = useExtensionPanels('settings');

  if (list.isLoading) return <Loading />;
  const items = list.data?.items ?? [];
  return (
    <section className="col" style={{ gap: 14 }}>
      {list.data?.safe_mode ? (
        <p className="card small warn-text" style={{ margin: 0 }}>
          {t('settings.ext.safeMode')}
        </p>
      ) : null}
      <div className="row">
        <p className="small muted grow" style={{ margin: 0 }}>
          {t('settings.ext.hint')}
        </p>
        <Switch checked={replace} onChange={setReplace} label={t('settings.ext.replace')} />
        <FilePick
          accept=".zip,application/zip"
          disabled={install.isPending}
          onFile={(file) =>
            install.mutate(
              { file, replace },
              {
                onSuccess: (ext) => (toast(t('settings.ext.installed')), setTrusting(ext)),
                onError: toastError,
              },
            )
          }
        >
          <Upload size={15} /> {t('settings.ext.install')}
        </FilePick>
      </div>
      {!items.length ? <Empty>{t('settings.ext.none')}</Empty> : null}
      <div className="grid-2">
        {items.map((ext) => (
          <ExtensionCard key={ext.id} ext={ext} onTrust={() => setTrusting(ext)} />
        ))}
      </div>
      {(panels.data ?? []).map((p) => (
        <div key={panelKey(p)} className="card col" style={{ gap: 10 }}>
          <strong>{p.title}</strong>
          <ExtensionFrame panel={p} />
        </div>
      ))}
      <TrustDialog ext={trusting} onClose={() => setTrusting(null)} />
    </section>
  );
}
