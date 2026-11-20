import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { localId, type Preset } from '../../api/workshop';
import { Icon } from '../../app/icons';
import { SaveState } from '../../components/SaveState';
import { confirm } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { downloadJson, presetToFile } from './files';
import { ExportPicker } from './ExportPicker';
import type { PresetLibrary } from './presetsState';

export function PresetHeader({
  library,
  headRef,
  onPreview,
}: {
  library: PresetLibrary;
  headRef: RefObject<HTMLDivElement | null>;
  onPreview: () => void;
}) {
  const { t } = useTranslation();
  const { current, presets, draft, choose, commit, update } = library;
  const [renaming, setRenaming] = useState(false);
  const cancelRename = useRef(false);
  if (!current) return null;
  return (
    <div className="workshop-asset-head" ref={headRef}>
      <label>
        {t('ws.presets.current')}
        {renaming ? (
          <input
            autoFocus
            onFocus={() => {
              cancelRename.current = false;
            }}
            defaultValue={current.title}
            aria-label={t('ws.presets.name')}
            onBlur={(e) => {
              if (cancelRename.current) {
                cancelRename.current = false;
                setRenaming(false);
                return;
              }
              const title = e.target.value.trim();
              if (title && title !== current.title) update((p) => ({ ...p, title }), true);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename.current = true;
                setRenaming(false);
              }
            }}
          />
        ) : (
          <select
            id="workshop-preset-select"
            value={current.id}
            onChange={(e) => choose(e.target.value)}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
      </label>
      <SaveState state={draft.state} />
      {draft.state === 'error' ? (
        <button
          type="button"
          className="btn small"
          onClick={() => void draft.flushAll().catch(toastError)}
        >
          {t('common.save')}
        </button>
      ) : null}
      <div>
        <button type="button" className="btn" onClick={() => setRenaming(!renaming)}>
          <Icon name="edit" />
          {t('ws.rename')}
        </button>
        <button
          type="button"
          className="btn"
          title={t('ws.presets.previewDesc')}
          onClick={onPreview}
        >
          <Icon name="brush" />
          {t('ws.presets.preview')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const copy: Preset = {
              ...structuredClone(current),
              id: localId('preset'),
              title: t('ws.presets.copyOf', { title: current.title }),
            };
            commit([...presets, copy], true);
            choose(copy.id!);
          }}
        >
          <Icon name="copy" />
          {t('ws.presets.duplicate')}
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={presets.length < 2}
          onClick={async () => {
            if (
              !(await confirm({
                title: t('ws.presets.removeConfirm', { title: current.title }),
                description: t('ws.presets.removeHelp'),
                danger: true,
              }))
            )
              return;
            const rest = presets.filter((p) => p.id !== current.id);
            commit(rest, true);
            choose(rest[0]?.id ?? '');
          }}
        >
          <Icon name="trash" />
          {t('ws.remove')}
        </button>
      </div>
    </div>
  );
}

export function PresetLibraryActions({
  library,
  exporting,
  onExportingChange,
}: {
  library: PresetLibrary;
  exporting: boolean;
  onExportingChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { current, presets, draft, addPreset, importPresets } = library;
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={importPresets}
        title={t('ws.presets.importHint')}
      >
        <Icon name="download" />
        {t('ws.import')}
      </button>
      <button
        type="button"
        className="btn"
        disabled={!presets.length}
        title={t('ws.exportPick.presetHint')}
        onClick={() => onExportingChange(true)}
      >
        <Icon name="upload" />
        {t('ws.exportDots')}
      </button>
      {exporting ? (
        <ExportPicker
          title={t('ws.exportPick.presetTitle')}
          noun={t('ws.exportPick.presetNoun')}
          items={presets.map((p) => ({
            id: p.id!,
            title: p.title,
            meta: t('ws.exportPick.vars', { count: p.entries.length }),
          }))}
          current={current?.id}
          onClose={() => onExportingChange(false)}
          onExport={async (ids) => {
            await draft.flushAll();
            const chosen = draft.read().filter((p) => ids.includes(p.id!));
            if (chosen.length === 1)
              downloadJson(`${chosen[0].title}.json`, presetToFile(chosen[0]));
            else {
              downloadJson(
                `${t('ws.exportPick.presetBundle', { count: chosen.length })}.json`,
                chosen.map(presetToFile),
              );
              toast(
                t('ws.exportPick.done', {
                  count: chosen.length,
                  noun: t('ws.exportPick.presetNoun'),
                }),
              );
            }
          }}
        />
      ) : null}
      <button type="button" className="btn" onClick={() => void addPreset()}>
        <Icon name="plus" />
        {t('ws.presets.new')}
      </button>
    </>
  );
}
