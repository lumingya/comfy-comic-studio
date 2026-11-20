import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { localId, useSavePresets, type Preset, type PresetEntry } from '../../api/workshop';
import type { Series } from '../../api/types';
import { useAutoDraft } from '../../app/useAutoDraft';
import { promptText } from '../../components/confirm';
import { toast, toastError } from '../../components/toast';
import { pickJsonFiles, presetFromFile } from './files';

const pickKey = (seriesId: string) => `mio.workshop.preset.${seriesId}`;
function blankPreset(title: string): Preset {
  const people = { id: localId('group'), title: '主角与服装' };
  const visual = { id: localId('group'), title: '画风与场景' };
  const e = (key: string, label: string, group: string): PresetEntry => ({
    id: localId('var'),
    key,
    label,
    value: '',
    hint: '',
    group_id: group,
  });
  return {
    id: localId('preset'),
    title,
    groups: [people, visual],
    entries: [
      e('character_display_name', '角色展示名 / 旁白', people.id),
      e('character', '角色名 / 提示词', people.id),
      e('outfit', '服装', people.id),
      e('style', '画风', visual.id),
      e('scene', '场景与环境', visual.id),
    ],
    bindings: [],
  };
}

export function usePresetLibrary(workshop: Series) {
  const { t } = useTranslation();
  const save = useSavePresets(workshop.id);
  const draft = useAutoDraft(workshop.presets, (next) => save.mutateAsync(next), 700);
  const kitId = workshop.kind === 'kit' ? workshop.id : undefined;
  const presets = draft.value;
  const [pick, setPick] = useState(() => localStorage.getItem(pickKey(workshop.id)) ?? '');
  // ?new=1 (help drawer / 开箱检查 「新建预设」): add a blank preset once and select it.
  const [params, setParams] = useSearchParams();
  const newHandled = useRef(false);
  useEffect(() => {
    if (!params.has('new')) {
      newHandled.current = false;
      return;
    }
    if (!presets || newHandled.current) return;
    newHandled.current = true;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
    const p = blankPreset(t('ws.presets.untitled', { n: presets.length + 1 }));
    const next = [...presets, p];
    draft.change(next);
    void draft.flushAll().catch(toastError);
    setPick(p.id!);
    localStorage.setItem(pickKey(workshop.id), p.id!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, params]);
  const commit = (next: Preset[] | ((previous: Preset[]) => Preset[]), now = false) => {
    draft.change(next);
    if (now) void draft.flushAll().catch(toastError);
  };
  const current = presets.find((p) => p.id === pick) ?? presets[0];
  const choose = (id: string) => {
    setPick(id);
    localStorage.setItem(pickKey(workshop.id), id);
  };
  const update = (fn: (p: Preset) => Preset, now = false) =>
    commit((previous) => previous.map((p) => (p.id === current?.id ? fn(p) : p)), now);

  // Legacy workshop-new: the name is asked first (blank names are refused).
  const addPreset = async () => {
    const title = await promptText({
      title: t('ws.presets.new'),
      label: t('ws.assetName'),
      value: t('ws.presets.untitled', { n: presets.length + 1 }),
      confirmLabel: t('common.create'),
      required: true,
    });
    if (title === null) return;
    const p = blankPreset(title);
    commit([...presets, p], true);
    choose(p.id!);
  };
  const importPresets = async () => {
    try {
      const added = (await pickJsonFiles()).map(presetFromFile);
      if (!added.length) return;
      commit((previous) => [...previous, ...added], true);
      choose(added[added.length - 1].id!);
      toast(t('ws.imported', { count: added.length }));
    } catch (e) {
      toastError(e);
    }
  };

  const addEntry = (group_id: string | null) => {
    if (!current) return;
    const used = new Set(current.entries.map((e) => e.key));
    let n = current.entries.length + 1;
    while (used.has(`var${n}`)) n += 1;
    update(
      (p) => ({
        ...p,
        entries: [
          ...p.entries,
          { id: localId('var'), key: `var${n}`, label: '', value: '', hint: '', group_id },
        ],
      }),
      true,
    );
  };
  return {
    draft,
    kitId,
    presets,
    current,
    choose,
    commit,
    update,
    addPreset,
    importPresets,
    addEntry,
  };
}

export type PresetLibrary = ReturnType<typeof usePresetLibrary>;
