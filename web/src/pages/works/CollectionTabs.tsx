import { Plus } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Collection, CollectionsIndex } from '../../api/collections';
import { confirm } from '../../components/confirm';
import { toastError } from '../../components/toast';
import { ActionMenu, Field, Modal } from '../../components/ui';

export function CollectionTabs(props: {
  index: CollectionsIndex | undefined;
  value: string;
  onChange: (value: string) => void;
  busy?: boolean;
  onCreate: (name: string) => Promise<unknown>;
  onRename: (id: string, name: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onDialogChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const tabs = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<Collection | 'new' | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const selected = props.index?.collections.find((c) => c.id === props.value);
  const title = t(editing === 'new' ? 'works.collections.create' : 'works.collections.rename', {
    defaultValue: editing === 'new' ? '新建合集' : '重命名合集',
  });
  const openEditor = (collection: Collection | 'new') => {
    setName(collection === 'new' ? '' : collection.name);
    setEditing(collection);
    props.onDialogChange?.(true);
  };
  const closeEditor = () => {
    setEditing(null);
    props.onDialogChange?.(false);
  };
  const save = async () => {
    if (!editing || saving || !name.trim() || name.trim().length > 80) return;
    setSaving(true);
    try {
      if (editing === 'new') await props.onCreate(name.trim());
      else await props.onRename(editing.id, name.trim());
      closeEditor();
    } catch (error) {
      toastError(error);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (collection: Collection) => {
    props.onDialogChange?.(true);
    try {
      if (
        !(await confirm({
          title: t('works.collections.deleteTitle', {
            defaultValue: '删除「{{name}}」？',
            name: collection.name,
          }),
          description: t('works.collections.deleteDescription', {
            defaultValue: '画册将保留在未归类中。',
          }),
          confirmLabel: t('common.delete'),
          danger: true,
        }))
      )
        return;
      await props.onDelete(collection.id);
      if (props.value === collection.id) props.onChange('');
    } catch (error) {
      toastError(error);
    } finally {
      props.onDialogChange?.(false);
    }
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = [...(tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const position = buttons.indexOf(event.target as HTMLButtonElement);
    if (position < 0) return;
    const next =
      event.key === 'ArrowRight'
        ? (position + 1) % buttons.length
        : event.key === 'ArrowLeft'
          ? (position + buttons.length - 1) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus();
    buttons[next].click();
  };
  const entries = [
    {
      id: '',
      name: t('works.collections.all', { defaultValue: '全部' }),
      count: props.index?.total_count,
    },
    {
      id: 'unfiled',
      name: t('works.collections.unfiled', { defaultValue: '未归类' }),
      count: props.index?.unfiled_count,
    },
    ...(props.index?.collections ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      count: c.album_count,
    })),
  ];
  return (
    <div className="shelf-collections">
      <div
        className="shelf-collection-tabs"
        ref={tabs}
        role="tablist"
        aria-label={t('works.collections.label', { defaultValue: '合集' })}
        onKeyDown={onTabKey}
      >
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className={`shelf-collection-tab ${props.value === entry.id ? 'active' : ''}`}
            aria-selected={props.value === entry.id}
            tabIndex={props.value === entry.id ? 0 : -1}
            data-shelf-collection={entry.id ? (entry.id === 'unfiled' ? '' : entry.id) : undefined}
            onClick={() => props.onChange(entry.id)}
          >
            <span>{entry.name}</span>
            {entry.count !== undefined ? <span className="mono">{entry.count}</span> : null}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn ghost icon sm"
        disabled={props.busy || !props.index}
        aria-label={t('works.collections.create', { defaultValue: '新建合集' })}
        title={t('works.collections.create', { defaultValue: '新建合集' })}
        onClick={() => openEditor('new')}
      >
        <Plus size={16} />
      </button>
      {selected ? (
        <ActionMenu
          label={t('works.collections.manage', { defaultValue: '管理合集' })}
          actions={[
            {
              label: t('works.collections.rename', { defaultValue: '重命名合集' }),
              disabled: props.busy,
              onSelect: () => openEditor(selected),
            },
            {
              label: t('works.collections.delete', { defaultValue: '删除合集' }),
              disabled: props.busy,
              danger: true,
              onSelect: () => void remove(selected),
            },
          ]}
        />
      ) : null}
      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && !saving && closeEditor()}
        title={title}
        footer={
          <>
            <button type="button" className="btn" disabled={saving} onClick={closeEditor}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="shelf-collection-form"
              className="btn primary"
              disabled={saving || !name.trim() || name.trim().length > 80}
            >
              {t('common.save')}
            </button>
          </>
        }
      >
        <form
          id="shelf-collection-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={t('works.collections.name', { defaultValue: '合集名称' })}>
            <input
              autoFocus
              value={name}
              maxLength={80}
              disabled={saving}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
