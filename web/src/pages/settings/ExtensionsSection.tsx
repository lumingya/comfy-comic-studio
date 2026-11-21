import { QueryError } from '../../app/errors';
import { ConceptHint } from '../../components/ConceptHint';
import { FolderOpen, Package, Power, PowerOff, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useWorkspaceSurfaces } from '../../extensions/host';
import { extensionFiles, extensionFolderError } from '../../extensions/packageFiles';
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
export function TrustDialog(props: { ext: ExtensionInfo | null; onClose: () => void }) {
  const { t } = useTranslation();
  const action = useExtensionAction();
  const ext = props.ext;
  return (
    <Modal
      open={!!ext}
      onOpenChange={(open) => !action.isPending && !open && props.onClose()}
      title={t('settings.ext.trustTitle', { name: ext?.name ?? '' })}
      description={t('settings.ext.trustHint')}
      footer={
        <>
          <button className="btn ghost" disabled={action.isPending} onClick={props.onClose}>
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
          {ext.has_requirements ? (
            <p className="row warn-text small" style={{ margin: 0 }}>
              <ShieldAlert size={16} /> {t('settings.ext.requirementsTrust')}
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
  const surfaces = useWorkspaceSurfaces();
  const surface = surfaces.data?.items.find((item) => item.extension_id === ext.id);
  const action = useExtensionAction();
  const [removing, setRemoving] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const run = (name: 'enable' | 'disable') =>
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
        {ext.runs_code && !ext.builtin ? (
          <span className="chip warn">{t('settings.ext.code')}</span>
        ) : null}
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
          <button
            className="btn primary sm"
            disabled={action.isPending}
            onClick={
              ext.builtin
                ? () =>
                    action.mutate(
                      { id: ext.id, action: 'enable', digest: ext.digest },
                      { onError: toastError },
                    )
                : onTrust
            }
          >
            <Power size={13} /> {t('settings.ext.enable')}
          </button>
        ) : null}
        <span className="grow" />
        {surface && ext.status === 'active' ? (
          <Link className="btn sm" to={`/extensions/${ext.id}`}>
            {surface.title}
          </Link>
        ) : null}
        {!ext.builtin ? (
          <button
            className="btn ghost icon sm danger"
            aria-label={t('settings.ext.uninstall')}
            disabled={action.isPending}
            onClick={() => {
              setDeleteData(false);
              setRemoving(true);
            }}
          >
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>
      <Modal
        open={removing}
        onOpenChange={(open) => !action.isPending && setRemoving(open)}
        title={t('settings.ext.uninstallTitle', { name: ext.name })}
        description={t('settings.ext.keepData')}
        footer={
          <>
            <button
              className="btn ghost"
              disabled={action.isPending}
              onClick={() => setRemoving(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn danger"
              disabled={action.isPending}
              onClick={() =>
                action.mutate(
                  { id: ext.id, action: 'remove', deleteData },
                  { onSuccess: () => setRemoving(false), onError: toastError },
                )
              }
            >
              <Trash2 size={14} /> {t('settings.ext.uninstall')}
            </button>
          </>
        }
      >
        <label className="row small soft" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={deleteData}
            disabled={action.isPending}
            onChange={(event) => setDeleteData(event.target.checked)}
          />
          {t('settings.ext.deleteData')}
        </label>
      </Modal>
    </div>
  );
}

export function ExtensionsSection({ query = '' }: { query?: string }) {
  const { t } = useTranslation();
  const list = useExtensions();
  const install = useInstallExtension();
  const [replace, setReplace] = useState(false);
  const [trusting, setTrusting] = useState<ExtensionInfo | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const panels = useExtensionPanels('settings');

  if (list.isError) return <QueryError error={list.error} onRetry={list.refetch} />;
  if (list.isLoading) return <Loading />;
  const items = (list.data?.items ?? []).filter((item) =>
    `${item.id} ${item.name} ${item.description ?? ''}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="col" style={{ gap: 14 }}>
      {list.data?.safe_mode ? (
        <div className="card small warn-text concept-hint-heading">
          <span>{t('settings.ext.safeMode')}</span>
          <ConceptHint concept="safeMode" />
        </div>
      ) : null}
      <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
        {list.data?.safe_mode === false ? <ConceptHint concept="safeMode" /> : null}
        <Switch checked={replace} onChange={setReplace} label={t('settings.ext.replace')} />
        <input
          ref={(element) => {
            folderInput.current = element;
            element?.setAttribute('webkitdirectory', '');
          }}
          hidden
          type="file"
          multiple
          onChange={(event) => {
            const files = extensionFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
            if (!files.length) return;
            const problem = extensionFolderError(files);
            if (problem) {
              toastError(t(`settings.ext.${problem}`));
              return;
            }
            install.mutate(
              { files, replace },
              {
                onSuccess: (ext) => {
                  toast(t('settings.ext.installed'));
                  setTrusting(ext);
                },
                onError: toastError,
              },
            );
          }}
        />
        <button
          className="btn"
          disabled={install.isPending}
          onClick={() => folderInput.current?.click()}
        >
          <FolderOpen size={15} /> {t('settings.ext.installFolder')}
        </button>
        <FilePick
          accept=".zip"
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
