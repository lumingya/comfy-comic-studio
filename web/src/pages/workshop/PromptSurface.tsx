import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { topDialog } from '../../components/topLayer';

/** Variable name → has a (non-empty) value somewhere. */
export type KnownVariables = Map<string, boolean>;
/** One definition of a variable: the preset that provides it and the value it gives there. */
export interface PromptSource {
  title: string;
  value: string;
}
/** Variable name → every preset defining it, in library order (production keeps the last one). */
export type PromptSources = Map<string, PromptSource[]>;
/** Variable name → how many times the story already uses it. */
export type PromptUsage = Map<string, number>;
export type VariableState = 'defined' | 'empty' | 'unknown';

/** Same grammar as the server (`pipeline/variables.py`): `{{` / `}}` escape, names ≤ 64 chars. */
const TOKEN = /\{\{|\}\}|\{([^{}\s][^{}]{0,63})\}/g;
const NAME_CHAR = /[\p{L}\p{N}_]/u;

export function variableState(key: string, known: KnownVariables): VariableState {
  return !known.has(key) ? 'unknown' : known.get(key) ? 'defined' : 'empty';
}

/** Unique variables of a text, in order of first use, split by state (legacy promptVariableReport). */
export function variableReport(text: string, known: KnownVariables) {
  const names: string[] = [];
  for (const m of text.matchAll(TOKEN)) if (m[1] && !names.includes(m[1])) names.push(m[1]);
  const by = (state: VariableState) => names.filter((k) => variableState(k, known) === state);
  return { names, defined: by('defined'), empty: by('empty'), unknown: by('unknown') };
}

/** How many times each variable appears across `texts` (the story's prompts and negatives). */
export function variableUsage(texts: readonly string[]): PromptUsage {
  const counts: PromptUsage = new Map();
  for (const text of texts)
    for (const m of text.matchAll(TOKEN)) if (m[1]) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  return counts;
}

/** True while a `{` is still waiting for its `}` (legacy hasUnclosedBrace). */
export function hasUnclosedBrace(text: string): boolean {
  let open = 0;
  for (const ch of text) {
    if (ch === '{') open += 1;
    else if (ch === '}' && open > 0) open -= 1;
  }
  return open > 0;
}

function paint(text: string, known: KnownVariables): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (!m[1]) continue;
    const state = variableState(m[1], known);
    out.push(text.slice(at, m.index));
    out.push(
      <mark
        key={m.index}
        className={state === 'defined' ? '' : `${state}-token`}
        data-prompt-variable={m[1]}
        data-state={state}
      >
        {m[0]}
      </mark>,
    );
    at = m.index! + m[0].length;
  }
  out.push(text.slice(at) + '\n');
  return out;
}

/* ---- Variable completion --------------------------------------------------------------------
   Typing "{" opens a listbox of candidates the way an IDE completes identifiers (legacy
   ui-editors.js). Each candidate names its source preset and warns when several presets define
   the same key, because production keeps the last preset in assembly order for a repeated key.
   Names already used in the story but defined nowhere are offered too, marked as undefined, so a
   typo is visible early. Completion never rewrites text on its own: only an explicit Enter / Tab /
   click inserts "{name}" at the caret. */

export interface CompletionRange {
  start: number;
  end: number;
  query: string;
  closed: boolean;
}

/** Where the caret sits inside an open `{name` token, or null. `{{` groups and `\{` never trigger. */
export function completionQueryAt(text: string, caret: number): CompletionRange | null {
  const end = Math.max(0, Math.min(caret, text.length));
  let i = end;
  while (i > 0 && NAME_CHAR.test(text[i - 1])) i -= 1;
  if (i === 0 || text[i - 1] !== '{') return null;
  const start = i - 1;
  if (text[start - 1] === '{' || text[start - 1] === '\\') return null;
  if (end < text.length && NAME_CHAR.test(text[end])) return null;
  return { start, end, query: text.slice(i, end), closed: text[end] === '}' };
}

export interface Candidate {
  key: string;
  state: VariableState;
  sources: PromptSource[];
  used: number;
  preview: string;
}

const preview = (value: string) => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
};

/** Every defined key plus every key the story uses, with its sources and state. */
export function completionCandidates(
  known: KnownVariables,
  sources?: PromptSources,
  used?: PromptUsage,
): Candidate[] {
  return [...new Set([...known.keys(), ...(used?.keys() ?? [])])].map((key) => {
    const list = sources?.get(key) ?? [];
    return {
      key,
      state: variableState(key, known),
      sources: list,
      used: used?.get(key) ?? 0,
      preview: preview((list.find((s) => s.value.trim()) ?? list[0])?.value ?? ''),
    };
  });
}

/**
 * Prefix matches first, then word-boundary and substring matches; ties prefer defined names and
 * names the story already uses. No fuzzy matching: with a few dozen variables, predictable beats
 * clever. An empty query lists everything.
 */
