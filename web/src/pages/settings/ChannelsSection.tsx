import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchSettings, useRegistry, useSettings } from '../../api/system';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, Loading, NumberInput, Select, TextInput } from '../../components/ui';

export interface ImageChannel {
  id: string;
  label: string;
  kind: string;
  base_url: string;
  api_key: string;
  model: string;
  negative: string;
  width: number;
  height: number;
  size: string;
  quality: string;
  steps: number;
  scale: number;
  sampler: string;
  ref_strength: number;
}

const BUILTIN_KINDS = ['openai_images', 'novelai', 'chat_image'];

export function newChannel(taken: string[]): ImageChannel {
  let n = taken.length + 1;
  while (taken.includes(`ch${n}`)) n += 1;
  return {
    id: `ch${n}`,
    label: '',
    kind: 'openai_images',
    base_url: '',
    api_key: '',
    model: '',
    negative: '',
    width: 832,
    height: 1216,
    size: '',
    quality: '',
    steps: 28,
    scale: 5,
    sampler: 'k_euler_ancestral',
    ref_strength: 0.6,
  };
}

function ChannelCard(props: {
  channel: ImageChannel;
  kinds: string[];
  onChange: (c: ImageChannel) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const c = props.channel;
  const set = (patch: Partial<ImageChannel>) => props.onChange({ ...c, ...patch });
  const novelai = c.kind === 'novelai';
  return (
    <div className="card col" style={{ gap: 12 }}>
      <div className="row">
        <strong className="grow mono">{c.id}</strong>
        <button
          className="btn ghost icon sm danger"
          aria-label={t('common.delete')}
          onClick={props.onRemove}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="grid-3">
        <Field label="ID">
          <TextInput mono value={c.id} onChange={(id) => set({ id: id.toLowerCase() })} />
        </Field>
        <Field label={t('common.name')}>
          <TextInput value={c.label} onChange={(label) => set({ label })} />
        </Field>
        <Field label={t('settings.channels.kind')}>
          <Select
            value={c.kind}
            onChange={(kind) => set({ kind })}
            options={props.kinds.map((k) => ({
              value: k,
              label: t(`settings.channels.kinds.${k}`, { defaultValue: k }),
            }))}
          />
        </Field>
      </div>
      <div className="grid-3">
        <Field label={t('settings.baseUrl')} hint={t('settings.channels.baseUrlHint')}>
          <TextInput mono value={c.base_url} onChange={(base_url) => set({ base_url })} />
        </Field>
        <Field label={t('settings.apiKey')}>
          <TextInput
            mono
            type="password"
            value={c.api_key}
            onChange={(api_key) => set({ api_key })}
          />
        </Field>
        <Field label={t('settings.channels.model')}>
          <TextInput mono value={c.model} onChange={(model) => set({ model })} />
        </Field>
      </div>
      <div className="grid-3">
        <Field label={t('settings.channels.width')}>
          <NumberInput
            value={c.width}
            min={64}
            max={2048}
            onChange={(v) => set({ width: v ?? 832 })}
          />
        </Field>
        <Field label={t('settings.channels.height')}>
          <NumberInput
            value={c.height}
            min={64}
            max={2048}
            onChange={(v) => set({ height: v ?? 1216 })}
          />
        </Field>
        {novelai ? (
          <Field label={t('settings.channels.steps')}>
            <NumberInput
              value={c.steps}
              min={1}
              max={50}
              onChange={(v) => set({ steps: v ?? 28 })}
            />
          </Field>
        ) : (
          <Field label={t('settings.channels.size')} hint="1024x1536">
            <TextInput mono value={c.size} onChange={(size) => set({ size })} />
          </Field>
        )}
      </div>
      <Field label={t('settings.channels.negative')}>
        <TextInput value={c.negative} onChange={(negative) => set({ negative })} />
      </Field>
    </div>
  );
}

export function ChannelsSection() {
  const { t } = useTranslation();
  const settings = useSettings();
  const registry = useRegistry();
  const patch = usePatchSettings();
  const stored = settings.data as unknown as
    { image_channels: ImageChannel[]; image_channel: string } | undefined;
  const [draft, setDraft] = useState<{ list: ImageChannel[]; current: string } | null>(null);

  if (!stored) return <Loading />;
  const list = draft?.list ?? stored.image_channels;
  const current = draft?.current ?? stored.image_channel;
  const kinds = Array.from(
    new Set([...BUILTIN_KINDS, ...(registry.data?.cloud_adapter ?? []).map((a) => a.id)]),
  );
  const edit = (next: ImageChannel[], cur = current) =>
    setDraft({ list: next, current: next.some((c) => c.id === cur) ? cur : '' });
  const ids = list.map((c) => c.id);
  const duplicate = ids.length !== new Set(ids).size;

  return (
    <section className="col" style={{ gap: 14 }}>
      <div className="row">
        <p className="small muted grow" style={{ margin: 0 }}>
          {t('settings.channels.hint')}
        </p>
        <button className="btn" onClick={() => edit([...list, newChannel(ids)])}>
          <Plus size={15} /> {t('settings.channels.add')}
        </button>
      </div>
      <div className="card row" style={{ gap: 12 }}>
        <Field label={t('settings.channels.default')} hint={t('settings.channels.defaultHint')}>
          <Select
            value={current}
            onChange={(v) => setDraft({ list, current: v })}
            options={[
              { value: '', label: t('settings.channels.llmProxy') },
              ...list.map((c) => ({ value: c.id, label: c.label || c.id })),
            ]}
          />
        </Field>
      </div>
      {!list.length ? <Empty>{t('settings.channels.none')}</Empty> : null}
      {list.map((c, i) => (
        <ChannelCard
          key={i}
          channel={c}
          kinds={kinds}
          onChange={(next) =>
            edit(
              list.map((x, j) => (j === i ? next : x)),
              current === c.id ? next.id : current,
            )
          }
          onRemove={() => edit(list.filter((_, j) => j !== i))}
        />
      ))}
      {draft ? (
        <div className="row">
          {duplicate ? (
            <span className="small danger">{t('settings.channels.duplicate')}</span>
          ) : null}
          <span className="grow" />
          <button className="btn ghost" onClick={() => setDraft(null)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={duplicate || patch.isPending}
            onClick={() =>
              patch.mutate(
                { image_channels: list, image_channel: current },
                {
                  onSuccess: () => (toast(t('common.saved')), setDraft(null)),
                  onError: toastError,
                },
              )
            }
          >
            {t('common.save')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
