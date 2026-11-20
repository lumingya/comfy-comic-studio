import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROMPT_TOKEN, variableUsage } from './PromptSurface';

const MAX_DEPTH = 4; // Same substitution depth as the server.
const PREVIEW_LENGTH = 12_000;

type PreviewPart = { text: string; missing?: 'unknown' | 'empty'; name?: string };

function expandForPreview(text: string, values: ReadonlyMap<string, string>): PreviewPart[] {
  const parts: PreviewPart[] = [];
  let remaining = PREVIEW_LENGTH;
  let truncated = false;
  const append = (value: string, missing?: PreviewPart['missing'], name?: string) => {
    if (!value) return;
    if (value.length > remaining) truncated = true;
    if (remaining > 0) parts.push({ text: value.slice(0, remaining), missing, name });
    remaining -= value.length;
  };
  const walk = (input: string, depth: number) => {
    let start = 0;
    for (const match of input.matchAll(PROMPT_TOKEN)) {
      const [token, name] = match;
      append(input.slice(start, match.index));
      if (!name) append(token[0]);
      else {
        const value = values.get(name.trim());
        if (!value?.trim()) append(token, value === undefined ? 'unknown' : 'empty', name.trim());
        else if (depth < MAX_DEPTH) walk(value, depth + 1);
        else append(value.replaceAll('{{', '{').replaceAll('}}', '}'));
      }
      start = match.index + token.length;
      if (remaining <= 0) break;
    }
    append(input.slice(start));
  };
  walk(text, 0);
  if (truncated) parts.push({ text: '…' });
  return parts;
}

export function FrameVariablePreview({
  prompt,
  negative,
  caption,
  values,
  onResolve,
}: {
  prompt: string;
  negative: string;
  caption: string;
  values: ReadonlyMap<string, string>;
  onResolve?: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const fields = [
    [t('ws.story.prompt'), prompt],
    [t('ws.story.negative'), negative],
    [t('ws.story.caption'), caption],
  ] as const;
  if (!variableUsage([prompt, negative, caption]).size) return null;

  return (
    <details
      className="quiet-advanced workshop-variable-preview"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t('ws.story.variablePreview.title')}</summary>
      <p className="help">{t('ws.story.variablePreview.scope')}</p>
      {open ? (
        <dl>
          {fields
            .filter(([, text]) => text.trim())
            .map(([label, text]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd className="prompt-resolved">
                  {expandForPreview(text, values).map((part, i) => {
                    if (!part.missing) return <Fragment key={i}>{part.text}</Fragment>;
                    const token = (
                      <mark
                        className={`${part.missing}-token`}
                        title={t(`ws.story.variablePreview.${part.missing}`)}
                      >
                        {part.text}
                      </mark>
                    );
                    return onResolve && part.name ? (
                      <button
                        key={i}
                        type="button"
                        className="variable-fix-token"
                        aria-label={t('bibleAssist.fill', { name: `{${part.name}}` })}
                        onClick={() => onResolve(part.name!)}
                      >
                        {token}
                      </button>
                    ) : (
                      <Fragment key={i}>{token}</Fragment>
                    );
                  })}
                </dd>
              </Fragment>
            ))}
        </dl>
      ) : null}
    </details>
  );
}