export function rankCompletions(candidates: Candidate[], query = '', limit = 8): Candidate[] {
  const needle = query.toLowerCase();
  const order: Record<VariableState, number> = { defined: 0, empty: 1, unknown: 2 };
  const score = (key: string) => {
    if (!needle) return 1;
    const hay = key.toLowerCase();
    if (hay === needle) return 5;
    if (hay.startsWith(needle)) return 4;
    if (hay.split('_').some((part) => part.startsWith(needle))) return 3;
    return hay.includes(needle) ? 2 : 0;
  };
  return candidates
    .map((item) => ({ item, score: score(item.key) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        order[a.item.state] - order[b.item.state] ||
        b.item.used - a.item.used ||
        a.item.key.localeCompare(b.item.key),
    )
    .slice(0, limit)
    .map((entry) => entry.item);
}

/** Replace the open `{name` token with `{key}`, reusing a closing brace that is already there. */
export function applyCompletion(
  text: string,
  range: CompletionRange,
  key: string,
): { text: string; caret: number } {
  const end = range.closed ? range.end + 1 : range.end;
  const replacement = `{${key}}`;
  return {
    text: text.slice(0, range.start) + replacement + text.slice(end),
    caret: range.start + replacement.length,
  };
}

interface CompletionState {
  range: CompletionRange;
  items: Candidate[];
  index: number;
}

/** Viewport rectangle of a text index, measured on a hidden clone of the paint layer. */
function caretRect(textarea: HTMLTextAreaElement, pre: HTMLPreElement | null, index: number) {
  if (!pre?.parentNode) return textarea.getBoundingClientRect();
  const mirror = pre.cloneNode(false) as HTMLPreElement;
  mirror.style.visibility = 'hidden';
  mirror.removeAttribute('id');
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(
    document.createTextNode(textarea.value.slice(0, index)),
    marker,
    document.createTextNode(`${textarea.value.slice(index)}\n`),
  );
  pre.parentNode.append(mirror);
  const rect = marker.getBoundingClientRect();
  mirror.remove();
  return rect;
}

const COMPLETION_ID = 'prompt-completion';

/**
 * The legacy prompt editor: a textarea over a painted copy of its text, so every `{变量}` shows its
 * state (defined / empty / undefined) while typing stays a plain textarea. Below it, as a sibling
 * (the surface clips its own box), the summary foot and the unclosed-brace hint.
 */
export function PromptSurface({
  id,
  value,
  onChange,
  onBlur,
  known,
  sources,
  used,
  prose,
  label,
  placeholder,
  className,
  foot = true,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  known: KnownVariables;
  sources?: PromptSources;
  used?: PromptUsage;
  prose?: boolean;
  label?: string;
  placeholder?: string;
  className?: string;
  foot?: boolean;
}) {
  const { t } = useTranslation();
  const pre = useRef<HTMLPreElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const report = useMemo(() => variableReport(value, known), [value, known]);
  const unclosed = hasUnclosedBrace(value);
  const summary = !report.names.length
    ? t('ws.prompt.hint')
    : [
        t('ws.prompt.found', { count: report.names.length }),
        report.unknown.length
          ? t('ws.prompt.unknown', {
              count: report.unknown.length,
              names: report.unknown.join(', '),
            })
          : '',
        report.empty.length
          ? t('ws.prompt.empty', { count: report.empty.length, names: report.empty.join(', ') })
          : '',
      ]
        .filter(Boolean)
        .join(' · ');

  const close = useCallback(() => setCompletion(null), []);
  const refresh = useCallback(
    (el: HTMLTextAreaElement) => {
      const range =
        el.selectionStart === el.selectionEnd
          ? completionQueryAt(el.value, el.selectionStart)
          : null;
      if (!range) return setCompletion(null);
      const items = rankCompletions(completionCandidates(known, sources, used), range.query);
      if (!items.length) return setCompletion(null);
      setCompletion((prev) => {
        const same = prev?.items[prev.index]?.key;
        const kept = range.query === '' ? -1 : items.findIndex((item) => item.key === same);
        return { range, items, index: Math.max(0, kept) };
      });
    },
    [known, sources, used],
  );
  const accept = useCallback(
    (index?: number) => {
      const el = area.current;
      if (!completion || !el) return;
      const item = completion.items[index ?? completion.index];
      if (!item) return setCompletion(null);
      const range = completionQueryAt(el.value, el.selectionStart) ?? completion.range;
      const next = applyCompletion(el.value, range, item.key);
      setCompletion(null);
      // Same as the legacy setRangeText: the DOM already holds the text when the parent re-renders,
      // so React leaves the caret where we put it.
      el.value = next.text;
      el.setSelectionRange(next.caret, next.caret);
      el.focus();
      onChange(next.text);
    },
    [completion, onChange],
  );
  const move = useCallback((step: number) => {
    setCompletion((prev) =>
      prev ? { ...prev, index: (prev.index + step + prev.items.length) % prev.items.length } : prev,
    );
  }, []);

  // While the listbox is open its keys belong to it and never reach dialog / shortcut handlers.
  useEffect(() => {
    if (!completion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== area.current || e.isComposing || e.keyCode === 229) return;
      const page = Math.min(4, completion.items.length - 1);
      if (e.key === 'ArrowDown') move(1);
      else if (e.key === 'ArrowUp') move(-1);
      else if (e.key === 'PageDown') move(page);
      else if (e.key === 'PageUp') move(-page);
      else if (e.key === 'Enter' || e.key === 'Tab') accept();
      else if (e.key === 'Escape') close();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target !== area.current && !target?.closest?.(`#${COMPLETION_ID}`)) close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [completion, move, accept, close]);

  const list = useRef<HTMLDivElement>(null);
  const place = useCallback(() => {
    const el = area.current;
    const box = list.current;
    if (!completion || !el || !box) return;
    const anchor = caretRect(el, pre.current, completion.range.start);
    const bounds = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, vw - box.offsetWidth - 8));
    const lineBottom = Math.min(Math.max(anchor.bottom, bounds.top), bounds.bottom);
    const lineTop = Math.min(Math.max(anchor.top, bounds.top), bounds.bottom);
    let top = lineBottom + 6;
    if (top + box.offsetHeight > vh - 8 && lineTop - 6 - box.offsetHeight >= 8)
      top = lineTop - 6 - box.offsetHeight;
    top = Math.max(8, top);
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [completion]);
  useLayoutEffect(() => {
    if (!completion) {
      setPos(null);
      return;
    }
    place();
    list.current?.querySelector('.active')?.scrollIntoView?.({ block: 'nearest' });
    document.addEventListener('scroll', place, true);
    return () => document.removeEventListener('scroll', place, true);
  }, [completion, place]);

  const host = completion ? (topDialog() ?? document.body) : null;
  return (
    <>
      <div className={`prompt-surface${prose ? ' prose' : ''}`} data-prompt-context="workshop">
        <div className="prompt-paint-viewport" aria-hidden="true">
          <pre className="prompt-paint" ref={pre}>
            {paint(value, known)}
          </pre>
        </div>
        <textarea
          id={id}
          ref={area}
          className={className}
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={completion ? COMPLETION_ID : undefined}
          aria-expanded={completion ? true : undefined}
          aria-activedescendant={completion ? `${COMPLETION_ID}-${completion.index}` : undefined}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value);
            if ((e.nativeEvent as Partial<InputEvent>).isComposing) close();
            else refresh(e.target);
          }}
          onKeyUp={(e) => {
            if (completion && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key))
              refresh(e.currentTarget);
          }}
          onBlur={() => {
            close();
            onBlur?.();
          }}
          onScroll={(e) => {
            if (pre.current)
              pre.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
          }}
        />
      </div>
      {foot ? (
        <div className="prompt-editor-foot">
          <div className="prompt-foot">
            <i
              className="dot"
              data-state={report.unknown.length || report.empty.length ? 'warn' : 'ok'}
            />
            <span className="prompt-summary">{summary}</span>
          </div>
          <p className="prompt-hint" hidden={!unclosed}>
            {t('ws.prompt.unclosed')}
          </p>
        </div>
      ) : null}
      {completion && host
        ? createPortal(
            <div
              id={COMPLETION_ID}
              ref={list}
              role="listbox"
              aria-label={t('ws.prompt.completion')}
              style={{
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                visibility: pos ? 'visible' : 'hidden',
              }}
              onPointerDown={(e) => e.preventDefault()}
            >
              {completion.items.map((item, index) => {
                const conflict = item.sources.length > 1;
                return (
                  <div
                    key={item.key}
                    role="option"
                    id={`${COMPLETION_ID}-${index}`}
                    aria-selected={index === completion.index}
                    className={`${index === completion.index ? 'active' : ''} state-${item.state}`}
                    onPointerMove={() => {
                      if (index !== completion.index)
                        setCompletion((prev) => (prev ? { ...prev, index } : prev));
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      accept(index);
                    }}
                  >
                    <span className="key">{`{${item.key}}`}</span>
                    {item.sources.length ? (
                      <span className="source">
                        {conflict
                          ? t('ws.prompt.presetCount', { count: item.sources.length })
                          : item.sources[0].title}
                      </span>
                    ) : null}
                    {item.preview ? <span className="preview">{item.preview}</span> : null}
                    {item.state === 'unknown' ? (
                      <span className="note warn">
                        {t('ws.prompt.undefined')}
                        {item.used ? ` · ${t('ws.prompt.usedTimes', { count: item.used })}` : ''}
                      </span>
                    ) : item.state === 'empty' ? (
                      <span className="note">{t('ws.prompt.emptyValue')}</span>
                    ) : null}
                    {conflict ? (
                      <span className="note warn">
                        {t('ws.prompt.conflict', {
                          count: item.sources.length,
                          names: item.sources.map((s) => s.title).join('、'),
                        })}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              <div className="foot">{t('ws.prompt.completionKeys')}</div>
            </div>,
            host,
          )
        : null}
    </>
  );
}
