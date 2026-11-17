import { useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import {
  discoverAssistModels,
  useAssistAction,
  useAssistTools,
  type AssistChannel,
  type AssistSettings as Settings,
} from './api';
import { Field, Modal, Select, Switch, TextInput } from './ui';
import { SecretInput } from './ui';
import { toast } from './runtime';
import { useAssistText } from './strings';

const defaults: Record<AssistChannel['provider'], string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};
const connection = (channel: AssistChannel) =>
  JSON.stringify([channel.id, channel.provider, channel.base_url, channel.api_key]);

export function AssistSettings({
  settings,
  onClose,
  onModeChange,
}: {
  settings: Settings;
  onClose: () => void;
  onModeChange: (mode: Settings['mode']) => void;
}) {
  const text = useAssistText();
  const [draft, setDraft] = useState(settings);
  const [tab, setTab] = useState<'channels' | 'permissions' | 'appearance'>('channels');
  const [selected, setSelected] = useState(draft.active_channel_id || draft.channels[0]?.id || '');
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [modelsFor, setModelsFor] = useState('');
  const [fetching, setFetching] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const save = useAssistAction<Settings>();
  const tools = useAssistTools(tab === 'permissions');
  const channel = draft.channels.find((c) => c.id === selected);
  const patchChannel = (patch: Partial<AssistChannel>) =>
    setDraft((d) => ({
      ...d,
      channels: d.channels.map((c) => (c.id === selected ? { ...c, ...patch } : c)),
    }));
  const patchPermissions = (patch: Partial<Settings['permissions']>) =>
    setDraft((d) => ({ ...d, permissions: { ...d.permissions, ...patch } }));
  const add = () => {
    const id = `channel_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    setDraft((d) => ({
      ...d,
      active_channel_id: d.active_channel_id || id,
      channels: [
        ...d.channels,
        { id, name: '', provider: 'openai', base_url: defaults.openai, api_key: '', model: '' },
      ],
    }));
    setSelected(id);
  };
  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);
  const submit = () => {
    const channels = draft.channels.map((c) => ({
      ...c,
      name: c.name.trim(),
      base_url: c.base_url.trim(),
      model: c.model.trim(),
    }));
    if (channels.some((c) => !c.name || !c.model || !/^https?:\/\//i.test(c.base_url))) {
      setError(text('invalidChannel'));
      setTab('channels');
      return;
    }
    const { storage_path: _path, ...body } = { ...draft, channels };
    save.mutate(
      { path: '/settings', method: 'PUT', body },
      {
        onSuccess: () => {
          toast(text('saved'));
          onClose();
          if (draft.mode !== settings.mode) onModeChange(draft.mode);
        },
        onError: (e) => setError(e.message),
      },
    );
  };
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={`${text('title')} · ${text('settings')}`}
      size="lg"
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={save.isPending}>
            {text('cancel')}
          </button>
          <button className="btn primary" onClick={submit} disabled={!dirty || save.isPending}>
            {text('save')}
          </button>
        </>
      }
    >
      <div className="assist-config-tabs" role="tablist" aria-label={text('settings')}>
        {(['channels', 'permissions', 'appearance'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`btn ghost ${tab === key ? 'active' : ''}`}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {text(key)}
          </button>
        ))}
      </div>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="assist-config-body">
        {tab === 'channels' ? (
          <>
            <div className="row wrap">
              <Select
                aria-label={text('chooseChannel')}
                value={selected}
                onChange={(id) => {
                  setSelected(id);
                  setModelSearch('');
                }}
                options={
                  draft.channels.length
                    ? draft.channels.map((c) => ({ value: c.id, label: c.name || c.provider }))
                    : [{ value: '', label: text('noChannel') }]
                }
              />
              <button className="btn" onClick={add}>
                <Plus size={16} />
                {text('addChannel')}
              </button>
              {channel ? (
                <button
                  className="btn ghost icon"
                  aria-label={text('remove')}
                  onClick={() => {
                    const channels = draft.channels.filter((c) => c.id !== selected);
                    setDraft({
                      ...draft,
                      channels,
                      active_channel_id:
                        draft.active_channel_id === selected
                          ? channels[0]?.id || ''
                          : draft.active_channel_id,
                    });
                    setSelected(channels[0]?.id || '');
                  }}
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
            {channel ? (
              <div className="assist-channel-form">
                <div className="grid-2">
                  <Field label={text('name')}>
                    <TextInput
                      value={channel.name}
                      onChange={(name) => patchChannel({ name })}
                      maxLength={80}
                    />
                  </Field>
                  <Field label={text('provider')}>
                    <Select
                      value={channel.provider}
                      onChange={(provider) => {
                        patchChannel({
                          provider,
                          base_url: defaults[provider],
                          api_key: '',
                          model: '',
                        });
                        setModelsFor('');
                      }}
                      options={[
                        { value: 'openai', label: 'OpenAI Compatible' },
                        { value: 'deepseek', label: 'DeepSeek' },
                        { value: 'gemini', label: 'Gemini' },
                      ]}
                    />
                  </Field>
                </div>
                <Field label={text('address')}>
                  <TextInput
                    type="url"
                    value={channel.base_url}
                    onChange={(base_url) => patchChannel({ base_url })}
                  />
                </Field>
                <Field label={text('key')}>
                  <SecretInput
                    value={channel.api_key}
                    onChange={(api_key) => patchChannel({ api_key })}
                  />
                </Field>
                <div className="assist-model-row">
                  <Field label={text('model')}>
                    <TextInput
                      value={channel.model}
                      onChange={(model) => patchChannel({ model })}
                      placeholder={text('modelSearch')}
                    />
                  </Field>
                  <button
                    className="btn"
                    disabled={fetching || !channel.base_url.trim()}
                    onClick={async () => {
                      const snapshot = { ...channel };
                      setFetching(true);
                      setError('');
                      try {
                        const response = await discoverAssistModels(snapshot);
                        setModels(response.items);
                        setModelsFor(connection(snapshot));
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setFetching(false);
                      }
                    }}
                  >
                    <Download size={15} />
                    {fetching ? text('running') : text('models')}
                  </button>
                </div>
                {modelsFor && modelsFor === connection(channel) ? (
                  <div className="assist-model-results">
                    <TextInput
                      aria-label={text('modelSearch')}
                      value={modelSearch}
                      onChange={setModelSearch}
                      placeholder={text('modelSearch')}
                    />
                    <div className="assist-model-list">
                      {models.length ? (
                        models
                          .filter((m) =>
                            `${m.id} ${m.name || ''}`
                              .toLowerCase()
                              .includes(modelSearch.toLowerCase()),
                          )
                          .map((m) => (
                            <button
                              key={m.id}
                              className={`btn ghost ${channel.model === m.id ? 'active' : ''}`}
                              onClick={() => patchChannel({ model: m.id })}
                            >
                              {m.name || m.id}
                            </button>
                          ))
                      ) : (
                        <p className="muted">{text('noModels')}</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted">{text('noChannel')}</p>
            )}
          </>
        ) : null}
        {tab === 'permissions' ? (
          <>
            <div className="assist-permission-categories">
              {(['read', 'write', 'render', 'admin'] as const).map((scope) => (
                <Switch
                  key={scope}
                  label={text(scope)}
                  checked={draft.permissions.scopes.includes(scope)}
                  onChange={(checked) =>
                    patchPermissions({
                      scopes: checked
                        ? [...draft.permissions.scopes, scope]
                        : draft.permissions.scopes.filter((s) => s !== scope),
                    })
                  }
                />
              ))}
            </div>
            <Switch
              label={text('confirmation')}
              checked={draft.permissions.confirm_mutations}
              onChange={(confirm_mutations) => patchPermissions({ confirm_mutations })}
            />
            <details className="assist-operations">
              <summary>{text('toolDetails')}</summary>
              <TextInput
                value={search}
                onChange={setSearch}
                placeholder={text('operationSearch')}
                aria-label={text('operationSearch')}
              />
              {tools.isError ? (
                <button className="btn" onClick={() => void tools.refetch()}>
                  {text('retryRead')}
                </button>
              ) : null}
              <div className="assist-operation-list">
                {(tools.data?.items || [])
                  .filter((tool) =>
                    `${tool.summary} ${tool.path} ${tool.id}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((tool) => (
                    <div className="assist-operation" key={tool.id}>
                      <div>
                        <strong>{tool.summary || tool.id}</strong>
                        <small>
                          {tool.method} {tool.path}
                        </small>
                        {tool.configurable === false ? <small>{tool.reason}</small> : null}
                      </div>
                      <Select
                        aria-label={tool.summary || tool.id}
                        disabled={tool.configurable === false}
                        value={
                          tool.configurable === false ||
                          draft.permissions.deny_operations.includes(tool.id)
                            ? 'deny'
                            : draft.permissions.allow_operations.includes(tool.id)
                              ? 'allow'
                              : 'default'
                        }
                        options={[
                          { value: 'default', label: text('operationDefault') },
                          { value: 'allow', label: text('operationAllow') },
                          { value: 'deny', label: text('operationDeny') },
                        ]}
                        onChange={(value) =>
                          patchPermissions({
                            allow_operations: [
                              ...draft.permissions.allow_operations.filter((id) => id !== tool.id),
                              ...(value === 'allow' ? [tool.id] : []),
                            ],
                            deny_operations: [
                              ...draft.permissions.deny_operations.filter((id) => id !== tool.id),
                              ...(value === 'deny' ? [tool.id] : []),
                            ],
                          })
                        }
                      />
                    </div>
                  ))}
              </div>
            </details>
          </>
        ) : null}
        {tab === 'appearance' ? (
          <>
            <Field label={text('appearance')}>
              <Select
                value={draft.mode}
                onChange={(mode) => setDraft({ ...draft, mode })}
                options={[
                  { value: 'floating', label: text('floating') },
                  { value: 'page', label: text('page') },
                ]}
              />
            </Field>
            {settings.storage_path ? (
              <div className="assist-storage">
                <span>{text('storage')}</span>
                <code>{settings.storage_path}</code>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
