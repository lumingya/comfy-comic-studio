import { Activity, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useDeleteInstance,
  useInstanceHealth,
  useInstances,
  useSaveInstance,
} from '../../api/system';
import type { ComfyInstance } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Empty, NumberInput, Switch, TagInput, TextInput } from '../../components/ui';
import { rid } from '../bible/BibleTab';

function InstanceRow({
  instance,
  isNew,
  onDone,
}: {
  instance: ComfyInstance;
  isNew: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const save = useSaveInstance();
  const remove = useDeleteInstance();
  const health = useInstanceHealth();
  const [d, setD] = useState(instance);
  const dirty = isNew || JSON.stringify(d) !== JSON.stringify(instance);
  const status = health.data?.id === d.id ? health.data : undefined;

  return (
    <tr>
      <td>
        <TextInput value={d.name} onChange={(name) => setD({ ...d, name })} />
      </td>
      <td>
        <TextInput
          mono
          value={d.base_url}
          onChange={(base_url) => setD({ ...d, base_url })}
          placeholder="http://127.0.0.1:8188"
        />
      </td>
      <td style={{ width: 80 }}>
        <NumberInput
          value={d.capacity}
          min={1}
          max={16}
          onChange={(v) => setD({ ...d, capacity: v ?? 1 })}
        />
      </td>
      <td>
        <TagInput value={d.tags} onChange={(tags) => setD({ ...d, tags })} />
      </td>
      <td>
        <Switch checked={d.enabled} onChange={(enabled) => setD({ ...d, enabled })} />
      </td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          {!isNew ? (
            <button
              className="btn ghost sm"
              disabled={health.isPending}
              onClick={() => health.mutate(d.id, { onError: toastError })}
            >
              <Activity size={13} />
              {status ? (
                <span className={status.ok ? 'accent-text' : 'danger'}>
                  {status.ok ? 'OK' : '✗'}
                </span>
              ) : null}
            </button>
          ) : null}
          {dirty ? (
            <button
              className="btn primary sm"
              disabled={!d.base_url.trim() || save.isPending}
              onClick={() =>
                save.mutate(
                  { instance: d, isNew },
                  { onSuccess: () => (toast(t('common.saved')), onDone()), onError: toastError },
                )
              }
            >
              {t('common.save')}
            </button>
          ) : null}
          <button
            className="btn ghost icon sm danger"
            aria-label={t('common.delete')}
            onClick={() => (isNew ? onDone() : remove.mutate(d.id, { onError: toastError }))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function InstancesSection() {
  const { t } = useTranslation();
  const instances = useInstances();
  const [draft, setDraft] = useState<ComfyInstance | null>(null);
  const list = instances.data?.instances ?? [];

  return (
    <section className="col" style={{ gap: 14 }}>
      <div className="row">
        <p className="small muted grow" style={{ margin: 0 }}>
          {t('settings.instancesHint')}
        </p>
        <button
          className="btn"
          disabled={!!draft}
          onClick={() =>
            setDraft({
              id: rid('comfy'),
              name: `ComfyUI ${list.length + 1}`,
              base_url: '',
              enabled: true,
              capacity: 1,
              tags: [],
            } as unknown as ComfyInstance)
          }
        >
          <Plus size={15} /> {t('settings.addInstance')}
        </button>
      </div>
      {!list.length && !draft ? <Empty>{t('settings.noInstances')}</Empty> : null}
      {list.length || draft ? (
        <table className="table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>URL</th>
              <th>{t('settings.capacity')}</th>
              <th>{t('common.tags')}</th>
              <th>{t('settings.enabled')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <InstanceRow
                key={`${i.id}${i.base_url}${i.capacity}`}
                instance={i}
                isNew={false}
                onDone={() => undefined}
              />
            ))}
            {draft ? (
              <InstanceRow key={draft.id} instance={draft} isNew onDone={() => setDraft(null)} />
            ) : null}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
