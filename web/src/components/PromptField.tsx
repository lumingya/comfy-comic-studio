import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Same grammar as the server (`pipeline/variables.py`): `{{` / `}}` escape, names ≤ 64 chars. */
const PATTERN = /\{\{|\}\}|\{([^{}\s][^{}]{0,63})\}/g;

export type VarState = 'ok' | 'empty' | 'missing';

export interface VarUse {
  name: string;
  state: VarState;
}

/** Every `{name}` in `text`, in order of first use, with how it resolves. */
export function scanVariables(text: string, known: Record<string, string>): VarUse[] {
  const seen = new Map<string, VarUse>();
  for (const m of text.matchAll(PATTERN)) {
    const name = m[1]?.trim();
    if (!name || seen.has(name)) continue;
    const state: VarState = !(name in known) ? 'missing' : known[name] ? 'ok' : 'empty';
    seen.set(name, { name, state });
  }
  return [...seen.values()];
}

function highlight(text: string, known: Record<string, string>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const name = m[1]?.trim();
    if (name) {
      const state = !(name in known) ? 'missing' : known[name] ? 'ok' : 'empty';
      out.push(
        <mark key={i++} className={`var is-${state}`}>
          {m[0]}
        </mark>,
      );
    } else out.push(m[0]);
    last = at + m[0].length;
  }
  out.push(text.slice(last));
  // A trailing newline needs a character after it or the mirror is one line short.
  out.push('\u200b');
  return out;
}

/**
 * The classic prompt box: a monospace textarea over a mirror that paints `{变量}` as chips
 * (defined → sage, empty value → dim, unknown → dashed), growing with its content.
 */
export function PromptField(props: {
  value: string;
  onChange: (value: string) => void;
  known: Record<string, string>;
  placeholder?: string;
  minRows?: number;
  'aria-label'?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = props.inputRef ?? own;
  const mirror = useRef<HTMLDivElement>(null);

  // Grow with the text (the mirror is absolutely positioned over the same box).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value, ref]);

  return (
    <div className="prompt-field">
      <div className="prompt-mirror" ref={mirror} aria-hidden>
        {highlight(props.value, props.known)}
      </div>
      <textarea
        ref={ref}
        className="prompt-input"
        value={props.value}
        rows={props.minRows ?? 5}
        spellCheck={false}
        placeholder={props.placeholder}
        aria-label={props['aria-label']}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={props.onKeyDown}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}

/** Insert `{name}` at the caret, adding a comma separator when the prompt needs one. */
export function insertVariable(
  el: HTMLTextAreaElement | null,
  value: string,
  name: string,
): { text: string; caret: number } {
  const token = `{${name}}`;
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const needsComma = before.trim() && !/[,，(\s]\s*$/.test(before);
  const lead = needsComma ? ', ' : before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s*[,，)]/.test(after) ? ', ' : '';
  const text = `${before}${lead}${token}${trail}${after}`;
  return { text, caret: before.length + lead.length + token.length };
}
