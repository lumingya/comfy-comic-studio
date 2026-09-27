import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { promptVariables } from '../../api/workshop';

/** Variable name → has a (non-empty) value somewhere. */
export type KnownVariables = Map<string, boolean>;

function paint(text: string, known: KnownVariables): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{([^\s{}]{1,64})\}/g)) {
    const state = known.has(m[1]) ? (known.get(m[1]) ? 'defined' : 'empty') : null;
    if (!state) continue;
    out.push(text.slice(at, m.index));
    out.push(
      <mark
        key={m.index}
        className={state === 'empty' ? 'empty-token' : ''}
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

/**
 * The legacy prompt editor: a textarea over a painted copy of its text, so `{变量}` that a preset
 * defines are highlighted (empty ones dimmed) while typing stays a plain textarea.
 */
export function PromptSurface({
  id,
  value,
  onChange,
  onBlur,
  known,
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
  prose?: boolean;
  label?: string;
  placeholder?: string;
  className?: string;
  foot?: boolean;
}) {
  const { t } = useTranslation();
  const pre = useRef<HTMLPreElement>(null);
  const used = promptVariables(value);
  const recognised = used.filter((k) => known.has(k));
  const empty = recognised.filter((k) => !known.get(k));
  const unclosed = (value.match(/\{/g)?.length ?? 0) !== (value.match(/\}/g)?.length ?? 0);
  return (
    <div className={`prompt-surface${prose ? ' prose' : ''}`} data-prompt-context="workshop">
      <div className="prompt-paint-viewport" aria-hidden="true">
        <pre className="prompt-paint" ref={pre}>
          {paint(value, known)}
        </pre>
      </div>
      <textarea
        id={id}
        className={className}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onScroll={(e) => {
          if (pre.current)
            pre.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
        }}
      />
      {foot ? (
        <div className="prompt-editor-foot">
          <div className="prompt-foot">
            <i className="dot" data-state={empty.length ? 'warn' : 'ok'} />
            <span className="prompt-summary">
              {recognised.length
                ? empty.length
                  ? t('ws.prompt.someEmpty', {
                      count: recognised.length,
                      empty: empty.length,
                      names: empty.join('、'),
                    })
                  : t('ws.prompt.found', { count: recognised.length })
                : t('ws.prompt.hint')}
            </span>
          </div>
          <p className="prompt-hint" hidden={!unclosed}>
            {t('ws.prompt.unclosed')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
