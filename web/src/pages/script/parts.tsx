import { Copy, Link2, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import { usePrompt } from '../../api/series';
import {
  DIALOGUE_KINDS,
  type Dialogue,
  type PanelCharacter,
  type PromptSource,
  type Series,
} from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Loading, Select, TagInput, TextInput } from '../../components/ui';

export function CastEditor(props: {
  value: PanelCharacter[];
  series: Series;
  onChange: (v: PanelCharacter[]) => void;
}) {
  const { t } = useTranslation();
  const chars = props.series.bible.characters;
  const used = new Set(props.value.map((c) => c.character_id));
  const free = chars.filter((c) => !used.has(c.id!));
  const edit = (i: number, patch: Partial<PanelCharacter>) =>
    props.onChange(props.value.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="col">
      {props.value.map((pc, i) => {
        const ch = chars.find((c) => c.id === pc.character_id);
        const outfits = Object.keys(ch?.outfits ?? {});
        return (
          <div key={pc.character_id} className="cast-row">
            <strong className="cast-name">{ch?.name ?? pc.character_id}</strong>
            <TextInput
              value={pc.expression}
              onChange={(expression) => edit(i, { expression })}
              placeholder={t('script.expression')}
            />
            <TextInput
              value={pc.action}
              onChange={(action) => edit(i, { action })}
              placeholder={t('script.action')}
            />
            {outfits.length ? (
              <Select
                value={pc.outfit}
                onChange={(outfit) => edit(i, { outfit })}
                options={[
                  { value: '', label: t('script.outfit') },
                  ...outfits.map((o) => ({ value: o, label: o })),
                ]}
              />
            ) : (
              <span />
            )}
            <button
              className="btn ghost icon sm"
              aria-label={t('common.remove')}
              onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}
            >
              <X size={14} />
            </button>
            <div className="cast-tags">
              <TagInput
                value={pc.tags ?? []}
                onChange={(tags) => edit(i, { tags })}
                placeholder={t('common.tags')}
              />
            </div>
          </div>
        );
      })}
      {free.length ? (
        <div className="row wrap">
          {free.map((c) => (
            <button
              key={c.id}
              className="btn sm"
              onClick={() =>
                props.onChange([
                  ...props.value,
                  {
                    character_id: c.id!,
                    outfit: '',
                    expression: '',
                    action: '',
                    tags: [],
                    position: 'unspecified',
                  },
                ])
              }
            >
              <Plus size={13} /> {c.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DialogueEditor(props: {
  value: Dialogue[];
  series: Series;
  onChange: (v: Dialogue[]) => void;
}) {
  const { t } = useTranslation();
  const speakers = [
    { value: '', label: t('script.narrator') },
    ...props.series.bible.characters.map((c) => ({ value: c.id!, label: c.name })),
  ];
  const edit = (i: number, patch: Partial<Dialogue>) =>
    props.onChange(props.value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  return (
    <div className="col">
      {props.value.map((d, i) => (
        <div key={i} className="dialogue-row">
          <Select
            value={d.speaker_id ?? ''}
            options={speakers}
            onChange={(s) => edit(i, { speaker_id: s || null })}
          />
          <Select
            value={d.kind}
            options={DIALOGUE_KINDS.map((k) => ({ value: k, label: t(`script.kinds.${k}`) }))}
            onChange={(kind) => edit(i, { kind })}
          />
          <TextInput value={d.text} onChange={(text) => edit(i, { text })} />
          <button
            className={`btn ghost icon sm ${d.bridge ? 'active' : ''}`}
            title={t('script.bridgeHint')}
            aria-label={t('script.bridge')}
            aria-pressed={d.bridge}
            disabled={d.kind === 'sfx'}
            onClick={() => edit(i, { bridge: !d.bridge })}
          >
            <Link2 size={14} />
          </button>
          <button
            className="btn ghost icon sm"
            aria-label={t('common.remove')}
            onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div>
        <button
          className="btn sm"
          onClick={() =>
            props.onChange([
              ...props.value,
              { speaker_id: null, text: '', kind: 'speech', bridge: false },
            ])
          }
        >
          <Plus size={13} /> {t('script.addLine')}
        </button>
      </div>
    </div>
  );
}

/** Colour bucket for a provenance key ("character:lin" -> "character"). */
const sourceKind = (source: string) => source.split(':')[0];

/** One dialect's tags as chips, each coloured by where it came from. */
function TagChips(props: {
  items: PromptSource[];
  negative?: boolean;
  nameOf: (source: string) => string;
}) {
  return (
    <div className={`tag-chips ${props.negative ? 'negative' : ''}`}>
      {props.items.map((s, i) => (
        <span
          key={`${s.tag}-${i}`}
          className={`tag-chip src-${sourceKind(s.source)}`}
          title={props.nameOf(s.source)}
        >
          {s.tag}
        </span>
      ))}
    </div>
  );
}

/**
 * What will actually be sent: every tag coloured by the field / rule that produced it (so a
 * stray "no humans" or "upper body" is explained), both dialects, and the auto-mounted references.
 */
export function PromptPreview(props: { episodeId: string; panelId: string; series?: Series }) {
  const { t } = useTranslation();
  const q = usePrompt(props.episodeId, props.panelId);
  if (q.isLoading) return <Loading />;
  if (!q.data) return null;
  const p = q.data;
  const characters = new Map(props.series?.bible.characters.map((c) => [c.id, c.name]) ?? []);
  const nameOf = (source: string) => {
    const [kind, id] = source.split(':');
    const base = t(`script.sources.${kind}`);
    return id ? `${base}: ${characters.get(id) ?? id}` : base;
  };
  const sources = p.tags.sources ?? [];
  const negatives = p.tags.negative_sources ?? [];
  const legend = [...new Set([...sources, ...negatives].map((s) => s.source))];
  const hasSources = sources.length > 0 && !p.tags.raw;
  return (
    <div className="col prompt-preview">
      <div className="row small muted">
        <span className="chip">
          {p.tags.width}×{p.tags.height}
        </span>
        {p.tags.raw ? <span className="chip warn">{t('script.rawChip')}</span> : null}
        {p.tags.loras.map((l) => (
          <span key={l.name} className="chip">
            {l.name}
          </span>
        ))}
        <span className="grow" />
        <button
          className="btn ghost sm"
          onClick={() =>
            navigator.clipboard
              ?.writeText(p.tags.positive)
              .then(() => toast(t('common.copied')), toastError)
          }
        >
          <Copy size={13} /> {t('script.copyPrompt')}
        </button>
      </div>
      {p.tags.unresolved.length ? (
        <div className="notice warn">
          {t('script.unresolved', { names: p.tags.unresolved.join('、') })}
        </div>
      ) : null}
      {hasSources ? (
        <>
          <TagChips items={sources} nameOf={nameOf} />
          <TagChips items={negatives} negative nameOf={nameOf} />
          <div className="source-legend small muted" title={t('script.sourceLegend')}>
            {legend.map((s) => (
              <span key={s} className={`tag-chip src-${sourceKind(s)}`}>
                {nameOf(s)}
              </span>
            ))}
          </div>
          <details>
            <summary className="small muted">{t('script.promptText')}</summary>
            <pre className="prompt-box">{p.tags.positive}</pre>
            <pre className="prompt-box negative">{p.tags.negative}</pre>
          </details>
        </>
      ) : (
        <>
          <pre className="prompt-box">{p.tags.positive}</pre>
          <pre className="prompt-box negative">{p.tags.negative}</pre>
        </>
      )}
      <details>
        <summary className="small muted">{t('script.naturalPrompt')}</summary>
        <pre className="prompt-box">{p.natural.positive}</pre>
      </details>
      {p.references.length ? (
        <>
          <div className="small soft">{t('script.references')}</div>
          <div className="ref-strip small">
            {p.references.map((r) => (
              <figure key={r.slot} className="ref-card mini" title={r.reason}>
                <img src={assetUrl(r.asset_id, 160)} alt={r.role} />
                <figcaption className="muted">
                  #{r.slot} {r.owner} · {r.role}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
