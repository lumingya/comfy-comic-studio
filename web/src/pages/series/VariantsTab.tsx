import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchSeries } from '../../api/series';
import { useProfiles } from '../../api/system';
import type { VariantSet } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, Select, TagInput, TextInput } from '../../components/ui';
import { rid } from '../bible/BibleTab';
import { useSeriesContext } from './SeriesPage';

export default function VariantsTab() {
  const { t } = useTranslation();
  const { series } = useSeriesContext();
  const patch = usePatchSeries(series.id);
  const profiles = useProfiles();
  const [variants, setVariants] = useState<VariantSet[]>(series.variants ?? []);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setVariants(series.variants ?? []);
    setDirty(false);
  }, [series.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (id: string, changes: Partial<VariantSet>) => {
    setVariants(variants.map((v) => (v.id === id ? { ...v, ...changes } : v)));
    setDirty(true);
  };

  const add = () => {
    setVariants([
      ...variants,
      {
        id: rid('var'),
        name: `${t('variants.add')} ${variants.length + 1}`,
        characters: {},
        style_id: null,
        profile_id: null,
      },
    ]);
    setDirty(true);
  };

  const save = () =>
    patch.mutate({ variants }, { onSuccess: () => toast(t('common.saved')), onError: toastError });

  const styleOptions = [
    { value: '', label: t('common.auto') },
    ...series.bible.styles.map((s) => ({ value: s.id!, label: s.name })),
  ];
  const profileOptions = [
    { value: '', label: t('common.auto') },
    ...(profiles.data ?? []).map((p) => ({ value: p.id!, label: p.name })),
  ];

  return (
    <section>
      <div className="row" style={{ marginBottom: 16 }}>
        <p className="muted small grow" style={{ margin: 0 }}>
          {t('variants.hint')}
        </p>
        <button className="btn" onClick={add}>
          <Plus size={15} /> {t('variants.add')}
        </button>
        <button className="btn primary" disabled={!dirty || patch.isPending} onClick={save}>
          {t('common.save')}
        </button>
      </div>
      {!variants.length ? <Empty>{t('common.empty')}</Empty> : null}
      <div className="variant-grid">
        {variants.map((v) => (
          <article key={v.id} className="card">
            <div className="row" style={{ marginBottom: 14 }}>
              <TextInput
                className="bare grow"
                value={v.name}
                onChange={(name) => edit(v.id!, { name })}
              />
              <button
                className="btn ghost icon sm danger"
                aria-label={t('common.delete')}
                onClick={() => (setVariants(variants.filter((x) => x.id !== v.id)), setDirty(true))}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="grid-2" style={{ marginBottom: 14 }}>
              <Field label={t('variants.style')}>
                <Select
                  value={v.style_id ?? ''}
                  options={styleOptions}
                  onChange={(s) => edit(v.id!, { style_id: s || null })}
                />
              </Field>
              <Field label={t('variants.profile')}>
                <Select
                  value={v.profile_id ?? ''}
                  options={profileOptions}
                  onChange={(p) => edit(v.id!, { profile_id: p || null })}
                />
              </Field>
            </div>
            <div className="col">
              {series.bible.characters.map((c) => {
                const override = (v.characters?.[c.id!] ?? {}) as { tag_description?: string[] };
                return (
                  <Field key={c.id} label={t('variants.override', { name: c.name })}>
                    <TagInput
                      value={override.tag_description ?? []}
                      placeholder={(c.tag_description ?? []).join(', ')}
                      onChange={(tags) => {
                        const characters = { ...(v.characters ?? {}) };
                        if (tags.length) characters[c.id!] = { ...override, tag_description: tags };
                        else delete characters[c.id!];
                        edit(v.id!, { characters });
                      }}
                    />
                  </Field>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
