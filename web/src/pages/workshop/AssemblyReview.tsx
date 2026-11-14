import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssemblyPreview, type AssembleVars, type AssemblyVariable } from '../../api/workshop';
import './assembly-review.css';

export function AssemblyReview({
  body,
  variables,
  onVariables,
}: {
  body: AssembleVars;
  variables: Record<string, string>;
  onVariables: (next: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const preview = useAssemblyPreview(body, true);
  const [expanded, setExpanded] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const panels = useRef(new Map<string, HTMLElement>());
  const fields = useRef(new Map<string, HTMLElement>());
  // A refetch must not present the previous report as a verified current preview.
  const report = !preview.isFetching && !preview.isError ? preview.data : undefined;
  const problems = report?.panels.flatMap((panel) =>
    panel.variables
      .filter((v) => ['missing', 'cycle', 'depth_limit'].includes(v.status))
      .map((variable) => ({ panel, variable })),
  );
  const keys = [
    ...new Set([...(problems ?? []).map((p) => p.variable.key), ...Object.keys(variables)]),
  ];
  const fieldName = (field: string) => {
    if (field.startsWith('dialogues.'))
      return t('ws.assemble.review.dialogue', { n: Number(field.split('.')[1]) + 1 });
    return t(`ws.assemble.review.fields.${field.split('.').at(-1)}`);
  };
  const sourceName = (variable: AssemblyVariable) =>
    [t(`ws.assemble.review.sources.${variable.source}`), variable.source_title]
      .filter(Boolean)
      .join(' · ');
  const locate = (panelId: string, field: string) => {
    setExpanded(true);
    if (details.current) details.current.open = true;
    const element = fields.current.get(`${panelId}:${field}`) ?? panels.current.get(panelId);
    element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    element?.focus();
  };

  return (
    <section className="designer-card assembly-review" aria-label={t('ws.assemble.review.title')}>
      <header className="designer-card-head">
        <h4>{t('ws.assemble.review.title')}</h4>
      </header>
      {preview.isFetching || preview.isPending ? (
        <p role="status">{t('ws.assemble.review.loading')}</p>
      ) : preview.isError ? (
        <div role="alert">
          <p>{t('ws.assemble.review.failed', { message: preview.error.message })}</p>
          <button type="button" className="btn" onClick={() => void preview.refetch()}>
            {t('ws.assemble.review.retry')}
          </button>
        </div>
      ) : report ? (
        <>
          <p role="status">
            {problems?.length
              ? t('ws.assemble.review.missing', { count: problems.length })
              : t('ws.assemble.review.checked', { count: report.panels.length })}
          </p>
          {problems?.length ? (
            <ul className="assembly-review-problems">
              {problems.map(({ panel, variable }, i) => (
                <li key={`${panel.panel_id}-${variable.field}-${variable.key}-${i}`}>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => locate(panel.panel_id, variable.field)}
                  >
                    {t('ws.assemble.review.scene', { n: panel.order + 1 })} ·{' '}
                    {fieldName(variable.field)} · {`{${variable.key}}`} ·{' '}
                    {t(`ws.assemble.review.status.${variable.status}`)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {keys.length ? (
        <fieldset className="assembly-review-variables">
          <legend>{t('ws.assemble.review.temporary')}</legend>
          <p className="help">{t('ws.assemble.review.temporaryHelp')}</p>
          {keys.map((key) => (
            <label key={key}>
              <span>{`{${key}}`}</span>
              <input
                aria-label={t('ws.assemble.review.variable', { name: key })}
                value={variables[key] ?? ''}
                placeholder={t('ws.assemble.review.variableHint')}
                onChange={(e) => onVariables({ ...variables, [key]: e.target.value })}
              />
              {Object.hasOwn(variables, key) ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() =>
                    onVariables(
                      Object.fromEntries(Object.entries(variables).filter(([k]) => k !== key)),
                    )
                  }
                >
                  {t('ws.assemble.review.remove')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => onVariables({ ...variables, [key]: '' })}
                >
                  {t('ws.assemble.review.useEmpty')}
                </button>
              )}
            </label>
          ))}
        </fieldset>
      ) : null}
      {report ? (
        <details
          ref={details}
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>{t('ws.assemble.review.expand')}</summary>
          {report.panels.map((panel) => (
            <article
              key={panel.panel_id}
              tabIndex={-1}
              ref={(node) => {
                if (node) panels.current.set(panel.panel_id, node);
                else panels.current.delete(panel.panel_id);
              }}
              aria-label={t('ws.assemble.review.scene', { n: panel.order + 1 })}
            >
              <h5>
                {t('ws.assemble.review.scene', { n: panel.order + 1 })} · {panel.title}
              </h5>
              <dl className="assembly-review-text">
                <dt>{t('ws.assemble.review.positive')}</dt>
                <dd>{panel.positive || t('ws.assemble.review.empty')}</dd>
                <dt>{t('ws.assemble.review.negative')}</dt>
                <dd>{panel.negative || t('ws.assemble.review.empty')}</dd>
                {panel.dialogues.map((line, i) => (
                  <div key={i}>
                    <dt>{t('ws.assemble.review.dialogue', { n: i + 1 })}</dt>
                    <dd>{line || t('ws.assemble.review.empty')}</dd>
                  </div>
                ))}
              </dl>
              {panel.variables.length ? (
                <ul className="assembly-review-values">
                  {panel.variables.map((variable, i) => (
                    <li
                      key={`${variable.field}-${variable.key}-${i}`}
                      tabIndex={-1}
                      ref={(node) => {
                        const key = `${panel.panel_id}:${variable.field}`;
                        if (node) fields.current.set(key, node);
                        else fields.current.delete(key);
                      }}
                      aria-label={`${fieldName(variable.field)} · {${variable.key}}`}
                    >
                      <code>{`{${variable.key}}`}</code>
                      <span>
                        {fieldName(variable.field)} · {sourceName(variable)} ·{' '}
                        {t(`ws.assemble.review.status.${variable.status}`)}
                      </span>
                      <q>{variable.value ?? t('ws.assemble.review.unresolved')}</q>
                      {variable.chain.length > 1 ? (
                        <small>{variable.chain.join(' → ')}</small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </details>
      ) : null}
    </section>
  );
}
