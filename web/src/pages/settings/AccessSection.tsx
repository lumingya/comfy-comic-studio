import { KeyRound, Plus, Send, Trash2, Webhook } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateToken,
  useDeleteWebhook,
  useDeliveries,
  useRevokeToken,
  useSaveWebhook,
  useTestWebhook,
  useTokens,
  useWebhooks,
  type WebhookInfo,
} from '../../api/open';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, Modal, Switch, TextInput } from '../../components/ui';

function Checks(props: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="scope-row">
      {props.options.map((o) => (
        <label key={o.value} className="small">
          <input
            type="checkbox"
            checked={props.value.includes(o.value)}
            onChange={(e) =>
              props.onChange(
                e.target.checked
                  ? [...props.value, o.value]
                  : props.value.filter((v) => v !== o.value),
              )
            }
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Shows a freshly minted secret exactly once. */
function SecretDialog(props: { secret: string; title: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={!!props.secret}
      onOpenChange={(open) => !open && props.onClose()}
      title={props.title}
      description={t('settings.access.secretOnce')}
      footer={
        <>
          <button
            className="btn"
            onClick={() =>
              navigator.clipboard?.writeText(props.secret).then(() => toast(t('common.copied')))
            }
          >
            {t('common.copy')}
          </button>
          <button className="btn primary" onClick={props.onClose}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="secret-box">{props.secret}</div>
    </Modal>
  );
}

function TokensPanel() {
  const { t } = useTranslation();
  const tokens = useTokens();
  const create = useCreateToken();
  const revoke = useRevokeToken();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [days, setDays] = useState('');
  const [secret, setSecret] = useState('');
  const items = tokens.data?.items ?? [];

  const submit = () => {
    const n = Number(days);
    const expires_at = n > 0 ? new Date(Date.now() + n * 86400_000).toISOString() : '';
    create.mutate(
      { name: name.trim(), scopes, expires_at },
      {
        onSuccess: (tok) => (setSecret(tok.token ?? ''), setName('')),
        onError: toastError,
      },
    );
  };

  return (
    <div className="card col" style={{ gap: 12 }}>
      <h3 className="row" style={{ margin: 0 }}>
        <KeyRound size={16} /> {t('settings.access.tokens')}
      </h3>
      <p className="small muted" style={{ margin: 0 }}>
        {t('settings.access.tokensHint')}
      </p>
      <div className="grid-3">
        <Field label={t('common.name')}>
          <TextInput value={name} onChange={setName} placeholder="astrbot" />
        </Field>
        <Field label={t('settings.access.expiresDays')} hint={t('settings.access.neverHint')}>
          <TextInput value={days} onChange={(v) => setDays(v.replace(/\D/g, ''))} />
        </Field>
        <Field label={t('settings.access.scopes')}>
          <Checks
            options={(tokens.data?.scopes ?? ['read', 'write', 'render', 'admin']).map((s) => ({
              value: s,
              label: t(`settings.access.scope.${s}`, { defaultValue: s }),
            }))}
            value={scopes}
            onChange={setScopes}
          />
        </Field>
      </div>
      <div>
        <button
          className="btn primary"
          disabled={!name.trim() || !scopes.length || create.isPending}
          onClick={submit}
        >
          <Plus size={14} /> {t('settings.access.createToken')}
        </button>
      </div>
      {items.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('settings.access.scopes')}</th>
              <th>{t('settings.access.lastUsed')}</th>
              <th>{t('settings.access.expires')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((tok) => (
              <tr key={tok.id}>
                <td>
                  {tok.name} <span className="small muted mono">…{tok.hint}</span>
                </td>
                <td className="small">{tok.scopes.join(', ')}</td>
                <td className="small muted">{tok.last_used_at || '—'}</td>
                <td className="small muted">{tok.expires_at || t('settings.access.never')}</td>
                <td>
                  <button
                    className="btn ghost icon sm danger"
                    aria-label={t('settings.access.revoke')}
                    onClick={() => revoke.mutate(tok.id, { onError: toastError })}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <SecretDialog
        secret={secret}
        title={t('settings.access.tokenCreated')}
        onClose={() => setSecret('')}
      />
    </div>
  );
}

function Deliveries({ hookId }: { hookId: string }) {
  const { t } = useTranslation();
  const list = useDeliveries(hookId);
  const rows = (list.data ?? []).slice(-8).reverse();
  if (!rows.length) return <p className="small muted">{t('settings.access.noDeliveries')}</p>;
  return (
    <div className="col small mono" style={{ gap: 2 }}>
      {rows.map((d) => (
        <div key={d.id} className={d.error ? 'danger' : 'soft'}>
          {d.at} · {d.event} · {d.status ?? '—'} {d.error ? `· ${d.error}` : ''}
        </div>
      ))}
    </div>
  );
}

function HookRow({ hook, events }: { hook: WebhookInfo; events: Record<string, string> }) {
  const { t } = useTranslation();
  const save = useSaveWebhook();
  const remove = useDeleteWebhook();
  const test = useTestWebhook();
  const [open, setOpen] = useState(false);
  return (
    <div className="card col" style={{ gap: 8 }}>
      <div className="row">
        <strong className="grow">
          {hook.name} <span className="small muted mono">{hook.url}</span>
        </strong>
        <Switch
          checked={hook.enabled}
          onChange={(enabled) =>
            save.mutate({ id: hook.id, body: { enabled } }, { onError: toastError })
          }
        />
        <button
          className="btn sm"
          disabled={test.isPending}
          onClick={() =>
            test.mutate(hook.id, {
              onSuccess: (d) => (toast(d.error || `HTTP ${d.status}`), setOpen(true)),
              onError: toastError,
            })
          }
        >
          <Send size={13} /> {t('settings.access.test')}
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>
          {t('settings.access.log')}
        </button>
        <button
          className="btn ghost icon sm danger"
          aria-label={t('common.delete')}
          onClick={() => remove.mutate(hook.id, { onError: toastError })}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="ext-meta">
        {hook.events.map((e) => (
          <span key={e} className="chip">
            {events[e] ?? e}
          </span>
        ))}
      </div>
      {open ? <Deliveries hookId={hook.id} /> : null}
    </div>
  );
}

function WebhooksPanel() {
  const { t } = useTranslation();
  const hooks = useWebhooks();
  const save = useSaveWebhook();
  const [draft, setDraft] = useState({ name: '', url: '', events: ['job.completed'] });
  const [secret, setSecret] = useState('');
  const events = hooks.data?.events ?? {};
  const items = hooks.data?.items ?? [];
  const valid = draft.name.trim() && /^https?:\/\//.test(draft.url) && draft.events.length;

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card col" style={{ gap: 12 }}>
        <h3 className="row" style={{ margin: 0 }}>
          <Webhook size={16} /> {t('settings.access.webhooks')}
        </h3>
        <p className="small muted" style={{ margin: 0 }}>
          {t('settings.access.webhooksHint')}
        </p>
        <div className="grid-2">
          <Field label={t('common.name')}>
            <TextInput value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
          </Field>
          <Field label="URL">
            <TextInput
              mono
              value={draft.url}
              placeholder="https://"
              onChange={(url) => setDraft({ ...draft, url })}
            />
          </Field>
        </div>
        <Field label={t('settings.access.events')}>
          <Checks
            options={Object.entries(events).map(([value, label]) => ({ value, label }))}
            value={draft.events}
            onChange={(ev) => setDraft({ ...draft, events: ev })}
          />
        </Field>
        <div>
          <button
            className="btn primary"
            disabled={!valid || save.isPending}
            onClick={() =>
              save.mutate(
                { body: { ...draft, enabled: true } },
                {
                  onSuccess: (h) => (
                    setSecret(h.secret),
                    setDraft({ ...draft, name: '', url: '' })
                  ),
                  onError: toastError,
                },
              )
            }
          >
            <Plus size={14} /> {t('settings.access.addWebhook')}
          </button>
        </div>
      </div>
      {!items.length ? <Empty>{t('settings.access.noWebhooks')}</Empty> : null}
      {items.map((h) => (
        <HookRow key={h.id} hook={h} events={events} />
      ))}
      <SecretDialog
        secret={secret}
        title={t('settings.access.webhookCreated')}
        onClose={() => setSecret('')}
      />
    </div>
  );
}

export function AccessSection() {
  return (
    <section className="col" style={{ gap: 18 }}>
      <TokensPanel />
      <WebhooksPanel />
    </section>
  );
}
